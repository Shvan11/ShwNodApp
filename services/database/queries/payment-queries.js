/**
 * Payment-related database queries
 */
import { executeQuery, TYPES } from '../index.js';

/**
 * Retrieves payments for a given patient ID.
 * @param {number} PID - The patient ID.
 * @returns {Promise<Array>} - A promise that resolves with an array of payment objects.
 */
export function getPayments(PID) {
    return executeQuery(
        `SELECT i.* FROM dbo.tblpatients p
         INNER JOIN dbo.tblwork w ON p.PersonID = w.PersonID
         INNER JOIN dbo.tblInvoice i ON w.workid = i.workid
         WHERE w.Finished = 0 AND p.personID = @PID`,
        [['PID', TYPES.Int, PID]],
        (columns) => ({ Payment: columns[1].value, Date: columns[2].value })
    );
}

/**
 * Retrieves active work details for invoice generation
 * @param {number} PID - The patient ID.
 * @returns {Promise<Object>} - A promise that resolves with work details.
 */
export function getActiveWorkForInvoice(PID) {
    return executeQuery(
        `SELECT w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.StartDate,
                p.PatientName, p.Phone,
                COALESCE(SUM(i.Amountpaid), 0) as TotalPaid
         FROM dbo.tblpatients p
         INNER JOIN dbo.tblwork w ON p.PersonID = w.PersonID
         LEFT JOIN dbo.tblInvoice i ON w.workid = i.workid
         WHERE w.Finished = 0 AND p.personID = @PID
         GROUP BY w.workid, w.PersonID, w.TotalRequired, w.Currency, w.Typeofwork, w.StartDate, p.PatientName, p.Phone`,
        [['PID', TYPES.Int, PID]]
    );
}

/**
 * Gets today's exchange rate only
 * @returns {Promise<number|null>} - Today's USD to IQD exchange rate or null if not set
 */
export function getCurrentExchangeRate() {
    const today = new Date().toISOString().split('T')[0];
    
    return executeQuery(
        `SELECT ExchangeRate FROM dbo.tblsms 
         WHERE date = @today AND ExchangeRate IS NOT NULL`,
        [['today', TYPES.Date, today]],
        (columns) => columns[0]?.value || null // Return null if no rate for today
    );
}

/**
 * Adds a new invoice record
 * @param {Object} invoiceData - Invoice data object
 * @returns {Promise<Object>} - Result of the insert operation
 */
export function addInvoice(invoiceData) {
    const { workid, amountPaid, paymentDate, actualAmount, actualCurrency, change } = invoiceData;
    
    return executeQuery(
        `INSERT INTO dbo.tblInvoice (workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change)
         VALUES (@workid, @amountPaid, @paymentDate, @actualAmount, @actualCurrency, @change);
         SELECT SCOPE_IDENTITY() as invoiceID;`,
        [
            ['workid', TYPES.Int, workid],
            ['amountPaid', TYPES.Int, amountPaid],
            ['paymentDate', TYPES.Date, paymentDate],
            ['actualAmount', TYPES.Int, actualAmount],
            ['actualCurrency', TYPES.NVarChar, actualCurrency],
            ['change', TYPES.Int, change]
        ]
    );
}

/**
 * Updates the exchange rate for today's date
 * @param {number} exchangeRate - New exchange rate
 * @returns {Promise<Object>} - Result of the update operation
 */
export function updateExchangeRate(exchangeRate) {
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
            ['exchangeRate', TYPES.Int, exchangeRate]
        ]
    );
}