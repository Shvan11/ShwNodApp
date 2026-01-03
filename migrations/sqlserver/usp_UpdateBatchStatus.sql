-- =============================================
-- Stored Procedure: usp_UpdateBatchStatus
-- =============================================
-- Purpose: Consolidate ALL batch state transitions with validation and business logic
-- Actions: MANUFACTURE, DELIVER, UNDO_MANUFACTURE, UNDO_DELIVERY
-- Parameters:
--   @AlignerBatchID: The batch to update
--   @Action: The action to perform
--   @TargetDate: Optional date for backdating/correction. If NULL, uses GETDATE()
-- Business Logic:
--   MANUFACTURE: Sets ManufactureDate = @TargetDate or GETDATE()
--                If @TargetDate provided and already manufactured, updates date
--   DELIVER: Sets DeliveredToPatientDate = @TargetDate or GETDATE()
--            BatchExpiryDate is auto-computed from DeliveredToPatientDate + (Days * AlignerCount)
--            If batch is latest (highest BatchSequence) AND not already active:
--            - Deactivates other batches in the set
--            - Activates this batch
--   UNDO_MANUFACTURE: Clears ManufactureDate (requires batch not yet delivered)
--   UNDO_DELIVERY: Clears DeliveredToPatientDate (BatchExpiryDate auto-clears as computed)
-- Returns: Result set with operation info and activation status
-- =============================================

USE [ShwanNew]
GO

IF OBJECT_ID('dbo.usp_UpdateBatchStatus', 'P') IS NOT NULL
    DROP PROCEDURE dbo.usp_UpdateBatchStatus;
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

