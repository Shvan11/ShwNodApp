-- =============================================
-- Add Separate @IncludeUpperTemplate/@IncludeLowerTemplate Parameters
-- =============================================
-- FEATURE: Allow first batch to independently control template inclusion
--          for upper and lower aligners
--
-- USAGE:
--   @IncludeUpperTemplate = 1: Upper aligners start from 0 (template)
--   @IncludeUpperTemplate = 0: Upper aligners start from 1
--   @IncludeUpperTemplate = NULL: Keep existing upper start sequence
--   (Same for @IncludeLowerTemplate)
--
-- NOTE: This only affects the FIRST batch. Subsequent batches always
--       use cumulative counts regardless of these parameters.
-- =============================================

USE ShwanNew;
GO

-- =============================================
-- UPDATE STORED PROCEDURE: usp_CreateAlignerBatch
-- =============================================

-- Drop existing procedure
IF EXISTS (SELECT 1 FROM sys.objects WHERE type = 'P' AND name = 'usp_CreateAlignerBatch')
BEGIN
    DROP PROCEDURE dbo.usp_CreateAlignerBatch;
    PRINT 'Dropped old usp_CreateAlignerBatch procedure';
END
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Create updated version with separate template parameters
CREATE PROCEDURE dbo.usp_CreateAlignerBatch
    @AlignerSetID INT,
    @UpperAlignerCount INT,
    @LowerAlignerCount INT,
    @ManufactureDate DATE,
    @DeliveredToPatientDate DATE = NULL,
    @Days INT = NULL,
    @Notes NVARCHAR(255) = NULL,
    @IsActive BIT = 1,
    @IsLast BIT = 0,
    @IncludeUpperTemplate BIT = 1,  -- NEW: Independent upper template (default true)
    @IncludeLowerTemplate BIT = 1,  -- NEW: Independent lower template (default true)
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
        FROM dbo.tblAlignerSets WITH (UPDLOCK)
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
        -- STEP 1.5: Deactivate other batches if creating an active batch
        -- ==========================================
        IF @IsActive = 1
        BEGIN
            UPDATE dbo.tblAlignerBatches
            SET IsActive = 0
            WHERE AlignerSetID = @AlignerSetID AND IsActive = 1;
        END

        -- ==========================================
        -- STEP 2: Calculate sequences with SEPARATE bases for upper/lower
        -- ==========================================
        DECLARE @UpperStartSeq INT, @LowerStartSeq INT, @BatchSequence INT;

        -- Determine SEPARATE base values for upper and lower:
        --   @IncludeUpperTemplate = 1: upper base = -1, so first batch upper starts at 0
        --   @IncludeUpperTemplate = 0: upper base = 0, so first batch upper starts at 1
        --   (Same logic for lower)
        DECLARE @UpperBase INT = CASE WHEN @IncludeUpperTemplate = 1 THEN -1 ELSE 0 END;
        DECLARE @LowerBase INT = CASE WHEN @IncludeLowerTemplate = 1 THEN -1 ELSE 0 END;

        -- Get max sequences from existing batches (efficient - single query)
        SELECT
            @UpperStartSeq = ISNULL(MAX(UpperAlignerEndSequence), @UpperBase) + 1,
            @LowerStartSeq = ISNULL(MAX(LowerAlignerEndSequence), @LowerBase) + 1,
            @BatchSequence = ISNULL(MAX(BatchSequence), 0) + 1
        FROM dbo.tblAlignerBatches
        WHERE AlignerSetID = @AlignerSetID;

        -- Set to NULL if no aligners requested
        IF @UpperAlignerCount = 0 SET @UpperStartSeq = NULL;
        IF @LowerAlignerCount = 0 SET @LowerStartSeq = NULL;

        -- ==========================================
        -- STEP 3: Insert the batch
        -- ==========================================
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
        -- STEP 4: Update remaining counts (incremental)
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

PRINT 'Created updated usp_CreateAlignerBatch procedure with separate template parameters';
GO

-- =============================================
-- UPDATE STORED PROCEDURE: usp_UpdateAlignerBatch
-- =============================================

