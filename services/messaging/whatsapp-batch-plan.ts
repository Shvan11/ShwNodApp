/**
 * The DECISIONS in the WhatsApp batch-reminder path, as pure functions.
 *
 * `whatsapp.ts` owns the I/O — the Puppeteer client, the 2s pacing, the DB
 * writes, the SSE emits, the restart. What it does NOT own any more is the
 * *reasoning*: who gets a message and what it says, when a run of failures means
 * the connection is dead rather than one number being bad, and which delivery
 * acks a report should write back. Each of those is a data-in/plan-out function
 * here, so it can be exercised without a browser, a phone or a database — see
 * `whatsapp-batch-plan.test.ts`.
 *
 * Everything in this module is pure: no clock (the caller passes `daysAhead`),
 * no randomness, no I/O, no service state. Keep it that way — the point is that
 * the rules stay testable while the machinery around them does not have to be.
 *
 * Deliberately NOT unified with the sibling builders in `messaging-queries.ts`
 * (`getSmsMessages`, `getNewAppointmentMessage`): their wording differs from the
 * WhatsApp reminder — different clinic phrasing, a meridiem on the time, the
 * `Tommorow` typos the retired procs shipped — and collapsing them into one
 * "shared" template would silently rewrite messages patients receive.
 */

import { arabicDay } from '../../utils/arabic-day.js';
import { englishDay, format12h, formatPhone, isValidPhone } from './reminder-format.js';
import { isConnectionStallError, isMalformedSendResultError } from './whatsapp-errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Recipient selection — who gets a reminder, and what it says
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reminders only go out the day before and two days before an appointment
 * (the retired proc's rule). Anything else — today, three days out, the past —
 * produces no messages at all, which is why a preview of such a date is empty.
 */
export function isReminderDay(daysAhead: number): boolean {
  return daysAhead === 1 || daysAhead === 2;
}

/** One eligible appointment row, as the reminder query selects it. */
export interface ReminderCandidate {
  id: number;
  phone: string | null;
  countryCode: string | null;
  patientName: string | null;
  firstName: string | null;
  /** `1` = English; anything else (including null) = Arabic. */
  language: number | null;
  /** Appointment timestamp — only its time-of-day is used. */
  appDate: Date;
}

/** A patient the batch will actually message. */
export interface ReminderRecipient {
  appointmentId: number;
  /** Dialable form: country code + national number, no '+'. */
  number: string;
  message: string;
  name: string;
}

/** A candidate the batch will skip, and why. */
export interface SkippedCandidate {
  appointmentId: number;
  reason: 'invalid-phone';
}

export interface ReminderPlan {
  recipients: ReminderRecipient[];
  skipped: SkippedCandidate[];
}

/**
 * Turn eligible appointment rows into the list of messages to send.
 *
 * `daysAhead` is passed in rather than derived from the clock so the plan is
 * deterministic: the same rows and the same `daysAhead` always yield the same
 * text. Outside the reminder window the plan is empty — the window rule lives
 * here so it cannot drift from the text that assumes it ("tomorrow" vs "the day
 * after tomorrow").
 *
 * A row with no usable phone is *skipped, not failed*: it never reaches the
 * send loop, so it stays eligible for a later batch once the number is fixed.
 */
export function buildReminderPlan(
  candidates: readonly ReminderCandidate[],
  options: { date: Date | string; daysAhead: number }
): ReminderPlan {
  const plan: ReminderPlan = { recipients: [], skipped: [] };
  if (!isReminderDay(options.daysAhead)) return plan;

  const aDay = arabicDay(options.date);
  const eDay = englishDay(options.date);
  const aMes =
    options.daysAhead === 1
      ? `غدا ${aDay} موعدك مع عيادة د.شوان لتقويم الاسنان الساعة`
      : `بعد غد ${aDay} موعدك مع عيادة د.شوان لتقويم الاسنان الساعة`;
  const eMes =
    options.daysAhead === 1
      ? `Tomorrow "${eDay}" is your appointment with Dr. Shwan orthodontic clinic at`
      : `The day after tomorrow "${eDay}" is your appointment with Dr. Shwan orthodontic clinic at`;

  for (const candidate of candidates) {
    if (!isValidPhone(candidate.phone)) {
      plan.skipped.push({ appointmentId: candidate.id, reason: 'invalid-phone' });
      continue;
    }

    const countryCode = candidate.countryCode || '964';
    const time = format12h(candidate.appDate);
    const message =
      candidate.language === 1
        ? `Hello ${candidate.firstName || candidate.patientName}. ${eMes} ${time}`
        : `السلام عليك ${candidate.patientName}. ${aMes} ${time}`;

    plan.recipients.push({
      appointmentId: candidate.id,
      number: formatPhone(candidate.phone, countryCode),
      message,
      name: candidate.patientName || '',
    });
  }

  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Abort rules — when a run of failures means the connection is dead
// ─────────────────────────────────────────────────────────────────────────────

/** What one send attempt turned out to be. */
export type SendOutcome = 'sent' | 'recipient-failure' | 'stall' | 'malformed';

/** Why a batch stopped early. */
export type BatchAbortReason = 'stalls' | 'malformed';

/**
 * Two in a row, not one: a lone anomaly (one number that trips the library, one
 * transient timeout) must not nuke a whole evening's reminders.
 */
export const MAX_CONSECUTIVE_FAILURES = 2;

export interface BatchGuard {
  consecutiveStalls: number;
  consecutiveMalformed: number;
  /** Non-null once the batch must stop. */
  abort: BatchAbortReason | null;
}

export const INITIAL_BATCH_GUARD: BatchGuard = Object.freeze({
  consecutiveStalls: 0,
  consecutiveMalformed: 0,
  abort: null,
});

/**
 * Classify a failed send. A *stall* (dead page/browser) and a *malformed result*
 * (whatsapp-web.js needs updating) are SYSTEMIC — every remaining send hits the
 * same wall — whereas anything else is about this one recipient (not on
 * WhatsApp, bad number) and the batch should carry on.
 */
export function classifySendFailure(errorMessage: string): Exclude<SendOutcome, 'sent'> {
  if (isMalformedSendResultError(errorMessage)) return 'malformed';
  if (isConnectionStallError(errorMessage)) return 'stall';
  return 'recipient-failure';
}

/**
 * Fold one outcome into the guard.
 *
 * Note the asymmetry, which is intentional and easy to lose in a rewrite: a
 * success or a per-recipient failure clears BOTH counters, but a stall does not
 * clear the malformed counter and vice versa — the two systemic signals are
 * independent, and alternating between them is not evidence that either has
 * recovered.
 */
export function advanceBatchGuard(guard: BatchGuard, outcome: SendOutcome): BatchGuard {
  if (outcome === 'sent' || outcome === 'recipient-failure') {
    return { consecutiveStalls: 0, consecutiveMalformed: 0, abort: null };
  }

  if (outcome === 'malformed') {
    const consecutiveMalformed = guard.consecutiveMalformed + 1;
    return {
      consecutiveStalls: guard.consecutiveStalls,
      consecutiveMalformed,
      abort: consecutiveMalformed >= MAX_CONSECUTIVE_FAILURES ? 'malformed' : null,
    };
  }

  const consecutiveStalls = guard.consecutiveStalls + 1;
  return {
    consecutiveStalls,
    consecutiveMalformed: guard.consecutiveMalformed,
    abort: consecutiveStalls >= MAX_CONSECUTIVE_FAILURES ? 'stalls' : null,
  };
}

export interface BatchSummary {
  /** How many sends reported success. */
  sentCount: number;
  /** How many recipients were never attempted (0 unless the batch aborted). */
  remaining: number;
  abort: BatchAbortReason | null;
  /** User-facing warning for the send page, or null when the batch ran clean. */
  warning: string | null;
  /** Whether the client should be restarted — a stall only; see below. */
  restart: boolean;
  /**
   * Whether to arm the zero-ack watchdog. An aborted batch is expected to be
   * ack-silent, so arming it there would fire a second, misleading warning.
   */
  armAckWatchdog: boolean;
}

/**
 * Describe what a finished batch means for the user.
 *
 * The restart rule is the load-bearing half: a stall is a dead connection and a
 * restart fixes it, while a malformed result is a library-version mismatch that
 * survives any number of restarts — so that branch warns and stops instead.
 */
export function summarizeBatch(input: {
  date: string;
  results: readonly { success: boolean }[];
  /** Recipients the batch set out to message. */
  total: number;
  abort: BatchAbortReason | null;
}): BatchSummary {
  const sentCount = input.results.filter((r) => r.success).length;
  const remaining = input.total - input.results.length;

  if (input.abort === 'stalls') {
    return {
      sentCount,
      remaining,
      abort: 'stalls',
      restart: true,
      armAckWatchdog: false,
      warning:
        `WhatsApp stopped responding — sending for ${input.date} was aborted ` +
        `(${remaining} message(s) not attempted). WhatsApp is restarting automatically. ` +
        `Verify on the phone whether the ${sentCount} earlier message(s) really delivered, ` +
        'then press Send again for the rest.',
    };
  }

  if (input.abort === 'malformed') {
    return {
      sentCount,
      remaining,
      abort: 'malformed',
      restart: false,
      armAckWatchdog: false,
      warning:
        `WhatsApp sending for ${input.date} was aborted — WhatsApp changed and the ` +
        `app needs updating (${remaining} message(s) not attempted). Verify on ` +
        `the phone whether the ${sentCount} earlier message(s) delivered, then ` +
        'contact support before resending.',
    };
  }

  return {
    sentCount,
    remaining,
    abort: null,
    restart: false,
    armAckWatchdog: shouldArmAckWatchdog(sentCount),
    warning: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. The zero-ack (zombie-send) verdict
// ─────────────────────────────────────────────────────────────────────────────

export const ACK_SILENCE_WINDOW_MS = 90000;

/**
 * Below this, ack silence proves nothing: one or two messages can plausibly go
 * unacked for 90s on a healthy connection.
 */
export const MIN_SENT_FOR_ACK_SIGNAL = 3;

export function shouldArmAckWatchdog(sentCount: number): boolean {
  return sentCount >= MIN_SENT_FOR_ACK_SIGNAL;
}

/**
 * After the silence window: is this the "shown as sent but never delivered"
 * zombie? A dead socket cannot produce server acks, so zero new acks is the
 * signal — unless the user pulled the plug themselves, in which case silence is
 * simply what they asked for.
 */
export function isAckSilenceConfirmed(input: {
  acksBefore: number;
  acksNow: number;
  manualDisconnect: boolean;
  destroyInProgress: boolean;
}): boolean {
  if (input.acksNow > input.acksBefore) return false;
  return !input.manualDisconnect && !input.destroyInProgress;
}

export function ackSilenceWarning(date: string, sentCount: number): string {
  return (
    `WhatsApp did not confirm any of the ${sentCount} messages sent for ${date} — ` +
    'they were most likely NOT delivered. WhatsApp is being restarted automatically; ' +
    'verify on the phone, then Reset the date and send again.'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Report reconciliation — which acks to write back
// ─────────────────────────────────────────────────────────────────────────────

/** Bounded so one hung chat cannot serialize-block the whole WhatsApp command path. */
export const REPORT_CONCURRENCY = 5;
export const REPORT_PER_MESSAGE_TIMEOUT_MS = 15000;

/** A message the app previously recorded as sent. */
export interface DeliveryStatusRow {
  id: number;
  wamid: string;
}

/** The subset of a fetched WhatsApp message reconciliation reads. */
export interface FetchedAck {
  id: { id: string };
  ack?: number;
}

/**
 * Match one recorded message against what the chat actually holds.
 *
 * `ack || 1` is deliberate: a message we can still see in the chat has at least
 * reached the server, so ack 0 ("pending", the value WhatsApp Web reports before
 * it has caught up) is recorded as 1 rather than as a regression of a status the
 * DB may already hold. Not finding the message yields null — no write at all,
 * never a downgrade.
 */
export function reconcileAck(
  row: DeliveryStatusRow,
  fetched: readonly FetchedAck[]
): { id: number; ack: number } | null {
  const ours = fetched.find((m) => m.id.id === row.wamid);
  return ours ? { id: row.id, ack: ours.ack || 1 } : null;
}
