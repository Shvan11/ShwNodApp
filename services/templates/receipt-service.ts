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
import { formatDatePattern } from '../../utils/date.js';

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
export type ReceiptPatientData = {
  person_id: number;
  patient_name: string;
  phone: string;
  app_date: Date;
};

/**
 * Work data for receipt
 */
export type ReceiptWorkData = {
  work_id: number;
  total_required: number;
  currency: string;
  discount: number;
  discount_date: Date | null;
  HasDiscount: boolean;
  NetRequired: number;
};

/**
 * Payment data for receipt
 */
export type ReceiptPaymentData = {
  PaymentDateTime: Date;
  AmountPaidToday: number;
  PreviouslyPaid: number;
  TotalPaid: number;
  RemainingBalance: number;
  currency: string;
};

/**
 * Complete receipt data structure
 */
export type ReceiptData = {
  patient: ReceiptPatientData;
  work: ReceiptWorkData;
  payment: ReceiptPaymentData;
};

/**
 * No-work receipt data
 */
export type NoWorkReceiptData = {
  patient: {
    person_id: number;
    patient_name: string;
    phone: string;
    app_date: Date;
  };
  receipt: {
    PrintedDate: Date;
  };
};

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

/**
 * What `renderTemplate` actually needs: something whose values it can walk by
 * dotted path. Declaring the parameter this way lets the concrete receipt shapes
 * (ReceiptData / NoWorkReceiptData) be passed directly — they used to be forced
 * through `as unknown as TemplateData`, a double cast that silenced any real
 * mismatch between the data and what the templates read.
 */
type RenderableData = TemplateData | Record<string, unknown>;

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
  //  - date_of_payment/amount_paid: the payment RECORDED today, if there is one
  //
  // That last join is keyed on `sys_start_time` (when the row was written) rather than
  // `date_of_payment` (the business date staff typed). Keying on date_of_payment broke on
  // a BACKDATED payment: register one dated yesterday, print the receipt it opens, and the
  // join matched nothing — the receipt said "Amount Paid Today: 0" for money that had just
  // been handed over. sys_start_time is what "today's payment" actually means here.
  //
  // LATERAL … ORDER BY … LIMIT 1 also makes the pick DETERMINISTIC. The old MAX() join
  // could return several rows for one work (nothing stops two payments sharing a
  // date_of_payment) and the caller then took an arbitrary results[0].
  const { rows: results } = await sql<ReceiptRow>`
        WITH "today_start" AS (
            -- invoices.sys_start_time is UTC wall-clock in a plain timestamp column
            -- (DEFAULT now() AT TIME ZONE 'UTC'), but "today" means the CLINIC's local
            -- day. Shift local midnight into that UTC frame by the session's current
            -- offset (LOCALTIMESTAMP minus the same instant expressed in UTC), so the
            -- window is a plain range scan and never drifts by the offset.
            SELECT date_trunc('day', LOCALTIMESTAMP)
                   - (LOCALTIMESTAMP - (now() AT TIME ZONE 'UTC')) AS "ts"
        )
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
        LEFT JOIN LATERAL (
            SELECT i."amount_paid", i."date_of_payment"
            FROM "invoices" i, "today_start" ts
            WHERE i."work_id" = w."work_id"
              AND i."sys_start_time" >= ts."ts"
              AND i."sys_start_time" <  ts."ts" + INTERVAL '1 day'
            ORDER BY i."sys_start_time" DESC, i."invoice_id" DESC
            LIMIT 1
        ) today ON true
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
 * Well-known name of the discount-variant receipt template.
 * Selected by name (mirrors the no-work template) rather than by a templating
 * conditional inside the file — the GrapesJS editor mangles {{#if}} blocks, so
 * the two layouts live in two flat, fully WYSIWYG templates and the app picks
 * one at render time on work.HasDiscount.
 */
const DISCOUNT_TEMPLATE_NAME = 'Shwan Orthodontics Default Receipt (With Discount)';
const NO_WORK_TEMPLATE_NAME = 'No-Work Appointment Receipt';

/** On-disk fallbacks used when a template row isn't present yet. */
const FALLBACK_TEMPLATE_PATHS = {
  discount: 'data/templates/shwan-orthodontics-default-receipt-discount.html',
  noWork: 'data/templates/shwan-orthodontics-no-work-receipt.html',
} as const;

/**
 * Look up an active template's file path.
 *
 * One reader for all three receipt variants — they were three near-identical
 * functions differing only in their WHERE clause and their fallback behaviour.
 * Pass `fallback` to degrade gracefully when the row is missing; omit it to make
 * an absent template a hard error (the default receipt has no on-disk twin).
 */
async function getTemplatePath(
  criteria: { templateName: string } | { documentTypeId: number },
  fallback?: string
): Promise<string> {
  const where =
    'templateName' in criteria
      ? sql`"template_name" = ${criteria.templateName}`
      : sql`"document_type_id" = ${criteria.documentTypeId} AND "is_default" = true`;

  const { rows } = await sql<{ template_file_path: string | null }>`
    SELECT "template_file_path"
    FROM "document_templates"
    WHERE ${where} AND "is_active" = true
    LIMIT 1
  `.execute(getKysely());

  const stored = rows[0]?.template_file_path;
  if (stored) return stored;

  if (fallback !== undefined) {
    log.warn('[RECEIPT-SERVICE] Template not in database, using default path', { fallback });
    return fallback;
  }
  throw new Error('Default receipt template not found');
}

/**
 * Resolve a DB-stored template path to an absolute file inside the templates
 * directory.
 *
 * `template_file_path` is admin-editable through the templates screen, and the old
 * `path.join(process.cwd(), stored)` would happily follow a `../../` out of the
 * repo and read any file the service account can — an absolute path escaped
 * outright. Containment is checked AFTER resolution, so `..` segments and absolute
 * paths are both caught.
 */
function resolveTemplateFile(storedPath: string): string {
  const root = path.resolve(process.cwd(), 'data', 'templates');
  const full = path.resolve(root, storedPath.replace(/^[/\\]+/, '').replace(/^data[/\\]+templates[/\\]+/, ''));
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Template path escapes the templates directory: ${storedPath}`);
  }
  return full;
}

