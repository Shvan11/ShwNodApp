/**
 * Client helpers for the header "Tasks" surface of the alerts table.
 *
 * Reads go through the funnel with the contract schema (the prod runtime guard);
 * mutations reuse the shared `/api/alerts/:id*` endpoints (status/snooze) keyed by
 * alert_id. After any mutation, call `notifyTasksChanged()` so an open TasksBell
 * (and any other listener, e.g. the patient view) refetches immediately.
 */
import { postJSON, putJSON, deleteJSON } from '@/core/http';
import type { TaskRow, CompletedTaskRow, CreateTaskBody } from '@shared/contracts/task.contract';
import type { AlertStatusBody } from '@shared/contracts/patient.contract';

export type { TaskRow, CompletedTaskRow };

/**
 * A staff member that a task can be assigned to (employees row, name + id).
 * The task READS (active list, history, assignable staff) now live in the React
 * Query layer as the `tasksQuery` / `tasksHistoryQuery` / `employeesQuery`
 * factories (`query/queries.ts`); this module keeps only the mutations + the
 * cross-app change signal.
 */
export interface StaffOption {
  id: number;
  employee_name: string;
}

export const TASKS_CHANGED_EVENT = 'tasks:changed';

/** Tell every listener (TasksBell, patient view) that task data changed. */
export function notifyTasksChanged(): void {
  window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
}

export function createTask(body: CreateTaskBody): Promise<unknown> {
  return postJSON('/api/tasks', body);
}

export function setTaskStatus(alertId: number, status: AlertStatusBody['status']): Promise<unknown> {
  return putJSON(`/api/alerts/${alertId}/status`, { status });
}

/** Permanently delete a finished task from history (hard delete). */
export function deleteTask(alertId: number): Promise<unknown> {
  return deleteJSON(`/api/tasks/${alertId}`);
}

export function snoozeTask(alertId: number, snoozedUntil: string | null): Promise<unknown> {
  return putJSON(`/api/alerts/${alertId}/snooze`, { snoozedUntil });
}

/** A 'YYYY-MM-DD' date `days` from today (local wall-clock), for quick-snooze. */
export function dateFromTodayYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
