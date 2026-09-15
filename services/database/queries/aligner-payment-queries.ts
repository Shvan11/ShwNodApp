/**
 * Aligner PAYMENT database queries — invoices raised against an aligner set, and the
 * per-set balance the UI shows.
 *
 * Split out of aligner-queries.ts (S2/C4). `getAlignerSetBalance` assembles its joins
 * inline — there is no DB view behind it.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';
import { log } from '../../../utils/logger.js';

interface AlignerPaymentData {
  workid: number;
  aligner_set_id: number | null;
  amount_paid: number | string;
  date_of_payment: Date | string;
  change?: number | null;
  notes?: string;
}

interface AlignerSetBalance {
  aligner_set_id: number;
  set_cost: number | null;
  TotalPaid: number | null;
  Balance: number | null;
}

// ==============================
// ALIGNER PAYMENTS QUERIES
// ==============================

/** Outcome of {@link createAlignerPayment} — the service maps these onto its own error codes. */
export type GuardedAlignerPaymentResult =
  | { outcome: 'created'; invoice_id: number }
  | { outcome: 'work_not_found' }
  | { outcome: 'set_not_found' }
  | { outcome: 'set_cost_not_defined' }
  | { outcome: 'invalid_amount' }
  | { outcome: 'exceeds_set_balance'; setCost: number; setPaid: number; setBalance: number }
  | { outcome: 'exceeds_work_balance'; totalRequired: number; discount: number; workPaid: number; remaining: number };

/**
 * Add a payment for an aligner set, re-checking BOTH balances under row locks.
 *
 * This is the aligner twin of `payment-queries.addInvoiceWithBalanceGuard`, and it exists for the
 * same reason: a service-layer `paymentAmount > balance` pre-check is a read-then-write. Two
 * payments registered against the same set at the same moment both read the pre-insert balance,
 * both pass, and the set is overpaid. Until 2026-09-15 this function was a bare
 * `insertInto('invoices')` with no transaction, no lock and no re-check, while the work-payment
 * path writing the SAME table had all three (audit finding F2).
 *
 * Two balances are checked, not one:
 *
 *  - **the set's** — `set_cost - sum(invoices.amount_paid WHERE aligner_set_id = …)`, the rule the
 *    service already intended to enforce;
 *  - **the work's** — `total_required - discount - sum(invoices.amount_paid WHERE work_id = …)`.
 *    This one was missing entirely. `invoices` is a per-WORK ledger: every other payment path sums
 *    the whole work, aligner rows included, so a set payment that ignores the work total does not
 *    merely skip a rule — it drives the work's own displayed balance negative and silently changes
 *    what the work-payment path will accept next. A set whose work has no total yet is therefore
 *    unpayable, exactly as that work already is from the work screen; the service says so in words.
 *
 * LOCK ORDER — `works` first, then `aligner_sets`. It is the only order in the codebase: the work
 * path locks `works` alone, and `createBatch`/`updateBatch`/`updateAlignerSet`/`deleteBatch` lock
 * `aligner_sets` alone, so nothing acquires them the other way round and no cycle exists. Keep it
 * that way when adding a writer that touches both.
 *
 * FLAG (date-string): `invoices.date_of_payment` is a PG `date`; the value is bound as a
 * 'YYYY-MM-DD' string wrapped in `sql<string>` so PG infers the date type and the column isn't
 * shifted by a UTC conversion (CLAUDE.md date gotcha). `toDateOnly` is handed the raw value, NOT
 * `new Date(value)` — the pass-through guard for a plain date string exists precisely so it is
 * never round-tripped through UTC midnight, and wrapping it first defeated that.
 */
