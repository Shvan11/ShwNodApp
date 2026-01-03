-- =============================================
-- Aligner Batch Trigger Optimization
-- =============================================
-- Converts 5 heavy triggers into 3 optimized stored procedures
-- Optimizes sync trigger to be non-blocking
-- Expected performance: 16+ seconds → 50-100ms (99%+ improvement)
-- =============================================

USE [ShwanNew]
GO

PRINT '';
PRINT '========================================';
PRINT 'Aligner Batch Trigger Optimization';
PRINT '========================================';
PRINT '';

-- =============================================
-- PHASE 1: Create Stored Procedures
-- =============================================

PRINT 'Phase 1: Creating stored procedures...';
PRINT '';

-- =============================================
-- Stored Procedure: usp_CreateAlignerBatch
-- =============================================
-- Purpose: Handle INSERT with validation, sequence calculation, and remaining count updates
-- Replaces: trg_ValidateAlignerBatchCounts, trg_AlignerBatches_SetAlignerSequences,
--           trg_AlignerBatches_UpdateRemainingCounts, trg_AlignerBatches_DaysChanged
-- =============================================

IF OBJECT_ID('dbo.usp_CreateAlignerBatch', 'P') IS NOT NULL
    DROP PROCEDURE dbo.usp_CreateAlignerBatch;
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE dbo.usp_CreateAlignerBatch
    @AlignerSetID INT,
    @UpperAlignerCount INT,
    @LowerAlignerCount INT,
    @ManufactureDate DATE = NULL,  -- Optional: NULL = pending manufacture
    @DeliveredToPatientDate DATE = NULL,
    @Days INT = NULL,
    @Notes NVARCHAR(255) = NULL,
    @IsActive BIT = 1,
    @IsLast BIT = 0,
    @NewBatchID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- ==========================================
        -- STEP 1: Validation with row lock
        -- ==========================================
        DECLARE @RemainingUpper INT, @RemainingLower INT;
        DECLARE @TotalUpper INT, @TotalLower INT;

        SELECT
            @RemainingUpper = RemainingUpperAligners,
            @RemainingLower = RemainingLowerAligners,
            @TotalUpper = UpperAlignersCount,
            @TotalLower = LowerAlignersCount
        FROM dbo.tblAlignerSets WITH (UPDLOCK)  -- Lock to prevent race conditions
        WHERE AlignerSetID = @AlignerSetID;

        IF @RemainingUpper IS NULL
        BEGIN
            THROW 50001, 'AlignerSet not found', 1;
        END

        IF @UpperAlignerCount > @RemainingUpper
        BEGIN
            DECLARE @UpperErrorMsg NVARCHAR(200) = 'Cannot add aligner batch: requested upper aligners ('
                + CAST(@UpperAlignerCount AS NVARCHAR) + ') exceed remaining count ('
                + CAST(@RemainingUpper AS NVARCHAR) + ')';
            THROW 50002, @UpperErrorMsg, 1;
        END

        IF @LowerAlignerCount > @RemainingLower
        BEGIN
            DECLARE @LowerErrorMsg NVARCHAR(200) = 'Cannot add aligner batch: requested lower aligners ('
                + CAST(@LowerAlignerCount AS NVARCHAR) + ') exceed remaining count ('
                + CAST(@RemainingLower AS NVARCHAR) + ')';
            THROW 50003, @LowerErrorMsg, 1;
        END

        -- ==========================================
        -- STEP 1B: Handle IsLast auto-activation
        -- ==========================================
        -- If IsLast = 1, ensure IsActive is also set to 1
        IF @IsLast = 1
        BEGIN
            SET @IsActive = 1;

            -- Deactivate all other batches in this set (both IsActive and IsLast)
            UPDATE dbo.tblAlignerBatches
            SET IsActive = 0, IsLast = 0
            WHERE AlignerSetID = @AlignerSetID;
        END
        ELSE IF @IsActive = 1
        BEGIN
            -- If only IsActive (not IsLast), just deactivate other active batches
            UPDATE dbo.tblAlignerBatches
            SET IsActive = 0
            WHERE AlignerSetID = @AlignerSetID AND IsActive = 1;
        END

        -- ==========================================
        -- STEP 2: Calculate sequences
        -- ==========================================
        DECLARE @UpperStartSeq INT, @LowerStartSeq INT, @BatchSequence INT;

        -- Get max sequences from existing batches (efficient - single query)
        SELECT
            @UpperStartSeq = ISNULL(MAX(UpperAlignerEndSequence), 0) + 1,
            @LowerStartSeq = ISNULL(MAX(LowerAlignerEndSequence), 0) + 1,
            @BatchSequence = ISNULL(MAX(BatchSequence), 0) + 1
        FROM dbo.tblAlignerBatches
        WHERE AlignerSetID = @AlignerSetID;

        -- Set to NULL if no aligners requested
        IF @UpperAlignerCount = 0 SET @UpperStartSeq = NULL;
        IF @LowerAlignerCount = 0 SET @LowerStartSeq = NULL;

        -- ==========================================
        -- STEP 3: Insert the batch
        -- ==========================================
        -- Note: ValidityPeriod and NextBatchReadyDate are computed columns
        --       and will be automatically calculated by SQL Server
        INSERT INTO dbo.tblAlignerBatches (
            AlignerSetID,
            UpperAlignerCount,
            LowerAlignerCount,
            ManufactureDate,
            DeliveredToPatientDate,
            Days,
            Notes,
            IsActive,
            IsLast,
            BatchSequence,
            UpperAlignerStartSequence,
            LowerAlignerStartSequence
        ) VALUES (
            @AlignerSetID,
            @UpperAlignerCount,
            @LowerAlignerCount,
            @ManufactureDate,
            @DeliveredToPatientDate,
            @Days,
            @Notes,
            @IsActive,
            @IsLast,
            @BatchSequence,
            @UpperStartSeq,
            @LowerStartSeq
        );

        SET @NewBatchID = SCOPE_IDENTITY();

        -- ==========================================
        -- STEP 5: Update remaining counts (incremental)
        -- ==========================================
        UPDATE dbo.tblAlignerSets
        SET
            RemainingUpperAligners = RemainingUpperAligners - @UpperAlignerCount,
            RemainingLowerAligners = RemainingLowerAligners - @LowerAlignerCount
        WHERE AlignerSetID = @AlignerSetID;

        COMMIT TRANSACTION;

    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        -- Re-throw the error
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();

        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO

