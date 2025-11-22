/**
 * Appointment-related database queries
 */
import { executeStoredProcedure, executeMultipleResultSets, TYPES } from '../index.js';
import { Request } from 'tedious';

/**
 * Retrieves appointment information for a given date.
 * @param {string} PDate - The date for which to retrieve appointments.
 * @returns {Promise<Object>} - A promise that resolves with an object containing appointment information.
 */
export function getPresentAps(PDate) {
    return executeStoredProcedure(
        'PTodayAppsWeb',
        [['AppsDate', TYPES.NVarChar, PDate]],
        (request) => {
            request.addOutputParameter('all', TYPES.Int);
            request.addOutputParameter('present', TYPES.Int);
            request.addOutputParameter('waiting', TYPES.Int);
            request.addOutputParameter('completed', TYPES.Int);
        },
        (columns) => ({
            Num: columns[0].value,
            apptime: columns[1].value,
            PatientType: columns[2].value,
            PatientName: columns[3].value,
            AppDetail: columns[4].value,
            Present: columns[5].value,
            Seated: columns[6].value,
            Dismissed: columns[7].value,
            HasVisit: columns[8].value,
            appointmentID: columns[9].value
        }),
        (result, outParams) => {
            const responseObject = {};
            responseObject.appointments = result;
            if (outParams) {
                for (const outParam of outParams) {
                    responseObject[outParam.parameterName] = outParam.value;
                }
                return responseObject;
            }
        }
    );
}

/**
 * Updates patient appointment state (Present, Seated, Dismissed).
 * @param {number} Aid - The appointment ID.
 * @param {string} state - The state field to update (Present, Seated, Dismissed).
 * @param {string} Tim - The time value to set.
 * @returns {Promise<Object>} - A promise that resolves with the update result.
 */
export function updatePresent(Aid, state, Tim) {
    return executeStoredProcedure(
        'UpdatePresent',
        [
            ['Aid', TYPES.Int, Aid],
            ['state', TYPES.VarChar, state],
            ['Tim', TYPES.VarChar, Tim]
        ],
        null,
        (columns) => columns,
        (result) => ({ success: true, appointmentID: Aid, state: state, time: Tim })
    );
}

/**
 * Undo appointment state by setting field to NULL (dedicated procedure for undo operations).
 * This uses a separate procedure to avoid affecting other applications using UpdatePresent.
 * @param {number} appointmentID - The appointment ID.
 * @param {string} stateField - The state field to clear (Present, Seated, Dismissed).
 * @returns {Promise<Object>} - A promise that resolves with the undo result.
 */
export function undoAppointmentState(appointmentID, stateField) {
    return executeStoredProcedure(
        'UndoAppointmentState',
        [
            ['AppointmentID', TYPES.Int, appointmentID],
            ['StateField', TYPES.VarChar, stateField]
        ],
        null,
        (columns) => ({
            appointmentID: columns[0].value,
            stateCleared: columns[1].value,
            success: columns[2].value
        }),
        (result) => result[0] || { success: true, appointmentID, stateCleared: stateField }
    );
}

/**
 * Get daily appointments using optimized stored procedure (OPTIMIZED - Phase 1)
 * Replaces getAllTodayApps + getPresentTodayApps with single call
 * Returns 3 result sets: all appointments, checked-in appointments, and statistics
 * @param {string} AppsDate - The date for which to retrieve appointments
 * @returns {Promise<Array>} - Array of 3 result sets
 */
export function getDailyAppointmentsOptimized(AppsDate) {
    return executeMultipleResultSets(
        'GetDailyAppointmentsOptimized',
        [['AppsDate', TYPES.Date, AppsDate]]
    );
}

/**
 * Updates appointment state within a transaction (TRANSACTION-AWARE)
 * Calls UpdatePresent stored procedure within an active transaction
 * @param {Transaction} transaction - Active transaction object
 * @param {number} Aid - The appointment ID
 * @param {string} state - The state field to update (Present, Seated, Dismissed)
 * @param {string} Tim - The time value to set
 * @returns {Promise<Object>} - A promise that resolves with the update result
 */
export function updatePresentInTransaction(transaction, Aid, state, Tim) {
    return new Promise((resolve, reject) => {
        // Call stored procedure: EXEC UpdatePresent @Aid, @state, @Tim
        const request = new Request('UpdatePresent', (err) => {
            if (err) {
                reject(err);
                return;
            }
        });

        // Add parameters
        request.addParameter('Aid', TYPES.Int, Aid);
        request.addParameter('state', TYPES.VarChar, state);
        request.addParameter('Tim', TYPES.VarChar, Tim);

        const result = [];

        request.on('row', (columns) => {
            result.push(columns);
        });

        request.on('requestCompleted', () => {
            resolve({
                success: true,
                appointmentID: Aid,
                state: state,
                time: Tim,
                dbResult: result
            });
        });

        request.on('error', (error) => {
            reject(error);
        });

        // Execute stored procedure within the transaction
        transaction.callProcedure(request).then(resolve).catch(reject);
    });
}

/**
 * Verify appointment state after update (CONFIRMATION QUERY)
 * @param {Transaction} transaction - Active transaction object
 * @param {number} appointmentID - The appointment ID to verify
 * @param {string} stateField - The state field that was updated
 * @returns {Promise<Object>} - Current state from database
 */
export function verifyAppointmentState(transaction, appointmentID, stateField) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT appointmentID,
                   Present, Seated, Dismissed
            FROM tblappointments
            WHERE appointmentID = @AppointmentID
        `;

        const request = new Request(query, (err) => {
            if (err) {
                reject(err);
                return;
            }
        });

        request.addParameter('AppointmentID', TYPES.Int, appointmentID);

        const rows = [];
        const columns = [];

        request.on('columnMetadata', (columnsMetadata) => {
            columnsMetadata.forEach(column => columns.push(column));
        });

        request.on('row', (rowColumns) => {
            const row = {};
            rowColumns.forEach((column, index) => {
                row[columns[index].colName] = column.value;
            });
            rows.push(row);
        });

        request.on('requestCompleted', () => {
            if (rows.length === 0) {
                reject(new Error(`Appointment ${appointmentID} not found after update`));
                return;
            }
            resolve(rows[0]);
        });

        request.on('error', (error) => {
            reject(error);
        });

        transaction.executeRequest(request).then(() => {
            // Transaction.executeRequest returns rows, so we handle them in the 'row' event
        }).catch(reject);
    });
}