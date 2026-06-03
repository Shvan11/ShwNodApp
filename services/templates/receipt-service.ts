/**
 * Receipt Service
 * Handles receipt generation using file-based HTML templates
 */

import { sql } from 'kysely';
import { getKysely } from '../database/kysely.js';
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
  person_id: number;
  patient_name: string;
  phone: string;
  TotalPaid: number;
  app_date: Date;
  date_of_payment: Date;
  amount_paid: number;
  work_id: number;
  total_required: number;
  currency: string;
  discount: number | null;
  discount_date: Date | null;
  [key: string]: string | number | Date | null;
}

/**
 * Patient data for receipt
 */
export interface ReceiptPatientData {
  person_id: number;
  patient_name: string;
  phone: string;
  app_date: Date;
}

/**
 * Work data for receipt
 */
export interface ReceiptWorkData {
  work_id: number;
  total_required: number;
  currency: string;
  discount: number;
  discount_date: Date | null;
  HasDiscount: boolean;
  NetRequired: number;
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
  currency: string;
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
    person_id: number;
    patient_name: string;
    phone: string;
    app_date: Date;
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
 * note: Intentionally uses Record type because templates can have any dynamic fields
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
 * @param workId - Work id
 * @returns Receipt data
 */
export async function getReceiptData(workId: number): Promise<ReceiptData> {
  // V_Report inlined (sub-views VTotPaid / VLastApp / V_TodayPayment) for a single work:
  //  - TotalPaid:           SUM(tblInvoice.amount_paid) for the work
  //  - app_date:             patient's latest FUTURE appointment (per-person MAX(app_date) > now)
  //  - date_of_payment/amount_paid: the work's latest payment IFF it landed today (else NULL)
  const { rows: results } = await sql<ReceiptRow>`
        SELECT
            w."person_id",
            p."patient_name",
            p."phone",
            tp."TotalPaid",
            la."app_date",
            today."date_of_payment",
            today."amount_paid",
            w."work_id",
            w."total_required",
            w."currency",
            w."discount",
            w."discount_date"
        FROM "works" w
        JOIN "patients" p ON p."person_id" = w."person_id"
        LEFT JOIN (
            SELECT "work_id", SUM("amount_paid") AS "TotalPaid"
            FROM "invoices" GROUP BY "work_id"
        ) tp ON tp."work_id" = w."work_id"
        LEFT JOIN (
            SELECT "person_id", MAX("app_date") AS "app_date"
            FROM "appointments" WHERE "app_date" > LOCALTIMESTAMP GROUP BY "person_id"
        ) la ON la."person_id" = w."person_id"
        LEFT JOIN (
            SELECT i."work_id", i."amount_paid", i."date_of_payment"
            FROM "invoices" i
            JOIN (
                SELECT "work_id", MAX("date_of_payment") AS "LastPayment"
                FROM "invoices" GROUP BY "work_id"
            ) m ON m."work_id" = i."work_id" AND m."LastPayment" = i."date_of_payment"
            WHERE m."LastPayment"::date = CURRENT_DATE
        ) today ON today."work_id" = w."work_id"
        WHERE w."work_id" = ${workId}
    `.execute(getKysely());

  if (results.length === 0) {
    throw new Error(`Work not found: ${workId}`);
  }

  const data = results[0];

  // Calculate balances (discount reduces the net amount owed)
  const totalPaid = data.TotalPaid || 0;
  const amountPaidToday = data.amount_paid || 0;
  const previouslyPaid = totalPaid - amountPaidToday;
  const discount = data.discount || 0;
  const netRequired = (data.total_required || 0) - discount;
  const remainingBalance = netRequired - totalPaid;

  // Structure data for template
  return {
    patient: {
      person_id: data.person_id,
      patient_name: data.patient_name,
      phone: data.phone,
      app_date: data.app_date,
    },
    work: {
      work_id: data.work_id,
      total_required: data.total_required,
      currency: data.currency,
      discount: discount,
      discount_date: data.discount_date,
      HasDiscount: discount > 0,
      NetRequired: netRequired,
    },
    payment: {
      PaymentDateTime: data.date_of_payment || new Date(),
      AmountPaidToday: amountPaidToday,
      PreviouslyPaid: previouslyPaid,
      TotalPaid: totalPaid,
      RemainingBalance: remainingBalance,
      currency: data.currency,
    },
  };
}

/**
 * Get default template file path from database
 * @returns Template file path
 */
async function getDefaultTemplatePath(): Promise<string> {
  const { rows: results } = await sql<{ template_file_path: string | null }>`
        SELECT "template_file_path"
        FROM "document_templates"
        WHERE "document_type_id" = 1
        AND "is_default" = true
        AND "is_active" = true
    `.execute(getKysely());

  if (results.length === 0 || !results[0]?.template_file_path) {
    throw new Error('Default receipt template not found');
  }

  return results[0].template_file_path;
}

/**
 * Well-known name of the discount-variant receipt template.
 * Selected by name (mirrors getNoWorkTemplatePath) rather than by a templating
 * conditional inside the file — the GrapesJS editor mangles {{#if}} blocks, so
 * the two layouts live in two flat, fully WYSIWYG templates and the app picks
 * one at render time on work.HasDiscount.
 */
const DISCOUNT_TEMPLATE_NAME = 'Shwan Orthodontics Default Receipt (With Discount)';

/**
 * Get the discount-variant template file path from database.
 * Falls back to the on-disk discount file path if the row isn't present yet,
 * so a missing/renamed row degrades gracefully instead of throwing.
 * @returns Template file path
 */
async function getDiscountTemplatePath(): Promise<string> {
  const { rows: results } = await sql<{ template_file_path: string | null }>`
        SELECT "template_file_path"
        FROM "document_templates"
        WHERE "template_name" = ${DISCOUNT_TEMPLATE_NAME}
        AND "is_active" = true
    `.execute(getKysely());

  if (results.length === 0 || !results[0]?.template_file_path) {
    log.warn('[RECEIPT-SERVICE] Discount template not in database, using default path');
    return 'data/templates/shwan-orthodontics-default-receipt-discount.html';
  }

  return results[0].template_file_path;
}

/**
 * Render template with data
 * @param templateHTML - HTML template with placeholders
 * @param data - Data to fill into template
 * @returns Rendered HTML
 */
function renderTemplate(templateHTML: string, data: TemplateData): string {
  let rendered = templateHTML;

  // Handle {{#if path}}...{{/if}} blocks before placeholder substitution.
  // The block renders only when resolveDataPath(path, data) is truthy (non-zero, non-empty).
  rendered = rendered.replace(
    /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, rawPath: string, body: string) => {
      const value = resolveDataPath(rawPath.trim(), data);
      const truthy = value !== null && value !== undefined && value !== false &&
        value !== 0 && value !== '';
      return truthy ? body : '';
    }
  );

