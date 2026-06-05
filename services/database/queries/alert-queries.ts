/**
 * Alert-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). Reads/writes
 * tblAlerts joined to tblAlertTypes. `is_active` is a PG boolean (was a bit), so
 * the WHERE/SET use `true`/the passed boolean directly. `creation_date` is a PG
 * `timestamp` → parsed to a local Date by kysely.ts.
 */
import { getKysely } from '../kysely.js';

// type definitions
type Alert = {
  alert_id: number;
  person_id: number;
  alert_type_id: number;
  AlertTypeName: string;
  alert_severity: number;
  alert_details: string | null;
  creation_date: Date;
  is_active: boolean;
};

// `type` (not `interface`) so an AlertType[] is assignable to the lookup
// contract's `z.array(z.looseObject({ alert_type_id }))` sendData arg (the
// index-signature rule — docs/shared-contract-progress.md).
type AlertType = {
  alert_type_id: number;
  type_name: string;
};

interface AlertData {
  person_id: number;
  alert_type_id: number;
  alert_severity: number;
  alert_details: string;
}

/**
 * Get all alerts for a specific person.
 */
export async function getAlertsByPersonId(personId: number): Promise<Alert[]> {
  const db = getKysely();
  return db
    .selectFrom('alerts as al')
    .innerJoin('alert_types as at', 'al.alert_type_id', 'at.alert_type_id')
    .where('al.person_id', '=', personId)
    .where('al.is_active', '=', true)
    .orderBy('al.creation_date', 'desc')
    .select([
      'al.alert_id',
      'al.person_id',
      'al.alert_type_id',
      'at.type_name as AlertTypeName',
      'al.alert_severity',
      'al.alert_details',
      'al.creation_date',
      'al.is_active',
    ])
    .execute();
}

/**
 * Create a new alert for a person.
 */
export async function createAlert(alertData: AlertData): Promise<void> {
  const db = getKysely();
  await db
    .insertInto('alerts')
    .values({
      person_id: alertData.person_id,
      alert_type_id: alertData.alert_type_id,
      alert_severity: alertData.alert_severity,
      alert_details: alertData.alert_details,
    })
    .execute();
}

/**
 * Update an alert's status (activate/deactivate).
 */
export async function setAlertStatus(alertId: number, isActive: boolean): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('alerts')
    .set({ is_active: isActive })
    .where('alert_id', '=', alertId)
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
    .updateTable('alerts')
    .set({
      alert_type_id: alertTypeId,
      alert_severity: alertSeverity,
      alert_details: alertDetails,
    })
    .where('alert_id', '=', alertId)
    .execute();
}

/**
 * Get all alert types for dropdown lists.
 */
export async function getAlertTypes(): Promise<AlertType[]> {
  const db = getKysely();
  return db
    .selectFrom('alert_types')
    .select(['alert_type_id', 'type_name'])
    .orderBy('type_name')
    .execute();
}
