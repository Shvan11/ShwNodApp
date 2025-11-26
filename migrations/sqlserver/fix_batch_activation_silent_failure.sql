-- =============================================
-- Fix Silent Failure in Batch Activation
-- =============================================
-- PROBLEM: When adding a new batch with IsActive=1 and there's already
--          an active batch for the same set, the stored procedure fails
--          silently without deactivating the old batch
--
-- SOLUTION: Add logic to deactivate other batches when IsActive=1
--           (matches the pattern used in createAlignerSet)
--
-- BUSINESS RULE: Only ONE batch per set can be active at a time
-- =============================================

USE ShwanNew;
GO

-- Drop existing procedure
IF EXISTS (SELECT 1 FROM sys.objects WHERE type = 'P' AND name = 'usp_CreateAlignerBatch')
BEGIN
    DROP PROCEDURE dbo.usp_CreateAlignerBatch;
    PRINT '✓ Dropped old usp_CreateAlignerBatch procedure';
END
GO

-- Create fixed version with automatic batch deactivation
CREATE PROCEDURE dbo.usp_CreateAlignerBatch
    @AlignerSetID INT,
    @UpperAlignerCount INT,
    @LowerAlignerCount INT,
    @ManufactureDate DATE,
    @DeliveredToPatientDate DATE = NULL,
    @Days INT = NULL,
    @Notes NVARCHAR(255) = NULL,
    @IsActive BIT = 1,
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
        -- FIX: This was missing! Now matches createAlignerSet pattern
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
PRINT '✓ Created fixed usp_CreateAlignerBatch procedure';
PRINT '';
PRINT 'FIX APPLIED:';
PRINT '  - Added automatic deactivation of other batches when IsActive=1';
PRINT '  - Now matches the pattern used in createAlignerSet()';
PRINT '  - Business rule enforced: Only ONE batch per set can be active';
PRINT '';
PRINT '✓ Silent failure fixed!';
GO
