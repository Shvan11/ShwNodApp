/**
 * The WhatsApp batch path's decision rules.
 *
 * These are the parts of the reminder run that decide something — who is
 * messaged and in what words, when a run of failures means the connection is
 * dead rather than one number being bad, whether ack silence is a zombie send,
 * which delivery acks get written back. They used to be reachable only by
 * running a real batch against a live phone, a browser and the clinic database,
 * which is why none of them had ever been tested.
 *
 * What is pinned here is deliberate behaviour, including the proc-parity quirks
 * (Friday's empty Arabic weekday, `ack || 1`) — if a change makes one of these
 * fail, the question is whether patients should receive something different.
 */
import { describe, expect, it } from 'vitest';
import {
  ackSilenceWarning,
  advanceBatchGuard,
  buildReminderPlan,
  classifySendFailure,
  INITIAL_BATCH_GUARD,
  isAckSilenceConfirmed,
  isReminderDay,
  MAX_CONSECUTIVE_FAILURES,
  reconcileAck,
  shouldArmAckWatchdog,
  summarizeBatch,
  type BatchGuard,
  type ReminderCandidate,
  type SendOutcome,
} from './whatsapp-batch-plan.js';
import { MALFORMED_SEND_RESULT_ERROR } from './whatsapp-errors.js';

/** 2026-09-16 is a Wednesday; 2026-09-18 a Friday (the clinic's closed day). */
const WEDNESDAY = '2026-09-16';
const FRIDAY = '2026-09-18';

function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    id: 1,
    phone: '07501234567',
    countryCode: '964',
    patientName: 'سارة أحمد',
    firstName: 'Sara',
    language: 0,
    appDate: new Date(2026, 8, 16, 14, 30),
    ...overrides,
  };
}

describe('buildReminderPlan — recipient selection', () => {
  it('sends nothing outside the day-before / two-days-before window', () => {
    // The rule that makes previewing any other date come back empty.
    for (const daysAhead of [-1, 0, 3, 7]) {
      expect(isReminderDay(daysAhead)).toBe(false);
      const plan = buildReminderPlan([candidate()], { date: WEDNESDAY, daysAhead });
      expect(plan.recipients, `daysAhead=${daysAhead}`).toHaveLength(0);
      expect(plan.skipped).toHaveLength(0);
    }
  });

  it('writes the Arabic reminder with the weekday and 12-hour time', () => {
    const plan = buildReminderPlan([candidate()], { date: WEDNESDAY, daysAhead: 1 });

    expect(plan.recipients).toHaveLength(1);
    expect(plan.recipients[0].message).toBe(
      'السلام عليك سارة أحمد. غدا ألاربعاء موعدك مع عيادة د.شوان لتقويم الاسنان الساعة 2:30'
    );
  });

  it('switches to "the day after tomorrow" two days out', () => {
    const plan = buildReminderPlan([candidate({ language: 1 })], {
      date: WEDNESDAY,
      daysAhead: 2,
    });

    expect(plan.recipients[0].message).toBe(
      'Hello Sara. The day after tomorrow "Wednesday" is your appointment with Dr. Shwan orthodontic clinic at 2:30'
    );
  });

  it('greets an English-language patient by first name, others by full name', () => {
    const [english] = buildReminderPlan([candidate({ language: 1 })], {
      date: WEDNESDAY,
      daysAhead: 1,
    }).recipients;
    const [arabic] = buildReminderPlan([candidate()], { date: WEDNESDAY, daysAhead: 1 })
      .recipients;

    expect(english.message).toMatch(/^Hello Sara\. Tomorrow "Wednesday"/);
    expect(arabic.message).toMatch(/^السلام عليك سارة أحمد\./);
  });

  it('falls back to the full name when an English patient has no first name', () => {
    const plan = buildReminderPlan(
      [candidate({ language: 1, firstName: null, patientName: 'Sara Ahmed' })],
      { date: WEDNESDAY, daysAhead: 1 }
    );

    expect(plan.recipients[0].message).toMatch(/^Hello Sara Ahmed\./);
  });

  it('keeps the empty Arabic weekday on a Friday (the retired proc returned NULL)', () => {
    // Clinic-closed day. Proc parity: the name is blank, leaving the double
    // space — pinned so nobody "fixes" the spacing and changes live message text.
    const plan = buildReminderPlan([candidate()], { date: FRIDAY, daysAhead: 1 });

    expect(plan.recipients[0].message).toContain('غدا  موعدك');
  });

  it('skips an unusable phone instead of failing it, and keeps the rest', () => {
    const plan = buildReminderPlan(
      [
        candidate({ id: 10, phone: null }),
        candidate({ id: 11, phone: '   ' }),
        candidate({ id: 12, phone: 'call the mother' }),
        candidate({ id: 13, phone: '07501234567' }),
      ],
      { date: WEDNESDAY, daysAhead: 1 }
    );

    // Skipped rows never reach the send loop, so they keep their eligibility
    // flags and go out in a later batch once the number is corrected.
    expect(plan.skipped.map((s) => s.appointmentId)).toEqual([10, 11, 12]);
    expect(plan.skipped.every((s) => s.reason === 'invalid-phone')).toBe(true);
    expect(plan.recipients.map((r) => r.appointmentId)).toEqual([13]);
  });

  it('dials every local phone shape as country code + national number', () => {
    const shapes: Array<[string, string]> = [
      ['07501234567', '9647501234567'],
      ['+9647501234567', '9647501234567'],
      ['009647501234567', '9647501234567'],
      ['9647501234567', '9647501234567'],
      ['7501234567', '9647501234567'],
      [' 07501234567 ', '9647501234567'],
    ];

    for (const [phone, expected] of shapes) {
      const plan = buildReminderPlan([candidate({ phone })], {
        date: WEDNESDAY,
        daysAhead: 1,
      });
      expect(plan.recipients[0]?.number, phone).toBe(expected);
    }
  });

  it('honours a patient country code, defaulting to Iraq', () => {
    const abroad = buildReminderPlan([candidate({ phone: '07700900123', countryCode: '44' })], {
      date: WEDNESDAY,
      daysAhead: 1,
    });
    const missing = buildReminderPlan([candidate({ countryCode: null })], {
      date: WEDNESDAY,
      daysAhead: 1,
    });

    expect(abroad.recipients[0].number).toBe('447700900123');
    expect(missing.recipients[0].number).toBe('9647501234567');
  });

  it('never carries a null name into the send loop', () => {
    const plan = buildReminderPlan([candidate({ patientName: null, language: 1 })], {
      date: WEDNESDAY,
      daysAhead: 1,
    });

    expect(plan.recipients[0].name).toBe('');
  });
});

