/**
 * Alert / Task database queries.
 *
 * The `alerts` table backs TWO surfaces (see migrations/pg/…_alerts-to-tasks.sql):
 *   - **context** alerts — patient flags shown on the patient view + appointment
 *     cards (getAlertsByPersonId).
 *   - **push** tasks — the app-wide header bell (getHeaderTasks), plus context
 *     alerts whose `escalate_at` has arrived.
 *
 * Lifecycle is the `status` column (active | done | dismissed); the old boolean
 * `is_active` is retired. Date columns (`snoozed_until`/`expires_at`/`escalate_at`)
 * are PG `date` → 'YYYY-MM-DD' strings (kysely.ts date parser). Visibility is
 * computed at READ time against CURRENT_DATE — no cron, no stored flag flips.
 *
 * The row types use the literal `status`/`surface_mode` unions (not bare `string`)
 * so they stay assignable to the contract's `z.input` (z.enum) when passed to
 * `sendData`. They are `type` (not `interface`) for the looseObject index-sig rule.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

type SurfaceMode = 'context' | 'push';
type AlertStatus = 'active' | 'done' | 'dismissed';

// A patient-context alert row (matches patientContract.alertRow).
type Alert = {
  alert_id: number;
  alert_type_id: number | null;
  AlertTypeName: string | null;
  alert_severity: number;
  alert_details: string | null;
  creation_date: Date;
  surface_mode: SurfaceMode;
  status: AlertStatus;
  snoozed_until: string | null;
  expires_at: string | null;
  escalate_at: string | null;
  // Assignment (feature #4): the owning staff member, or null when unassigned /
  // a patient-context alert. assignee_name is left-joined from `employees`.
  assigned_to: number | null;
  assignee_name: string | null;
};

// A header task row = alert row + owning patient (taskContract.taskRow).
type HeaderTask = Alert & {
  person_id: number | null;
  patient_name: string | null;
};

// A completed task row (history view) = header task + the completion audit stamps.
type CompletedTask = HeaderTask & {
  completed_at: Date | null;
  completed_by: string | null;
};

type AlertType = {
  alert_type_id: number;
  type_name: string;
};

type CreateAlertInput = {
  person_id: number | null;
  alert_type_id: number | null;
  alert_severity: number;
  alert_details: string;
  surface_mode?: SurfaceMode;
  expires_at?: string | null;
  escalate_at?: string | null;
  snoozed_until?: string | null;
  assigned_to?: number | null;
};

type UpdateAlertInput = {
  alert_type_id?: number | null;
  alert_severity?: number;
  alert_details?: string;
  surface_mode?: SurfaceMode;
  expires_at?: string | null;
  escalate_at?: string | null;
  assigned_to?: number | null;
};

// Columns shared by both reads (alert row shape). assignee_name is left-joined
// from `employees as emp` (present in every read below).
const ALERT_COLUMNS = [
  'al.alert_id',
  'al.alert_type_id',
  'at.type_name as AlertTypeName',
  'al.alert_severity',
  'al.alert_details',
  'al.creation_date',
  'al.surface_mode',
  'al.status',
  'al.snoozed_until',
  'al.expires_at',
  'al.escalate_at',
  'al.assigned_to',
  'emp.employee_name as assignee_name',
] as const;

/**
 * Context alerts for a patient (patient view + appointment cards).
 * Visible = this patient, status active, not expired. Snooze is deliberately
 * IGNORED here — if the patient is in front of you, a snoozed reminder still helps.
 */
export async function getAlertsByPersonId(personId: number): Promise<Alert[]> {
  const db = getKysely();
  const rows = await db
    .selectFrom('alerts as al')
    .leftJoin('alert_types as at', 'al.alert_type_id', 'at.alert_type_id')
    .leftJoin('employees as emp', 'al.assigned_to', 'emp.id')
    .where('al.person_id', '=', personId)
    .where('al.status', '=', 'active')
    .where((eb) =>
      eb.or([
        eb('al.expires_at', 'is', null),
        eb('al.expires_at', '>=', sql<string>`CURRENT_DATE`),
      ])
    )
    .orderBy('al.creation_date', 'desc')
    .select(ALERT_COLUMNS)
    .execute();
  return rows as Alert[];
}

/**
 * The header task list. Visible = status active, not snoozed, not expired, and
 * either a push task OR a context alert whose escalate_at has arrived. Left-joins
 * the patient name (null for clinic-wide tasks). Ordered severity then recency.
 */
export async function getHeaderTasks(): Promise<HeaderTask[]> {
  const db = getKysely();
  const rows = await db
    .selectFrom('alerts as al')
    .leftJoin('alert_types as at', 'al.alert_type_id', 'at.alert_type_id')
    .leftJoin('patients as p', 'al.person_id', 'p.person_id')
    .leftJoin('employees as emp', 'al.assigned_to', 'emp.id')
    .where('al.status', '=', 'active')
    .where((eb) =>
      eb.or([
        eb('al.snoozed_until', 'is', null),
        eb('al.snoozed_until', '<=', sql<string>`CURRENT_DATE`),
      ])
    )
    .where((eb) =>
      eb.or([
        eb('al.expires_at', 'is', null),
        eb('al.expires_at', '>=', sql<string>`CURRENT_DATE`),
      ])
    )
    .where((eb) =>
      eb.or([
        eb('al.surface_mode', '=', 'push'),
        eb.and([
          eb('al.escalate_at', 'is not', null),
          eb('al.escalate_at', '<=', sql<string>`CURRENT_DATE`),
        ]),
      ])
    )
    .orderBy('al.alert_severity', 'desc')
    .orderBy('al.creation_date', 'desc')
    .select([...ALERT_COLUMNS, 'al.person_id', 'p.patient_name'])
    .execute();
  return rows as HeaderTask[];
}