PRINT '✅ Created usp_CreateAlignerBatch';

-- =============================================
-- Stored Procedure: usp_UpdateAlignerBatch
-- =============================================
-- Purpose: Handle UPDATE with validation, resequencing, and remaining count updates
-- Replaces: All 5 triggers for UPDATE operations
-- =============================================

IF OBJECT_ID('dbo.usp_UpdateAlignerBatch', 'P') IS NOT NULL
    DROP PROCEDURE dbo.usp_UpdateAlignerBatch;
GO

-- Required SET options for tables with persisted computed columns
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
SET ANSI_PADDING ON
GO
SET ANSI_WARNINGS ON
GO
SET ARITHABORT ON
GO
SET CONCAT_NULL_YIELDS_NULL ON
GO
SET NUMERIC_ROUNDABORT OFF
GO

CREATE PROCEDURE dbo.usp_UpdateAlignerBatch
    @AlignerBatchID INT,
    @AlignerSetID INT,
    @UpperAlignerCount INT,
    @LowerAlignerCount INT,
    @Days INT = NULL,
    @Notes NVARCHAR(255) = NULL,
    @IsActive BIT = NULL,
    @IsLast BIT = NULL
    -- NOTE: ManufactureDate and DeliveredToPatientDate are managed via usp_UpdateBatchStatus