CREATE PROCEDURE dbo.usp_UpdateBatchStatus
    @AlignerBatchID INT,
    @Action VARCHAR(20),
    @TargetDate DATETIME = NULL  -- Optional: for backdating/correction. If NULL, uses GETDATE()
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

        -- Variables for batch state
        DECLARE @AlignerSetID INT;
        DECLARE @BatchSequence INT;
        DECLARE @ManufactureDate DATE;
        DECLARE @DeliveredToPatientDate DATE;
        DECLARE @IsCurrentlyActive BIT;
        DECLARE @Message NVARCHAR(200);
        DECLARE @WasActivated BIT = 0;
        DECLARE @PreviouslyActiveBatchSequence INT = NULL;

        -- Fetch current batch state with lock
        SELECT
            @AlignerSetID = AlignerSetID,
            @BatchSequence = BatchSequence,
            @ManufactureDate = ManufactureDate,
            @DeliveredToPatientDate = DeliveredToPatientDate,
            @IsCurrentlyActive = IsActive
        FROM dbo.tblAlignerBatches WITH (UPDLOCK)
        WHERE AlignerBatchID = @AlignerBatchID;

        IF @AlignerSetID IS NULL
        BEGIN
            THROW 50001, 'Aligner batch not found', 1;
        END

        -- ==========================================
        -- ACTION: MANUFACTURE
        -- ==========================================
        IF @Action = 'MANUFACTURE'
        BEGIN
            -- If already manufactured AND no TargetDate provided, return early (idempotent)
            IF @ManufactureDate IS NOT NULL AND @TargetDate IS NULL
            BEGIN
                SET @Message = 'Batch already manufactured';
                SELECT @AlignerBatchID AS AlignerBatchID, @BatchSequence AS BatchSequence,
                       @AlignerSetID AS AlignerSetID, @Action AS ActionPerformed,
                       CAST(1 AS BIT) AS Success, @Message AS Message,
                       CAST(0 AS BIT) AS WasActivated, @IsCurrentlyActive AS WasAlreadyActive,
                       CAST(0 AS BIT) AS WasAlreadyDelivered, NULL AS PreviouslyActiveBatchSequence;
                COMMIT TRANSACTION;
                RETURN;
            END

            -- Use TargetDate if provided, else GETDATE()
            DECLARE @NewManufactureDate DATE = CAST(ISNULL(@TargetDate, GETDATE()) AS DATE);

            UPDATE dbo.tblAlignerBatches
            SET ManufactureDate = @NewManufactureDate
            WHERE AlignerBatchID = @AlignerBatchID;

            -- Set message based on whether it was new or update
            SET @Message = CASE
                WHEN @ManufactureDate IS NOT NULL THEN 'Manufacture date updated'
                ELSE 'Batch marked as manufactured'
            END;
        END

        -- ==========================================
        -- ACTION: DELIVER
        -- ==========================================
        ELSE IF @Action = 'DELIVER'
        BEGIN
            -- Validation: must be manufactured first
            IF @ManufactureDate IS NULL
            BEGIN
                THROW 50002, 'Cannot deliver: batch not yet manufactured', 1;
            END

            -- If already delivered AND no TargetDate provided, return early (idempotent)
            IF @DeliveredToPatientDate IS NOT NULL AND @TargetDate IS NULL
            BEGIN
                SET @Message = 'Batch already delivered';
                SELECT @AlignerBatchID AS AlignerBatchID, @BatchSequence AS BatchSequence,
                       @AlignerSetID AS AlignerSetID, @Action AS ActionPerformed,
                       CAST(1 AS BIT) AS Success, @Message AS Message,
                       CAST(0 AS BIT) AS WasActivated, @IsCurrentlyActive AS WasAlreadyActive,
                       CAST(1 AS BIT) AS WasAlreadyDelivered, NULL AS PreviouslyActiveBatchSequence;
                COMMIT TRANSACTION;
                RETURN;
            END

            -- Use TargetDate if provided, else GETDATE()
            DECLARE @NewDeliveryDate DATE = CAST(ISNULL(@TargetDate, GETDATE()) AS DATE);

            -- Update delivery date (BatchExpiryDate is auto-computed)
            UPDATE dbo.tblAlignerBatches
            SET DeliveredToPatientDate = @NewDeliveryDate
            WHERE AlignerBatchID = @AlignerBatchID;

            -- Check if this is the latest batch
            DECLARE @MaxBatchSequence INT;
            SELECT @MaxBatchSequence = MAX(BatchSequence)
            FROM dbo.tblAlignerBatches
            WHERE AlignerSetID = @AlignerSetID;

            IF @BatchSequence = @MaxBatchSequence AND @IsCurrentlyActive = 0
            BEGIN
                -- Get previously active batch for logging
                SELECT TOP 1 @PreviouslyActiveBatchSequence = BatchSequence
                FROM dbo.tblAlignerBatches
                WHERE AlignerSetID = @AlignerSetID
                  AND IsActive = 1
                  AND AlignerBatchID != @AlignerBatchID;

                -- Deactivate all other batches
                UPDATE dbo.tblAlignerBatches
                SET IsActive = 0
                WHERE AlignerSetID = @AlignerSetID
                  AND AlignerBatchID != @AlignerBatchID
                  AND IsActive = 1;

                -- Activate this batch
                UPDATE dbo.tblAlignerBatches
                SET IsActive = 1
                WHERE AlignerBatchID = @AlignerBatchID;

                SET @WasActivated = 1;
            END

            -- Set message based on whether it was new or update
            SET @Message = CASE
                WHEN @DeliveredToPatientDate IS NOT NULL THEN 'Delivery date updated'
                ELSE 'Batch marked as delivered'
            END;
        END

        -- ==========================================
        -- ACTION: UNDO_MANUFACTURE
        -- ==========================================
        ELSE IF @Action = 'UNDO_MANUFACTURE'
        BEGIN
            IF @DeliveredToPatientDate IS NOT NULL
            BEGIN
                THROW 50003, 'Cannot undo manufacture: batch already delivered. Undo delivery first.', 1;
            END

            UPDATE dbo.tblAlignerBatches
            SET ManufactureDate = NULL
            WHERE AlignerBatchID = @AlignerBatchID;

            SET @Message = 'Manufacture undone';
        END

        -- ==========================================
        -- ACTION: UNDO_DELIVERY
        -- ==========================================
        ELSE IF @Action = 'UNDO_DELIVERY'
        BEGIN
            -- Clear delivery date (BatchExpiryDate auto-clears as computed column)
            UPDATE dbo.tblAlignerBatches
            SET DeliveredToPatientDate = NULL
            WHERE AlignerBatchID = @AlignerBatchID;

            SET @Message = 'Delivery undone';
        END

        -- ==========================================
        -- INVALID ACTION
        -- ==========================================
        ELSE
        BEGIN
            THROW 50004, 'Invalid action. Must be MANUFACTURE, DELIVER, UNDO_MANUFACTURE, or UNDO_DELIVERY', 1;
        END

        -- Return success result
        SELECT @AlignerBatchID AS AlignerBatchID, @BatchSequence AS BatchSequence,
               @AlignerSetID AS AlignerSetID, @Action AS ActionPerformed,
               CAST(1 AS BIT) AS Success, @Message AS Message,
               @WasActivated AS WasActivated, @IsCurrentlyActive AS WasAlreadyActive,
               CAST(0 AS BIT) AS WasAlreadyDelivered, @PreviouslyActiveBatchSequence AS PreviouslyActiveBatchSequence;

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

GRANT EXECUTE ON dbo.usp_UpdateBatchStatus TO PUBLIC;
GO

PRINT 'Stored procedure usp_UpdateBatchStatus created successfully.';
