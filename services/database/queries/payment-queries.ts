/**
 * Payment-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). Money columns on
 * tblInvoice (amount_paid, usd_received, iqd_received, actual_amount, change) are PG
 * `integer`, so they map straight to JS numbers (no numeric cast needed). Several
 * declared return types still say `Date` for date-only columns (date_of_payment,
 * start_date); those are PG `date`, which the centralized pg parser (kysely.ts)
 * returns as a 'YYYY-MM-DD' string. The declared types are preserved via
 * `$castTo<Date>()` (type-only); the runtime value is now a string — see FLAGS.
 * The IF EXISTS…UPDATE…ELSE INSERT exchange-rate upserts became ON CONFLICT against
 * the new UQ_tblsms_date unique constraint. tblsms.date is PG `date`, so date params
 * are wrapped as `sql<Date>` to satisfy the static type without changing emitted SQL.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';

// type definitions
interface Payment {
  Payment: number;
  Date: Date;
}

interface WorkForInvoice {
  work_id: number;
  person_id: number;
  total_required: number | null;
  currency: string | null;
  type_of_work: number | null;
  start_date: Date | null;
  patient_name: string;
  phone: string | null;
  TotalPaid: number;
}

interface InvoiceData {
  workid: number;
  amountPaid: number;
  paymentDate: string;
  usdReceived: number;
  iqdReceived: number;
  change: number | null;
}

interface PaymentRecord {
  InvoiceID: number;
  work_id: number;
  amount_paid: number;
  date_of_payment: Date;
  actual_amount: number | null;
  actual_cur: string | null;
  change: number | null;
}

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
    .select((eb) => [
      'i.amount_paid as Payment',
      eb.ref('i.date_of_payment').$castTo<Date>().as('Date'),
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
      eb.ref('w.start_date').$castTo<Date>().as('start_date'),
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
    .where('date', '=', sql<Date>`${today}`)
    .where('exchange_rate', 'is not', null)
    .select('exchange_rate')
    .executeTakeFirst();

  return row ? row.exchange_rate : null;
}

/**
 * Adds a new invoice record with dual-currency support
 */
export async function addInvoice(invoiceData: InvoiceData): Promise<{ invoice_id: number }[]> {
  const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } = invoiceData;

  // Wrapped so the patient_type trigger (patient-type transition on the FIRST payment for a work)
  // commits atomically with the invoice. The old function-based overpayment CHECK
  // (CK_MoreThanTotal: SUM(amount_paid) <= total_required) is re-enforced upstream in
  // PaymentService.validateAndCreateInvoice — the sole caller — which rejects a payment
  // that exceeds the remaining balance (total_required - discount - TotalPaid) before this
  // runs. Aligner-set payments are likewise guarded in AlignerService.validateAndCreateAlignerPayment.
  const invoice_id = await withPgTransaction(async (trx) => {
    const row = await trx
      .insertInto('invoices')
      .values({
        work_id: workid,
        amount_paid: amountPaid,
        date_of_payment: sql<Date>`${paymentDate}`,
        usd_received: usdReceived,
        iqd_received: iqdReceived,
        change: change,
      })
      .returning('invoice_id')
      .executeTakeFirstOrThrow();

    // patient_type trigger: only on the work's first invoice.
    const cnt = await trx
      .selectFrom('invoices')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('work_id', '=', workid)
      .executeTakeFirst();

    if (Number(cnt?.n ?? 0) === 1) {
      const work = await trx
        .selectFrom('works')
        .select(['person_id', 'type_of_work'])
        .where('work_id', '=', workid)
      .executeTakeFirst();
      if (work) {
        const patient = await trx
          .selectFrom('patients')
          .select('patient_type_id')
          .where('person_id', '=', work.person_id)
          .executeTakeFirst();
        const typ = patient?.patient_type_id ?? null;
        if (typ === 3 || typ === 4 || typ === 5 || typ === 6) {
          const newType = work.type_of_work === 1 ? 1 : 5;
          await trx.updateTable('patients').set({ patient_type_id: newType }).where('person_id', '=', work.person_id).execute();
        }
      }
    }

    return row.invoice_id;
  });

  return [{ invoice_id }];
}

/**
 * Updates the exchange rate for today's date
 */
export async function updateExchangeRate(exchangeRate: number): Promise<unknown[]> {
  const today = toDateOnly(new Date());
  const db = getKysely();

  // IF EXISTS…UPDATE…ELSE INSERT → ON CONFLICT against UQ_tblsms_date.
  await db
    .insertInto('sms')
    .values({
      date: sql<Date>`${today}`,
      sms_sent: false,
      email_sent: false,
      exchange_rate: exchangeRate,
    })
    .onConflict((oc) => oc.column('date').doUpdateSet({ exchange_rate: exchangeRate }))
    .execute();

  return [];
}

/**
 * Gets the exchange rate for a specific date
 */
export async function getExchangeRateForDate(date: string): Promise<number | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('sms')
    .where('date', '=', sql<Date>`${date}`)
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

  // IF EXISTS…UPDATE…ELSE INSERT → ON CONFLICT against UQ_tblsms_date.
  await db
    .insertInto('sms')
    .values({
      date: sql<Date>`${date}`,
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
    .where('date', '>=', sql<Date>`${fromDate}`)
    .where('date', '<=', sql<Date>`${toDate}`)
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
    .select((eb) => [
      'invoice_id as InvoiceID',
      'work_id',
      'amount_paid',
      eb.ref('date_of_payment').$castTo<Date>().as('date_of_payment'),
      'actual_amount',
      'actual_cur',
      'change',
    ])
    .execute() as Promise<PaymentRecord[]>;
}
