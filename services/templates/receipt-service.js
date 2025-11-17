/**
 * Receipt Service
 * Handles receipt generation using file-based HTML templates
 */

import { executeQuery, TYPES } from '../database/index.js';
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

    const replacements = {
        'YYYY': date.getUTCFullYear(),
        'YY': String(date.getUTCFullYear()).slice(-2),
        'MMMM': monthsFull[date.getUTCMonth()],
        'MMM': months[date.getUTCMonth()],
        'MM': String(date.getUTCMonth() + 1).padStart(2, '0'),
        'DD': String(date.getUTCDate()).padStart(2, '0'),
        'HH': String(date.getUTCHours()).padStart(2, '0'),
        'mm': String(date.getUTCMinutes()).padStart(2, '0'),
        'ss': String(date.getUTCSeconds()).padStart(2, '0')
    };

    let formatted = pattern;
    for (const [key, value] of Object.entries(replacements)) {
        formatted = formatted.replace(new RegExp(key, 'g'), value);
    }

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

export default {
    getReceiptData,
    generateReceiptHTML
};
