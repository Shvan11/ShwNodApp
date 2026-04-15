-- =============================================
-- Update aligner batch stored procedures to use HasUpperTemplate/HasLowerTemplate
-- =============================================
-- CHANGES:
--   1. usp_CreateAlignerBatch: replace @IncludeUpperTemplate/@IncludeLowerTemplate
--      with @HasUpperTemplate/@HasLowerTemplate. Compute real aligners consumed
--      per side as (Count - IIF(HasTemplate = 1, 1, 0)). Validate and decrement
--      Remaining by real consumption only. Persist flag columns. Enforce that
--      HasTemplate = 1 is only valid for the first batch in a set.
--
--   2. usp_UpdateAlignerBatch: accept @HasUpperTemplate/@HasLowerTemplate.
--      Use delta between new and old real consumption. Allow flag toggle only
--      on the first batch in a set.
--
--   3. usp_DeleteAlignerBatch: restore Remaining by the batch's real aligner
--      consumption (Count - template slot), not total slots.
-- =============================================

USE ShwanNew;
GO

-- =============================================
-- usp_CreateAlignerBatch
-- =============================================
IF OBJECT_ID('dbo.usp_CreateAlignerBatch', 'P') IS NOT NULL
    DROP PROCEDURE dbo.usp_CreateAlignerBatch;