-- Drop existing procedure
IF EXISTS (SELECT 1 FROM sys.objects WHERE type = 'P' AND name = 'usp_UpdateAlignerBatch')
BEGIN
    DROP PROCEDURE dbo.usp_UpdateAlignerBatch;
    PRINT 'Dropped old usp_UpdateAlignerBatch procedure';
END
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- Create updated version with separate template parameters
CREATE PROCEDURE dbo.usp_UpdateAlignerBatch
    @AlignerBatchID INT,
    @AlignerSetID INT,
    @UpperAlignerCount INT,
    @LowerAlignerCount INT,
    @ManufactureDate DATE,
    @DeliveredToPatientDate DATE = NULL,
    @Days INT = NULL,
    @Notes NVARCHAR(255) = NULL,
    @IsActive BIT = NULL,
    @IsLast BIT = NULL,
    @IncludeUpperTemplate BIT = NULL,  -- NEW: Independent upper template control
    @IncludeLowerTemplate BIT = NULL   -- NEW: Independent lower template control
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- ==========================================
        -- STEP 1: Fetch old values
        -- ==========================================
        DECLARE @OldAlignerSetID INT, @OldUpperCount INT, @OldLowerCount INT;
        DECLARE @OldManufactureDate DATE, @OldDays INT;
        DECLARE @OldUpperStartSeq INT, @OldLowerStartSeq INT;
        DECLARE @OldBatchSequence INT;

        SELECT
            @OldAlignerSetID = AlignerSetID,
            @OldUpperCount = UpperAlignerCount,
            @OldLowerCount = LowerAlignerCount,
            @OldManufactureDate = ManufactureDate,
            @OldDays = Days,
            @OldUpperStartSeq = UpperAlignerStartSequence,
            @OldLowerStartSeq = LowerAlignerStartSequence,
            @OldBatchSequence = BatchSequence
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
        -- STEP 3: Detect changes
        -- ==========================================
        DECLARE @ManufactureDateChanged BIT = 0;
        DECLARE @CountsChanged BIT = 0;
        DECLARE @DaysChanged BIT = 0;
        DECLARE @TemplateChanged BIT = 0;

        IF @ManufactureDate != @OldManufactureDate
            SET @ManufactureDateChanged = 1;

        IF @UpperAlignerCount != @OldUpperCount OR @LowerAlignerCount != @OldLowerCount
            SET @CountsChanged = 1;

        IF (@Days IS NULL AND @OldDays IS NOT NULL)
            OR (@Days IS NOT NULL AND @OldDays IS NULL)
            OR (@Days IS NOT NULL AND @OldDays IS NOT NULL AND @Days != @OldDays)
            SET @DaysChanged = 1;

        -- Check if this is the first batch (no batches with lower sequence)
        DECLARE @IsFirstBatch BIT = 0;
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID
              AND BatchSequence < @OldBatchSequence
        )
            SET @IsFirstBatch = 1;

        -- Detect if template option changed (check each independently)
        IF @IsFirstBatch = 1
        BEGIN
            -- Check upper template change
            IF @IncludeUpperTemplate IS NOT NULL
            BEGIN
                DECLARE @CurrentUpperHasTemplate BIT = CASE WHEN @OldUpperStartSeq = 0 THEN 1 ELSE 0 END;
                IF @IncludeUpperTemplate != @CurrentUpperHasTemplate
                    SET @TemplateChanged = 1;
            END

            -- Check lower template change
            IF @IncludeLowerTemplate IS NOT NULL
            BEGIN
                DECLARE @CurrentLowerHasTemplate BIT = CASE WHEN @OldLowerStartSeq = 0 THEN 1 ELSE 0 END;
                IF @IncludeLowerTemplate != @CurrentLowerHasTemplate
                    SET @TemplateChanged = 1;
            END
        END

        -- ==========================================
        -- STEP 4: Handle IsActive change
        -- ==========================================
        DECLARE @DeactivatedBatchID INT = NULL;
        DECLARE @DeactivatedBatchSequence INT = NULL;

        IF @IsActive = 1
        BEGIN
            -- Deactivate other active batches in the same set
            SELECT TOP 1
                @DeactivatedBatchID = AlignerBatchID,
                @DeactivatedBatchSequence = BatchSequence
            FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID
              AND AlignerBatchID != @AlignerBatchID
              AND IsActive = 1;

            IF @DeactivatedBatchID IS NOT NULL
            BEGIN
                UPDATE dbo.tblAlignerBatches
                SET IsActive = 0
                WHERE AlignerBatchID = @DeactivatedBatchID;
            END
        END

        -- ==========================================
        -- STEP 5: Update the batch
        -- ==========================================
        UPDATE dbo.tblAlignerBatches
        SET
            UpperAlignerCount = @UpperAlignerCount,
            LowerAlignerCount = @LowerAlignerCount,
            ManufactureDate = @ManufactureDate,
            DeliveredToPatientDate = @DeliveredToPatientDate,
            Days = @Days,
            Notes = @Notes,
            IsActive = ISNULL(@IsActive, IsActive),
            IsLast = ISNULL(@IsLast, IsLast)
        WHERE AlignerBatchID = @AlignerBatchID;

        -- ==========================================
        -- STEP 6: Resequence if needed
        -- ==========================================
        IF @ManufactureDateChanged = 1 OR @CountsChanged = 1 OR @TemplateChanged = 1
        BEGIN
            -- Resequence batch numbers if manufacture date changed
            IF @ManufactureDateChanged = 1
            BEGIN
                ;WITH OrderedBatches AS (
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
            END

            -- Determine SEPARATE base values for upper and lower
            DECLARE @UpperBase INT = 0;  -- Default: first batch starts at 1
            DECLARE @LowerBase INT = 0;  -- Default: first batch starts at 1

            IF @IsFirstBatch = 1
            BEGIN
                -- Upper base: use parameter if provided, else preserve existing
                IF @IncludeUpperTemplate IS NOT NULL
                    SET @UpperBase = CASE WHEN @IncludeUpperTemplate = 1 THEN -1 ELSE 0 END;
                ELSE
                    SET @UpperBase = CASE WHEN @OldUpperStartSeq = 0 THEN -1 ELSE 0 END;

                -- Lower base: use parameter if provided, else preserve existing
                IF @IncludeLowerTemplate IS NOT NULL
                    SET @LowerBase = CASE WHEN @IncludeLowerTemplate = 1 THEN -1 ELSE 0 END;
                ELSE
                    SET @LowerBase = CASE WHEN @OldLowerStartSeq = 0 THEN -1 ELSE 0 END;
            END

            -- Recalculate aligner start/end sequences with INDEPENDENT template support
            ;WITH OrderedBatches AS (
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
                    RowNum,
                    -- For first batch (RowNum=1), use respective base; for others, use cumulative sum
                    CASE
                        WHEN RowNum = 1 THEN @UpperBase
                        ELSE ISNULL(SUM(UpperAlignerCount) OVER (
                            ORDER BY RowNum
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ), 0) + @UpperBase
                    END AS PrevUpperCount,
                    CASE
                        WHEN RowNum = 1 THEN @LowerBase
                        ELSE ISNULL(SUM(LowerAlignerCount) OVER (
                            ORDER BY RowNum
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ), 0) + @LowerBase
                    END AS PrevLowerCount
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
        -- STEP 7: Update remaining counts (delta)
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
        -- STEP 8: Log Days changes to activity flags
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

        -- Return deactivated batch info if any
        IF @DeactivatedBatchID IS NOT NULL
        BEGIN
            SELECT
                @DeactivatedBatchID AS DeactivatedBatchID,
                @DeactivatedBatchSequence AS DeactivatedBatchSequence;
        END

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

PRINT '';
PRINT 'Created updated usp_UpdateAlignerBatch procedure';
PRINT '';
PRINT 'NEW FEATURE:';
PRINT '  - Added @IncludeUpperTemplate parameter (default: NULL)';
PRINT '  - Added @IncludeLowerTemplate parameter (default: NULL)';
PRINT '  - Upper and lower template settings are now INDEPENDENT';
PRINT '  - @IncludeUpperTemplate = 1: Upper aligners start from 0 (template)';
PRINT '  - @IncludeLowerTemplate = 1: Lower aligners start from 0 (template)';
PRINT '  - NULL values preserve existing start sequences';
PRINT '  - Only affects the first batch in the set';
PRINT '';
GO
