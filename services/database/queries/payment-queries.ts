/**
 * Payment-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). Money columns on
 * tblInvoice (amount_paid, usd_received, iqd_received, actual_amount, change) are PG
 * `integer`, so they map straight to JS numbers (no numeric cast needed). The date-only
 * columns (date_of_payment, start_date) are PG `date`, which the centralized pg parser
 * (kysely.ts) returns as a 'YYYY-MM-DD' string; the generated `Database` type already
 * types them `string`, so they're projected as-is and the declared return types are
 * `string` (no `$castTo` needed).
 * The IF EXISTS…UPDATE…ELSE INSERT exchange-rate upserts became ON CONFLICT against
 * the new uq_sms_date unique index. tblsms.date is PG `date`, so date params
 * are wrapped as `sql<string>` to satisfy the static type without changing emitted SQL.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
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

// `type` (not `interface`) so it carries an implicit string index signature and
// is therefore assignable to the `z.looseObject(...)` response contract that
// `sendData` validates against (see shared-contract-progress.md, Phase 1 finding).
type WorkForInvoice = {
  work_id: number;
  person_id: number;
  total_required: number | null;
  currency: string | null;
  type_of_work: number | null;
  start_date: string | null;
  patient_name: string;
  phone: string | null;
  TotalPaid: number;
};

interface InvoiceData {
  workid: number;
  amountPaid: number;
  paymentDate: string;
  usdReceived: number;
  iqdReceived: number;
  change: number | null;
}

// `type` (not `interface`): see WorkForInvoice — implicit index signature so it
// satisfies the `z.looseObject` paymentHistory response contract via `sendData`.
type PaymentRecord = {
  InvoiceID: number;
  work_id: number;
  amount_paid: number;
  date_of_payment: string;
  actual_amount: number | null;
  actual_cur: string | null;
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
    .execute() as Promise<Payment[]>;
}

/**
 * Retrieves active work details for invoice generation
 */
export function getActiveWorkForInvoice(PID: number): Promise<WorkForInvoice[]> {
  const db = getKysely();
  return db
    .selectFrom('patients as p')
    .innerJoin('works as w', 'p.person_id', 'w.person_id')
    .leftJoin('invoices as i', 'w.work_id', 'i.work_id')
    .where('w.status', '=', 1)
    .where('p.person_id', '=', PID)
    .groupBy([
      'w.work_id',
      'w.person_id',
      'w.total_required',
      'w.currency',
      'w.type_of_work',
      'w.start_date',
      'p.patient_name',
      'p.phone',
    ])
    .select((eb) => [
      'w.work_id',
      'w.person_id',
      'w.total_required',
      'w.currency',
      'w.type_of_work',
      'w.start_date as start_date',
      'p.patient_name',
      'p.phone',
      eb.fn.coalesce(eb.fn.sum('i.amount_paid'), sql<number>`0`).$castTo<number>().as('TotalPaid'),
    ])
    .execute() as Promise<WorkForInvoice[]>;
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

/**
 * Adds a new invoice record with dual-currency support
 */
export async function addInvoice(invoiceData: InvoiceData): Promise<{ invoice_id: number }[]> {
  const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } = invoiceData;

  // The old function-based overpayment CHECK (CK_MoreThanTotal: SUM(amount_paid) <=
  // total_required) is re-enforced upstream in PaymentService.validateAndCreateInvoice —
  // the sole caller — which rejects a payment exceeding the remaining balance
  // (total_required - discount - TotalPaid) before this runs. Aligner-set payments are
  // likewise guarded in AlignerService.validateAndCreateAlignerPayment.
  //
  // No patient-type side effect: an invoice doesn't change the patient's works, and the
  // patient type is now DERIVED from works by classifyPatient() — the legacy first-payment
  // Active/Not-Ortho transition is gone.
  const row = await getKysely()
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

  return [{ invoice_id: row.invoice_id }];
}

/**
 * Gets the exchange rate for a specific date
 */
export async function getExchangeRateForDate(date: string): Promise<number | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('sms')
    .where('date', '=', sql<string>`${date}`)
    .where('exchange_rate', 'is not', null)
    .select('exchange_rate')
    .executeTakeFirst();

  return row ? row.exchange_rate : null;
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
    .execute() as Promise<{ date: string; exchangeRate: number }[]>;
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
      'actual_amount',
      'actual_cur',
      'change',
    ])
    .execute() as Promise<PaymentRecord[]>;
}

/** Delete a single invoice by primary key. Returns the number of rows deleted (0 or 1). */
export async function deleteInvoiceById(invoiceId: number): Promise<number> {
  const db = getKysely();
  const result = await sql`
    DELETE FROM "invoices" WHERE "invoice_id" = ${invoiceId}
  `.execute(db);
  return Number(result.numAffectedRows ?? 0n);
}
