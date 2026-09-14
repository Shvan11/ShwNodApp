/**
 * Payment-related database queries
 *
 * Money columns on `invoices` (amount_paid, usd_received, iqd_received, change) are PG
 * `integer`, so they map straight to JS numbers (no numeric cast needed). The date-only
 * columns (date_of_payment, start_date) are PG `date`, which the centralized pg parser
 * (kysely.ts) returns as a 'YYYY-MM-DD' string; the generated `Database` type already
 * types them `string`, so they're projected as-is and the declared return types are
 * `string` (no `$castTo` needed). The exchange-rate upserts use ON CONFLICT against the
 * `uq_sms_date` unique index.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';

// type definitions

/**
 * A single payment row for a patient, as projected by {@link getPayments}.
 * `Date` is `i.date_of_payment` (PG `date`), which the centralized pg parser
 * returns as a 'YYYY-MM-DD' string at runtime — hence the `string` type.
 */
export interface Payment {
  Payment: number;
  Date: string;
}

interface InvoiceData {
  workid: number;
  amountPaid: number;
  paymentDate: string;
  usdReceived: number;
  iqdReceived: number;
  change: number | null;
}

// `type` (not `interface`) so it carries an implicit string index signature and is
// therefore assignable to the `z.looseObject` paymentHistory response contract that
// `sendData` validates against (see shared-contract-progress.md, Phase 1 finding).
type PaymentRecord = {
  InvoiceID: number;
  work_id: number;
  amount_paid: number;
  date_of_payment: string;
  change: number | null;
};

/**
 * Retrieves payments for a given patient id.
 */
export function getPayments(PID: number): Promise<Payment[]> {
  const db = getKysely();
  return db
    .selectFrom('patients as p')
    .innerJoin('works as w', 'p.person_id', 'w.person_id')
    .innerJoin('invoices as i', 'w.work_id', 'i.work_id')
    .where('w.status', '=', 1)
    .where('p.person_id', '=', PID)
    // Original projected `i.*` then mapped columns[1]=amount_paid, columns[2]=date_of_payment.
    .select([
      'i.amount_paid as Payment',
      'i.date_of_payment as Date',
    ])
    .execute();
}

/**
 * Gets today's exchange rate only
 */
export async function getCurrentExchangeRate(): Promise<number | null> {
  const today = toDateOnly(new Date());
  const db = getKysely();
  const row = await db
    .selectFrom('sms')
    .where('date', '=', sql<string>`${today}`)
    .where('exchange_rate', 'is not', null)
    .select('exchange_rate')
    .executeTakeFirst();

  return row ? row.exchange_rate : null;
}

/**
 * Most recent exchange rate on record (any date), newest first. Unlike
 * getCurrentExchangeRate() this does NOT require today's rate to be entered — it
 * returns the latest non-null `sms.exchange_rate`. null only if none was ever set.
 * Used by the Statistics → Breakdown tab to rank dual-currency revenue by a
 * USD-equivalent total without resorting to a hardcoded fallback.
 */
export async function getLatestExchangeRate(): Promise<number | null> {
  const row = await getKysely()
    .selectFrom('sms')
    .where('exchange_rate', 'is not', null)
    .select('exchange_rate')
    .orderBy('date', 'desc')
    .limit(1)
    .executeTakeFirst();

  return row ? row.exchange_rate : null;
}

/** An exchange rate together with the date it was actually recorded on. */
export interface ExchangeRateAsOf {
  exchangeRate: number;
  rateDate: string;
}

/**
 * The rate in force ON a given date: the most recent `sms.exchange_rate` dated on or
 * before it. Unlike getExchangeRateForDate() this never comes back empty just because
 * nobody entered a rate that particular day — it carries the last known rate forward,
 * which is what actually happened in the real world (the rate didn't reset overnight).
 * If the date predates every recorded rate (backdated history) the EARLIEST rate on
 * record is returned instead — still far closer than a hardcoded constant. null only
 * if `sms` holds no rate at all.
 *
 * Used by the payment modal (so a missing daily rate can't block a payment) and by the
 * statistics routes (as the per-period fallback for days with no rate of their own).
 */
