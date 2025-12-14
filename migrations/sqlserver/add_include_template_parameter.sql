-- =============================================
-- Add @IncludeTemplate Parameter to usp_CreateAlignerBatch
-- =============================================
-- FEATURE: Allow first batch to optionally start from aligner 0 (template)
--          instead of aligner 1
--
-- USAGE:
--   @IncludeTemplate = 1 (default): First batch starts from 0
--   @IncludeTemplate = 0:           First batch starts from 1
--
-- NOTE: This only affects the FIRST batch. Subsequent batches always
--       use MAX(EndSequence) + 1 regardless of this parameter.
-- =============================================

USE ShwanNew;
GO

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

-- Create updated version with @IncludeTemplate parameter
CREATE PROCEDURE dbo.usp_CreateAlignerBatch
    @AlignerSetID INT,
    @UpperAlignerCount INT,
    @LowerAlignerCount INT,
    @ManufactureDate DATE,
    @DeliveredToPatientDate DATE = NULL,
    @Days INT = NULL,
    @Notes NVARCHAR(255) = NULL,
    @IsActive BIT = 1,
    @IsLast BIT = 0,           -- Mark as final batch for the set
    @IncludeTemplate BIT = 1,  -- NEW: Start from 0 (template) by default for first batch
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
        -- STEP 1.5: Deactivate other batches if creating an active batch
        -- ==========================================
        IF @IsActive = 1
        BEGIN
            UPDATE dbo.tblAlignerBatches
            SET IsActive = 0
            WHERE AlignerSetID = @AlignerSetID AND IsActive = 1;
        END

        -- ==========================================
        -- STEP 2: Calculate sequences
        -- ==========================================
        DECLARE @UpperStartSeq INT, @LowerStartSeq INT, @BatchSequence INT;

        -- Determine base value for first batch:
        --   @IncludeTemplate = 1: base = -1, so first batch starts at 0
        --   @IncludeTemplate = 0: base = 0, so first batch starts at 1
        -- For subsequent batches, MAX(EndSequence) is used, so base doesn't matter
        DECLARE @Base INT = CASE WHEN @IncludeTemplate = 1 THEN -1 ELSE 0 END;

        -- Get max sequences from existing batches (efficient - single query)
        SELECT
            @UpperStartSeq = ISNULL(MAX(UpperAlignerEndSequence), @Base) + 1,
            @LowerStartSeq = ISNULL(MAX(LowerAlignerEndSequence), @Base) + 1,
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

PRINT '';
PRINT 'Created updated usp_CreateAlignerBatch procedure';
PRINT '';
PRINT 'NEW FEATURE:';
PRINT '  - Added @IncludeTemplate parameter (default: 1)';
PRINT '  - @IncludeTemplate = 1: First batch starts from aligner 0 (template)';
PRINT '  - @IncludeTemplate = 0: First batch starts from aligner 1';
PRINT '  - Subsequent batches always continue from previous end sequence';
PRINT '';
GO
