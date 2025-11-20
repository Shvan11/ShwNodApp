/**
 * Receipt Service
 * Handles receipt generation using file-based HTML templates
 */

import { executeQuery, TYPES } from '../database/index.js';
import { getPatientNoWorkReceiptData } from '../database/queries/patient-queries.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Get receipt data for a specific payment/work using V_Report view
 * @param {number} workId - Work ID
 * @returns {Promise<Object>} Receipt data
 */
export async function getReceiptData(workId) {
    const query = `
        SELECT
            PersonID,
            PatientName,
            Phone,
            TotalPaid,
            AppDate,
            Dateofpayment,
            Amountpaid,
            workid,
            TotalRequired,
            Currency
        FROM dbo.V_Report WITH (NOLOCK)
        WHERE workid = @workId
    `;

    const results = await executeQuery(query, [
        ['workId', TYPES.Int, workId]
    ], (columns) => {
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

    // Calculate balances
    const totalPaid = data.TotalPaid || 0;
    const amountPaidToday = data.Amountpaid || 0;
    const previouslyPaid = totalPaid - amountPaidToday;
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
            Currency: data.Currency
        },
        payment: {
            PaymentDateTime: data.Dateofpayment || new Date(),
            AmountPaidToday: amountPaidToday,
            PreviouslyPaid: previouslyPaid,
            TotalPaid: totalPaid,
            RemainingBalance: remainingBalance,
            Currency: data.Currency
        }
    };
}

/**
 * Get default template file path from database
 * @returns {Promise<string>} Template file path
 */
async function getDefaultTemplatePath() {
    const query = `
        SELECT template_file_path
        FROM DocumentTemplates WITH (NOLOCK)
        WHERE document_type_id = 1
        AND is_default = 1
        AND is_active = 1
    `;

    const results = await executeQuery(query, [], (columns) => {
        return columns[0].value;
    });

    if (results.length === 0 || !results[0]) {
        throw new Error('Default receipt template not found');
    }

    return results[0];
}

/**
 * Render template with data
 * @param {string} templateHTML - HTML template with placeholders
 * @param {Object} data - Data to fill into template
 * @returns {string} - Rendered HTML
 */
function renderTemplate(templateHTML, data) {
    let rendered = templateHTML;

    // Replace all {{placeholder}} occurrences
    rendered = rendered.replace(/\{\{([^}]+)\}\}/g, (_, placeholder) => {
        const parts = placeholder.split('|');
        const path = parts[0].trim();
        const filters = parts.slice(1).map(f => f.trim());

        // Resolve data path (e.g., 'patient.PatientName')
        let value = resolveDataPath(path, data);

        // Apply filters
        for (const filter of filters) {
            value = applyFilter(value, filter);
        }

        return value !== null && value !== undefined ? value : '';
    });

    return rendered;
}

/**
 * Resolve data path (e.g., 'patient.PatientName')
 * @param {string} path - Dot-notation path
 * @param {Object} data - Data object
 * @returns {any} - Resolved value
 */
function resolveDataPath(path, data) {
    const keys = path.split('.');
    let value = data;

    for (const key of keys) {
        if (value === null || value === undefined) {
            return null;
        }
        value = value[key];
    }

    return value;
}

/**
 * Apply filter to value
 * @param {any} value - Value to filter
 * @param {string} filter - Filter expression (e.g., 'currency', 'date:MMM DD, YYYY')
 * @returns {string} - Filtered value
 */
function applyFilter(value, filter) {
    if (value === null || value === undefined || value === '') {
        // Check for default filter
        if (filter.startsWith('default:')) {
            return filter.substring(8);
        }
        return '';
    }

    // Currency filter
    if (filter === 'currency') {
        const num = parseFloat(value);
        if (isNaN(num)) return '0';
        return Math.round(num).toLocaleString('en-US');
    }

    // Date filter
    if (filter.startsWith('date:')) {
        const format = filter.substring(5);
        return formatDate(value, format);
    }

    // Default filter
    if (filter.startsWith('default:')) {
        return String(value);
    }

    return String(value);
}

/**
 * Format date based on pattern
 * @param {any} dateValue - Date value
 * @param {string} pattern - Format pattern
 * @returns {string} - Formatted date
 */