/**
 * Escape a resolved placeholder value for HTML text/attribute context.
 *
 * Every `{{…}}` on a receipt is a DB scalar (patient name, phone, id, money, date) that
 * lands in the document as text — none of them is meant to carry markup. Interpolating
 * them raw let a patient name containing `<` or `"` reshape the receipt, and the printed
 * output is written straight into a `document.write`d print window, so it executes.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render template with data
 * @param templateHTML - HTML template with placeholders
 * @param data - Data to fill into template
 * @returns Rendered HTML
 */
function renderTemplate(templateHTML: string, data: RenderableData): string {
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

    // Escaped, not raw — the values are text, and the rendered HTML is document.write'n
    // into a print window. The {{#if}} pass above deliberately stays raw: its body is
    // template markup, not data.
    return value !== null && value !== undefined ? escapeHtml(String(value)) : '';
  });

  return rendered;
}

/**
 * Resolve data path (e.g., 'patient.patient_name')
 * @param dataPath - Dot-notation path
 * @param data - Data object
 * @returns Resolved value
 */
function resolveDataPath(dataPath: string, data: RenderableData): unknown {
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
    return formatDatePattern(value as Date | string | number | null, format);
  }

  // Default filter
  if (filter.startsWith('default:')) {
    return String(value);
  }

  return String(value);
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
    ? await getTemplatePath({ templateName: DISCOUNT_TEMPLATE_NAME }, FALLBACK_TEMPLATE_PATHS.discount)
    : await getTemplatePath({ documentTypeId: 1 });
  const fullPath = resolveTemplateFile(templatePath);

  // Read template file
  const templateHTML = await fs.readFile(fullPath, 'utf-8');

  // Render template with data
  const html = renderTemplate(templateHTML, data);

  return html;
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
  const templatePath = await getTemplatePath(
    { templateName: NO_WORK_TEMPLATE_NAME },
    FALLBACK_TEMPLATE_PATHS.noWork
  );
  const fullPath = resolveTemplateFile(templatePath);

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
  const html = renderTemplate(templateHTML, data);

  log.info('[RECEIPT-SERVICE] Receipt generated successfully');

  return html;
}

export default {
  getReceiptData,
  generateReceiptHTML,
  generateNoWorkReceiptHTML,
};