export async function getExchangeRateAsOf(date: string): Promise<ExchangeRateAsOf | null> {
  const db = getKysely();

  const { rows } = await sql<ExchangeRateAsOf>`
    SELECT "exchange_rate" AS "exchangeRate", "date"::text AS "rateDate"
    FROM "sms"
    WHERE "exchange_rate" IS NOT NULL AND "date" <= ${date}::date
    ORDER BY "date" DESC
    LIMIT 1
  `.execute(db);
  if (rows[0]) return rows[0];

  // Only reached for a date older than every rate on record — one extra round trip
  // in a case that effectively never happens on the hot path.
  const { rows: earliest } = await sql<ExchangeRateAsOf>`
    SELECT "exchange_rate" AS "exchangeRate", "date"::text AS "rateDate"
    FROM "sms"
    WHERE "exchange_rate" IS NOT NULL
    ORDER BY "date" ASC
    LIMIT 1
  `.execute(db);

  return earliest[0] ?? null;
}

/** The work's balance as re-read INSIDE the guarded insert's transaction. */
export interface WorkBalanceSnapshot {
  totalRequired: number;
  discount: number;
  totalPaid: number;
  remaining: number;
}

/** Outcome of {@link addInvoiceWithBalanceGuard} — the caller maps these to its own errors. */
export type GuardedInvoiceResult =
  | { outcome: 'created'; invoice_id: number }
  | { outcome: 'work_not_found' }
  | { outcome: 'negative_amount' }
  | { outcome: 'exceeds_remaining'; balance: WorkBalanceSnapshot };

/**
 * Adds a new invoice record with dual-currency support, re-checking the remaining
 * balance under a row lock so the overpayment rule can't be raced.
 *
 * The old function-based overpayment CHECK (CK_MoreThanTotal: SUM(amount_paid) <=
 * total_required) was dropped, and PaymentService.validateAndCreateInvoice re-enforces it
 * in TypeScript. That check alone is a read-then-write: two payments registered against
 * the same work at the same moment both read the pre-insert balance, both pass, and the
 * work ends up overpaid. So the authoritative check lives HERE, inside one transaction:
 *
 *   1. `SELECT … FOR UPDATE` on the works row — concurrent payments against the SAME work
 *      serialize on that lock (different works never contend).
 *   2. Re-sum invoices.amount_paid. Under READ COMMITTED this statement runs after the
 *      lock is granted, so it sees the other transaction's committed insert.
 *   3. Insert only if the payment still fits.
 *
 * PaymentService keeps its pre-check: it fails fast with a fuller message before the
 * change-validation work, and it needs the work's currency anyway. This is the backstop
 * that actually holds under concurrency.
 *
 * No patient-type side effect: an invoice doesn't change the patient's works, and the
 * patient type is now DERIVED from works by classifyPatient() — the legacy first-payment
 * Active/Not-Ortho transition is gone.
 */
export function addInvoiceWithBalanceGuard(
  invoiceData: InvoiceData
): Promise<GuardedInvoiceResult> {
  const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } = invoiceData;

  return withPgTransaction(async (trx): Promise<GuardedInvoiceResult> => {
    const work = await trx
      .selectFrom('works')
      .where('work_id', '=', workid)
      .select(['total_required', 'discount'])
      .forUpdate()
      .executeTakeFirst();

    if (!work) {
      return { outcome: 'work_not_found' };
    }

    const paidRow = await trx
      .selectFrom('invoices')
      .where('work_id', '=', workid)
      .select((eb) =>
        eb.fn.coalesce(eb.fn.sum('amount_paid'), sql<number>`0`).$castTo<number>().as('paid')
      )
      .executeTakeFirstOrThrow();

    const totalRequired = Number(work.total_required ?? 0);
    const discount = Number(work.discount ?? 0);
    const totalPaid = Number(paidRow.paid ?? 0);
    const remaining = totalRequired - discount - totalPaid;

    // Lower bound, checked HERE and not only at the contract. The overpayment rule
    // below asks `amount > remaining`, which a negative amount passes trivially —
    // and a negative invoice does not just record a wrong figure, it RAISES the
    // work's outstanding balance and skews every sum over `invoices.amount_paid`
    // (the doctor-commission report included). The request boundary now rejects it
    // too, but this is the layer that holds for a caller that never crosses it:
    // a script, a future service, a reverse-sync path.
    if ((Number(amountPaid) || 0) <= 0) {
      return { outcome: 'negative_amount' };
    }

    if ((Number(amountPaid) || 0) > remaining) {
      return {
        outcome: 'exceeds_remaining',
        balance: { totalRequired, discount, totalPaid, remaining },
      };
    }

    const row = await trx
      .insertInto('invoices')
      .values({
        work_id: workid,
        amount_paid: amountPaid,
        date_of_payment: sql<string>`${paymentDate}`,
        usd_received: usdReceived,
        iqd_received: iqdReceived,
        change: change,
      })
      .returning('invoice_id')
      .executeTakeFirstOrThrow();

    return { outcome: 'created', invoice_id: row.invoice_id };
  });
}

