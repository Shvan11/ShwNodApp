/**
 * Payment-related database queries
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). Money columns on
 * tblInvoice (Amountpaid, USDReceived, IQDReceived, ActualAmount, Change) are PG
 * `integer`, so they map straight to JS numbers (no numeric cast needed). Several
 * declared return types still say `Date` for date-only columns (Dateofpayment,
 * StartDate); those are PG `date`, which the centralized pg parser (kysely.ts)
 * returns as a 'YYYY-MM-DD' string. The declared types are preserved via
 * `$castTo<Date>()` (type-only); the runtime value is now a string — see FLAGS.
 * The IF EXISTS…UPDATE…ELSE INSERT exchange-rate upserts became ON CONFLICT against
 * the new UQ_tblsms_date unique constraint. tblsms.date is PG `date`, so date params
 * are wrapped as `sql<Date>` to satisfy the static type without changing emitted SQL.
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';

// Type definitions
interface Payment {
  Payment: number;
  Date: Date;
}

interface WorkForInvoice {
  workid: number;
  PersonID: number;
  TotalRequired: number | null;
  Currency: string | null;
  Typeofwork: number | null;
  StartDate: Date | null;
  PatientName: string;
  Phone: string | null;
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
  workid: number;
  Amountpaid: number;
  Dateofpayment: Date;
  ActualAmount: number | null;
  ActualCur: string | null;
  Change: number | null;
}

/**
 * Retrieves payments for a given patient ID.
 */
export function getPayments(PID: number): Promise<Payment[]> {
  const db = getKysely();
  return db
    .selectFrom('tblpatients as p')
    .innerJoin('tblwork as w', 'p.PersonID', 'w.PersonID')
    .innerJoin('tblInvoice as i', 'w.workid', 'i.workid')
    .where('w.Status', '=', 1)
    .where('p.PersonID', '=', PID)
    // Original projected `i.*` then mapped columns[1]=Amountpaid, columns[2]=Dateofpayment.
    .select((eb) => [
      'i.Amountpaid as Payment',
      eb.ref('i.Dateofpayment').$castTo<Date>().as('Date'),
    ])
    .execute() as Promise<Payment[]>;
}

/**
 * Retrieves active work details for invoice generation
 */
