/**
 * Receipt Service
 * Handles receipt generation using the template system
 */

import { getDefaultTemplate, logTemplateUsage } from '../database/queries/template-queries.js';
import { renderTemplateToPrint } from './TemplateRenderer.js';
import { executeQuery, TYPES } from '../database/index.js';

/**
 * Get receipt data for a specific payment/work
 * @param {number} workId - Work ID
 * @param {number} invoiceId - Optional invoice ID for specific payment
 * @returns {Promise<Object>} Receipt data
 */
export async function getReceiptData(workId, invoiceId = null) {
    const query = `
        SELECT
            -- Patient Info
            p.PersonID,
            p.PatientName,
            p.Phone,
            p.AppDate,

            -- Work Info
            w.workid,
            w.TotalRequired,
            w.Currency,
            w.Typeofwork,
            w.StartDate,

            -- Payment Info
            ${invoiceId ? 'i.Amountpaid as AmountPaidToday,' : 'NULL as AmountPaidToday,'}
            ${invoiceId ? 'i.Dateofpayment as PaymentDateTime,' : 'GETDATE() as PaymentDateTime,'}
            COALESCE(SUM(i2.Amountpaid), 0) as PreviouslyPaid

        FROM dbo.tblwork w
        INNER JOIN dbo.tblpatients p ON w.PersonID = p.PersonID
        ${invoiceId ? 'LEFT JOIN dbo.tblInvoice i ON i.InvoiceID = @invoiceId' : ''}
        LEFT JOIN dbo.tblInvoice i2 ON w.workid = i2.workid ${invoiceId ? 'AND i2.InvoiceID != @invoiceId' : ''}

        WHERE w.workid = @workId
        GROUP BY p.PersonID, p.PatientName, p.Phone, p.AppDate,
                 w.workid, w.TotalRequired, w.Currency, w.Typeofwork, w.StartDate
                 ${invoiceId ? ', i.Amountpaid, i.Dateofpayment' : ''}
    `;

    const params = [
        ['workId', TYPES.Int, workId]
    ];

    if (invoiceId) {
        params.push(['invoiceId', TYPES.Int, invoiceId]);
    }

    const results = await executeQuery(query, params, (columns) => {
        const row = {};
        columns.forEach(col => {
            row[col.metadata.colName] = col.value;
        });
        return row;
    });

    if (results.length === 0) {
        throw new Error(`Work not found: ${workId}`);
    }

    const data = results[0];

    // Calculate totals
    const previouslyPaid = data.PreviouslyPaid || 0;
    const amountPaidToday = data.AmountPaidToday || 0;
    const totalPaid = previouslyPaid + amountPaidToday;
    const remainingBalance = data.TotalRequired - totalPaid;

    // Structure data for template
    return {
        patient: {
            PersonID: data.PersonID,
            PatientName: data.PatientName,
            Phone: data.Phone,
            AppDate: data.AppDate
        },
        work: {
            WorkID: data.workid,
            TotalRequired: data.TotalRequired,
            Currency: data.Currency,
            Typeofwork: data.Typeofwork,
            StartDate: data.StartDate
        },
        payment: {
            PaymentDateTime: data.PaymentDateTime || new Date(),
            AmountPaidToday: amountPaidToday,
            PreviouslyPaid: previouslyPaid,
            TotalPaid: totalPaid,
            RemainingBalance: remainingBalance,
            Currency: data.Currency
        },
        clinic: {
            Name: 'Shwan Orthodontics',
            Location: 'Sulaymaniyah, Kurdistan - Iraq',
            Phone1: '+964 750 123 4567',
            Phone2: '+964 770 987 6543'
        },
        system: {
            CurrentDateTime: new Date(),
            ReceiptNumber: `${data.workid}-${Date.now().toString().slice(-6)}`
        }
    };
}

/**
 * Generate receipt HTML for a payment
 * @param {number} workId - Work ID
 * @param {number} invoiceId - Optional invoice ID
 * @returns {Promise<string>} Receipt HTML
 */
export async function generateReceiptHTML(workId, invoiceId = null) {
    // Get default receipt template
    const template = await getDefaultTemplate(1); // 1 = receipt type

    if (!template) {
        throw new Error('Default receipt template not found');
    }

    // Get receipt data
    const data = await getReceiptData(workId, invoiceId);

    // Render template
    const html = renderTemplateToPrint(template, data);

    // Log template usage
    if (invoiceId) {
        await logTemplateUsage(template.template_id, 'invoice', invoiceId, 'system');
    }

    return html;
}

/**
 * Generate receipt data for frontend (for the existing receiptGenerator.js)
 * This maintains backwards compatibility with the existing system
 * @param {number} workId - Work ID
 * @param {number} invoiceId - Optional invoice ID
 * @returns {Promise<Object>} Receipt data formatted for frontend
 */
export async function generateReceiptDataForFrontend(workId, invoiceId = null) {
    const data = await getReceiptData(workId, invoiceId);

    // Format for existing frontend receiptGenerator.js
    return {
        // Patient Info
        PersonID: data.patient.PersonID,
        PatientName: data.patient.PatientName,
        Phone: data.patient.Phone,
        AppDate: data.patient.AppDate,

        // Work Info
        workid: data.work.WorkID,
        TotalRequired: data.work.TotalRequired,
        Currency: data.work.Currency,
        Typeofwork: data.work.Typeofwork,

        // Payment Info
        paymentDateTime: data.payment.PaymentDateTime,
        amountPaidToday: data.payment.AmountPaidToday,
        TotalPaid: data.payment.PreviouslyPaid, // Previous total (before today)
        newBalance: data.payment.RemainingBalance
    };
}

export default {
    getReceiptData,
    generateReceiptHTML,
    generateReceiptDataForFrontend
};