  // Replace all {{placeholder}} occurrences
  rendered = rendered.replace(/\{\{([^}]+)\}\}/g, (_, placeholder: string) => {
    const parts = placeholder.split('|');
    const dataPath = parts[0].trim();
    const filters = parts.slice(1).map((f) => f.trim());

    // Resolve data path (e.g., 'patient.patient_name')
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
 * Resolve data path (e.g., 'patient.patient_name')
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

  // currency filter
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
 * @param workId - Work id
 * @returns Receipt HTML
 */
export async function generateReceiptHTML(workId: number): Promise<string> {
  // Get receipt data from V_Report view first — the layout (with/without the
  // discount rows) is chosen on data, not by a templating conditional.
  const data = await getReceiptData(workId);

  // Pick the flat template variant: discount layout only when a discount applies.
  const templatePath = data.work.HasDiscount
    ? await getDiscountTemplatePath()
    : await getDefaultTemplatePath();
  const fullPath = path.join(process.cwd(), templatePath);

  // Read template file
  const templateHTML = await fs.readFile(fullPath, 'utf-8');

  // Render template with data
  const html = renderTemplate(templateHTML, data as unknown as TemplateData);

  return html;
}

/**
 * Get no-work receipt template path from database
 * @returns Template file path
 */
async function getNoWorkTemplatePath(): Promise<string> {
  const { rows: results } = await sql<{ template_file_path: string | null }>`
        SELECT "template_file_path"
        FROM "document_templates"
        WHERE "template_name" = 'No-Work Appointment Receipt'
        AND "is_active" = true
    `.execute(getKysely());

  if (results.length === 0 || !results[0]?.template_file_path) {
    // Fallback to default file path if not in database yet
    log.warn('[RECEIPT-SERVICE] No-work template not in database, using default path');
    return 'data/templates/shwan-orthodontics-no-work-receipt.html';
  }

  return results[0].template_file_path;
}

/**
 * Generate no-work appointment receipt HTML for a patient
 * @param patientId - Patient id
 * @returns Receipt HTML
 */
export async function generateNoWorkReceiptHTML(patientId: number): Promise<string> {
  log.info('[RECEIPT-SERVICE] Generating no-work receipt', { patientId });

  // Get patient data from V_rptNoWork view
  const patientData = await getPatientNoWorkReceiptData(patientId);

  if (!patientData) {
    throw new Error(`Patient not found: ${patientId}`);
  }

  if (!patientData.app_date) {
    throw new Error(`Patient ${patientId} has no scheduled appointment`);
  }

  log.debug('[RECEIPT-SERVICE] Patient data retrieved', {
    person_id: patientData.person_id,
    patient_name: patientData.patient_name,
    hasAppointment: !!patientData.app_date,
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
      person_id: patientData.person_id,
      patient_name: patientData.patient_name,
      phone: patientData.phone || 'N/A',
      app_date: patientData.app_date,
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