/**
 * The full task log (history page). Every PUSH task in ANY state — active (incl.
 * snoozed), done, dismissed — not just completed. Active first, then most-recent,
 * so live work sits on top and finished/dropped tasks read as a log below. The
 * `completed_at`/`completed_by` stamps are null for non-done rows (the consumer
 * shows them only where present). Scoped to surface_mode='push' (context alerts are
 * patient flags, owned by the patient view). Capped to the most recent `limit`.
 */
export async function getAllTasks(limit = 200): Promise<CompletedTask[]> {
  const db = getKysely();
  const rows = await db
    .selectFrom('alerts as al')
    .leftJoin('alert_types as at', 'al.alert_type_id', 'at.alert_type_id')
    .leftJoin('patients as p', 'al.person_id', 'p.person_id')
    .leftJoin('employees as emp', 'al.assigned_to', 'emp.id')
    .where('al.surface_mode', '=', 'push')
    .orderBy(sql`CASE al.status WHEN 'active' THEN 0 WHEN 'done' THEN 1 ELSE 2 END`)
    .orderBy('al.creation_date', 'desc')
    .limit(limit)
    .select([...ALERT_COLUMNS, 'al.person_id', 'p.patient_name', 'al.completed_at', 'al.completed_by'])
    .execute();
  return rows as CompletedTask[];
}

/**
 * Create an alert/task. surface_mode defaults to the DB default ('context') when
 * omitted; the task route passes 'push'. Empty-string dates are normalized to null.
 */
export async function createAlert(input: CreateAlertInput): Promise<void> {
  const db = getKysely();
  await db
    .insertInto('alerts')
    .values({
      person_id: input.person_id,
      alert_type_id: input.alert_type_id,
      alert_severity: input.alert_severity,
      alert_details: input.alert_details,
      ...(input.surface_mode ? { surface_mode: input.surface_mode } : {}),
      expires_at: input.expires_at || null,
      escalate_at: input.escalate_at || null,
      snoozed_until: input.snoozed_until || null,
      assigned_to: input.assigned_to ?? null,
    })
    .execute();
}

/**
 * Set an alert's lifecycle status. 'done' stamps completed_at + completed_by;
 * any other status clears them (e.g. re-activating a task).
 */
export async function setAlertStatus(
  alertId: number,
  status: AlertStatus,
  completedBy: string | null = null
): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('alerts')
    .set({
      status,
      completed_at: status === 'done' ? sql`LOCALTIMESTAMP` : null,
      completed_by: status === 'done' ? completedBy : null,
    })
    .where('alert_id', '=', alertId)
    .execute();
}

/**
 * Snooze a task in the header until `snoozedUntil` (a 'YYYY-MM-DD' date), or pass
 * null to clear the snooze.
 */
export async function setAlertSnooze(
  alertId: number,
  snoozedUntil: string | null
): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('alerts')
    .set({ snoozed_until: snoozedUntil })
    .where('alert_id', '=', alertId)
    .execute();
}

/**
 * Permanently delete a finished task (history "Delete"). Guarded to status<>'active'
 * so a live patient-context alert can't be hard-deleted through this path — active
 * alerts are managed via dismiss in the bell/patient view. The DELETE is CDC-captured
 * → propagates to the Supabase mirror.
 */
export async function deleteTask(alertId: number): Promise<void> {
  const db = getKysely();
  await db
    .deleteFrom('alerts')
    .where('alert_id', '=', alertId)
    .where('status', '!=', 'active')
    .execute();
}

/**
 * Update an alert's editable fields (only the keys provided are written).
 */
export async function updateAlert(alertId: number, input: UpdateAlertInput): Promise<void> {
  const db = getKysely();
  const set: Record<string, unknown> = {};
  if (input.alert_type_id !== undefined) set.alert_type_id = input.alert_type_id;
  if (input.alert_severity !== undefined) set.alert_severity = input.alert_severity;
  if (input.alert_details !== undefined) set.alert_details = input.alert_details;
  if (input.surface_mode !== undefined) set.surface_mode = input.surface_mode;
  if (input.expires_at !== undefined) set.expires_at = input.expires_at || null;
  if (input.escalate_at !== undefined) set.escalate_at = input.escalate_at || null;
  if (input.assigned_to !== undefined) set.assigned_to = input.assigned_to;
  if (Object.keys(set).length === 0) return;

  await db.updateTable('alerts').set(set).where('alert_id', '=', alertId).execute();
}

/**
 * Current assignee of an alert (NULL if unassigned or the alert is missing).
 * Lets the update path tell an UNCHANGED assignee apart from a NEWLY-set one, so
 * re-saving a task that's still legitimately assigned to a now-quit employee
 * (we keep those assignments) doesn't trip the "no assigning to quit staff" guard.
 */
export async function getAlertAssignedTo(alertId: number): Promise<number | null> {
  const row = await getKysely()
    .selectFrom('alerts')
    .select('assigned_to')
    .where('alert_id', '=', alertId)
    .executeTakeFirst();
  return row?.assigned_to ?? null;
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
