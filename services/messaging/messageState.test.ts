/**
 * FE-F16-1: the /send page's progress must be the reminder BATCH's own.
 *
 * Before: `sent`/`failed` grew on every `MessageSent`/`MessageFailed`, which
 * one-off sends (payment receipts, booking confirmations, re-sends) fire too, and
 * `finished` was only ever set true — so after two receipts a batch's first
 * message read 3/3, and a second batch in the same process was "finished" after
 * one message. This replays that sequence against the real module.
 */
import { describe, expect, it } from 'vitest';
import messageState from './messageState.js';

// The singleton initialises its keys on the next tick.
const ready = () => new Promise((resolve) => setTimeout(resolve, 0));

const oneOff = (n: number) =>
  messageState.addPerson({ messageId: `receipt-${n}`, name: 'Receipt', number: '9647700000000', success: '&#10004;' });

describe('messageState batch progress (FE-F16-1)', () => {
  it('counts only the batch, starts each batch from zero, and finishes per batch', async () => {
    await ready();

    // Two receipts before any batch: no batch counters move.
    await oneOff(1);
    await oneOff(2);
    expect(messageState.batchProgress).toMatchObject({ started: false, sent: 0, failed: 0 });

    // Batch 1: 3 recipients, a receipt in the middle of it.
    expect(await messageState.startBatch('2026-10-05', 3)).toMatchObject({
      started: true, finished: false, total: 3, sent: 0, failed: 0, date: '2026-10-05', error: null,
    });
    await messageState.recordBatchResult(true);
    await oneOff(3);
    await messageState.recordBatchResult(false);
    await messageState.recordBatchResult(true);
    expect(messageState.batchProgress).toMatchObject({ sent: 2, failed: 1, finished: false });
    expect(await messageState.finishBatch()).toMatchObject({ finished: true, sent: 2, failed: 1, error: null });

    // Batch 2 in the same process: not "finished" after its first message.
    await messageState.startBatch('2026-10-06', 4);
    expect(await messageState.recordBatchResult(true)).toMatchObject({
      started: true, finished: false, total: 4, sent: 1, failed: 0, date: '2026-10-06',
    });

    // A batch that stops early says why.
    expect(await messageState.finishBatch('WhatsApp stopped responding')).toMatchObject({
      finished: true, sent: 1, error: 'WhatsApp stopped responding',
    });

    // The dump (initial-state's `sentMessages`) is the batch's too.
    expect(messageState.dump()).toMatchObject({ sentMessages: 1, failedMessages: 0, finishedSending: true });

    await messageState.reset();
    expect(messageState.batchProgress).toMatchObject({ started: false, finished: false, total: 0, sent: 0 });
  });
});