GO

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE PROCEDURE dbo.usp_CreateAlignerBatch
    @AlignerSetID INT,
    @UpperAlignerCount INT,
    @LowerAlignerCount INT,
    @ManufactureDate DATE = NULL,
    @DeliveredToPatientDate DATE = NULL,
    @Days INT = NULL,
    @Notes NVARCHAR(255) = NULL,
    @IsActive BIT = 0,
    @IsLast BIT = 0,
    @HasUpperTemplate BIT = 0,
    @HasLowerTemplate BIT = 0,
    @NewBatchID INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- ------------------------------------------------------------
        -- STEP 1: First-batch enforcement for template flags
        -- ------------------------------------------------------------
        DECLARE @ExistingBatchCount INT;
        SELECT @ExistingBatchCount = COUNT(*)
        FROM dbo.tblAlignerBatches
        WHERE AlignerSetID = @AlignerSetID;

        IF @ExistingBatchCount > 0 AND (@HasUpperTemplate = 1 OR @HasLowerTemplate = 1)
        BEGIN
            THROW 50004, 'Template flag can only be set on the first batch in a set', 1;
        END

        -- Templates require a real aligner count >= 1 (the template itself occupies slot 0,
        -- so Count must be at least 1 to have anything to store — Count = 1 means template only)
        IF @HasUpperTemplate = 1 AND @UpperAlignerCount < 1
        BEGIN
            THROW 50005, 'HasUpperTemplate = 1 requires UpperAlignerCount >= 1', 1;
        END
        IF @HasLowerTemplate = 1 AND @LowerAlignerCount < 1
        BEGIN
            THROW 50006, 'HasLowerTemplate = 1 requires LowerAlignerCount >= 1', 1;
        END

        -- ------------------------------------------------------------
        -- STEP 2: Lock set and compute real consumption
        -- ------------------------------------------------------------
        DECLARE @RemainingUpper INT, @RemainingLower INT;

        SELECT
            @RemainingUpper = RemainingUpperAligners,
            @RemainingLower = RemainingLowerAligners
        FROM dbo.tblAlignerSets WITH (UPDLOCK)
        WHERE AlignerSetID = @AlignerSetID;

        IF @RemainingUpper IS NULL
        BEGIN
            THROW 50001, 'AlignerSet not found', 1;
        END

        DECLARE @UpperConsumed INT = @UpperAlignerCount - IIF(@HasUpperTemplate = 1, 1, 0);
        DECLARE @LowerConsumed INT = @LowerAlignerCount - IIF(@HasLowerTemplate = 1, 1, 0);

        IF @UpperConsumed > @RemainingUpper
        BEGIN
            DECLARE @UpperErrorMsg NVARCHAR(200) = 'Cannot add aligner batch: requested upper aligners ('
                + CAST(@UpperConsumed AS NVARCHAR) + ') exceed remaining count ('
                + CAST(@RemainingUpper AS NVARCHAR) + ')';
            THROW 50002, @UpperErrorMsg, 1;
        END

        IF @LowerConsumed > @RemainingLower
        BEGIN
            DECLARE @LowerErrorMsg NVARCHAR(200) = 'Cannot add aligner batch: requested lower aligners ('
                + CAST(@LowerConsumed AS NVARCHAR) + ') exceed remaining count ('
                + CAST(@RemainingLower AS NVARCHAR) + ')';
            THROW 50003, @LowerErrorMsg, 1;
        END

        -- ------------------------------------------------------------
        -- STEP 3: Deactivate other batches if creating an active batch
        -- ------------------------------------------------------------
        IF @IsActive = 1
        BEGIN
            UPDATE dbo.tblAlignerBatches
            SET IsActive = 0
            WHERE AlignerSetID = @AlignerSetID AND IsActive = 1;
        END

        -- ------------------------------------------------------------
        -- STEP 4: Calculate sequences
        -- Template flag controls the base: first batch with template starts at 0,
        -- first batch without template starts at 1, subsequent batches always
        -- continue from prior end sequence + 1.
        -- ------------------------------------------------------------
        DECLARE @UpperStartSeq INT, @LowerStartSeq INT, @BatchSequence INT;
        DECLARE @UpperBase INT = CASE WHEN @HasUpperTemplate = 1 THEN -1 ELSE 0 END;
        DECLARE @LowerBase INT = CASE WHEN @HasLowerTemplate = 1 THEN -1 ELSE 0 END;

        SELECT
            @UpperStartSeq = ISNULL(MAX(UpperAlignerEndSequence), @UpperBase) + 1,
            @LowerStartSeq = ISNULL(MAX(LowerAlignerEndSequence), @LowerBase) + 1,
            @BatchSequence = ISNULL(MAX(BatchSequence), 0) + 1
        FROM dbo.tblAlignerBatches
        WHERE AlignerSetID = @AlignerSetID;

        IF @UpperAlignerCount = 0 SET @UpperStartSeq = NULL;
        IF @LowerAlignerCount = 0 SET @LowerStartSeq = NULL;

        -- ------------------------------------------------------------
        -- STEP 5: Insert the batch
        -- ------------------------------------------------------------
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
            LowerAlignerStartSequence,
            HasUpperTemplate,
            HasLowerTemplate
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
            @LowerStartSeq,
            @HasUpperTemplate,
            @HasLowerTemplate
        );

        SET @NewBatchID = SCOPE_IDENTITY();

        -- ------------------------------------------------------------
        -- STEP 6: Decrement Remaining by real consumption only
        -- ------------------------------------------------------------
        UPDATE dbo.tblAlignerSets
        SET
            RemainingUpperAligners = RemainingUpperAligners - @UpperConsumed,
            RemainingLowerAligners = RemainingLowerAligners - @LowerConsumed
        WHERE AlignerSetID = @AlignerSetID;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;

        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO

PRINT 'Updated usp_CreateAlignerBatch';
GO

-- =============================================
-- usp_UpdateAlignerBatch
-- =============================================
IF OBJECT_ID('dbo.usp_UpdateAlignerBatch', 'P') IS NOT NULL
    DROP PROCEDURE dbo.usp_UpdateAlignerBatch;
GO

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO
SET ANSI_PADDING ON;
GO
SET ANSI_WARNINGS ON;
GO
SET ARITHABORT ON;
GO
SET CONCAT_NULL_YIELDS_NULL ON;
GO
SET NUMERIC_ROUNDABORT OFF;
GO

