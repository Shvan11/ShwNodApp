/**
 * Aligner PAYMENT database queries — invoices raised against an aligner set, and the
 * per-set balance the UI shows.
 *
 * Split out of aligner-queries.ts (S2/C4). `getAlignerSetBalance` assembles its joins
 * inline — there is no DB view behind it.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
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

/**
 * Add payment for an aligner set
 *
 * FLAG (date-string): `tblInvoice.date_of_payment` is a PG `date` column; the value is
 * bound as a 'YYYY-MM-DD' string (via toDateOnly) wrapped in `sql<string>` so PG infers the
 * date type and the column isn't shifted by a UTC conversion (see CLAUDE.md date gotcha).
 * `amount_paid`/`change`/`usd_received`/`iqd_received` are plain integer columns.
 */
export async function createAlignerPayment(
  paymentData: AlignerPaymentData
): Promise<number> {
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

  log.info('Creating aligner payment', { workid, aligner_set_id, amount_paid, usdReceived: amount });

  try {
    const dateStr = toDateOnly(new Date(date_of_payment as string));

    const row = await getKysely()
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

    return row.invoice_id;
  } catch (err) {
    log.error('Failed to create aligner payment', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
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
