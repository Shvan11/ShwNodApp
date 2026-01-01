/**
 * Receipt Service
 * Handles receipt generation using file-based HTML templates
 */

import { executeQuery, TYPES } from '../database/index.js';
import { getPatientNoWorkReceiptData } from '../database/queries/patient-queries.js';
import { promises as fs } from 'fs';
import path from 'path';
import { log } from '../../utils/logger.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Receipt data from V_Report view
 */
interface ReceiptRow {
  PersonID: number;
  PatientName: string;
  Phone: string;
  TotalPaid: number;
  AppDate: Date;
  Dateofpayment: Date;
  Amountpaid: number;
  workid: number;
  TotalRequired: number;
  Currency: string;
  [key: string]: string | number | Date;
}

/**
 * Patient data for receipt
 */
export interface ReceiptPatientData {
  PersonID: number;
  PatientName: string;
  Phone: string;
  AppDate: Date;
}

/**
 * Work data for receipt
 */
export interface ReceiptWorkData {
  WorkID: number;
  TotalRequired: number;
  Currency: string;
}

/**
 * Payment data for receipt
 */
export interface ReceiptPaymentData {
  PaymentDateTime: Date;
  AmountPaidToday: number;
  PreviouslyPaid: number;
  TotalPaid: number;
  RemainingBalance: number;
  Currency: string;
}

/**
 * Complete receipt data structure
 */
export interface ReceiptData {
  patient: ReceiptPatientData;
  work: ReceiptWorkData;
  payment: ReceiptPaymentData;
}

/**
 * No-work receipt data
 */
export interface NoWorkReceiptData {
  patient: {
    PersonID: number;
    PatientName: string;
    Phone: string;
    AppDate: Date;
  };
  receipt: {
    PrintedDate: Date;
  };
}

/**
 * Primitive template values
 */
type PrimitiveValue = string | number | boolean | Date | null | undefined;

/**
 * Template data for rendering
 * Note: Intentionally uses Record type because templates can have any dynamic fields
 * based on the template design. The actual fields depend on template placeholders.
 */
interface TemplateData {
  [key: string]: PrimitiveValue | PrimitiveValue[] | TemplateData | TemplateData[];
}

// =============================================================================
// RECEIPT DATA FUNCTIONS
// =============================================================================

/**
 * Get receipt data for a specific payment/work using V_Report view
 * @param workId - Work ID
 * @returns Receipt data
 */
export async function getReceiptData(workId: number): Promise<ReceiptData> {
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

  const results = await executeQuery<ReceiptRow>(
    query,
    [['workId', TYPES.Int, workId]],
    (columns) => {
      const row: Record<string, unknown> = {};
      columns.forEach((col) => {
        row[col.metadata.colName] = col.value;
      });
      return row as ReceiptRow;
    }
  );

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
      AppDate: data.AppDate,
    },
    work: {
      WorkID: data.workid,
      TotalRequired: data.TotalRequired,
      Currency: data.Currency,
    },
    payment: {
      PaymentDateTime: data.Dateofpayment || new Date(),
      AmountPaidToday: amountPaidToday,
      PreviouslyPaid: previouslyPaid,
      TotalPaid: totalPaid,
      RemainingBalance: remainingBalance,
      Currency: data.Currency,
    },
  };
}

/**
 * Get default template file path from database
 * @returns Template file path
 */
async function getDefaultTemplatePath(): Promise<string> {
  const query = `
        SELECT template_file_path
        FROM DocumentTemplates WITH (NOLOCK)
        WHERE document_type_id = 1
        AND is_default = 1
        AND is_active = 1
    `;

  const results = await executeQuery<string>(query, [], (columns) => {
    return columns[0].value as string;
  });

  if (results.length === 0 || !results[0]) {
    throw new Error('Default receipt template not found');
  }

  return results[0];
}

/**
 * Render template with data
 * @param templateHTML - HTML template with placeholders
 * @param data - Data to fill into template
 * @returns Rendered HTML
 */
function renderTemplate(templateHTML: string, data: TemplateData): string {
  let rendered = templateHTML;

  // Replace all {{placeholder}} occurrences
  rendered = rendered.replace(/\{\{([^}]+)\}\}/g, (_, placeholder: string) => {
    const parts = placeholder.split('|');
    const dataPath = parts[0].trim();
    const filters = parts.slice(1).map((f) => f.trim());

    // Resolve data path (e.g., 'patient.PatientName')
    let value = resolveDataPath(dataPath, data);

    // Apply filters
    for (const filter of filters) {
      value = applyFilter(value, filter);
    }

    return value !== null && value !== undefined ? String(value) : '';
  });

  return rendered;
}

/**
 * Resolve data path (e.g., 'patient.PatientName')
 * @param dataPath - Dot-notation path
 * @param data - Data object
 * @returns Resolved value
 */
function resolveDataPath(dataPath: string, data: TemplateData): unknown {
  const keys = dataPath.split('.');
  let value: unknown = data;

  for (const key of keys) {
    if (value === null || value === undefined) {
      return null;
    }
    value = (value as Record<string, unknown>)[key];
  }

  return value;
}

/**
 * Apply filter to value
 * @param value - Value to filter
 * @param filter - Filter expression (e.g., 'currency', 'date:MMM DD, YYYY')
 * @returns Filtered value
 */
