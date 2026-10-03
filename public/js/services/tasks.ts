/**
 * Client helpers for the header "Tasks" surface of the alerts table.
 *
 * Reads go through the funnel with the contract schema (the prod runtime guard);
 * mutations reuse the shared `/api/alerts/:id*` endpoints (status/snooze) keyed by
 * alert_id. After any task or alert write, call `invalidateTasks(personId)`.
 */
import { postJSON, putJSON, deleteJSON } from '@/core/http';
import { queryClient } from '@/query/client';
import { qk } from '@/query/keys';
import { toLocalDateString } from '@/utils/calendarDate';
import type { TaskRow, CompletedTaskRow, CreateTaskBody } from '@shared/contracts/task.contract';
import type { AlertStatusBody } from '@shared/contracts/patient.contract';

export type { TaskRow, CompletedTaskRow };

/**
 * A staff member that a task can be assigned to (employees row, name + id).
 * The task READS (active list, history, assignable staff) live in the React
 * Query layer as the `tasksQuery` / `tasksHistoryQuery` / `employeesQuery`
 * factories (`query/queries.ts`); this module keeps the mutations.
 */
export interface StaffOption {
  id: number;
  employee_name: string;
}

/**
 * Refresh every read a task or alert write can change: the bell, the task
 * history, and — for a row linked to a patient — that patient's alert list. A
 * patient-linked task IS a row in that list (`getAlertsByPersonId` reads every
 * surface), and a patient alert shown in the header is a task, so both sides
 * refresh together (audit FE-F5-6). The patient's info read refreshes too: its
 * `AlertCount` is the works page's alert badge (FE-F7-10). A window `CustomEvent`
 * bus used to do half of this beside React Query; audit FE-F1-10 retired it.
 */
export function invalidateTasks(personId?: number | string | null): Promise<void> {
  const keys: ReadonlyArray<readonly unknown[]> = [
    qk.tasks.all(),
    ...(personId != null && personId !== ''
      ? [qk.patient.alerts(personId), qk.patient.info(personId)]
      : []),
  ];
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(
    () => undefined
  );
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
  return toLocalDateString(d);
}
