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
import {
  addWork,
  getActiveWork,
  addWorkWithInvoice as dbAddWorkWithInvoice,
  deleteWork as dbDeleteWork,
  WORK_STATUS,
} from '../database/queries/work-queries.js';
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
  | 'WORK_HAS_DEPENDENCIES';

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
  PersonID: number | string;
  DrID: number | string;
  Typeofwork: number | string;
  TotalRequired?: number | string | null;
  Currency?: string;
  Notes?: string;
  StartDate?: string | Date;
  DebondDate?: string | Date;
  FPhotoDate?: string | Date;
  IPhotoDate?: string | Date;
  NotesDate?: string | Date;
  createAsFinished?: boolean;
  Status?: WorkStatusType;
  EstimatedDuration?: number;
  KeyWordID1?: number;
  KeyWordID2?: number;
  KeywordID3?: number;
  KeywordID4?: number;
  KeywordID5?: number;
  // Index signature for dynamic date field access
  [key: string]: string | number | boolean | Date | null | undefined;
}

/**
 * Date field names
 */
const DATE_FIELDS = [
  'StartDate',
  'DebondDate',
  'FPhotoDate',
  'IPhotoDate',
  'NotesDate',
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
  if (!workData.PersonID || !workData.DrID) {
    throw new WorkValidationError(
      'Missing required fields: PersonID and DrID are required',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  // Validate Typeofwork is required
  if (!workData.Typeofwork) {
    throw new WorkValidationError(
      'Typeofwork is required',
      'MISSING_TYPE_OF_WORK'
    );
  }

  // Validate data types
  if (
    isNaN(parseInt(String(workData.PersonID))) ||
    isNaN(parseInt(String(workData.DrID)))
  ) {
    throw new WorkValidationError(
      'PersonID and DrID must be valid numbers',
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

  // Validate TotalRequired
  if (
    !workData.TotalRequired ||
    parseFloat(String(workData.TotalRequired)) <= 0
  ) {
    throw new WorkValidationError(
      'TotalRequired must be greater than 0 for finished work with invoice',
      'INVALID_TOTAL_REQUIRED'
    );
  }

  // Validate Currency
  if (!workData.Currency) {
    throw new WorkValidationError(
      'Currency is required for finished work with invoice',
      'MISSING_CURRENCY'
    );
  }
}

/**
 * Format duplicate active work error with existing work details
 * @param personId - Patient ID
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
            workId: existingWork.workid,
            typeOfWork: existingWork.Typeofwork ?? null,
            typeName: existingWork.TypeName ?? null,
            doctor: existingWork.DoctorName ?? null,
            additionDate: existingWork.AdditionDate ?? null,
            totalRequired: existingWork.TotalRequired ?? null,
            currency: existingWork.Currency ?? null,
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
 * SQL error with number property
 */
interface SqlError extends Error {
  number?: number;
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

  // Default TotalRequired to 0 if empty or not provided
  const normalizedData = { ...workData };
  if (
    normalizedData.TotalRequired === '' ||
    normalizedData.TotalRequired === null ||
    normalizedData.TotalRequired === undefined
  ) {
    normalizedData.TotalRequired = 0;
  }

  // Normalize date fields
  const dataWithDates = normalizeDateFields(normalizedData);

  try {
    // Convert to proper types for database
    const dbData = {
      ...dataWithDates,
      PersonID: parseInt(String(dataWithDates.PersonID), 10),
      DrID: parseInt(String(dataWithDates.DrID), 10),
      Typeofwork: parseInt(String(dataWithDates.Typeofwork), 10),
      TotalRequired: dataWithDates.TotalRequired != null ? parseFloat(String(dataWithDates.TotalRequired)) : null,
    };
    // Create work in database
    const result = (await addWork(dbData)) as Work;
    log.info(
      `Work created successfully: Work ${result.workid} for Patient ${workData.PersonID}`
    );
    return result;
  } catch (error) {
    const sqlError = error as SqlError;
    // Handle duplicate active work constraint violation
    if (
      sqlError.number === 2601 &&
      sqlError.message.includes('UNQ_tblWork_Active')
    ) {
      const errorDetails = await formatDuplicateActiveWorkError(
        workData.PersonID
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
      PersonID: parseInt(String(dataWithDates.PersonID), 10),
      DrID: parseInt(String(dataWithDates.DrID), 10),
      Typeofwork: parseInt(String(dataWithDates.Typeofwork), 10),
      TotalRequired: dataWithDates.TotalRequired != null ? parseFloat(String(dataWithDates.TotalRequired)) : null,
    };
    // Create work and invoice in database (transaction handled by query layer)
    const result = (await dbAddWorkWithInvoice(
      dbData
    )) as WorkWithInvoiceResult;
    log.info(
      `Work with invoice created successfully: Work ${result.workId}, Invoice ${result.invoiceId} for Patient ${workData.PersonID}`
    );
    return result;
  } catch (error) {
    const sqlError = error as SqlError;
    // Handle duplicate active work constraint violation
    if (
      sqlError.number === 2601 &&
      sqlError.message.includes('UNQ_tblWork_Active')
    ) {
      const errorDetails = await formatDuplicateActiveWorkError(
        workData.PersonID
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
 * Check work dependencies before deletion
 * @param workId - Work ID
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
 * @param workId - Work ID
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

export default {
  validateAndCreateWork,
  validateAndCreateWorkWithInvoice,
  checkWorkDependencies,
  validateAndDeleteWork,
  WorkValidationError,
};