describe('classifySendFailure', () => {
  it('reads a dead page as systemic, not as one bad recipient', () => {
    for (const message of [
      'Timeout after 60000ms: sendMessage 9647501234567',
      'Protocol error (Runtime.callFunctionOn): Target closed',
      'Execution context was destroyed',
      'Session closed. Most likely the page has been closed.',
    ]) {
      expect(classifySendFailure(message), message).toBe('stall');
    }
  });

  it('reads an empty send result as a library-version break', () => {
    expect(classifySendFailure(MALFORMED_SEND_RESULT_ERROR)).toBe('malformed');
  });

  it('treats anything else as this recipient only', () => {
    for (const message of ['No LID for user', 'Invalid wid', 'some new library error']) {
      expect(classifySendFailure(message), message).toBe('recipient-failure');
    }
  });
});

describe('advanceBatchGuard — when to abort a batch', () => {
  const fold = (outcomes: SendOutcome[]): BatchGuard =>
    outcomes.reduce<BatchGuard>(advanceBatchGuard, INITIAL_BATCH_GUARD);

  it('lets a lone stall through — one anomaly must not nuke the batch', () => {
    expect(fold(['sent', 'stall']).abort).toBeNull();
    expect(MAX_CONSECUTIVE_FAILURES).toBe(2);
  });

  it('aborts on two stalls in a row', () => {
    expect(fold(['sent', 'stall', 'stall']).abort).toBe('stalls');
  });

  it('aborts on two malformed results in a row', () => {
    expect(fold(['malformed', 'malformed']).abort).toBe('malformed');
  });

  it('clears the run on a success or a per-recipient failure', () => {
    expect(fold(['stall', 'sent', 'stall']).abort).toBeNull();
    expect(fold(['stall', 'recipient-failure', 'stall']).abort).toBeNull();
    expect(fold(['malformed', 'sent', 'malformed']).abort).toBeNull();
  });

  it('keeps the two systemic counters independent', () => {
    // Alternating stall/malformed is NOT evidence that either recovered, so
    // neither counter resets the other — the third stall still aborts.
    const guard = fold(['stall', 'malformed', 'stall']);

    expect(guard.consecutiveStalls).toBe(2);
    expect(guard.consecutiveMalformed).toBe(1);
    expect(guard.abort).toBe('stalls');
  });

  it('does not mutate the guard it is handed', () => {
    const before = { ...INITIAL_BATCH_GUARD };
    advanceBatchGuard(INITIAL_BATCH_GUARD, 'stall');
    expect(INITIAL_BATCH_GUARD).toEqual(before);
  });
});

