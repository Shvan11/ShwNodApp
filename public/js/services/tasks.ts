/**
 * Client helpers for the header "Tasks" surface of the alerts table.
 *
 * Reads go through the funnel with the contract schema (the prod runtime guard);
 * mutations reuse the shared `/api/alerts/:id*` endpoints (status/snooze) keyed by
 * alert_id. After any mutation, call `notifyTasksChanged()` so an open TasksBell
 * (and any other listener, e.g. the patient view) refetches immediately.
 */
import { fetchJSON, postJSON, putJSON, deleteJSON } from '@/core/http';
import * as taskContract from '@shared/contracts/task.contract';
import * as employeeContract from '@shared/contracts/employee.contract';
import type { TaskRow, CompletedTaskRow, CreateTaskBody } from '@shared/contracts/task.contract';
import type { AlertStatusBody } from '@shared/contracts/patient.contract';

export type { TaskRow, CompletedTaskRow };

/** A staff member that a task can be assigned to (employees row, name + id). */
export interface StaffOption {
  id: number;
  employee_name: string;
}

export const TASKS_CHANGED_EVENT = 'tasks:changed';

/** Tell every listener (TasksBell, patient view) that task data changed. */
export function notifyTasksChanged(): void {
  window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
}

export function fetchTasks(signal?: AbortSignal): Promise<TaskRow[]> {
  return fetchJSON<TaskRow[]>('/api/tasks', { signal, schema: taskContract.tasks.response });
}

/** Completed-task history (feature #3) — newest completion first. */
export function fetchTaskHistory(signal?: AbortSignal): Promise<CompletedTaskRow[]> {
  return fetchJSON<CompletedTaskRow[]>('/api/tasks/history', { signal, schema: taskContract.tasksHistory.response });
}

/** Staff list for the assignee picker (feature #4). The contract asserts only `id`;
 *  the explicit generic surfaces `employee_name` (a preserved long-tail field). */
export function fetchAssignableStaff(signal?: AbortSignal): Promise<StaffOption[]> {
  return fetchJSON<{ employees: StaffOption[] }>('/api/employees', {
    signal,
    schema: employeeContract.employees.response,
  }).then((r) => r.employees);
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
