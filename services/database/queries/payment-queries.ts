/**
 * Payment-related database queries
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, TYPES, SqlParam } from '../index.js';

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
  return executeQuery<Payment>(
    `SELECT i.* FROM dbo.tblpatients p
     INNER JOIN dbo.tblwork w ON p.PersonID = w.PersonID
     INNER JOIN dbo.tblInvoice i ON w.workid = i.workid
     WHERE w.Status = 1 AND p.personID = @PID`,
    [['PID', TYPES.Int, PID]],
    (columns: ColumnValue[]) => ({
      Payment: columns[1].value as number,
      Date: columns[2].value as Date,
    })
  );
}

/**
 * Retrieves active work details for invoice generation
 */
export function getActiveWorkForInvoice(PID: number): Promise<WorkForInvoice[]> {
  return executeQuery<WorkForInvoice>(
    `SELECT w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.StartDate,
            p.PatientName, p.Phone,
            COALESCE(SUM(i.Amountpaid), 0) as TotalPaid
     FROM dbo.tblpatients p
     INNER JOIN dbo.tblwork w ON p.PersonID = w.PersonID
     LEFT JOIN dbo.tblInvoice i ON w.workid = i.workid
     WHERE w.Status = 1 AND p.personID = @PID
     GROUP BY w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.StartDate, p.PatientName, p.Phone`,
    [['PID', TYPES.Int, PID]],
    (columns: ColumnValue[]) => ({
      workid: columns[0].value as number,
      PersonID: columns[1].value as number,
      TotalRequired: columns[2].value as number | null,
      Currency: columns[3].value as string | null,
      Typeofwork: columns[4].value as number | null,
      StartDate: columns[5].value as Date | null,
      PatientName: columns[6].value as string,
      Phone: columns[7].value as string | null,
      TotalPaid: columns[8].value as number,
    })
  );
}

/**
 * Gets today's exchange rate only
 */
export function getCurrentExchangeRate(): Promise<number | null> {
  const today = new Date().toISOString().split('T')[0];

  return executeQuery<number, number | null>(
    `SELECT ExchangeRate FROM dbo.tblsms
     WHERE date = @today AND ExchangeRate IS NOT NULL`,
    [['today', TYPES.Date, today]],
    (columns: ColumnValue[]) => columns[0]?.value as number,
    (result) => (result.length > 0 ? result[0] : null)
  );
}

/**
 * Adds a new invoice record with dual-currency support
 */
export function addInvoice(invoiceData: InvoiceData): Promise<{ invoiceID: number }[]> {
  const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } = invoiceData;

  return executeQuery<{ invoiceID: number }>(
    `INSERT INTO dbo.tblInvoice (workid, Amountpaid, Dateofpayment, USDReceived, IQDReceived, Change)
     VALUES (@workid, @amountPaid, @paymentDate, @usdReceived, @iqdReceived, @change);
     SELECT SCOPE_IDENTITY() as invoiceID;`,
    [
      ['workid', TYPES.Int, workid],
      ['amountPaid', TYPES.Int, amountPaid],
      ['paymentDate', TYPES.Date, paymentDate],
      ['usdReceived', TYPES.Int, usdReceived],
      ['iqdReceived', TYPES.Int, iqdReceived],
      ['change', TYPES.Int, change],
    ],
    (columns: ColumnValue[]) => ({ invoiceID: columns[0].value as number })
  );
}

/**
 * Updates the exchange rate for today's date
 */
export function updateExchangeRate(exchangeRate: number): Promise<unknown[]> {
  const today = new Date().toISOString().split('T')[0];

  return executeQuery(
    `IF EXISTS (SELECT 1 FROM dbo.tblsms WHERE date = @today)
     BEGIN
         UPDATE dbo.tblsms SET ExchangeRate = @exchangeRate WHERE date = @today
     END
     ELSE
     BEGIN
         INSERT INTO dbo.tblsms (date, smssent, emailsent, ExchangeRate)
         VALUES (@today, 0, 0, @exchangeRate)
     END`,
    [
      ['today', TYPES.Date, today],
      ['exchangeRate', TYPES.Int, exchangeRate],
    ],
    () => ({})
  );
}

/**
 * Gets the exchange rate for a specific date
 */
export function getExchangeRateForDate(date: string): Promise<number | null> {
  return executeQuery<number, number | null>(
    `SELECT ExchangeRate FROM dbo.tblsms
     WHERE date = @date AND ExchangeRate IS NOT NULL`,
    [['date', TYPES.Date, date]],
    (columns: ColumnValue[]) => columns[0]?.value as number,
    (result) => (result.length > 0 ? result[0] : null)
  );
}

/**
 * Updates the exchange rate for a specific date
 */
export function updateExchangeRateForDate(date: string, exchangeRate: number): Promise<unknown[]> {
  return executeQuery(
    `IF EXISTS (SELECT 1 FROM dbo.tblsms WHERE date = @date)
     BEGIN
         UPDATE dbo.tblsms SET ExchangeRate = @exchangeRate WHERE date = @date
     END
     ELSE
     BEGIN
         INSERT INTO dbo.tblsms (date, smssent, emailsent, ExchangeRate)
         VALUES (@date, 0, 0, @exchangeRate)
     END`,
    [
      ['date', TYPES.Date, date],
      ['exchangeRate', TYPES.Int, exchangeRate],
    ],
    () => ({})
  );
}

/**
 * Gets payment history for a specific work
 */
export function getPaymentHistoryByWorkId(workId: number): Promise<PaymentRecord[]> {
  return executeQuery<PaymentRecord>(
    `SELECT InvoiceID, workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change
     FROM dbo.tblInvoice
     WHERE workid = @workId
     ORDER BY Dateofpayment DESC`,
    [['workId', TYPES.Int, workId]],
    (columns: ColumnValue[]) => ({
      InvoiceID: columns[0].value as number,
      workid: columns[1].value as number,
      Amountpaid: columns[2].value as number,
      Dateofpayment: columns[3].value as Date,
      ActualAmount: columns[4].value as number | null,
      ActualCur: columns[5].value as string | null,
      Change: columns[6].value as number | null,
    })
  );
}
