/**
 * Work Service - Business Logic Layer
 *
 * This service handles all work (treatment) business logic including:
 * - Work creation with validation
 * - Work with invoice creation (finished work with full payment)
 * - Work deletion with dependency checking
 * - Duplicate active work validation
 * - Date field normalization
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { log } from '../../utils/logger.js';
import { isUniqueViolation } from '../../utils/pg-errors.js';
import { toDateOnly } from '../../utils/date.js';
import {
  addWork,
  getActiveWork,
  getWorkById,
  getWorkDetails,
  validateStatusChange,
  updateWork,
  addWorkWithInvoice as dbAddWorkWithInvoice,
  deleteWork as dbDeleteWork,
  transferWork as dbTransferWork,
  getWorkRelatedCounts,
  WORK_STATUS,
  type WorkRelatedCounts,
  type TransferWorkResult,
} from '../database/queries/work-queries.js';
import { getPatientById } from '../database/queries/patient-queries.js';
import { isToday } from '../../middleware/time-based-auth.js';
import { ROLES, type UserRole } from '../../shared/auth/roles.js';

// Re-export WORK_STATUS for convenience
export { WORK_STATUS };

/**
 * Work error codes
 */
export type WorkErrorCode =
  | 'INVALID_DATE_FORMAT'
  | 'MISSING_REQUIRED_FIELDS'
  | 'MISSING_TYPE_OF_WORK'
  | 'INVALID_DATA_TYPE'
  | 'INVALID_FINISHED_FLAG'
  | 'INVALID_TOTAL_REQUIRED'
  | 'MISSING_CURRENCY'
  | 'DUPLICATE_ACTIVE_WORK'
  | 'WORK_HAS_DEPENDENCIES'
  | 'WORK_NOT_FOUND'
  | 'TARGET_PATIENT_NOT_FOUND'
  | 'SAME_PATIENT'
  | 'ACTIVE_WORK_CONFLICT'
  | 'INVALID_DISCOUNT'
  | 'DISCOUNT_EXCEEDS_REMAINING';

/**
 * Work error details
 */
export interface WorkErrorDetails {
  field?: string;
  value?: string | number | boolean | null;
  message?: string;
  code?: string;
  existingWork?: ExistingWorkInfo | null;
  dependencies?: WorkDependencies;
  personId?: number;
  workId?: number;
  [key: string]: string | number | boolean | null | undefined | ExistingWorkInfo | WorkDependencies;
}

/**
 * Existing work information for error reporting
 */
export interface ExistingWorkInfo {
  workId: number;
  typeOfWork: number | null;
  typeName: string | null;
  doctor: string | null;
  additionDate: string | null;
  totalRequired: number | null;
  currency: string | null;
}

/**
 * Build the wire-facing `ExistingWorkInfo` DTO from a work row.
 *
 * `addition_date` is a `timestamp` (a real `Date` at runtime), so truncate it to a
 * local `YYYY-MM-DD` string here — `toDateOnly` uses local getters, which keeps the
 * stored wall-clock date instead of the UTC-shifted value `res.json()` would emit by
 * serializing the `Date` via `.toISOString()`. Both DUPLICATE_ACTIVE_WORK and
 * ACTIVE_WORK_CONFLICT build the same shape; this is the single conversion point.
 */
function toExistingWorkInfo(row: {
  work_id: number;
  type_of_work: number | null;
  type_name: string | null;
  doctor_name: string | null;
  addition_date: Date | null;
  total_required: number | null;
  currency: string | null;
}): ExistingWorkInfo {
  return {
    workId: row.work_id,
    typeOfWork: row.type_of_work ?? null,
    typeName: row.type_name ?? null,
    doctor: row.doctor_name ?? null,
    additionDate: row.addition_date ? toDateOnly(row.addition_date) : null,
    totalRequired: row.total_required ?? null,
    currency: row.currency ?? null,
  };
}

/**
 * Work dependencies count
 */
export interface WorkDependencies {
  InvoiceCount: number;
  VisitCount: number;
  ItemCount: number;
  DiagnosisCount: number;
  ImplantCount: number;
  ScrewCount: number;
  AlignerSetCount: number;
}

