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
         WHERE w.Status = 1 AND p.personID = @PID`,
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
         WHERE w.Status = 1 AND p.personID = @PID
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
        (columns) => columns[0]?.value,
        (result) => result.length > 0 ? result[0] : null // Return null if no rows
    );
}

/**
 * Adds a new invoice record with dual-currency support
 * @param {Object} invoiceData - Invoice data object
 * @param {number} invoiceData.workid - Work ID
 * @param {number} invoiceData.amountPaid - Amount registered to account (in account currency)
 * @param {string} invoiceData.paymentDate - Payment date (YYYY-MM-DD)
 * @param {number} invoiceData.usdReceived - USD received from patient (0 if none)
 * @param {number} invoiceData.iqdReceived - IQD received from patient (0 if none)
 * @param {number} invoiceData.change - Change given back in IQD (0 if none)
 * @returns {Promise<Object>} - Result of the insert operation
 */
export function addInvoice(invoiceData) {
    const { workid, amountPaid, paymentDate, usdReceived, iqdReceived, change } = invoiceData;

    return executeQuery(
        `INSERT INTO dbo.tblInvoice (workid, Amountpaid, Dateofpayment, USDReceived, IQDReceived, Change)
         VALUES (@workid, @amountPaid, @paymentDate, @usdReceived, @iqdReceived, @change);
         SELECT SCOPE_IDENTITY() as invoiceID;`,
        [
            ['workid', TYPES.Int, workid],
            ['amountPaid', TYPES.Int, amountPaid],
            ['paymentDate', TYPES.Date, paymentDate],
            ['usdReceived', TYPES.Int, usdReceived],
            ['iqdReceived', TYPES.Int, iqdReceived],
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

/**
 * Gets the exchange rate for a specific date
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<number|null>} - USD to IQD exchange rate for the specified date or null if not set
 */
export function getExchangeRateForDate(date) {
    return executeQuery(
        `SELECT ExchangeRate FROM dbo.tblsms
         WHERE date = @date AND ExchangeRate IS NOT NULL`,
        [['date', TYPES.Date, date]],
        (columns) => columns[0]?.value,
        (result) => result.length > 0 ? result[0] : null // Return null if no rows
    );
}

/**
 * Updates the exchange rate for a specific date
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {number} exchangeRate - New exchange rate
 * @returns {Promise<Object>} - Result of the update operation
 */
export function updateExchangeRateForDate(date, exchangeRate) {
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
            ['exchangeRate', TYPES.Int, exchangeRate]
        ]
    );
}

/**
 * Gets payment history for a specific work
 * @param {number} workId - The work ID
 * @returns {Promise<Array>} - Array of payment records
 */
export function getPaymentHistoryByWorkId(workId) {
    return executeQuery(
        `SELECT InvoiceID, workid, Amountpaid, Dateofpayment, ActualAmount, ActualCur, Change
         FROM dbo.tblInvoice
         WHERE workid = @workId
         ORDER BY Dateofpayment DESC`,
        [['workId', TYPES.Int, workId]],
        (columns) => ({
            InvoiceID: columns[0].value,
            workid: columns[1].value,
            Amountpaid: columns[2].value,
            Dateofpayment: columns[3].value,
            ActualAmount: columns[4].value,
            ActualCur: columns[5].value,
            Change: columns[6].value
        })
    );
}