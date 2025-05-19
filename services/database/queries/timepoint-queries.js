/**
 * TimePoint and image-related database queries
 */
import { executeStoredProcedure, TYPES } from '../index.js';

/**
 * Retrieves time points for a given patient ID.
 * @param {string} PID - The patient ID.
 * @returns {Promise<Array>} - A promise that resolves with an array of time point objects.
 */
export function getTimePoints(PID) {
    return executeStoredProcedure(
        'ListDolphTimePoints',
        [['ID', TYPES.VarChar, PID]],
        null,
        (columns) => ({
            tpCode: columns[0].value,
            tpDateTime: columns[1].value,
            tpDescription: columns[2].value,
        }),
        null
    );
}

/**
 * Retrieves time point images for a given patient ID and time point code.
 * @param {string} pid - The patient ID.
 * @param {string} tp - The time point code.
 * @returns {Promise<Array>} - A promise that resolves with an array of time point image names.
 */
export function getTimePointImgs(pid, tp) {
    return executeStoredProcedure(
        'ListTimePointImgs',
        [
            ['ID', TYPES.VarChar, pid],
            ['tpCode', TYPES.VarChar, tp],
        ],
        null,
        (columns) => columns[0].value,
        (result) => result
    );
}