export function createAlignerPayment(
  paymentData: AlignerPaymentData
): Promise<GuardedAlignerPaymentResult> {
  const { workid, aligner_set_id, amount_paid, date_of_payment, change } = paymentData;

  // Aligner sets are USD-only (enforced by `usdOnlyCurrency` in aligner.contract.ts +
  // the fixed field in SetFormDrawer), so the payment lands wholly in usd_received and
  // the IQD leg of the cash split is always 0. Billing a set in IQD would need a real
  // currency threaded in from the request AND the set currency re-opened — there is no
  // half-way state, so nothing here pretends to generalise.
  //
  // Rounded to an integer once: amount_paid / usd_received are both integer columns.
  const amount = Math.round(
    typeof amount_paid === 'string' ? parseFloat(amount_paid) : amount_paid
  );

  return withPgTransaction(async (trx): Promise<GuardedAlignerPaymentResult> => {
    // Lower bound checked HERE and not only at the contract: `amount > balance` passes trivially
    // for a negative, and a negative invoice RAISES the work's outstanding balance and skews every
    // sum over invoices.amount_paid (the doctor-commission report included).
    if (!Number.isFinite(amount) || amount <= 0) return { outcome: 'invalid_amount' };

    const work = await trx
      .selectFrom('works')
      .where('work_id', '=', workid)
      .select(['total_required', 'discount'])
      .forUpdate()
      .executeTakeFirst();
    if (!work) return { outcome: 'work_not_found' };

    if (aligner_set_id) {
      const set = await trx
        .selectFrom('aligner_sets')
        .where('aligner_set_id', '=', aligner_set_id)
        .select((eb) => [eb.ref('set_cost').$castTo<number | null>().as('set_cost')])
        .forUpdate()
        .executeTakeFirst();
      if (!set) return { outcome: 'set_not_found' };
      if (set.set_cost === null) return { outcome: 'set_cost_not_defined' };

      // Re-summed AFTER the lock is granted: under READ COMMITTED this statement sees a
      // concurrent payment's committed insert, which is the whole point of the lock.
      const setPaidRow = await trx
        .selectFrom('invoices')
        .where('aligner_set_id', '=', aligner_set_id)
        .select((eb) => eb.fn.coalesce(eb.fn.sum('amount_paid'), sql<number>`0`).$castTo<number>().as('paid'))
        .executeTakeFirstOrThrow();

      const setCost = Number(set.set_cost);
      const setPaid = Number(setPaidRow.paid ?? 0);
      const setBalance = setCost - setPaid;
      if (amount > setBalance) {
        return { outcome: 'exceeds_set_balance', setCost, setPaid, setBalance };
      }
    }

    const workPaidRow = await trx
      .selectFrom('invoices')
      .where('work_id', '=', workid)
      .select((eb) => eb.fn.coalesce(eb.fn.sum('amount_paid'), sql<number>`0`).$castTo<number>().as('paid'))
      .executeTakeFirstOrThrow();

    const totalRequired = Number(work.total_required ?? 0);
    const discount = Number(work.discount ?? 0);
    const workPaid = Number(workPaidRow.paid ?? 0);
    const remaining = totalRequired - discount - workPaid;
    if (amount > remaining) {
      return { outcome: 'exceeds_work_balance', totalRequired, discount, workPaid, remaining };
    }

    const dateStr = toDateOnly(date_of_payment);

    const row = await trx
      .insertInto('invoices')
      .values({
        work_id: workid,
        amount_paid: amount,
        date_of_payment: sql<string>`${dateStr}`,
        change: change ?? null,
        aligner_set_id: aligner_set_id || null,
        usd_received: amount,
        iqd_received: 0,
      })
      .returning('invoice_id')
      .executeTakeFirstOrThrow();

    log.info('Created aligner payment', { workid, aligner_set_id, invoice_id: row.invoice_id, amount });
    return { outcome: 'created', invoice_id: row.invoice_id };
  });
}

/**
 * Get aligner set balance information for validation.
 *
 * Payment roll-up is assembled inline (no DB view);
 * its set_cost / TotalPaid / Balance logic is inlined as a single aggregate query.
 */
export async function getAlignerSetBalance(alignerSetId: number): Promise<AlignerSetBalance | null> {
  try {
    const row = await getKysely()
      .selectFrom('aligner_sets as s')
      .leftJoin('invoices as i', 's.aligner_set_id', 'i.aligner_set_id')
      .where('s.aligner_set_id', '=', alignerSetId)
      .groupBy(['s.aligner_set_id', 's.set_cost'])
      .select((eb) => [
        's.aligner_set_id',
        eb.ref('s.set_cost').$castTo<number | null>().as('set_cost'),
        eb.fn.coalesce(eb.fn.sum('i.amount_paid'), sql<number>`0`).$castTo<number>().as('TotalPaid'),
        sql<number | null>`${eb.ref('s.set_cost')} - coalesce(sum(i."amount_paid"), 0)`.as('Balance'),
      ])
      .executeTakeFirst();

    if (!row) return null;
    return {
      aligner_set_id: row.aligner_set_id,
      set_cost: row.set_cost,
      TotalPaid: row.TotalPaid,
      Balance: row.Balance,
    };
  } catch (err) {
    log.error('Failed to get aligner set balance', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