AS
BEGIN
    SET NOCOUNT ON;
    -- Ensure correct settings for computed columns at runtime
    SET ANSI_WARNINGS ON;
    SET ARITHABORT ON;
    SET CONCAT_NULL_YIELDS_NULL ON;
    SET NUMERIC_ROUNDABORT OFF;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- ==========================================
        -- STEP 1: Fetch old values
        -- ==========================================
        DECLARE @OldAlignerSetID INT, @OldUpperCount INT, @OldLowerCount INT;
        DECLARE @OldDays INT;
        DECLARE @CurrentDeliveredToPatientDate DATE;  -- For IsActive validation

        SELECT
            @OldAlignerSetID = AlignerSetID,
            @OldUpperCount = UpperAlignerCount,
            @OldLowerCount = LowerAlignerCount,
            @OldDays = Days,
            @CurrentDeliveredToPatientDate = DeliveredToPatientDate
        FROM dbo.tblAlignerBatches
        WHERE AlignerBatchID = @AlignerBatchID;

        IF @OldAlignerSetID IS NULL
        BEGIN
            THROW 50010, 'Aligner batch not found', 1;
        END

        -- AlignerSetID cannot change
        IF @AlignerSetID != @OldAlignerSetID
        BEGIN
            THROW 50011, 'Cannot change AlignerSetID', 1;
        END

        -- ==========================================
        -- STEP 2: Validation
        -- ==========================================
        DECLARE @RemainingUpper INT, @RemainingLower INT;

        SELECT
            @RemainingUpper = RemainingUpperAligners,
            @RemainingLower = RemainingLowerAligners
        FROM dbo.tblAlignerSets WITH (UPDLOCK)
        WHERE AlignerSetID = @AlignerSetID;

        -- Check if new counts exceed remaining (accounting for old counts)
        IF @UpperAlignerCount > (@RemainingUpper + @OldUpperCount)
        BEGIN
            DECLARE @UpperErrorMsg NVARCHAR(200) = 'Cannot update aligner batch: requested upper aligners ('
                + CAST(@UpperAlignerCount AS NVARCHAR) + ') exceed available count ('
                + CAST(@RemainingUpper + @OldUpperCount AS NVARCHAR) + ')';
            THROW 50012, @UpperErrorMsg, 1;
        END

        IF @LowerAlignerCount > (@RemainingLower + @OldLowerCount)
        BEGIN
            DECLARE @LowerErrorMsg NVARCHAR(200) = 'Cannot update aligner batch: requested lower aligners ('
                + CAST(@LowerAlignerCount AS NVARCHAR) + ') exceed available count ('
                + CAST(@RemainingLower + @OldLowerCount AS NVARCHAR) + ')';
            THROW 50013, @LowerErrorMsg, 1;
        END

        -- ==========================================
        -- STEP 2B: Handle IsLast and IsActive
        -- ==========================================
        -- IsLast: Only one batch can be marked as last (planning purposes)
        -- IsActive: Only one batch can be active, and must be delivered first

        -- IsLast does NOT auto-activate anymore
        IF @IsLast = 1
        BEGIN
            -- Only clear IsLast from other batches (one batch can be "last")
            UPDATE dbo.tblAlignerBatches
            SET IsLast = 0
            WHERE AlignerSetID = @AlignerSetID
            AND AlignerBatchID != @AlignerBatchID
            AND IsLast = 1;
        END

        -- IsActive requires DeliveredToPatientDate
        IF @IsActive = 1
        BEGIN
            -- Validate: must be delivered first
            IF @CurrentDeliveredToPatientDate IS NULL
            BEGIN
                THROW 50014, 'Cannot set IsActive: batch must be delivered first', 1;
            END

            -- Deactivate other batches
            UPDATE dbo.tblAlignerBatches
            SET IsActive = 0
            WHERE AlignerSetID = @AlignerSetID
            AND AlignerBatchID != @AlignerBatchID
            AND IsActive = 1;
        END

        -- ==========================================
        -- STEP 3: Detect changes
        -- ==========================================
        -- NOTE: ManufactureDate changes are now handled via usp_UpdateBatchStatus
        DECLARE @CountsChanged BIT = 0;
        DECLARE @DaysChanged BIT = 0;

        IF @UpperAlignerCount != @OldUpperCount OR @LowerAlignerCount != @OldLowerCount
            SET @CountsChanged = 1;

        IF (@Days IS NULL AND @OldDays IS NOT NULL)
            OR (@Days IS NOT NULL AND @OldDays IS NULL)
            OR (@Days IS NOT NULL AND @OldDays IS NOT NULL AND @Days != @OldDays)
            SET @DaysChanged = 1;

        -- ==========================================
        -- STEP 4: Update the batch
        -- ==========================================
        -- Note: ValidityPeriod and BatchExpiryDate are computed columns
        --       and will be automatically recalculated by SQL Server
        -- NOTE: ManufactureDate and DeliveredToPatientDate are NOT updated here
        --       They are managed via usp_UpdateBatchStatus
        UPDATE dbo.tblAlignerBatches
        SET
            UpperAlignerCount = @UpperAlignerCount,
            LowerAlignerCount = @LowerAlignerCount,
            Days = @Days,
            Notes = @Notes,
            IsActive = ISNULL(@IsActive, IsActive),
            IsLast = ISNULL(@IsLast, IsLast)
        WHERE AlignerBatchID = @AlignerBatchID;

        -- ==========================================
        -- STEP 5: Resequence if counts changed
        -- ==========================================
        IF @CountsChanged = 1
        BEGIN
            -- Resequence ALL batches in the set
            WITH OrderedBatches AS (
                SELECT
                    AlignerBatchID,
                    ROW_NUMBER() OVER (ORDER BY ManufactureDate, AlignerBatchID) AS NewSequence
                FROM dbo.tblAlignerBatches
                WHERE AlignerSetID = @AlignerSetID
            )
            UPDATE b
            SET BatchSequence = o.NewSequence
            FROM dbo.tblAlignerBatches b
            INNER JOIN OrderedBatches o ON b.AlignerBatchID = o.AlignerBatchID
            WHERE b.BatchSequence != o.NewSequence;

            -- Recalculate aligner start/end sequences
            WITH OrderedBatches AS (
                SELECT
                    AlignerBatchID,
                    UpperAlignerCount,
                    LowerAlignerCount,
                    ROW_NUMBER() OVER (ORDER BY ManufactureDate, AlignerBatchID) AS RowNum
                FROM dbo.tblAlignerBatches
                WHERE AlignerSetID = @AlignerSetID
            ),
            CumulativeSums AS (
                SELECT
                    AlignerBatchID,
                    UpperAlignerCount,
                    LowerAlignerCount,
                    ISNULL(SUM(UpperAlignerCount) OVER (
                        ORDER BY RowNum
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ), 0) AS PrevUpperCount,
                    ISNULL(SUM(LowerAlignerCount) OVER (
                        ORDER BY RowNum
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ), 0) AS PrevLowerCount
                FROM OrderedBatches
            )
            UPDATE b
            SET
                UpperAlignerStartSequence = CASE
                    WHEN c.UpperAlignerCount > 0
                    THEN c.PrevUpperCount + 1
                    ELSE NULL
                END,
                LowerAlignerStartSequence = CASE
                    WHEN c.LowerAlignerCount > 0
                    THEN c.PrevLowerCount + 1
                    ELSE NULL
                END
            FROM dbo.tblAlignerBatches b
            INNER JOIN CumulativeSums c ON b.AlignerBatchID = c.AlignerBatchID;
        END

        -- ==========================================
        -- STEP 6: Update remaining counts (delta)
        -- ==========================================
        DECLARE @UpperDelta INT = @UpperAlignerCount - @OldUpperCount;
        DECLARE @LowerDelta INT = @LowerAlignerCount - @OldLowerCount;

        IF @UpperDelta != 0 OR @LowerDelta != 0
        BEGIN
            UPDATE dbo.tblAlignerSets
            SET
                RemainingUpperAligners = RemainingUpperAligners - @UpperDelta,
                RemainingLowerAligners = RemainingLowerAligners - @LowerDelta
            WHERE AlignerSetID = @AlignerSetID;
        END

        -- ==========================================
        -- STEP 7: Log Days changes to activity flags
        -- ==========================================
        IF @DaysChanged = 1
        BEGIN
            INSERT INTO dbo.tblAlignerActivityFlags (
                AlignerSetID,
                ActivityType,
                ActivityDescription,
                RelatedRecordID
            )
            VALUES (
                @AlignerSetID,
                'DaysChanged',
                'Days changed from ' + ISNULL(CAST(@OldDays AS VARCHAR), 'not set') +
                ' to ' + ISNULL(CAST(@Days AS VARCHAR), 'not set'),
                @AlignerBatchID
            );
        END

        COMMIT TRANSACTION;

    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();

        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO

