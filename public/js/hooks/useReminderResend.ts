/**
 * Re-sending reminders from the /send status table — one row, or every failed row.
 *
 * The state lives at MODULE scope, not in the page, on purpose (audit FE-F16-7).
 * "Re-send all failed" is a client loop (one row every 2 s), and it keeps going
 * after the user leaves /send. With the flag in page state, a return visit found
 * the menu enabled again, and a second "Re-send all failed" re-sent the rows the
 * first loop hadn't reached: two reminders to the same patients. A single-row
 * re-send had no guard at all, and its row stays FAILED until the next status
 * read, so it could be fired twice. Here one tab knows what it is already
 * sending, whichever page instance asked; the toasts go through `window.toast`
 * so a loop that outlives the page still reports how it ended.
 */
import { useSyncExternalStore } from 'react';
import { postJSON, httpErrorMessage } from '@/core/http';
import * as waContract from '@shared/contracts/whatsapp.contract';
import { queryClient } from '@/query/client';
import { qk } from '@/query/keys';
import { API_ENDPOINTS } from '../utils/whatsapp-send-constants';

/** Gap between bulk resends — mirrors the batch sender's per-message spacing. */
const BULK_RESEND_GAP_MS = 2000;

export interface ResendTarget {
  appointmentId: number;
  name: string;
}

export interface ResendState {
  /** Appointment ids with a re-send request in flight. */
  inFlight: ReadonlySet<number>;
  /** The running "Re-send all failed" loop, if any. */
  bulk: { done: number; total: number } | null;
}

let state: ResendState = { inFlight: new Set(), bulk: null };
const listeners = new Set<() => void>();

function update(next: Partial<ResendState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setInFlight(appointmentId: number, on: boolean): void {
  const next = new Set(state.inFlight);
  if (on) next.add(appointmentId);
  else next.delete(appointmentId);
  update({ inFlight: next });
}

function refreshDay(date: string): void {
  void queryClient.invalidateQueries({ queryKey: qk.whatsapp.messages(date) });
  void queryClient.invalidateQueries({ queryKey: qk.whatsapp.messageCount(date) });
}

/** POST one re-send; resolves to null on success, else the reason. */
async function postResend(appointmentId: number): Promise<string | null> {
  setInFlight(appointmentId, true);
  try {
    await postJSON(API_ENDPOINTS.WA_RESEND, { appointmentId }, { schema: waContract.resendAppointment.response });
    return null;
  } catch (error) {
    return httpErrorMessage(error, 'Unknown error');
  } finally {
    setInFlight(appointmentId, false);
  }
}

/** The page's view of what this tab is already re-sending. */
export function useReminderResend(): ResendState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Re-send one appointment's reminder — unless it, or a bulk run, is already going. */
export async function resendReminder(target: ResendTarget, date: string): Promise<void> {
  if (state.bulk || state.inFlight.has(target.appointmentId)) return;
  const error = await postResend(target.appointmentId);
  if (error) window.toast?.error(`Re-send to ${target.name} failed: ${error}`);
  else window.toast?.success(`Reminder re-sent to ${target.name}`);
  refreshDay(date);
}

/** Re-send every failed row, one every 2 s. A second call while one runs is ignored. */
export async function resendAllFailed(targets: readonly ResendTarget[], date: string): Promise<void> {
  if (state.bulk) return;
  const todo = targets.filter((t) => !state.inFlight.has(t.appointmentId));
  if (todo.length === 0) return;

  update({ bulk: { done: 0, total: todo.length } });
  window.toast?.info(`Re-sending ${todo.length} failed message(s)…`);
  let sent = 0;
  try {
    for (let i = 0; i < todo.length; i++) {
      if ((await postResend(todo[i].appointmentId)) === null) sent++;
      update({ bulk: { done: i + 1, total: todo.length } });
      if (i < todo.length - 1) await new Promise((resolve) => setTimeout(resolve, BULK_RESEND_GAP_MS));
    }
  } finally {
    update({ bulk: null });
    refreshDay(date);
  }
  if (sent === todo.length) {
    window.toast?.success(`Re-sent all ${sent} failed message(s)`);
  } else {
    window.toast?.warning(`Re-sent ${sent} of ${todo.length} failed message(s) — check the table for reasons`);
  }
}
