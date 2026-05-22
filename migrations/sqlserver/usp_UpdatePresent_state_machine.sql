-- =============================================
-- Stored Procedure: UpdatePresent (state-machine rewrite)
-- =============================================
-- Purpose: Enforce the appointment-state forward transition rules atomically.
--          Replaces the prior dynamic-SQL UpdatePresent (which accepted any
--          column name and wrote it without reading current state).
--
-- Parameters:
--   @Aid    - AppointmentID
--   @state  - One of: 'Present', 'Seated', 'Dismissed'
--   @Tim    - Time(0) to record in the chosen state column
--
-- State machine:
--   Set 'Present'   requires Present, Seated, Dismissed all NULL
--   Set 'Seated'    requires Present IS NOT NULL, Seated IS NULL, Dismissed IS NULL
--   Set 'Dismissed' requires Seated IS NOT NULL, Dismissed IS NULL
--
-- Errors (all carry the '[INVALID_STATE_TRANSITION]' prefix in the message so the
-- Node layer can match on it via Error.message; mssql v12 does not expose the
-- SQL error number to the JS Error object):
--   50101 - Appointment not found
--   50102 - Cannot check in (already present/seated/dismissed)
--   50103 - Cannot seat (not checked in)
--   50104 - Cannot seat (already seated)
--   50105 - Cannot seat (already dismissed)
--   50106 - Cannot dismiss (not seated)
--   50107 - Cannot dismiss (already dismissed)
--   50108 - Invalid state parameter (not Present/Seated/Dismissed)
-- =============================================

USE [ShwanNew]
GO

IF OBJECT_ID('dbo.UpdatePresent', 'P') IS NOT NULL
    DROP PROCEDURE dbo.UpdatePresent;
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE PROCEDURE dbo.UpdatePresent
    @Aid INT,
    @state VARCHAR(100),
    @Tim VARCHAR(10)   -- preserves the live signature; JS layer sends VARCHAR
AS
BEGIN
    SET NOCOUNT ON;

    -- Nesting-aware transaction: only begin/commit/rollback our own tran when
    -- there isn't already one in flight. Avoids killing an outer tran on THROW.
    DECLARE @startedTran BIT = 0;

    BEGIN TRY
        IF @@TRANCOUNT = 0
        BEGIN
            BEGIN TRANSACTION;
            SET @startedTran = 1;
        END

        DECLARE @TimVal TIME(0) = CAST(@Tim AS TIME(0));
        DECLARE @currPresent TIME(0);
        DECLARE @currSeated TIME(0);
        DECLARE @currDismissed TIME(0);
        DECLARE @rowExists BIT = 0;

        SELECT
            @currPresent = Present,
            @currSeated = Seated,
            @currDismissed = Dismissed,
            @rowExists = 1
        FROM dbo.tblappointments WITH (UPDLOCK, HOLDLOCK)
        WHERE AppointmentID = @Aid;

        IF @rowExists = 0
            THROW 50101, 'Appointment not found', 1;

        IF @state = 'Present'
        BEGIN
            IF @currPresent IS NOT NULL OR @currSeated IS NOT NULL OR @currDismissed IS NOT NULL
                THROW 50102, '[INVALID_STATE_TRANSITION] Cannot check in: patient is already checked in, seated, or dismissed', 1;

            UPDATE dbo.tblappointments
            SET Present = @TimVal,
                LastUpdated = GETDATE()
            WHERE AppointmentID = @Aid;
        END
        ELSE IF @state = 'Seated'
        BEGIN
            IF @currPresent IS NULL
                THROW 50103, '[INVALID_STATE_TRANSITION] Cannot seat: patient is not checked in', 1;
            IF @currSeated IS NOT NULL
                THROW 50104, '[INVALID_STATE_TRANSITION] Cannot seat: patient is already seated', 1;
            IF @currDismissed IS NOT NULL
                THROW 50105, '[INVALID_STATE_TRANSITION] Cannot seat: patient is already dismissed', 1;

            UPDATE dbo.tblappointments
            SET Seated = @TimVal,
                LastUpdated = GETDATE()
            WHERE AppointmentID = @Aid;
        END
        ELSE IF @state = 'Dismissed'
        BEGIN
            IF @currSeated IS NULL
                THROW 50106, '[INVALID_STATE_TRANSITION] Cannot dismiss: patient is not seated', 1;
            IF @currDismissed IS NOT NULL
                THROW 50107, '[INVALID_STATE_TRANSITION] Cannot dismiss: patient is already dismissed', 1;

            UPDATE dbo.tblappointments
            SET Dismissed = @TimVal,
                LastUpdated = GETDATE()
            WHERE AppointmentID = @Aid;
        END
        ELSE
        BEGIN
            THROW 50108, 'Invalid state parameter. Must be Present, Seated, or Dismissed.', 1;
        END

        IF @startedTran = 1
            COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @startedTran = 1 AND @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;

        -- THROW (no args) re-raises the original error preserving error number,
        -- message, and severity — so the [INVALID_STATE_TRANSITION] prefix is
        -- visible to the JS caller.
        ;THROW;
    END CATCH
END
GO

GRANT EXECUTE ON dbo.UpdatePresent TO PUBLIC;
GO

PRINT 'Stored procedure UpdatePresent rewritten with state-machine validation.';
