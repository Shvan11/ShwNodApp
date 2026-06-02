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
import {
  addWork,
  getActiveWork,
  getWorkById,
  addWorkWithInvoice as dbAddWorkWithInvoice,
  deleteWork as dbDeleteWork,
  transferWork as dbTransferWork,
  getWorkRelatedCounts,
  WORK_STATUS,
  type WorkRelatedCounts,
  type TransferWorkResult,
} from '../database/queries/work-queries.js';
import { getPatientById } from '../database/queries/patient-queries.js';
import type { Work, WorkWithDetails } from '../../types/database.types.js';

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
  additionDate: Date | null;
  totalRequired: number | null;
  currency: string | null;
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
  start_date?: string | Date;
  debond_date?: string | Date;
  f_photo_date?: string | Date;
  i_photo_date?: string | Date;
  notes_date?: string | Date;
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
      normalized[field] = date;
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
    const existingWork = (await getActiveWork(
      parseInt(String(personId))
    )) as WorkWithDetails | null;
    return {
      message:
        'This patient already has an active (unfinished) work record. You can finish the existing work and add the new one.',
      code: 'DUPLICATE_ACTIVE_WORK',
      existingWork: existingWork
        ? {
            workId: existingWork.work_id,
            typeOfWork: existingWork.type_of_work ?? null,
            typeName: existingWork.type_name ?? null,
            doctor: existingWork.doctor_name ?? null,
            additionDate: existingWork.addition_date ?? null,
            totalRequired: existingWork.total_required ?? null,
            currency: existingWork.currency ?? null,
          }
        : null,
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
  workData: WorkCreateData
): Promise<Work> {
  // Validate required fields
  validateWorkRequiredFields(workData);

  // Default total_required to 0 if empty or not provided
  const normalizedData = { ...workData };
  if (
    normalizedData.total_required === '' ||
    normalizedData.total_required === null ||
    normalizedData.total_required === undefined
  ) {
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
    const result = (await addWork(dbData)) as unknown as Work;
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
          existingWork: {
            workId: targetActiveWork.work_id,
            typeOfWork: targetActiveWork.type_of_work ?? null,
            typeName: targetActiveWork.type_name ?? null,
            doctor: targetActiveWork.doctor_name ?? null,
            additionDate: targetActiveWork.addition_date ?? null,
            totalRequired: targetActiveWork.total_required ?? null,
            currency: targetActiveWork.currency ?? null,
          },
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
