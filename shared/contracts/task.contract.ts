/**
 * API contract — header "Tasks" (the app-wide surface of the `alerts` table).
 *
 * Imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). Tasks and patient-context alerts are the same DB rows
 * (`alerts`, dual-surfaced by `surface_mode`) — so this module builds on the
 * canonical `alertRow` + enums from patient.contract.ts rather than redefining
 * them. See CLAUDE.md › "Shared API contracts" and the alerts→tasks migration.
 */
import { z } from 'zod';
import { intId, idParams, optionalDateString, timestampString } from '../validation.js';
import { alertRow } from './patient.contract.js';

// A header task row = the canonical alert row + the owning patient (both nullable:
// a clinic-wide task has no patient). patient_name is left-joined from `patients`.
// The assignee (assigned_to / assignee_name) rides along from alertRow.
const taskRow = z.looseObject({
  ...alertRow.shape,
  person_id: z.number().nullable(),
  patient_name: z.string().nullable(),
});
export type TaskRow = z.infer<typeof taskRow>;

// A completed-task row (history view, feature #3) = the task row + the completion
// audit stamps that setAlertStatus('done') writes. completed_at is a PG `timestamp`
// → timestampString; both are nullable defensively though 'done' always stamps them.
const completedTaskRow = z.looseObject({
  ...taskRow.shape,
  completed_at: timestampString.nullable(),
  completed_by: z.string().nullable(),
});
export type CompletedTaskRow = z.infer<typeof completedTaskRow>;

// GET /api/tasks — the header list: active, not snoozed, not expired, and either
// surface_mode='push' OR a context alert whose escalate_at has arrived. Ordered
// by severity desc, then creation_date desc (server-side).
export const tasks = { response: z.array(taskRow) } as const;
export type TasksResponse = z.infer<typeof tasks.response>;

// GET /api/tasks/history — completed tasks, newest completion first (capped). The
// audit trail (what / when / who) the schema was already capturing, now read back.
export const tasksHistory = { response: z.array(completedTaskRow) } as const;
export type TasksHistoryResponse = z.infer<typeof tasksHistory.response>;

// POST /api/tasks — create a header (push) task. Patient + category + assignee are
// optional; severity + details required. `surface_mode` is forced to 'push'
// server-side. sendSuccess(null) — the client refetches on the `tasks:changed` event.
export const createTask = {
  body: z.object({
    personId: intId.optional(),
    alertTypeId: intId.optional(),
    alertSeverity: intId,
    alertDetails: z.string().min(1),
    expiresAt: optionalDateString,
    snoozedUntil: optionalDateString,
    assignedTo: intId.optional(),
  }),
} as const;
export type CreateTaskBody = z.infer<typeof createTask.body>;

// DELETE /api/tasks/:alertId — permanently remove a finished task from history
// (feature #3 delete). sendSuccess(null); the client drops the row locally.
export const deleteTask = { params: idParams('alertId') } as const;