CREATE PROCEDURE dbo.usp_UpdateAlignerBatch
    @AlignerBatchID INT,
    @AlignerSetID INT,
    @UpperAlignerCount INT,
    @LowerAlignerCount INT,
    @Days INT = NULL,
    @Notes NVARCHAR(255) = NULL,
    @IsActive BIT = NULL,
    @IsLast BIT = NULL,
    @HasUpperTemplate BIT = NULL,
    @HasLowerTemplate BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET ANSI_WARNINGS ON;
    SET ARITHABORT ON;
    SET CONCAT_NULL_YIELDS_NULL ON;
    SET NUMERIC_ROUNDABORT OFF;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- ------------------------------------------------------------
        -- STEP 1: Fetch old values
        -- ------------------------------------------------------------
        DECLARE @OldAlignerSetID INT,
                @OldUpperCount INT,
                @OldLowerCount INT,
                @OldDays INT,
                @OldHasUpperTemplate BIT,
                @OldHasLowerTemplate BIT,
                @CurrentDeliveredToPatientDate DATE;

        SELECT
            @OldAlignerSetID = AlignerSetID,
            @OldUpperCount = UpperAlignerCount,
            @OldLowerCount = LowerAlignerCount,
            @OldDays = Days,
            @OldHasUpperTemplate = HasUpperTemplate,
            @OldHasLowerTemplate = HasLowerTemplate,
            @CurrentDeliveredToPatientDate = DeliveredToPatientDate
        FROM dbo.tblAlignerBatches
        WHERE AlignerBatchID = @AlignerBatchID;

        IF @OldAlignerSetID IS NULL
            THROW 50010, 'Aligner batch not found', 1;

        IF @AlignerSetID != @OldAlignerSetID
            THROW 50011, 'Cannot change AlignerSetID', 1;

        -- Resolve new template flags (NULL means keep existing)
        DECLARE @NewHasUpperTemplate BIT = ISNULL(@HasUpperTemplate, @OldHasUpperTemplate);
        DECLARE @NewHasLowerTemplate BIT = ISNULL(@HasLowerTemplate, @OldHasLowerTemplate);

        -- ------------------------------------------------------------
        -- STEP 2: Enforce template flags only on first batch
        -- ------------------------------------------------------------
        IF (@NewHasUpperTemplate = 1 OR @NewHasLowerTemplate = 1)
           AND EXISTS (
               SELECT 1 FROM dbo.tblAlignerBatches
               WHERE AlignerSetID = @AlignerSetID
                 AND AlignerBatchID <> @AlignerBatchID
                 AND BatchSequence < (SELECT BatchSequence FROM dbo.tblAlignerBatches WHERE AlignerBatchID = @AlignerBatchID)
           )
        BEGIN
            THROW 50015, 'Template flag can only be set on the first batch in a set', 1;
        END

        IF @NewHasUpperTemplate = 1 AND @UpperAlignerCount < 1
            THROW 50016, 'HasUpperTemplate = 1 requires UpperAlignerCount >= 1', 1;
        IF @NewHasLowerTemplate = 1 AND @LowerAlignerCount < 1
            THROW 50017, 'HasLowerTemplate = 1 requires LowerAlignerCount >= 1', 1;

        -- ------------------------------------------------------------
        -- STEP 3: Validate consumption against remaining
        -- ------------------------------------------------------------
        DECLARE @RemainingUpper INT, @RemainingLower INT;

        SELECT
            @RemainingUpper = RemainingUpperAligners,
            @RemainingLower = RemainingLowerAligners
        FROM dbo.tblAlignerSets WITH (UPDLOCK)
        WHERE AlignerSetID = @AlignerSetID;

        DECLARE @OldUpperConsumed INT = @OldUpperCount - IIF(@OldHasUpperTemplate = 1, 1, 0);
        DECLARE @OldLowerConsumed INT = @OldLowerCount - IIF(@OldHasLowerTemplate = 1, 1, 0);
        DECLARE @NewUpperConsumed INT = @UpperAlignerCount - IIF(@NewHasUpperTemplate = 1, 1, 0);
        DECLARE @NewLowerConsumed INT = @LowerAlignerCount - IIF(@NewHasLowerTemplate = 1, 1, 0);

        IF @NewUpperConsumed > (@RemainingUpper + @OldUpperConsumed)
        BEGIN
            DECLARE @UpperErrorMsg NVARCHAR(200) = 'Cannot update aligner batch: requested upper aligners ('
                + CAST(@NewUpperConsumed AS NVARCHAR) + ') exceed available count ('
                + CAST(@RemainingUpper + @OldUpperConsumed AS NVARCHAR) + ')';
            THROW 50012, @UpperErrorMsg, 1;
        END

        IF @NewLowerConsumed > (@RemainingLower + @OldLowerConsumed)
        BEGIN
            DECLARE @LowerErrorMsg NVARCHAR(200) = 'Cannot update aligner batch: requested lower aligners ('
                + CAST(@NewLowerConsumed AS NVARCHAR) + ') exceed available count ('
                + CAST(@RemainingLower + @OldLowerConsumed AS NVARCHAR) + ')';
            THROW 50013, @LowerErrorMsg, 1;
        END

        -- ------------------------------------------------------------
        -- STEP 4: Handle IsLast / IsActive
        -- ------------------------------------------------------------
        IF @IsLast = 1
        BEGIN
            UPDATE dbo.tblAlignerBatches
            SET IsLast = 0
            WHERE AlignerSetID = @AlignerSetID
              AND AlignerBatchID != @AlignerBatchID
              AND IsLast = 1;
        END

        IF @IsActive = 1
        BEGIN
            IF @CurrentDeliveredToPatientDate IS NULL
                THROW 50014, 'Cannot set IsActive: batch must be delivered first', 1;

            UPDATE dbo.tblAlignerBatches
            SET IsActive = 0
            WHERE AlignerSetID = @AlignerSetID
              AND AlignerBatchID != @AlignerBatchID
              AND IsActive = 1;
        END

        -- ------------------------------------------------------------
        -- STEP 5: Detect changes
        -- ------------------------------------------------------------
        DECLARE @CountsChanged BIT = 0;
        DECLARE @DaysChanged BIT = 0;
        DECLARE @TemplateChanged BIT = 0;

        IF @UpperAlignerCount != @OldUpperCount OR @LowerAlignerCount != @OldLowerCount
            SET @CountsChanged = 1;

        IF @NewHasUpperTemplate != @OldHasUpperTemplate OR @NewHasLowerTemplate != @OldHasLowerTemplate
            SET @TemplateChanged = 1;

        IF (@Days IS NULL AND @OldDays IS NOT NULL)
            OR (@Days IS NOT NULL AND @OldDays IS NULL)
            OR (@Days IS NOT NULL AND @OldDays IS NOT NULL AND @Days != @OldDays)
            SET @DaysChanged = 1;

        -- ------------------------------------------------------------
        -- STEP 6: Update the batch
        -- ------------------------------------------------------------
        UPDATE dbo.tblAlignerBatches
        SET
            UpperAlignerCount = @UpperAlignerCount,
            LowerAlignerCount = @LowerAlignerCount,
            Days = @Days,
            Notes = @Notes,
            IsActive = ISNULL(@IsActive, IsActive),
            IsLast = ISNULL(@IsLast, IsLast),
            HasUpperTemplate = @NewHasUpperTemplate,
            HasLowerTemplate = @NewHasLowerTemplate
        WHERE AlignerBatchID = @AlignerBatchID;

        -- ------------------------------------------------------------
        -- STEP 7: Resequence if counts or template flags changed
        -- Template flag on the first batch controls whether its start sequence
        -- is 0 or 1, which shifts all downstream start/end sequences.
        -- ------------------------------------------------------------
        IF @CountsChanged = 1 OR @TemplateChanged = 1
        BEGIN
            -- Recompute BatchSequence by ManufactureDate then AlignerBatchID
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

            -- Recompute start sequences. First batch with HasTemplate=1 starts at 0,
            -- otherwise at 1. Subsequent batches continue from prior end + 1.
            ;WITH Ordered AS (
                SELECT
                    AlignerBatchID,
                    UpperAlignerCount,
                    LowerAlignerCount,
                    HasUpperTemplate,
                    HasLowerTemplate,
                    ROW_NUMBER() OVER (ORDER BY ManufactureDate, AlignerBatchID) AS RowNum
                FROM dbo.tblAlignerBatches
                WHERE AlignerSetID = @AlignerSetID
            ),
            Cumulative AS (
                SELECT
                    AlignerBatchID,
                    UpperAlignerCount,
                    LowerAlignerCount,
                    HasUpperTemplate,
                    HasLowerTemplate,
                    RowNum,
                    ISNULL(SUM(UpperAlignerCount) OVER (
                        ORDER BY RowNum
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ), 0) AS PrevUpperTotal,
                    ISNULL(SUM(LowerAlignerCount) OVER (
                        ORDER BY RowNum
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ), 0) AS PrevLowerTotal,
                    FIRST_VALUE(HasUpperTemplate) OVER (ORDER BY RowNum) AS FirstHasUpperTemplate,
                    FIRST_VALUE(HasLowerTemplate) OVER (ORDER BY RowNum) AS FirstHasLowerTemplate
                FROM Ordered
            )
            UPDATE b
            SET
                UpperAlignerStartSequence = CASE
                    WHEN c.UpperAlignerCount > 0
                    THEN c.PrevUpperTotal + CASE WHEN c.FirstHasUpperTemplate = 1 THEN 0 ELSE 1 END
                    ELSE NULL
                END,
                LowerAlignerStartSequence = CASE
                    WHEN c.LowerAlignerCount > 0
                    THEN c.PrevLowerTotal + CASE WHEN c.FirstHasLowerTemplate = 1 THEN 0 ELSE 1 END
                    ELSE NULL
                END
            FROM dbo.tblAlignerBatches b
            INNER JOIN Cumulative c ON b.AlignerBatchID = c.AlignerBatchID;
        END

        -- ------------------------------------------------------------
        -- STEP 8: Apply delta to Remaining
        -- ------------------------------------------------------------
        DECLARE @UpperDelta INT = @NewUpperConsumed - @OldUpperConsumed;
        DECLARE @LowerDelta INT = @NewLowerConsumed - @OldLowerConsumed;

        IF @UpperDelta != 0 OR @LowerDelta != 0
        BEGIN
            UPDATE dbo.tblAlignerSets
            SET
                RemainingUpperAligners = RemainingUpperAligners - @UpperDelta,
                RemainingLowerAligners = RemainingLowerAligners - @LowerDelta
            WHERE AlignerSetID = @AlignerSetID;
        END

        -- ------------------------------------------------------------
        -- STEP 9: Log Days changes
        -- ------------------------------------------------------------
        IF @DaysChanged = 1
        BEGIN
            INSERT INTO dbo.tblAlignerActivityFlags (
                AlignerSetID,
                ActivityType,
                ActivityDescription,
                RelatedRecordID
            ) VALUES (
                @AlignerSetID,
                'DaysChanged',
                'Days changed from ' + ISNULL(CAST(@OldDays AS VARCHAR), 'not set')
                  + ' to ' + ISNULL(CAST(@Days AS VARCHAR), 'not set'),
                @AlignerBatchID
            );
        END

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;

        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO

