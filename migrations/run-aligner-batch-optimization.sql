-- =============================================
-- Aligner Batch Optimization - Fixed Version
-- Runs in ShwanNew database context
-- =============================================

USE ShwanNew;
GO

-- =============================================
-- Create usp_CreateAlignerBatch
-- =============================================
IF OBJECT_ID('dbo.usp_CreateAlignerBatch', 'P') IS NOT NULL
    DROP PROCEDURE dbo.usp_CreateAlignerBatch;
GO

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
            THROW 50001, 'AlignerSet not found', 1;

        IF @UpperAlignerCount > @RemainingUpper
        BEGIN
            DECLARE @UpperErrorMsg NVARCHAR(200) = 'Cannot add aligner batch: requested upper aligners (' + CAST(@UpperAlignerCount AS NVARCHAR) + ') exceed remaining count (' + CAST(@RemainingUpper AS NVARCHAR) + ')';
            THROW 50002, @UpperErrorMsg, 1;
        END

        IF @LowerAlignerCount > @RemainingLower
        BEGIN
            DECLARE @LowerErrorMsg NVARCHAR(200) = 'Cannot add aligner batch: requested lower aligners (' + CAST(@LowerAlignerCount AS NVARCHAR) + ') exceed remaining count (' + CAST(@RemainingLower AS NVARCHAR) + ')';
            THROW 50003, @LowerErrorMsg, 1;
        END

        DECLARE @UpperStartSeq INT, @LowerStartSeq INT, @BatchSequence INT;
        DECLARE @ValidityPeriod INT, @NextBatchReadyDate DATE;

        SELECT
            @UpperStartSeq = ISNULL(MAX(UpperAlignerEndSequence), 0) + 1,
            @LowerStartSeq = ISNULL(MAX(LowerAlignerEndSequence), 0) + 1,
            @BatchSequence = ISNULL(MAX(BatchSequence), 0) + 1
        FROM dbo.tblAlignerBatches
        WHERE AlignerSetID = @AlignerSetID;

        IF @UpperAlignerCount = 0 SET @UpperStartSeq = NULL;
        IF @LowerAlignerCount = 0 SET @LowerStartSeq = NULL;

        IF @Days IS NOT NULL AND @DeliveredToPatientDate IS NOT NULL
        BEGIN
            SET @ValidityPeriod = @Days * (@UpperAlignerCount + @LowerAlignerCount);
            SET @NextBatchReadyDate = DATEADD(DAY, @ValidityPeriod, @DeliveredToPatientDate);
        END

        INSERT INTO dbo.tblAlignerBatches (
            AlignerSetID, UpperAlignerCount, LowerAlignerCount,
            ManufactureDate, DeliveredToPatientDate, Days, Notes, IsActive,
            BatchSequence, UpperAlignerStartSequence, LowerAlignerStartSequence,
            ValidityPeriod, NextBatchReadyDate
        ) VALUES (
            @AlignerSetID, @UpperAlignerCount, @LowerAlignerCount,
            @ManufactureDate, @DeliveredToPatientDate, @Days, @Notes, @IsActive,
            @BatchSequence, @UpperStartSeq, @LowerStartSeq,
            @ValidityPeriod, @NextBatchReadyDate
        );

        SET @NewBatchID = SCOPE_IDENTITY();

        UPDATE dbo.tblAlignerSets
        SET
            RemainingUpperAligners = RemainingUpperAligners - @UpperAlignerCount,
            RemainingLowerAligners = RemainingLowerAligners - @LowerAlignerCount
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

PRINT 'Created usp_CreateAlignerBatch';
GO