/**
 * Deletion result
 */
export interface DeleteResult {
  canDelete: boolean;
  deleted?: boolean;
  rowsAffected?: number;
  dependencies?: WorkDependencies;
}

/**
 * Work with invoice result
 */
export interface WorkWithInvoiceResult {
  workId: number;
  invoiceId: number;
}

/**
 * Validation error class for work business logic
 */
export class WorkValidationError extends Error {
  public readonly code: WorkErrorCode;
  public readonly details: WorkErrorDetails;

  constructor(
    message: string,
    code: WorkErrorCode,
    details: WorkErrorDetails = {}
  ) {
    super(message);
    this.name = 'WorkValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Work status type (1=Active, 2=Finished, 3=Discontinued)
 */
export type WorkStatusType = 1 | 2 | 3;

/**
 * Work creation data
 */
export interface WorkCreateData {
  person_id: number | string;
  dr_id: number | string;
  type_of_work: number | string;
  total_required?: number | string | null;
  currency?: string;
  notes?: string;
  start_date?: string;
  debond_date?: string;
  f_photo_date?: string;
  i_photo_date?: string;
  notes_date?: string;
  createAsFinished?: boolean;
  status?: WorkStatusType;
  estimated_duration?: number;
  keyword_id_1?: number;
  keyword_id_2?: number;
  keyword_id_3?: number;
  keyword_id_4?: number;
  keyword_id_5?: number;
  // Index signature for dynamic date field access
  [key: string]: string | number | boolean | Date | null | undefined;
}

/**
 * Date field names
 */
const DATE_FIELDS = [
  'start_date',
  'debond_date',
  'f_photo_date',
  'i_photo_date',
  'notes_date',
] as const;

/**
 * Normalize and validate date fields in work data
 * @param workData - Work data object
 * @param dateFields - Array of date field names
 * @returns Normalized work data
 * @throws WorkValidationError If date format is invalid
 */
function normalizeDateFields(
  workData: WorkCreateData,
  dateFields: readonly string[] = DATE_FIELDS
): WorkCreateData {
  const normalized = { ...workData };

  for (const field of dateFields) {
    const value = normalized[field];
    if (value && typeof value === 'string') {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        throw new WorkValidationError(
          `Invalid date format for ${field}`,
          'INVALID_DATE_FORMAT',
          { field, value }
        );
      }
      // PG `date` columns are typed/serialized as 'YYYY-MM-DD' strings (see kysely.ts
      // parsers + db:codegen --date-parser string). Store the normalized date-only
      // string, not a Date object, so a `date` column never gets a tz-shifted value.
      normalized[field] = toDateOnly(date);
    }
  }

  return normalized;
}

/**
 * Validate required fields for work creation
 * @param workData - Work data object
 * @throws WorkValidationError If validation fails
 */
function validateWorkRequiredFields(workData: WorkCreateData): void {
  // Validate required fields
  if (!workData.person_id || !workData.dr_id) {
    throw new WorkValidationError(
      'Missing required fields: person_id and dr_id are required',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  // Validate type_of_work is required
  if (!workData.type_of_work) {
    throw new WorkValidationError(
      'type_of_work is required',
      'MISSING_TYPE_OF_WORK'
    );
  }

  // Validate data types
  if (
    isNaN(parseInt(String(workData.person_id))) ||
    isNaN(parseInt(String(workData.dr_id)))
  ) {
    throw new WorkValidationError(
      'person_id and dr_id must be valid numbers',
      'INVALID_DATA_TYPE'
    );
  }
}

/**
 * Validate required fields for finished work with invoice
 * @param workData - Work data object
 * @throws WorkValidationError If validation fails
 */
function validateFinishedWorkRequiredFields(workData: WorkCreateData): void {
  // Validate createAsFinished flag
  if (!workData.createAsFinished) {
    throw new WorkValidationError(
      'createAsFinished flag must be true for this operation',
      'INVALID_FINISHED_FLAG'
    );
  }

  // Validate total_required
  if (
    !workData.total_required ||
    parseFloat(String(workData.total_required)) <= 0
  ) {
    throw new WorkValidationError(
      'total_required must be greater than 0 for finished work with invoice',
      'INVALID_TOTAL_REQUIRED'
    );
  }

  // Validate currency
  if (!workData.currency) {
    throw new WorkValidationError(
      'currency is required for finished work with invoice',
      'MISSING_CURRENCY'
    );
  }
}

/**
 * Format duplicate active work error with existing work details
 * @param personId - Patient id
 * @returns Error details with existing work information
 */
async function formatDuplicateActiveWorkError(
  personId: number | string
): Promise<WorkErrorDetails> {
  try {
    const existingWork = await getActiveWork(parseInt(String(personId)));
    return {
      message:
        'This patient already has an active (unfinished) work record. You can finish the existing work and add the new one.',
      code: 'DUPLICATE_ACTIVE_WORK',
      existingWork: existingWork ? toExistingWorkInfo(existingWork) : null,
    };
  } catch {
    // If we can't fetch the existing work, return basic error
    return {
      message:
        'This patient already has an active (unfinished) work record. Please complete or finish the existing work before adding a new one.',
      code: 'DUPLICATE_ACTIVE_WORK',
    };
  }
}

/**
 * Validate and create a new work record
 * @param workData - Work data object
 * @returns Created work record with workId
 * @throws WorkValidationError If validation fails or duplicate active work exists
 */
export async function validateAndCreateWork(
  workData: WorkCreateData,
  userRole?: UserRole
): Promise<{ work_id: number }> {
  // Validate required fields
  validateWorkRequiredFields(workData);

  const normalizedData = { ...workData };
  if (userRole === ROLES.CLINICAL) {
    // Clinical staff add works without cost — ignore any client-sent money
    // fields rather than trust them.
    normalizedData.total_required = 0;
    normalizedData.currency = undefined;
    delete normalizedData.discount;
    delete normalizedData.discount_date;
  } else if (
    normalizedData.total_required === '' ||
    normalizedData.total_required === null ||
    normalizedData.total_required === undefined
  ) {
    // Default total_required to 0 if empty or not provided
    normalizedData.total_required = 0;
  }

  // Normalize date fields
  const dataWithDates = normalizeDateFields(normalizedData);

  try {
    // Convert to proper types for database
    const dbData = {
      ...dataWithDates,
      person_id: parseInt(String(dataWithDates.person_id), 10),
      dr_id: parseInt(String(dataWithDates.dr_id), 10),
      type_of_work: parseInt(String(dataWithDates.type_of_work), 10),
      total_required: dataWithDates.total_required != null ? parseFloat(String(dataWithDates.total_required)) : null,
    };
    // Create work in database
    const result = await addWork(dbData);
    if (!result) {
      throw new Error('Work creation did not return an id');
    }
    log.info(
      `Work created successfully: Work ${result.work_id} for Patient ${workData.person_id}`
    );
    return result;
  } catch (error) {
    // Duplicate active-work unique violation (partial index unq_tblwork_active).
    // pg reports this as SQLSTATE 23505 + constraint name — NOT the old mssql 2601.
    if (isUniqueViolation(error, 'unq_tblwork_active')) {
      const errorDetails = await formatDuplicateActiveWorkError(
        workData.person_id
      );
      throw new WorkValidationError(
        'Patient already has an active work',
        errorDetails.code as WorkErrorCode,
        errorDetails
      );
    }
    throw error;
  }
}

/**
 * Validate and create a finished work with invoice (full payment)
 *
 * This creates a work record that is marked as finished and has a full payment invoice.
 * Used for completed treatments that are paid in full immediately.
 *
 * @param workData - Work data object (same as validateAndCreateWork)
 * @returns Created work and invoice with workId and invoiceId
 * @throws WorkValidationError If validation fails
 */
export async function validateAndCreateWorkWithInvoice(
  workData: WorkCreateData
): Promise<WorkWithInvoiceResult> {
  // Validate standard work fields
  validateWorkRequiredFields(workData);

  // Validate additional fields for finished work with invoice
  validateFinishedWorkRequiredFields(workData);

  // Normalize date fields
  const dataWithDates = normalizeDateFields(workData);

  try {
    // Convert to proper types for database
    const dbData = {
      ...dataWithDates,
      person_id: parseInt(String(dataWithDates.person_id), 10),
      dr_id: parseInt(String(dataWithDates.dr_id), 10),
      type_of_work: parseInt(String(dataWithDates.type_of_work), 10),
      total_required: dataWithDates.total_required != null ? parseFloat(String(dataWithDates.total_required)) : null,
    };
    // Create work and invoice in database (transaction handled by query layer)
    const result = (await dbAddWorkWithInvoice(
      dbData
    )) as WorkWithInvoiceResult;
    log.info(
      `Work with invoice created successfully: Work ${result.workId}, Invoice ${result.invoiceId} for Patient ${workData.person_id}`
    );
    return result;
  } catch (error) {
    // Duplicate active-work unique violation (partial index unq_tblwork_active).
    // pg reports this as SQLSTATE 23505 + constraint name — NOT the old mssql 2601.
    if (isUniqueViolation(error, 'unq_tblwork_active')) {
      const errorDetails = await formatDuplicateActiveWorkError(
        workData.person_id
      );
      throw new WorkValidationError(
        'Patient already has an active work',
        errorDetails.code as WorkErrorCode,
        errorDetails
      );
    }
    throw error;
  }
}

/**
 * Validate a proposed discount amount against a work's total_required and TotalPaid.
 *
 * Rules:
 * - discount must be a non-negative finite number
 * - discount + TotalPaid must not exceed total_required (cannot create a refund situation)
 *
 * @param discount - Proposed discount amount (0 or null means no discount)
 * @param totalRequired - Work's total_required
 * @param totalPaid - Current sum of invoices paid for this work
 * @throws WorkValidationError when rules are violated
 */
export function validateDiscount(
  discount: number | null | undefined,
  totalRequired: number | null | undefined,
  totalPaid: number
): void {
  if (discount == null || discount === 0) return;

  if (!Number.isFinite(discount) || discount < 0) {
    throw new WorkValidationError(
      'discount must be a non-negative number',
      'INVALID_DISCOUNT',
      { field: 'discount', value: discount }
    );
  }

  const total = Number(totalRequired ?? 0);
  const paid = Number(totalPaid ?? 0);
  const remaining = total - paid;

  if (discount > remaining) {
    throw new WorkValidationError(
      `discount (${discount}) cannot exceed remaining balance (${remaining}). Refund the difference first or lower the discount.`,
      'DISCOUNT_EXCEEDS_REMAINING',
      { field: 'discount', value: discount, totalRequired: total, totalPaid: paid }
    );
  }
}

/**
 * Validation-error kinds for PUT /updatework that each map to a specific HTTP
 * status. Keeping the (financial, permission-sensitive) update rules here lets
 * the route stay a thin status-code mapper. WorkValidationError is NOT reused for
 * all of these because most carry no WorkErrorCode (and it would force one).
 */
export type WorkUpdateErrorKind = 'badRequest' | 'notFound' | 'conflict' | 'forbidden';

export class WorkUpdateError extends Error {
  public readonly kind: WorkUpdateErrorKind;
  public readonly details?: Record<string, unknown>;

  constructor(kind: WorkUpdateErrorKind, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'WorkUpdateError';
    this.kind = kind;
    this.details = details;
  }
}

// PUT /updatework treats discount_date as a date too (the create path's DATE_FIELDS
// does not include it), so this list is deliberately distinct from DATE_FIELDS.
const UPDATE_WORK_DATE_FIELDS = [
  'start_date',
  'debond_date',
  'f_photo_date',
  'i_photo_date',
  'notes_date',
  'discount_date',
] as const;

/**
 * Input for {@link validateAndUpdateWork}. `workData` is the loose rest-spread body
 * (every field except workId); `userRole` is the authenticated caller's session role.
 */
export interface UpdateWorkInput {
  workId: number;
  userRole: string | undefined;
  workData: Record<string, unknown>;
}

/**
 * Validate and apply an update to an existing work.
 *
 * Extracted from PUT /updatework so the route is a thin mapper. Enforces, in order:
 * date-field coercion, status-change validation, the secretary financial-field edit
 * time window (editable only on the work's creation day), the total_required >=
 * already-paid guard (was DB CHECK CK_MoreThanTotalW), and the discount rules
 * (non-admin changes divert to the approval queue via the forbidden throw).
 * On failure throws WorkUpdateError (route → 400/403/404/409) or, from
 * validateDiscount, WorkValidationError (→ 400 with its code).
 */
export async function validateAndUpdateWork(
  input: UpdateWorkInput
): Promise<{ rowsAffected: number; moneyChanged: boolean }> {
  const { workId, userRole } = input;
  const workData: Record<string, unknown> = { ...input.workData };

  // Normalize provided date fields to 'YYYY-MM-DD' strings. These are all PG `date`
  // columns (typed string in db.d.ts), so they must be bound as date-only strings,
  // NOT Date objects — a Date can tz-shift on insert, and it also broke the
  // discount_date change-detection below (String(Date) never equals 'YYYY-MM-DD').
  // Mirrors the create path's normalizeDateFields/toDateOnly.
  for (const field of UPDATE_WORK_DATE_FIELDS) {
    const value = workData[field];
    if (value && typeof value === 'string') {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        log.warn('Update work invalid date format', { workId, field, value });
        throw new WorkUpdateError('badRequest', `Invalid date format for ${field}`);
      }
      workData[field] = toDateOnly(date);
    }
  }

  // Fetch current work once if a validation below needs it.
  const status = workData.status as WorkStatusType | undefined;
  const financialFields = ['total_required', 'currency'];
  const needsCurrentWork =
    status !== undefined ||
    (userRole !== 'admin' &&
      financialFields.some((field) => Object.prototype.hasOwnProperty.call(workData, field)));

  let currentWork: Awaited<ReturnType<typeof getWorkById>> = null;
  if (needsCurrentWork) {
    currentWork = await getWorkById(workId);
    if (!currentWork) {
      log.warn('Work not found for update', { workId });
      // notFound message is the resource NOUN — ErrorResponses.notFound appends " not found".
      throw new WorkUpdateError('notFound', 'Work');
    }
  }

  // ===== STATUS CHANGE VALIDATION =====
  if (status !== undefined && currentWork && currentWork.status !== status) {
    const validation = await validateStatusChange(
      workId,
      status,
      (workData.person_id as number | undefined) || currentWork.person_id
    );
    if (!validation.valid) {
      throw new WorkUpdateError('conflict', validation.error || 'Status change conflict', {
        existingWork: validation.existingWork,
      });
    }
  }

  // ===== FINANCIAL FIELDS PERMISSION CHECK =====
  // Track whether a money field actually CHANGED (not merely present in the body)
  // so the route's notify tier only FYIs the admin on real same-day money edits.
  let moneyFieldsChanged = false;
  if (
    currentWork &&
    financialFields.some((field) => Object.prototype.hasOwnProperty.call(workData, field))
  ) {
    const totalRequiredChanged =
      workData.total_required !== undefined &&
      Number(workData.total_required) !== Number(currentWork.total_required);
    const currencyChanged =
      workData.currency !== undefined &&
      String(workData.currency) !== String(currentWork.currency);
    if (totalRequiredChanged || currencyChanged) {
      moneyFieldsChanged = true;
      // Non-admins may only change total_required / currency on the work's creation day.
      // currentWork.addition_date is the creation date (was a separate getWorkCreationDate query).
      if (userRole !== 'admin') {
        const created = currentWork.addition_date;
        if (!created || !isToday(created)) {
          throw new WorkUpdateError(
            'forbidden',
            'Cannot edit financial fields (Total Required, currency) for work not created today. Contact admin.',
            { restrictedFields: financialFields }
          );
        }
      }
    }
  }

  // ===== TOTAL-REQUIRED vs PAID GUARD (was DB CHECK CK_MoreThanTotalW) =====
  // A work's total_required must never drop below what's already been paid, or the
  // work becomes overpaid. (NULL/absent total_required = no change / no limit → skip.)
  if (
    Object.prototype.hasOwnProperty.call(workData, 'total_required') &&
    workData.total_required !== null &&
    workData.total_required !== undefined
  ) {
    const newTotal = Number(workData.total_required);
    const workForTotal = await getWorkDetails(workId);
    const alreadyPaid = Number((workForTotal as { TotalPaid?: number } | null)?.TotalPaid ?? 0);
    if (Number.isFinite(newTotal) && newTotal < alreadyPaid) {
      throw new WorkUpdateError(
        'badRequest',
        `Total required (${newTotal}) cannot be less than the amount already paid (${alreadyPaid}).`,
        { code: 'TOTAL_BELOW_PAID' }
      );
    }
  }

  // ===== DISCOUNT FIELDS PERMISSION + VALIDATION =====
  // discount and discount_date apply directly only for admin; for other roles the
  // forbidden throw below is caught by PUT /updatework and diverted into the
  // approval queue (action 'work.discount'). discount_reason is editable by any
  // authenticated user.
  const discountAdminFields = ['discount', 'discount_date'] as const;
  const hasDiscountFieldInPayload = discountAdminFields.some((field) =>
    Object.prototype.hasOwnProperty.call(workData, field)
  );

  if (hasDiscountFieldInPayload) {
    const workWithPaid = await getWorkDetails(workId);
    if (!workWithPaid) {
      throw new WorkUpdateError('notFound', 'Work'); // resource noun; see above
    }

    const discount = workData.discount as number | null | undefined;
    const discountDate = workData.discount_date as string | null | undefined;
    const discountChanged =
      discount !== undefined && Number(discount ?? 0) !== Number(workWithPaid.discount ?? 0);
    const discountDateChanged =
      discountDate !== undefined &&
      String(discountDate ?? '') !== String(workWithPaid.discount_date ?? '');

    if (discountChanged || discountDateChanged) {
      moneyFieldsChanged = true;
    }

    // Amount validation runs BEFORE the role gate: a Front-Desk over-limit
    // discount must 400 immediately, not sit in the approval queue only to
    // fail when the admin hits Approve.
    if (discountChanged) {
      try {
        validateDiscount(
          discount ?? null,
          workWithPaid.total_required,
          (workWithPaid as { TotalPaid?: number }).TotalPaid ?? 0
        );
      } catch (err) {
        // Surface validateDiscount's WorkValidationError as a 400 carrying its code.
        if (err instanceof WorkValidationError) {
          throw new WorkUpdateError('badRequest', err.message, {
            code: err.code,
            ...(err.details ?? {}),
          });
        }
        throw err;
      }
    }

    if ((discountChanged || discountDateChanged) && userRole !== 'admin') {
      throw new WorkUpdateError('forbidden', 'Discount changes require admin approval.', {
        restrictedFields: [...discountAdminFields],
      });
    }
  }

  const result = await updateWork(workId, workData as Parameters<typeof updateWork>[1]);
  return { rowsAffected: result.rowCount, moneyChanged: moneyFieldsChanged };
}

/**
 * Check work dependencies before deletion
 * @param workId - Work id
 * @returns Dependency information
 */
export async function checkWorkDependencies(
  workId: number
): Promise<DeleteResult> {
  const result = (await dbDeleteWork(workId)) as DeleteResult;

  if (!result.canDelete) {
    const deps = result.dependencies!;
    const dependencyMessages: string[] = [];

    if (deps.InvoiceCount > 0)
      dependencyMessages.push(`${deps.InvoiceCount} payment(s)`);
    if (deps.VisitCount > 0)
      dependencyMessages.push(`${deps.VisitCount} visit(s)`);
    if (deps.ItemCount > 0)
      dependencyMessages.push(`${deps.ItemCount} item(s)`);
    if (deps.DiagnosisCount > 0)
      dependencyMessages.push(`${deps.DiagnosisCount} diagnosis(es)`);
    if (deps.ImplantCount > 0)
      dependencyMessages.push(`${deps.ImplantCount} implant(s)`);
    if (deps.ScrewCount > 0)
      dependencyMessages.push(`${deps.ScrewCount} screw(s)`);
    if (deps.AlignerSetCount > 0)
      dependencyMessages.push(`${deps.AlignerSetCount} aligner set(s)`);

    throw new WorkValidationError(
      'Cannot delete work with existing records',
      'WORK_HAS_DEPENDENCIES',
      {
        message: `This work has ${dependencyMessages.join(', ')} that must be deleted first.`,
        dependencies: deps,
      }
    );
  }

  return result;
}

/**
 * Validate and delete a work record
 * @param workId - Work id
 * @returns Deletion result with rowsAffected
 * @throws WorkValidationError If work has dependencies
 */
export async function validateAndDeleteWork(
  workId: number
): Promise<DeleteResult> {
  log.info(`Attempting to delete work ${workId}`);

  const result = await checkWorkDependencies(workId);

  log.info(`Work ${workId} deleted successfully`);
  return result;
}

// ===== WORK TRANSFER =====

/**
 * Re-export transfer-related types
 */
export type { WorkRelatedCounts, TransferWorkResult };

/**
 * Validate and transfer a work to a new patient
 *
 * Validation:
 * - Work must exist
 * - Target patient must exist
 * - Cannot transfer to same patient
 * - If work is ACTIVE, target patient cannot have an active work
 *
 * @param workId - Work id to transfer
 * @param targetPatientId - Target patient id
 * @returns Transfer result with source/target info and related counts
 * @throws WorkValidationError If validation fails
 */
export async function validateAndTransferWork(
  workId: number,
  targetPatientId: number
): Promise<TransferWorkResult> {
  log.info(`Validating work transfer: Work ${workId} -> Patient ${targetPatientId}`);

  // 1. Get the work to transfer
  const work = await getWorkById(workId);
  if (!work) {
    throw new WorkValidationError(
      'Work not found',
      'WORK_NOT_FOUND',
      { workId }
    );
  }

  // 2. Check not transferring to same patient
  if (work.person_id === targetPatientId) {
    throw new WorkValidationError(
      'Cannot transfer work to the same patient',
      'SAME_PATIENT',
      { workId, sourcePatientId: work.person_id, targetPatientId }
    );
  }

  // 3. Validate target patient exists
  const targetPatient = await getPatientById(targetPatientId);
  if (!targetPatient) {
    throw new WorkValidationError(
      'Target patient not found',
      'TARGET_PATIENT_NOT_FOUND',
      { targetPatientId }
    );
  }

  // 4. If work is ACTIVE, check for active work conflict
  if (work.status === WORK_STATUS.ACTIVE) {
    const targetActiveWork = await getActiveWork(targetPatientId);
    if (targetActiveWork) {
      throw new WorkValidationError(
        'Target patient already has an active work',
        'ACTIVE_WORK_CONFLICT',
        {
          targetPatientId,
          existingWork: toExistingWorkInfo(targetActiveWork),
        }
      );
    }
  }

  // 5. Execute the transfer
  log.info(`Executing work transfer: Work ${workId} from Patient ${work.person_id} to Patient ${targetPatientId}`);
  const result = await dbTransferWork(workId, targetPatientId);
  log.info(`Work transfer complete:`, result);

  return result;
}

/**
 * Get transfer preview (related record counts)
 * @param workId - Work id
 * @returns Related record counts
 */
export async function getTransferPreview(workId: number): Promise<WorkRelatedCounts> {
  const work = await getWorkById(workId);
  if (!work) {
    throw new WorkValidationError(
      'Work not found',
      'WORK_NOT_FOUND',
      { workId }
    );
  }

  return getWorkRelatedCounts(workId);
}

export default {
  validateAndCreateWork,
  validateAndCreateWorkWithInvoice,
  checkWorkDependencies,
  validateAndDeleteWork,
  validateAndTransferWork,
  getTransferPreview,
  WorkValidationError,
};