function formatDate(dateValue, pattern) {
    if (!dateValue) return '';

    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return String(dateValue);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthsFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const daysFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const hours24 = date.getUTCHours();
    const hours12 = hours24 % 12 || 12; // Convert to 12-hour format (0 becomes 12)
    const ampm = hours24 >= 12 ? 'PM' : 'AM';

    // Create replacements object with actual values
    const replacements = {
        'dddd': daysFull[date.getUTCDay()],
        'YYYY': String(date.getUTCFullYear()),
        'YY': String(date.getUTCFullYear()).slice(-2),
        'MMMM': monthsFull[date.getUTCMonth()],
        'MMM': months[date.getUTCMonth()],
        'MM': String(date.getUTCMonth() + 1).padStart(2, '0'),
        'DD': String(date.getUTCDate()).padStart(2, '0'),
        'HH': String(hours24).padStart(2, '0'),
        'hh': String(hours12).padStart(2, '0'),
        'h': String(hours12),
        'mm': String(date.getUTCMinutes()).padStart(2, '0'),
        'ss': String(date.getUTCSeconds()).padStart(2, '0'),
        'A': ampm,
        'a': ampm.toLowerCase()
    };

    console.log('[DATE-FORMAT] Input pattern:', pattern);
    console.log('[DATE-FORMAT] Date object:', date.toISOString());
    console.log('[DATE-FORMAT] Day of week:', date.getUTCDay(), '=', daysFull[date.getUTCDay()]);

    // Replace tokens in order of length (longest first) to prevent partial matches
    // This ensures 'MMMM' is replaced before 'MMM', 'dddd' before 'DD', etc.
    let formatted = pattern;
    const tokens = Object.keys(replacements).sort((a, b) => b.length - a.length);

    for (const token of tokens) {
        const oldFormatted = formatted;
        // Use split/join to replace all occurrences without regex
        formatted = formatted.split(token).join(replacements[token]);

        if (oldFormatted !== formatted) {
            console.log(`[DATE-FORMAT] Replaced "${token}" with "${replacements[token]}": ${oldFormatted} → ${formatted}`);
        }
    }

    console.log('[DATE-FORMAT] Final result:', formatted);
    return formatted;
}

/**
 * Generate receipt HTML for a payment
 * @param {number} workId - Work ID
 * @returns {Promise<string>} Receipt HTML
 */
export async function generateReceiptHTML(workId) {
    // Get template file path from database
    const templatePath = await getDefaultTemplatePath();
    const fullPath = path.join(process.cwd(), templatePath);

    // Read template file
    const templateHTML = await fs.readFile(fullPath, 'utf-8');

    // Get receipt data from V_Report view
    const data = await getReceiptData(workId);

    // Render template with data
    const html = renderTemplate(templateHTML, data);

    return html;
}

/**
 * Get no-work receipt template path from database
 * @returns {Promise<string>} Template file path
 */
async function getNoWorkTemplatePath() {
    const query = `
        SELECT template_file_path
        FROM DocumentTemplates WITH (NOLOCK)
        WHERE template_name = 'No-Work Appointment Receipt'
        AND is_active = 1
    `;

    const results = await executeQuery(query, [], (columns) => {
        return columns[0].value;
    });

    if (results.length === 0 || !results[0]) {
        // Fallback to default file path if not in database yet
        console.warn('[RECEIPT-SERVICE] No-work template not in database, using default path');
        return 'data/templates/shwan-orthodontics-no-work-receipt.html';
    }

    return results[0];
}

/**
 * Generate no-work appointment receipt HTML for a patient
 * @param {number} patientId - Patient ID
 * @returns {Promise<string>} Receipt HTML
 */
export async function generateNoWorkReceiptHTML(patientId) {
    console.log(`[RECEIPT-SERVICE] Generating no-work receipt for patient ${patientId}`);

    // Get patient data from V_rptNoWork view
    const patientData = await getPatientNoWorkReceiptData(patientId);

    if (!patientData) {
        throw new Error(`Patient not found: ${patientId}`);
    }

    if (!patientData.AppDate) {
        throw new Error(`Patient ${patientId} has no scheduled appointment`);
    }

    console.log(`[RECEIPT-SERVICE] Patient data retrieved:`, {
        PersonID: patientData.PersonID,
        PatientName: patientData.PatientName,
        hasAppointment: !!patientData.AppDate
    });

    // Get template file path
    const templatePath = await getNoWorkTemplatePath();
    const fullPath = path.join(process.cwd(), templatePath);

    console.log(`[RECEIPT-SERVICE] Using template: ${templatePath}`);

    // Read template file
    const templateHTML = await fs.readFile(fullPath, 'utf-8');

    // Prepare data for template
    const data = {
        patient: {
            PersonID: patientData.PersonID,
            PatientName: patientData.PatientName,
            Phone: patientData.Phone || 'N/A',
            AppDate: patientData.AppDate
        },
        receipt: {
            PrintedDate: new Date()
        }
    };

    console.log(`[RECEIPT-SERVICE] Rendering template with data`);

    // Render template with data
    const html = renderTemplate(templateHTML, data);

    console.log(`[RECEIPT-SERVICE] Receipt generated successfully`);

    return html;
}

export default {
    getReceiptData,
    generateReceiptHTML,
    generateNoWorkReceiptHTML
};
