/**
 * Deploy UndoAppointmentState with validation logic
 *
 * This script updates the stored procedure to enforce logical state transitions:
 * - Cannot undo Present if Seated is set
 * - Cannot undo Seated if Dismissed is set
 *
 * Usage: node database/stored-procedures/deploy-undo-validation.js
 */

import dotenv from 'dotenv';
import { executeQuery } from '../../services/database/index.js';

// Load environment variables
dotenv.config();

const procedureSQL = `
ALTER PROCEDURE [dbo].[UndoAppointmentState]
    @AppointmentID as int,
    @StateField as varchar(100)  -- 'Present', 'Seated', or 'Dismissed'
AS
BEGIN
    SET NOCOUNT ON;

    -- Validate state field to prevent SQL injection
    IF @StateField NOT IN ('Present', 'Seated', 'Dismissed')
    BEGIN
        RAISERROR('Invalid state field. Must be Present, Seated, or Dismissed.', 16, 1)
        RETURN
    END

    -- Get current state of the appointment
    DECLARE @CurrentPresent time
    DECLARE @CurrentSeated time
    DECLARE @CurrentDismissed time

    SELECT
        @CurrentPresent = Present,
        @CurrentSeated = Seated,
        @CurrentDismissed = Dismissed
    FROM tblappointments
    WHERE AppointmentID = @AppointmentID

    -- Validate state transition logic
    -- Rule 1: Cannot undo Present if Seated is set
    IF @StateField = 'Present' AND @CurrentSeated IS NOT NULL
    BEGIN
        RAISERROR('Cannot undo check-in: Patient is already seated', 16, 1)
        RETURN
    END

    -- Rule 2: Cannot undo Seated if Dismissed is set
    IF @StateField = 'Seated' AND @CurrentDismissed IS NOT NULL
    BEGIN
        RAISERROR('Cannot undo seated: Patient visit is already completed', 16, 1)
        RETURN
    END

    -- Validation passed - proceed with undo
    DECLARE @SQL NVARCHAR(MAX)
    SET @SQL = N'UPDATE tblappointments SET [' + @StateField + N'] = NULL WHERE AppointmentID = @AppointmentID'

    EXEC sp_executesql @SQL, N'@AppointmentID int', @AppointmentID

    -- Return success indicator
    SELECT
        @AppointmentID as AppointmentID,
        @StateField as StateCleared,
        1 as Success
END
`;

async function deployProcedure() {
    try {
        console.log('🔄 Deploying UndoAppointmentState with validation logic...');
        console.log('📊 Database:', process.env.DB_DATABASE);
        console.log('🖥️  Server:', process.env.DB_SERVER);

        await executeQuery(procedureSQL);

        console.log('✅ Stored procedure updated successfully!');
        console.log('\nValidation rules enforced:');
        console.log('  ✓ Cannot undo Present if Seated is set');
        console.log('  ✓ Cannot undo Seated if Dismissed is set');
        console.log('  ✓ Can always undo Dismissed (last state)');

        process.exit(0);
    } catch (error) {
        console.error('❌ Failed to deploy stored procedure:', error.message);
        console.error(error);
        process.exit(1);
    }
}

deployProcedure();