/**
 * Updates the exchange rate for a specific date
 */
export async function updateExchangeRateForDate(date: string, exchangeRate: number): Promise<unknown[]> {
  const db = getKysely();

  // IF EXISTS…UPDATE…ELSE INSERT → ON CONFLICT against the unique index uq_sms_date.
  await db
    .insertInto('sms')
    .values({
      date: sql<string>`${date}`,
      sms_sent: false,
      email_sent: false,
      exchange_rate: exchangeRate,
    })
    .onConflict((oc) => oc.column('date').doUpdateSet({ exchange_rate: exchangeRate }))
    .execute();

  return [];
}

/**
 * Lists exchange rates within a date range (inclusive), newest first.
 */
export function listExchangeRates(
  fromDate: string,
  toDate: string
): Promise<{ date: string; exchangeRate: number }[]> {
  const db = getKysely();
  return db
    .selectFrom('sms')
    .where('exchange_rate', 'is not', null)
    .where('date', '>=', sql<string>`${fromDate}`)
    .where('date', '<=', sql<string>`${toDate}`)
    .orderBy('date', 'desc')
    .select((eb) => [
      eb.ref('date').$castTo<string>().as('date'),
      eb.ref('exchange_rate').$castTo<number>().as('exchangeRate'),
    ])
    .execute();
}

/**
 * Gets payment history for a specific work
 */
export function getPaymentHistoryByWorkId(workId: number): Promise<PaymentRecord[]> {
  const db = getKysely();
  return db
    .selectFrom('invoices')
    .where('work_id', '=', workId)
    .orderBy('date_of_payment', 'desc')
    .select([
      'invoice_id as InvoiceID',
      'work_id',
      'amount_paid',
      'date_of_payment',
      'change',
    ])
    .execute();
}

/** Delete a single invoice by primary key. Returns the number of rows deleted (0 or 1). */
export async function deleteInvoiceById(invoiceId: number): Promise<number> {
  const db = getKysely();
  const result = await sql`
    DELETE FROM "invoices" WHERE "invoice_id" = ${invoiceId}
  `.execute(db);
  return Number(result.numAffectedRows ?? 0n);
}

/**
 * One work's receipt header. `type` (not `interface`) so it feeds the
 * `z.looseObject` workForReceipt response via `sendData` — the index-signature
 * rule (CLAUDE.md / TS2345).
 */
export type WorkForReceipt = {
  person_id: number;
  patient_name: string;
  phone: string | null;
  TotalPaid: number;
  app_date: Date;
  work_id: number;
  total_required: number;
  currency: string;
  discount: number | null;
  discount_date: Date | null;
};

/** Receipt header for a work, or undefined when the work doesn't exist. */
export async function getWorkForReceipt(workId: number): Promise<WorkForReceipt | undefined> {
  // V_Report (and its sub-views VTotPaid / VLastApp) inlined for a single work:
  //  - TotalPaid: SUM(tblInvoice.amount_paid) for the work (NULL when no payments, as VTotPaid yielded)
  //  - app_date:   the patient's latest FUTURE appointment (VLastApp: per-person MAX(app_date) > now)
  const { rows } = await sql<WorkForReceipt>`
    SELECT
      w."person_id",
      p."patient_name",
      p."phone",
      tp."TotalPaid",
      la."app_date",
      w."work_id",
      w."total_required",
      w."currency",
      w."discount",
      w."discount_date"
    FROM "works" w
    JOIN "patients" p ON p."person_id" = w."person_id"
    LEFT JOIN (
      SELECT "work_id", SUM("amount_paid") AS "TotalPaid"
      FROM "invoices" GROUP BY "work_id"
    ) tp ON tp."work_id" = w."work_id"
    LEFT JOIN (
      SELECT "person_id", MAX("app_date") AS "app_date"
      FROM "appointments" WHERE "app_date" > LOCALTIMESTAMP GROUP BY "person_id"
    ) la ON la."person_id" = w."person_id"
    WHERE w."work_id" = ${workId}
  `.execute(getKysely());
  return rows[0];
}