function applyFilter(value: unknown, filter: string): string {
  if (value === null || value === undefined || value === '') {
    // Check for default filter
    if (filter.startsWith('default:')) {
      return filter.substring(8);
    }
    return '';
  }

  // Currency filter
  if (filter === 'currency') {
    const num = parseFloat(String(value));
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
 * @param dateValue - Date value
 * @param pattern - Format pattern
 * @returns Formatted date
 */
function formatDate(dateValue: unknown, pattern: string): string {
  if (!dateValue) return '';

  const date = new Date(dateValue as string | number | Date);
  if (isNaN(date.getTime())) return String(dateValue);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthsFull = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const daysFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Use LOCAL time methods (not UTC) - Iraq stores times in local timezone (UTC+3)
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12; // Convert to 12-hour format (0 becomes 12)
  const ampm = hours24 >= 12 ? 'PM' : 'AM';

  // Create replacements object with actual values
  const replacements: Record<string, string> = {
    dddd: daysFull[date.getDay()],
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: monthsFull[date.getMonth()],
    MMM: months[date.getMonth()],
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    DD: String(date.getDate()).padStart(2, '0'),
    HH: String(hours24).padStart(2, '0'),
    hh: String(hours12).padStart(2, '0'),
    h: String(hours12),
    mm: String(date.getMinutes()).padStart(2, '0'),
    ss: String(date.getSeconds()).padStart(2, '0'),
    A: ampm,
    a: ampm.toLowerCase(),
  };

  // Replace tokens in order of length (longest first) to prevent partial matches
  // Use unique placeholders to prevent re-replacement
  let formatted = pattern;
  const tokens = Object.keys(replacements).sort((a, b) => b.length - a.length);
  const placeholders: Record<string, string> = {};

  // First pass: Replace tokens with unique placeholders
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const placeholder = `\u0000${i}\u0000`; // Use null bytes as placeholders (very unlikely to appear in pattern)
    placeholders[placeholder] = replacements[token];

    // Replace all occurrences of the token with the placeholder
    const regex = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    formatted = formatted.replace(regex, placeholder);
  }

  // Second pass: Replace placeholders with actual values
  for (const [placeholder, value] of Object.entries(placeholders)) {
    formatted = formatted.split(placeholder).join(value);
  }

  return formatted;
}

/**
 * Generate receipt HTML for a payment
 * @param workId - Work ID
 * @returns Receipt HTML
 */
export async function generateReceiptHTML(workId: number): Promise<string> {
  // Get template file path from database
  const templatePath = await getDefaultTemplatePath();
  const fullPath = path.join(process.cwd(), templatePath);

  // Read template file
  const templateHTML = await fs.readFile(fullPath, 'utf-8');

  // Get receipt data from V_Report view
  const data = await getReceiptData(workId);

  // Render template with data
  const html = renderTemplate(templateHTML, data as unknown as TemplateData);

  return html;
}

/**
 * Get no-work receipt template path from database
 * @returns Template file path
 */
async function getNoWorkTemplatePath(): Promise<string> {
  const query = `
        SELECT template_file_path
        FROM DocumentTemplates WITH (NOLOCK)
        WHERE template_name = 'No-Work Appointment Receipt'
        AND is_active = 1
    `;

  const results = await executeQuery<string>(query, [], (columns) => {
    return columns[0].value as string;
  });

  if (results.length === 0 || !results[0]) {
    // Fallback to default file path if not in database yet
    log.warn('[RECEIPT-SERVICE] No-work template not in database, using default path');
    return 'data/templates/shwan-orthodontics-no-work-receipt.html';
  }

  return results[0];
}

/**
 * Generate no-work appointment receipt HTML for a patient
 * @param patientId - Patient ID
 * @returns Receipt HTML
 */
export async function generateNoWorkReceiptHTML(patientId: number): Promise<string> {
  log.info('[RECEIPT-SERVICE] Generating no-work receipt', { patientId });

  // Get patient data from V_rptNoWork view
  const patientData = await getPatientNoWorkReceiptData(patientId);

  if (!patientData) {
    throw new Error(`Patient not found: ${patientId}`);
  }

  if (!patientData.AppDate) {
    throw new Error(`Patient ${patientId} has no scheduled appointment`);
  }

  log.debug('[RECEIPT-SERVICE] Patient data retrieved', {
    PersonID: patientData.PersonID,
    PatientName: patientData.PatientName,
    hasAppointment: !!patientData.AppDate,
  });

  // Get template file path
  const templatePath = await getNoWorkTemplatePath();
  const fullPath = path.join(process.cwd(), templatePath);

  log.debug('[RECEIPT-SERVICE] Using template', { templatePath });

  // Read template file
  const templateHTML = await fs.readFile(fullPath, 'utf-8');

  // Prepare data for template
  const data: NoWorkReceiptData = {
    patient: {
      PersonID: patientData.PersonID,
      PatientName: patientData.PatientName,
      Phone: patientData.Phone || 'N/A',
      AppDate: patientData.AppDate,
    },
    receipt: {
      PrintedDate: new Date(),
    },
  };

  log.debug('[RECEIPT-SERVICE] Rendering template with data');

  // Render template with data
  const html = renderTemplate(templateHTML, data as unknown as TemplateData);

  log.info('[RECEIPT-SERVICE] Receipt generated successfully');

  return html;
}

export default {
  getReceiptData,
  generateReceiptHTML,
  generateNoWorkReceiptHTML,
};
