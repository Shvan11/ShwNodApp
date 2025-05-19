/**
 * Payment-related database queries
 */
import { executeQuery, TYPES } from '../index.js';

/**
 * Retrieves payments for a given patient ID.
 * @param {number} PID - The patient ID.
 * @returns {Promise<Array>} - A promise that resolves with an array of payment objects.
 */
export function getPayments(PID) {
    return executeQuery(
        `SELECT i.* FROM dbo.tblpatients p
         INNER JOIN dbo.tblwork w ON p.PersonID = w.PersonID
         INNER JOIN dbo.tblInvoice i ON w.workid = i.workid
         WHERE w.Finished = 0 AND p.personID = @PID`,
        [['PID', TYPES.Int, PID]],
        (columns) => ({ Payment: columns[1].value, Date: columns[2].value })
    );
}