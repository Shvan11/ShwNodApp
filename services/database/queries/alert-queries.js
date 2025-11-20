import { executeQuery } from '../index.js';
import { TYPES } from 'tedious';

/**
 * Get all alerts for a specific person.
 * @param {number} personId - The ID of the person.
 * @returns {Promise<Array>} A promise that resolves to an array of alerts.
 */
export function getAlertsByPersonId(personId) {
    const query = `
        SELECT
            al.AlertID,
            al.PersonID,
            al.AlertTypeID,
            at.TypeName AS AlertTypeName,
            al.AlertSeverity,
            al.AlertDetails,
            al.CreationDate,
            al.IsActive
        FROM
            tblAlerts al
        JOIN
            tblAlertTypes at ON al.AlertTypeID = at.AlertTypeID
        WHERE
            al.PersonID = @personId
        ORDER BY
            al.CreationDate DESC;
    `;
    const params = [['personId', TYPES.Int, personId]];
    return executeQuery(query, params, (columns) => ({
        AlertID: columns[0].value,
        PersonID: columns[1].value,
        AlertTypeID: columns[2].value,
        AlertTypeName: columns[3].value,
        AlertSeverity: columns[4].value,
        AlertDetails: columns[5].value,
        CreationDate: columns[6].value,
        IsActive: columns[7].value
    }));
}

/**
 * Create a new alert for a person.
 * @param {object} alertData - The alert data.
 * @param {number} alertData.PersonID - The ID of the person.
 * @param {number} alertData.AlertTypeID - The ID of the alert type.
 * @param {number} alertData.AlertSeverity - The severity level (1, 2, or 3).
 * @param {string} alertData.AlertDetails - The details of the alert.
 * @returns {Promise<void>}
 */
export async function createAlert(alertData) {
    const query = `
        INSERT INTO tblAlerts (PersonID, AlertTypeID, AlertSeverity, AlertDetails)
        VALUES (@personId, @alertTypeId, @alertSeverity, @alertDetails);
    `;
    const params = [
        ['personId', TYPES.Int, alertData.PersonID],
        ['alertTypeId', TYPES.Int, alertData.AlertTypeID],
        ['alertSeverity', TYPES.Int, alertData.AlertSeverity],
        ['alertDetails', TYPES.NVarChar, alertData.AlertDetails],
    ];
    await executeQuery(query, params);
}

/**
 * Update an alert's status (activate/deactivate).
 * @param {number} alertId - The ID of the alert to update.
 * @param {boolean} isActive - The new active status.
 * @returns {Promise<void>}
 */
export async function setAlertStatus(alertId, isActive) {
    const query = `
        UPDATE tblAlerts
        SET IsActive = @isActive
        WHERE AlertID = @alertId;
    `;
    const params = [
        ['alertId', TYPES.Int, alertId],
        ['isActive', TYPES.Bit, isActive],
    ];
    await executeQuery(query, params);
}

/**
 * Get all alert types for dropdown lists.
 * @returns {Promise<Array>} A promise that resolves to an array of alert types.
 */
export function getAlertTypes() {
    return executeQuery(
        'SELECT AlertTypeID, TypeName FROM tblAlertTypes ORDER BY TypeName',
        [],
        (columns) => ({
            AlertTypeID: columns[0].value,
            TypeName: columns[1].value
        })
    );
}