describe('summarizeBatch — what a finished run means', () => {
  const ok = { success: true };
  const failed = { success: false };

  it('says nothing to the user after a clean run', () => {
    const summary = summarizeBatch({
      date: WEDNESDAY,
      results: [ok, ok, failed, ok],
      total: 4,
      abort: null,
    });

    expect(summary).toMatchObject({
      sentCount: 3,
      remaining: 0,
      abort: null,
      warning: null,
      restart: false,
      armAckWatchdog: true,
    });
  });

  it('does not arm the zombie-send watchdog below three sends', () => {
    // One or two unacked messages in 90s is normal; three is a signal.
    expect(shouldArmAckWatchdog(2)).toBe(false);
    expect(shouldArmAckWatchdog(3)).toBe(true);
    expect(
      summarizeBatch({ date: WEDNESDAY, results: [ok, ok], total: 2, abort: null })
        .armAckWatchdog
    ).toBe(false);
  });

  it('restarts after a stall abort and reports what was not attempted', () => {
    const summary = summarizeBatch({
      date: WEDNESDAY,
      results: [ok, ok, ok, failed, failed],
      total: 30,
      abort: 'stalls',
    });

    expect(summary.sentCount).toBe(3);
    expect(summary.remaining).toBe(25);
    expect(summary.restart).toBe(true);
    // An aborted batch is expected to be ack-silent — arming the watchdog would
    // fire a second, misleading warning 90s later.
    expect(summary.armAckWatchdog).toBe(false);
    expect(summary.warning).toContain('25 message(s) not attempted');
    expect(summary.warning).toContain('the 3 earlier message(s)');
  });

  it('does NOT restart after a malformed abort — a version mismatch survives it', () => {
    const summary = summarizeBatch({
      date: WEDNESDAY,
      results: [ok, failed, failed],
      total: 12,
      abort: 'malformed',
    });

    expect(summary.restart).toBe(false);
    expect(summary.armAckWatchdog).toBe(false);
    expect(summary.warning).toContain('app needs updating');
    expect(summary.warning).toContain('9 message(s) not attempted');
  });
});

describe('isAckSilenceConfirmed — the zombie-send verdict', () => {
  const base = {
    acksBefore: 4,
    acksNow: 4,
    manualDisconnect: false,
    destroyInProgress: false,
  };

  it('confirms the zombie when not one ack arrived in the window', () => {
    expect(isAckSilenceConfirmed(base)).toBe(true);
  });

  it('clears as healthy as soon as a single ack lands', () => {
    expect(isAckSilenceConfirmed({ ...base, acksNow: 5 })).toBe(false);
  });

  it('stays quiet when the silence is the user\'s own doing', () => {
    expect(isAckSilenceConfirmed({ ...base, manualDisconnect: true })).toBe(false);
    expect(isAckSilenceConfirmed({ ...base, destroyInProgress: true })).toBe(false);
  });

  it('tells the user to verify before resending', () => {
    // The DB "sent" flags are deliberately not auto-cleared, so the copy must
    // not invite a blind resend.
    expect(ackSilenceWarning(WEDNESDAY, 7)).toContain('7 messages');
    expect(ackSilenceWarning(WEDNESDAY, 7)).toContain('verify on the phone');
  });
});

describe('reconcileAck — which delivery acks get written back', () => {
  const row = { id: 42, wamid: 'ABC123' };

  it('records the ack of the message it finds in the chat', () => {
    expect(reconcileAck(row, [{ id: { id: 'OTHER' }, ack: 1 }, { id: { id: 'ABC123' }, ack: 3 }]))
      .toEqual({ id: 42, ack: 3 });
  });

  it('writes nothing when the message is not in the fetched window', () => {
    expect(reconcileAck(row, [{ id: { id: 'OTHER' }, ack: 3 }])).toBeNull();
    expect(reconcileAck(row, [])).toBeNull();
  });

  it('floors a pending/absent ack at 1 rather than reporting a regression', () => {
    // The message is visibly in the chat, so it reached the server; ack 0
    // ("pending", reported before WhatsApp Web catches up) must not overwrite a
    // delivered/read status the DB may already hold.
    expect(reconcileAck(row, [{ id: { id: 'ABC123' }, ack: 0 }])).toEqual({ id: 42, ack: 1 });
    expect(reconcileAck(row, [{ id: { id: 'ABC123' } }])).toEqual({ id: 42, ack: 1 });
  });
});
