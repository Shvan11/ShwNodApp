/**
 * Alert-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). Reads/writes
 * tblAlerts joined to tblAlertTypes. `IsActive` is a PG boolean (was a bit), so
 * the WHERE/SET use `true`/the passed boolean directly. `CreationDate` is a PG
 * `timestamp` → parsed to a local Date by kysely.ts.
 */
import { getKysely } from '../kysely.js';

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
export async function getAlertsByPersonId(personId: number): Promise<Alert[]> {
  const db = getKysely();
  return db
    .selectFrom('tblAlerts as al')
    .innerJoin('tblAlertTypes as at', 'al.AlertTypeID', 'at.AlertTypeID')
    .where('al.PersonID', '=', personId)
    .where('al.IsActive', '=', true)
    .orderBy('al.CreationDate', 'desc')
    .select([
      'al.AlertID',
      'al.PersonID',
      'al.AlertTypeID',
      'at.TypeName as AlertTypeName',
      'al.AlertSeverity',
      'al.AlertDetails',
      'al.CreationDate',
      'al.IsActive',
    ])
    .execute();
}

/**
 * Create a new alert for a person.
 */
export async function createAlert(alertData: AlertData): Promise<void> {
  const db = getKysely();
  await db
    .insertInto('tblAlerts')
    .values({
      PersonID: alertData.PersonID,
      AlertTypeID: alertData.AlertTypeID,
      AlertSeverity: alertData.AlertSeverity,
      AlertDetails: alertData.AlertDetails,
    })
    .execute();
}

/**
 * Update an alert's status (activate/deactivate).
 */
export async function setAlertStatus(alertId: number, isActive: boolean): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('tblAlerts')
    .set({ IsActive: isActive })
    .where('AlertID', '=', alertId)
    .execute();
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
  const db = getKysely();
  await db
    .updateTable('tblAlerts')
    .set({
      AlertTypeID: alertTypeId,
      AlertSeverity: alertSeverity,
      AlertDetails: alertDetails,
    })
    .where('AlertID', '=', alertId)
    .execute();
}

/**
 * Get all alert types for dropdown lists.
 */
export async function getAlertTypes(): Promise<AlertType[]> {
  const db = getKysely();
  return db
    .selectFrom('tblAlertTypes')
    .select(['AlertTypeID', 'TypeName'])
    .orderBy('TypeName')
    .execute();
}