export function getActiveWorkForInvoice(PID: number): Promise<WorkForInvoice[]> {
  const db = getKysely();
  return db
    .selectFrom('tblpatients as p')
    .innerJoin('tblwork as w', 'p.PersonID', 'w.PersonID')
    .leftJoin('tblInvoice as i', 'w.workid', 'i.workid')
    .where('w.Status', '=', 1)
    .where('p.PersonID', '=', PID)
    .groupBy([
      'w.workid',
      'w.PersonID',
      'w.TotalRequired',
      'w.Currency',
      'w.Typeofwork',
      'w.StartDate',
      'p.PatientName',
      'p.Phone',
    ])
    .select((eb) => [
      'w.workid',
      'w.PersonID',
      'w.TotalRequired',
      'w.Currency',
      'w.Typeofwork',
      eb.ref('w.StartDate').$castTo<Date>().as('StartDate'),
      'p.PatientName',
      'p.Phone',
      eb.fn.coalesce(eb.fn.sum('i.Amountpaid'), sql<number>`0`).$castTo<number>().as('TotalPaid'),
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
    .selectFrom('tblsms')
    .where('date', '=', sql<Date>`${today}`)
    .where('ExchangeRate', 'is not', null)
    .select('ExchangeRate')
    .executeTakeFirst();

  return row ? row.ExchangeRate : null;
}

/**
 * Adds a new invoice record with dual-currency support
 */
export async function addInvoice(invoiceData: InvoiceData): Promise<{ invoiceID: number }[]> {
  const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } = invoiceData;

  // Wrapped so the PatientType trigger (patient-type transition on the FIRST payment for a work)
  // commits atomically with the invoice. (Note: the old function-based overpayment CHECK
  // CK_MoreThanTotal is intentionally NOT re-enforced here — flagged for Phase 7.)
  const invoiceID = await withPgTransaction(async (trx) => {
    const row = await trx
      .insertInto('tblInvoice')
      .values({
        workid,
        Amountpaid: amountPaid,
        Dateofpayment: sql<Date>`${paymentDate}`,
        USDReceived: usdReceived,
        IQDReceived: iqdReceived,
        Change: change,
      })
      .returning('invoiceID')
      .executeTakeFirstOrThrow();

    // PatientType trigger: only on the work's first invoice.
    const cnt = await trx
      .selectFrom('tblInvoice')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('workid', '=', workid)
      .executeTakeFirst();

    if (Number(cnt?.n ?? 0) === 1) {
      const work = await trx
        .selectFrom('tblwork')
        .select(['PersonID', 'Typeofwork'])
        .where('workid', '=', workid)
        .executeTakeFirst();
      if (work) {
        const patient = await trx
          .selectFrom('tblpatients')
          .select('PatientTypeID')
          .where('PersonID', '=', work.PersonID)
          .executeTakeFirst();
        const typ = patient?.PatientTypeID ?? null;
        if (typ === 3 || typ === 4 || typ === 5 || typ === 6) {
          const newType = work.Typeofwork === 1 ? 1 : 5;
          await trx.updateTable('tblpatients').set({ PatientTypeID: newType }).where('PersonID', '=', work.PersonID).execute();
        }
      }
    }

    return row.invoiceID;
  });

  return [{ invoiceID }];
}

/**
 * Updates the exchange rate for today's date
 */
export async function updateExchangeRate(exchangeRate: number): Promise<unknown[]> {
  const today = toDateOnly(new Date());
  const db = getKysely();

  // IF EXISTS…UPDATE…ELSE INSERT → ON CONFLICT against UQ_tblsms_date.
  await db
    .insertInto('tblsms')
    .values({
      date: sql<Date>`${today}`,
      smssent: false,
      emailsent: false,
      ExchangeRate: exchangeRate,
    })
    .onConflict((oc) => oc.column('date').doUpdateSet({ ExchangeRate: exchangeRate }))
    .execute();

  return [];
}

/**
 * Gets the exchange rate for a specific date
 */
export async function getExchangeRateForDate(date: string): Promise<number | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('tblsms')
    .where('date', '=', sql<Date>`${date}`)
    .where('ExchangeRate', 'is not', null)
    .select('ExchangeRate')
    .executeTakeFirst();

  return row ? row.ExchangeRate : null;
}

/**
 * Updates the exchange rate for a specific date
 */
export async function updateExchangeRateForDate(date: string, exchangeRate: number): Promise<unknown[]> {
  const db = getKysely();

  // IF EXISTS…UPDATE…ELSE INSERT → ON CONFLICT against UQ_tblsms_date.
  await db
    .insertInto('tblsms')
    .values({
      date: sql<Date>`${date}`,
      smssent: false,
      emailsent: false,
      ExchangeRate: exchangeRate,
    })
    .onConflict((oc) => oc.column('date').doUpdateSet({ ExchangeRate: exchangeRate }))
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
    .selectFrom('tblsms')
    .where('ExchangeRate', 'is not', null)
    .where('date', '>=', sql<Date>`${fromDate}`)
    .where('date', '<=', sql<Date>`${toDate}`)
    .orderBy('date', 'desc')
    .select((eb) => [
      eb.ref('date').$castTo<string>().as('date'),
      eb.ref('ExchangeRate').$castTo<number>().as('exchangeRate'),
    ])
    .execute() as Promise<{ date: string; exchangeRate: number }[]>;
}

/**
 * Gets payment history for a specific work
 */
export function getPaymentHistoryByWorkId(workId: number): Promise<PaymentRecord[]> {
  const db = getKysely();
  return db
    .selectFrom('tblInvoice')
    .where('workid', '=', workId)
    .orderBy('Dateofpayment', 'desc')
    .select((eb) => [
      'invoiceID as InvoiceID',
      'workid',
      'Amountpaid',
      eb.ref('Dateofpayment').$castTo<Date>().as('Dateofpayment'),
      'ActualAmount',
      'ActualCur',
      'Change',
    ])
    .execute() as Promise<PaymentRecord[]>;
}