PRINT '✅ Created usp_UpdateAlignerBatch';

-- =============================================
-- Stored Procedure: usp_DeleteAlignerBatch
-- =============================================
-- Purpose: Handle DELETE with remaining count restoration and resequencing
-- Replaces: trg_AlignerBatches_UpdateRemainingCounts for DELETE
-- =============================================

IF OBJECT_ID('dbo.usp_DeleteAlignerBatch', 'P') IS NOT NULL
    DROP PROCEDURE dbo.usp_DeleteAlignerBatch;
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE dbo.usp_DeleteAlignerBatch
    @AlignerBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- ==========================================
        -- STEP 1: Fetch batch data before deletion
        -- ==========================================
        DECLARE @AlignerSetID INT, @UpperCount INT, @LowerCount INT;

        SELECT
            @AlignerSetID = AlignerSetID,
            @UpperCount = UpperAlignerCount,
            @LowerCount = LowerAlignerCount
        FROM dbo.tblAlignerBatches
        WHERE AlignerBatchID = @AlignerBatchID;

        IF @AlignerSetID IS NULL
        BEGIN
            THROW 50020, 'Aligner batch not found', 1;
        END

        -- ==========================================
        -- STEP 2: Delete the batch
        -- ==========================================
        DELETE FROM dbo.tblAlignerBatches
        WHERE AlignerBatchID = @AlignerBatchID;

        -- ==========================================
        -- STEP 3: Restore remaining counts
        -- ==========================================
        UPDATE dbo.tblAlignerSets
        SET
            RemainingUpperAligners = RemainingUpperAligners + @UpperCount,
            RemainingLowerAligners = RemainingLowerAligners + @LowerCount
        WHERE AlignerSetID = @AlignerSetID;

        -- ==========================================
        -- STEP 4: Resequence remaining batches
        -- ==========================================
        WITH OrderedBatches AS (
            SELECT
                AlignerBatchID,
                ROW_NUMBER() OVER (ORDER BY ManufactureDate, AlignerBatchID) AS NewSequence
            FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID
        )
        UPDATE b
        SET BatchSequence = o.NewSequence
        FROM dbo.tblAlignerBatches b
        INNER JOIN OrderedBatches o ON b.AlignerBatchID = o.AlignerBatchID;

        -- Recalculate sequences
        WITH OrderedBatches AS (
            SELECT
                AlignerBatchID,
                UpperAlignerCount,
                LowerAlignerCount,
                ROW_NUMBER() OVER (ORDER BY ManufactureDate, AlignerBatchID) AS RowNum
            FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID
        ),
        CumulativeSums AS (
            SELECT
                AlignerBatchID,
                UpperAlignerCount,
                LowerAlignerCount,
                ISNULL(SUM(UpperAlignerCount) OVER (
                    ORDER BY RowNum
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0) AS PrevUpperCount,
                ISNULL(SUM(LowerAlignerCount) OVER (
                    ORDER BY RowNum
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0) AS PrevLowerCount
            FROM OrderedBatches
        )
        UPDATE b
        SET
            UpperAlignerStartSequence = CASE
                WHEN c.UpperAlignerCount > 0
                THEN c.PrevUpperCount + 1
                ELSE NULL
            END,
            LowerAlignerStartSequence = CASE
                WHEN c.LowerAlignerCount > 0
                THEN c.PrevLowerCount + 1
                ELSE NULL
            END
        FROM dbo.tblAlignerBatches b
        INNER JOIN CumulativeSums c ON b.AlignerBatchID = c.AlignerBatchID;

        COMMIT TRANSACTION;

    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();

        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO

PRINT '✅ Created usp_DeleteAlignerBatch';
PRINT '';

-- =============================================
-- PHASE 2: Drop Old Triggers
-- =============================================

PRINT 'Phase 2: Dropping old triggers...';
PRINT '';

IF OBJECT_ID('dbo.trg_ValidateAlignerBatchCounts', 'TR') IS NOT NULL
BEGIN
    DROP TRIGGER dbo.trg_ValidateAlignerBatchCounts;
    PRINT '✅ Dropped trg_ValidateAlignerBatchCounts';
END

IF OBJECT_ID('dbo.trg_AlignerBatches_SetAlignerSequences', 'TR') IS NOT NULL
BEGIN
    DROP TRIGGER dbo.trg_AlignerBatches_SetAlignerSequences;
    PRINT '✅ Dropped trg_AlignerBatches_SetAlignerSequences';
END

IF OBJECT_ID('dbo.trg_AlignerBatches_UpdateRemainingCounts', 'TR') IS NOT NULL
BEGIN
    DROP TRIGGER dbo.trg_AlignerBatches_UpdateRemainingCounts;
    PRINT '✅ Dropped trg_AlignerBatches_UpdateRemainingCounts';
END

IF OBJECT_ID('dbo.trg_AlignerBatches_ResequenceOnUpdate', 'TR') IS NOT NULL
BEGIN
    DROP TRIGGER dbo.trg_AlignerBatches_ResequenceOnUpdate;
    PRINT '✅ Dropped trg_AlignerBatches_ResequenceOnUpdate';
END

IF OBJECT_ID('dbo.trg_AlignerBatches_DaysChanged', 'TR') IS NOT NULL
BEGIN
    DROP TRIGGER dbo.trg_AlignerBatches_DaysChanged;
    PRINT '✅ Dropped trg_AlignerBatches_DaysChanged';
END

PRINT '';

-- =============================================
-- PHASE 3: Optimize Sync Trigger
-- =============================================

PRINT 'Phase 3: Creating optimized sync trigger...';
PRINT '';

-- Drop existing sync trigger
IF OBJECT_ID('dbo.trg_sync_tblAlignerBatches', 'TR') IS NOT NULL
    DROP TRIGGER dbo.trg_sync_tblAlignerBatches;
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Create optimized version (no JSON building)
CREATE TRIGGER dbo.trg_sync_tblAlignerBatches
ON dbo.tblAlignerBatches
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Only insert if there are actual changes
    IF NOT EXISTS (
        SELECT 1 FROM inserted i
        LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID
        WHERE d.AlignerBatchID IS NULL  -- INSERT
           OR (  -- UPDATE with actual changes
               ISNULL(i.Days, -1) <> ISNULL(d.Days, -1)
               OR ISNULL(i.UpperAlignerCount, -1) <> ISNULL(d.UpperAlignerCount, -1)
               OR ISNULL(i.LowerAlignerCount, -1) <> ISNULL(d.LowerAlignerCount, -1)
               OR ISNULL(i.UpperAlignerStartSequence, -1) <> ISNULL(d.UpperAlignerStartSequence, -1)
               OR ISNULL(i.UpperAlignerEndSequence, -1) <> ISNULL(d.UpperAlignerEndSequence, -1)
               OR ISNULL(i.LowerAlignerStartSequence, -1) <> ISNULL(d.LowerAlignerStartSequence, -1)
               OR ISNULL(i.LowerAlignerEndSequence, -1) <> ISNULL(d.LowerAlignerEndSequence, -1)
               OR ISNULL(CAST(i.ManufactureDate AS VARCHAR), '') <> ISNULL(CAST(d.ManufactureDate AS VARCHAR), '')
               OR ISNULL(CAST(i.DeliveredToPatientDate AS VARCHAR), '') <> ISNULL(CAST(d.DeliveredToPatientDate AS VARCHAR), '')
               OR ISNULL(i.ValidityPeriod, -1) <> ISNULL(d.ValidityPeriod, -1)
               OR ISNULL(CAST(i.NextBatchReadyDate AS VARCHAR), '') <> ISNULL(CAST(d.NextBatchReadyDate AS VARCHAR), '')
               OR ISNULL(i.Notes, '') <> ISNULL(d.Notes, '')
               OR ISNULL(i.IsActive, 0) <> ISNULL(d.IsActive, 0)
               OR ISNULL(i.IsLast, 0) <> ISNULL(d.IsLast, 0)
               OR ISNULL(CAST(i.CreationDate AS VARCHAR), '') <> ISNULL(CAST(d.CreationDate AS VARCHAR), '')
           )
    )
    RETURN;

    -- Just store IDs - NO JSON building (5-10ms)
    -- Queue processor will fetch data and build JSON asynchronously
    INSERT INTO SyncQueue (TableName, RecordID, Operation, Status)
    SELECT
        'aligner_batches',
        i.AlignerBatchID,
        CASE WHEN d.AlignerBatchID IS NULL THEN 'INSERT' ELSE 'UPDATE' END,
        'pending'
    FROM inserted i
    LEFT JOIN deleted d ON i.AlignerBatchID = d.AlignerBatchID;

    -- Note: JsonData = NULL, queue processor will populate it
END
GO

PRINT '✅ Created optimized trg_sync_tblAlignerBatches (no JSON building)';
PRINT '';

-- =============================================
-- PHASE 4: Grant Permissions
-- =============================================

PRINT 'Phase 4: Granting permissions...';
PRINT '';

-- Grant EXECUTE permissions to appropriate roles/users
-- Adjust these based on your security model
GRANT EXECUTE ON dbo.usp_CreateAlignerBatch TO PUBLIC;
GRANT EXECUTE ON dbo.usp_UpdateAlignerBatch TO PUBLIC;
GRANT EXECUTE ON dbo.usp_DeleteAlignerBatch TO PUBLIC;

PRINT '✅ Granted EXECUTE permissions';
PRINT '';

-- =============================================
-- Summary
-- =============================================

PRINT '';
PRINT '========================================';
PRINT 'Migration Complete!';
PRINT '========================================';
PRINT '';
PRINT 'Summary:';
PRINT '  ✅ Created 3 stored procedures';
PRINT '     - usp_CreateAlignerBatch';
PRINT '     - usp_UpdateAlignerBatch';
PRINT '     - usp_DeleteAlignerBatch';
PRINT '';
PRINT '  ✅ Dropped 5 heavy triggers';
PRINT '     - trg_ValidateAlignerBatchCounts';
PRINT '     - trg_AlignerBatches_SetAlignerSequences';
PRINT '     - trg_AlignerBatches_UpdateRemainingCounts';
PRINT '     - trg_AlignerBatches_ResequenceOnUpdate';
PRINT '     - trg_AlignerBatches_DaysChanged';
PRINT '';
PRINT '  ✅ Optimized sync trigger';
PRINT '     - trg_sync_tblAlignerBatches (no JSON building)';
PRINT '';
PRINT 'Expected Performance:';
PRINT '  INSERT: 16,000ms → 50ms (99.7% faster)';
PRINT '  UPDATE: 8,000ms → 70ms (99.1% faster)';
PRINT '  DELETE: 4,000ms → 50ms (98.8% faster)';
PRINT '  Sync Trigger: 4,000ms → 10ms (99.75% faster)';
PRINT '';
PRINT 'Next Steps:';
PRINT '  1. Update Node.js API routes to call stored procedures';
PRINT '  2. Enhance queue processor to fetch data when JsonData is NULL';
PRINT '  3. Test CRUD operations';
PRINT '  4. Verify sync to Supabase works correctly';
PRINT '';
PRINT '========================================';
PRINT '';
GO
