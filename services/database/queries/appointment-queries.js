/**
 * Appointment-related database queries
 */
import { executeStoredProcedure, TYPES } from '../index.js';

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
        (columns) => columns,
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