-- =============================================
-- Add @IncludeTemplate Parameter to usp_UpdateAlignerBatch
-- =============================================
-- FEATURE: Allow first batch to optionally change start sequence between 0 and 1
--          when editing the batch
--
-- USAGE:
--   @IncludeTemplate = 1: First batch starts from 0 (template aligner)
--   @IncludeTemplate = 0: First batch starts from 1
--   @IncludeTemplate = NULL (default): Keep existing start sequence
--
-- NOTE: This only affects the FIRST batch. Subsequent batches always
--       use cumulative counts regardless of this parameter.
-- =============================================

USE ShwanNew;
GO

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

-- Create updated version with @IncludeTemplate parameter
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
    @IncludeTemplate BIT = NULL  -- NEW: Only used for first batch, NULL = keep existing
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

        -- Check if @IncludeTemplate changes the start sequence for first batch
        -- Only relevant if this is the first batch (no batches with lower sequence)
        DECLARE @IsFirstBatch BIT = 0;
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID
              AND BatchSequence < @OldBatchSequence
        )
            SET @IsFirstBatch = 1;

        -- Detect if template option changed
        IF @IsFirstBatch = 1 AND @IncludeTemplate IS NOT NULL
        BEGIN
            DECLARE @CurrentIncludesTemplate BIT = CASE WHEN @OldUpperStartSeq = 0 OR @OldLowerStartSeq = 0 THEN 1 ELSE 0 END;
            IF @IncludeTemplate != @CurrentIncludesTemplate
                SET @TemplateChanged = 1;
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
            IsActive = ISNULL(@IsActive, IsActive)
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

            -- Determine base value for first batch sequence calculation
            DECLARE @Base INT = 0;  -- Default: first batch starts at 1
            IF @IsFirstBatch = 1 AND @IncludeTemplate IS NOT NULL
            BEGIN
                SET @Base = CASE WHEN @IncludeTemplate = 1 THEN -1 ELSE 0 END;
            END
            ELSE IF @IsFirstBatch = 1
            BEGIN
                -- Preserve existing behavior: if current start is 0, keep base at -1
                SET @Base = CASE WHEN @OldUpperStartSeq = 0 OR @OldLowerStartSeq = 0 THEN -1 ELSE 0 END;
            END

            -- Recalculate aligner start/end sequences with template support
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
                    -- For first batch (RowNum=1), use @Base; for others, use cumulative sum
                    CASE
                        WHEN RowNum = 1 THEN @Base
                        ELSE ISNULL(SUM(UpperAlignerCount) OVER (
                            ORDER BY RowNum
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ), 0) + @Base
                    END AS PrevUpperCount,
                    CASE
                        WHEN RowNum = 1 THEN @Base
                        ELSE ISNULL(SUM(LowerAlignerCount) OVER (
                            ORDER BY RowNum
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                        ), 0) + @Base
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
PRINT '  - Added @IncludeTemplate parameter (default: NULL)';
PRINT '  - @IncludeTemplate = 1: First batch starts from aligner 0 (template)';
PRINT '  - @IncludeTemplate = 0: First batch starts from aligner 1';
PRINT '  - @IncludeTemplate = NULL: Keep existing start sequence';
PRINT '  - Only affects the first batch in the set';
PRINT '';
GO