PRINT 'Updated usp_UpdateAlignerBatch';
GO

-- =============================================
-- usp_DeleteAlignerBatch
-- =============================================
IF OBJECT_ID('dbo.usp_DeleteAlignerBatch', 'P') IS NOT NULL
    DROP PROCEDURE dbo.usp_DeleteAlignerBatch;
GO

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE PROCEDURE dbo.usp_DeleteAlignerBatch
    @AlignerBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    BEGIN TRY
        BEGIN TRANSACTION;

        -- ------------------------------------------------------------
        -- STEP 1: Fetch batch data
        -- ------------------------------------------------------------
        DECLARE @AlignerSetID INT,
                @UpperCount INT,
                @LowerCount INT,
                @HasUpperTemplate BIT,
                @HasLowerTemplate BIT;

        SELECT
            @AlignerSetID = AlignerSetID,
            @UpperCount = UpperAlignerCount,
            @LowerCount = LowerAlignerCount,
            @HasUpperTemplate = HasUpperTemplate,
            @HasLowerTemplate = HasLowerTemplate
        FROM dbo.tblAlignerBatches
        WHERE AlignerBatchID = @AlignerBatchID;

        IF @AlignerSetID IS NULL
            THROW 50020, 'Aligner batch not found', 1;

        -- ------------------------------------------------------------
        -- STEP 2: Delete the batch
        -- ------------------------------------------------------------
        DELETE FROM dbo.tblAlignerBatches
        WHERE AlignerBatchID = @AlignerBatchID;

        -- ------------------------------------------------------------
        -- STEP 3: Restore Remaining by real consumption only
        -- ------------------------------------------------------------
        DECLARE @UpperRestored INT = @UpperCount - IIF(@HasUpperTemplate = 1, 1, 0);
        DECLARE @LowerRestored INT = @LowerCount - IIF(@HasLowerTemplate = 1, 1, 0);

        UPDATE dbo.tblAlignerSets
        SET
            RemainingUpperAligners = RemainingUpperAligners + @UpperRestored,
            RemainingLowerAligners = RemainingLowerAligners + @LowerRestored
        WHERE AlignerSetID = @AlignerSetID;

        -- ------------------------------------------------------------
        -- STEP 4: Resequence remaining batches
        -- ------------------------------------------------------------
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
        INNER JOIN OrderedBatches o ON b.AlignerBatchID = o.AlignerBatchID;

        -- Recompute start sequences (template on first remaining batch controls base)
        ;WITH Ordered AS (
            SELECT
                AlignerBatchID,
                UpperAlignerCount,
                LowerAlignerCount,
                HasUpperTemplate,
                HasLowerTemplate,
                ROW_NUMBER() OVER (ORDER BY ManufactureDate, AlignerBatchID) AS RowNum
            FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID
        ),
        Cumulative AS (
            SELECT
                AlignerBatchID,
                UpperAlignerCount,
                LowerAlignerCount,
                HasUpperTemplate,
                HasLowerTemplate,
                RowNum,
                ISNULL(SUM(UpperAlignerCount) OVER (
                    ORDER BY RowNum
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0) AS PrevUpperTotal,
                ISNULL(SUM(LowerAlignerCount) OVER (
                    ORDER BY RowNum
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ), 0) AS PrevLowerTotal,
                FIRST_VALUE(HasUpperTemplate) OVER (ORDER BY RowNum) AS FirstHasUpperTemplate,
                FIRST_VALUE(HasLowerTemplate) OVER (ORDER BY RowNum) AS FirstHasLowerTemplate
            FROM Ordered
        )
        UPDATE b
        SET
            UpperAlignerStartSequence = CASE
                WHEN c.UpperAlignerCount > 0
                THEN c.PrevUpperTotal + CASE WHEN c.FirstHasUpperTemplate = 1 THEN 0 ELSE 1 END
                ELSE NULL
            END,
            LowerAlignerStartSequence = CASE
                WHEN c.LowerAlignerCount > 0
                THEN c.PrevLowerTotal + CASE WHEN c.FirstHasLowerTemplate = 1 THEN 0 ELSE 1 END
                ELSE NULL
            END
        FROM dbo.tblAlignerBatches b
        INNER JOIN Cumulative c ON b.AlignerBatchID = c.AlignerBatchID;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;

        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END
GO

PRINT 'Updated usp_DeleteAlignerBatch';
GO
