/**
 * Alert-related database queries
 */
import { TYPES } from 'tedious';
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery } from '../index.js';

// Type definitions
interface Alert {
  AlertID: number;
  PersonID: number;
  AlertTypeID: number;
  AlertTypeName: string;
  AlertSeverity: number;
  AlertDetails: string | null;
  CreationDate: Date;
  IsActive: boolean;
}

interface AlertType {
  AlertTypeID: number;
  TypeName: string;
}

interface AlertData {
  PersonID: number;
  AlertTypeID: number;
  AlertSeverity: number;
  AlertDetails: string;
}

/**
 * Get all alerts for a specific person.
 */
export function getAlertsByPersonId(personId: number): Promise<Alert[]> {
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
      AND al.IsActive = 1
    ORDER BY
      al.CreationDate DESC;
  `;
  return executeQuery<Alert>(query, [['personId', TYPES.Int, personId]], (columns: ColumnValue[]) => ({
    AlertID: columns[0].value as number,
    PersonID: columns[1].value as number,
    AlertTypeID: columns[2].value as number,
    AlertTypeName: columns[3].value as string,
    AlertSeverity: columns[4].value as number,
    AlertDetails: columns[5].value as string | null,
    CreationDate: columns[6].value as Date,
    IsActive: columns[7].value as boolean,
  }));
}

/**
 * Create a new alert for a person.
 */
export async function createAlert(alertData: AlertData): Promise<void> {
  const query = `
    INSERT INTO tblAlerts (PersonID, AlertTypeID, AlertSeverity, AlertDetails)
    VALUES (@personId, @alertTypeId, @alertSeverity, @alertDetails);
  `;
  await executeQuery(
    query,
    [
      ['personId', TYPES.Int, alertData.PersonID],
      ['alertTypeId', TYPES.Int, alertData.AlertTypeID],
      ['alertSeverity', TYPES.Int, alertData.AlertSeverity],
      ['alertDetails', TYPES.NVarChar, alertData.AlertDetails],
    ],
    () => ({})
  );
}

/**
 * Update an alert's status (activate/deactivate).
 */
export async function setAlertStatus(alertId: number, isActive: boolean): Promise<void> {
  const query = `
    UPDATE tblAlerts
    SET IsActive = @isActive
    WHERE AlertID = @alertId;
  `;
  await executeQuery(
    query,
    [
      ['alertId', TYPES.Int, alertId],
      ['isActive', TYPES.Bit, isActive],
    ],
    () => ({})
  );
}

/**
 * Update an alert's details.
 */
export async function updateAlert(
  alertId: number,
  alertTypeId: number,
  alertSeverity: number,
  alertDetails: string
): Promise<void> {
  const query = `
    UPDATE tblAlerts
    SET AlertTypeID = @alertTypeId,
        AlertSeverity = @alertSeverity,
        AlertDetails = @alertDetails
    WHERE AlertID = @alertId;
  `;
  await executeQuery(
    query,
    [
      ['alertId', TYPES.Int, alertId],
      ['alertTypeId', TYPES.Int, alertTypeId],
      ['alertSeverity', TYPES.Int, alertSeverity],
      ['alertDetails', TYPES.NVarChar, alertDetails],
    ],
    () => ({})
  );
}

/**
 * Get all alert types for dropdown lists.
 */
export function getAlertTypes(): Promise<AlertType[]> {
  return executeQuery<AlertType>(
    'SELECT AlertTypeID, TypeName FROM tblAlertTypes ORDER BY TypeName',
    [],
    (columns: ColumnValue[]) => ({
      AlertTypeID: columns[0].value as number,
      TypeName: columns[1].value as string,
    })
  );
}
