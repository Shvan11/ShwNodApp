-- =============================================
-- Add Separate @IncludeUpperTemplate/@IncludeLowerTemplate Parameters
-- to usp_CreateAlignerBatch
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
--
-- NOTE: usp_UpdateAlignerBatch is NOT modified here.
--       It is defined in 12_stored_procedures_aligner_batch_crud.sql
--       and does NOT accept ManufactureDate or DeliveredToPatientDate params.
--       Those dates are managed exclusively via usp_UpdateBatchStatus.
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
PRINT '';
PRINT 'NOTE: usp_UpdateAlignerBatch is defined in 12_stored_procedures_aligner_batch_crud.sql';
PRINT '      It does NOT accept ManufactureDate/DeliveredToPatientDate params.';
PRINT '      Those dates are managed exclusively via usp_UpdateBatchStatus.';
GO
