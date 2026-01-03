/**
 * Aligner Service - Business Logic Layer
 *
 * This service handles all aligner-related business logic including:
 * - Aligner set creation with active set management
 * - Aligner set update and deletion with validation
 * - Aligner batch management
 * - Aligner doctor email validation and dependency checking
 * - Aligner notes validation
 * - Business rules enforcement
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { log } from '../../utils/logger.js';
import * as alignerQueries from '../database/queries/aligner-queries.js';
import type { AlignerSet, AlignerBatch, AlignerPartner } from '../../types/database.types.js';

/**
 * Aligner error codes
 */
export type AlignerErrorCode =
  | 'MISSING_REQUIRED_FIELDS'
  | 'INVALID_SET_ID'
  | 'SET_NOT_FOUND'
  | 'INVALID_BATCH_ID'
  | 'BATCH_NOT_FOUND'
  | 'INVALID_SET_CHANGE'
  | 'UPPER_ALIGNER_LIMIT_EXCEEDED'
  | 'LOWER_ALIGNER_LIMIT_EXCEEDED'
  | 'BATCH_NOT_DELIVERED'
  | 'VALIDATION_ERROR'
  | 'MISSING_DOCTOR_NAME'
  | 'EMAIL_ALREADY_EXISTS'
  | 'DOCTOR_HAS_SETS'
  | 'INVALID_NOTE_ID'
  | 'MISSING_NOTE_TEXT'
  | 'NOTE_NOT_FOUND'
  | 'SET_COST_NOT_DEFINED'
  | 'INVALID_AMOUNT'
  | 'PAYMENT_EXCEEDS_BALANCE'
  | 'INVALID_SEARCH_TERM';

/**
 * Aligner error details
 */
export interface AlignerErrorDetails {
  [key: string]: unknown;
  setId?: number;
  email?: string;
  setCount?: number;
  noteId?: number;
  batchId?: number;
  workId?: number;
  amount?: number;
  balance?: number;
}

/**
 * Validation error class for aligner business logic
 */
export class AlignerValidationError extends Error {
  public readonly code: AlignerErrorCode;
  public readonly details: AlignerErrorDetails;

  constructor(
    message: string,
    code: AlignerErrorCode,
    details: AlignerErrorDetails = {}
  ) {
    super(message);
    this.name = 'AlignerValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Set creation data
 */
export interface SetCreateData {
  WorkID: number;
  AlignerDrID: number;
  IsActive?: boolean;
  TotalAligners?: number;
  RemainingAligners?: number;
  SetCost?: number;
  Notes?: string;
  SetSequence?: number;
  Type?: string;
  UpperAlignersCount?: number;
  LowerAlignersCount?: number;
}

/**
 * Set update data
 */
export interface SetUpdateData {
  AlignerDrID?: number;
  IsActive?: boolean;
  TotalAligners?: number;
  RemainingAligners?: number;
  SetCost?: number;
  Notes?: string;
  SetSequence?: number;
  Type?: string;
  UpperAlignersCount?: number;
  LowerAlignersCount?: number;
}

/**
 * Batch creation data
 */
export interface BatchCreateData {
  AlignerSetID: number;
  IsActive?: boolean;
  BatchSequence?: number;
  AlignersInBatch?: number;
  Notes?: string;
  UpperAlignerCount?: number;
  LowerAlignerCount?: number;
  UpperAlignerStartSequence?: number;
  UpperAlignerEndSequence?: number;
  LowerAlignerStartSequence?: number;
  LowerAlignerEndSequence?: number;
  Days?: number;
  ValidityPeriod?: number;
}

/**
 * Batch update data
 * NOTE: ManufactureDate and DeliveredToPatientDate are managed via markBatchManufactured/markBatchDelivered
 */
export interface BatchUpdateData {
  AlignerSetID?: number;
  IsActive?: boolean;
  BatchSequence?: number;
  AlignersInBatch?: number;
  // ManufactureDate and DeliveredToPatientDate are managed via status endpoints
  Notes?: string;
  UpperAlignerCount?: number;
  LowerAlignerCount?: number;
  UpperAlignerStartSequence?: number;
  UpperAlignerEndSequence?: number;
  LowerAlignerStartSequence?: number;
  LowerAlignerEndSequence?: number;
  Days?: number;
  IsLast?: boolean;
  // Note: BatchExpiryDate and ValidityPeriod are computed columns - cannot be set directly
}

/**
 * Batch update result
 */
export interface BatchUpdateResult {
  deactivatedBatch?: {
    batchSequence: number;
  };
}

/**
 * Deactivated batch info
 */
export interface DeactivatedBatchInfo {
  batchId: number;
  batchSequence: number;
}

/**
 * Create batch result
 */
export interface CreateBatchResult {
  newBatchId: number;
  deactivatedBatch: DeactivatedBatchInfo | null;
}

/**
 * Doctor creation data
 */
export interface DoctorCreateData {
  DoctorName: string;
  DoctorEmail?: string;
  DoctorPhone?: string;
  IsActive?: boolean;
  Address?: string;
  Notes?: string;
}

/**
 * Doctor update data
 */
export interface DoctorUpdateData {
  DoctorName: string;
  DoctorEmail?: string;
  DoctorPhone?: string;
  IsActive?: boolean;
  Address?: string;
  Notes?: string;
}

/**
 * Payment creation data
 */
export interface PaymentCreateData {
  workid: number;
  AlignerSetID: number;
  Amountpaid: number | string;
  Dateofpayment: string;
  USDReceived?: number;
  IQDReceived?: number;
  Change?: number;
  Notes?: string;
}

/**
 * Set balance info
 */
interface SetBalanceInfo {
  SetCost: number | null;
  TotalPaid: number;
  Balance: number;
}

/**
 * Batch info for deactivation check
 */
interface BatchInfo {
  AlignerBatchID: number;
  BatchSequence: number;
  IsActive: boolean;
}

/**
 * Aligner patient search result
 */
export interface AlignerPatientSearchResult {
  PersonID: number;
  PatientName: string;
  Phone?: string | null;
  WorkID?: number;
  DoctorName?: string | null;
  SetCount?: number;
  ActiveSetID?: number | null;
}

// ==============================
// ALIGNER SETS BUSINESS LOGIC
// ==============================

/**
 * Validate and create a new aligner set
 *
 * Business Rules:
 * - WorkID and AlignerDrID are required
 * - If creating an active set (IsActive = 1), deactivates all other sets for the same work
 * - Initializes remaining aligners count equal to total count
 * - Sets creation date automatically
 *
 * @param setData - Set data
 * @returns New set ID
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreateSet(
  setData: SetCreateData
): Promise<number> {
  const startTime = Date.now();
  const { WorkID, AlignerDrID } = setData;

  // Validation
  if (!WorkID || !AlignerDrID) {
    throw new AlignerValidationError(
      'WorkID and AlignerDrID are required',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  // Sanitize numeric fields - convert empty strings to undefined
  const sanitizedData: SetCreateData = {
    ...setData,
    SetCost: setData.SetCost !== undefined && setData.SetCost !== null && String(setData.SetCost) !== ''
      ? Number(setData.SetCost)
      : undefined,
  };

  const afterValidation = Date.now();
  log.info(
    `⏱️  [SERVICE TIMING] Validation took: ${afterValidation - startTime}ms`
  );
  log.info('Creating new aligner set with business logic:', sanitizedData);

  try {
    const dbStartTime = Date.now();
    const newSetId = (await alignerQueries.createAlignerSet(sanitizedData)) as number;
    const dbEndTime = Date.now();

    log.info(
      `⏱️  [SERVICE TIMING] Database query took: ${dbEndTime - dbStartTime}ms`
    );
    log.info(
      `⏱️  [SERVICE TIMING] Total service time: ${dbEndTime - startTime}ms`
    );
    log.info(
      `Aligner set created successfully: Set ${newSetId} for Work ${WorkID}`
    );
    return newSetId;
  } catch (error) {
    const errorTime = Date.now() - startTime;
    log.error(`⏱️  [SERVICE TIMING] Error after ${errorTime}ms:`, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Validate and update an aligner set
 *
 * Business Rules:
 * - Set must exist
 * - If provided, AlignerDrID must be valid
 *
 * @param setId - Set ID
 * @param setData - Set data to update
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndUpdateSet(
  setId: number | string,
  setData: SetUpdateData
): Promise<void> {
  if (!setId || isNaN(parseInt(String(setId)))) {
    throw new AlignerValidationError('Valid setId is required', 'INVALID_SET_ID');
  }

  // Check if set exists
  const setExists = await alignerQueries.getAlignerSetById(
    parseInt(String(setId))
  );
  if (!setExists) {
    throw new AlignerValidationError('Aligner set not found', 'SET_NOT_FOUND', {
      setId: parseInt(String(setId)),
    });
  }

  // Sanitize numeric fields - convert empty strings to undefined
  const sanitizedData: SetUpdateData = {
    ...setData,
    SetCost: setData.SetCost !== undefined && setData.SetCost !== null && String(setData.SetCost) !== ''
      ? Number(setData.SetCost)
      : undefined,
  };

  log.info(`Updating aligner set ${setId}:`, sanitizedData);

  try {
    await alignerQueries.updateAlignerSet(parseInt(String(setId)), sanitizedData);
    log.info(`Aligner set ${setId} updated successfully`);
  } catch (error) {
    log.error('Error updating aligner set:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Validate and delete an aligner set
 *
 * Business Rules:
 * - Set must exist
 * - Deletes all batches first (cascade delete)
 *
 * @param setId - Set ID
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndDeleteSet(
  setId: number | string
): Promise<void> {
  if (!setId || isNaN(parseInt(String(setId)))) {
    throw new AlignerValidationError('Valid setId is required', 'INVALID_SET_ID');
  }

  const parsedSetId = parseInt(String(setId));

  // Check if set exists
  const setExists = await alignerQueries.getAlignerSetById(parsedSetId);
  if (!setExists) {
    throw new AlignerValidationError('Aligner set not found', 'SET_NOT_FOUND', {
      setId: parsedSetId,
    });
  }

  log.info(`Deleting aligner set ${setId}`);

  try {
    // Delete batches first (foreign key constraint)
    await alignerQueries.deleteBatchesBySetId(parsedSetId);

    // Then delete the set
    await alignerQueries.deleteAlignerSet(parsedSetId);

    log.info(`Aligner set ${setId} and its batches deleted successfully`);
  } catch (error) {
    log.error('Error deleting aligner set:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// ==============================
// ALIGNER BATCHES BUSINESS LOGIC
// ==============================

/**
 * Validate and create a new batch
 *
 * Business Rules:
 * - AlignerSetID is required
 * - Set must exist
 * - If IsActive=1, automatically deactivates other active batches for the same set
 *
 * @param batchData - Batch data
 * @returns Object with newBatchId and deactivatedBatch info
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreateBatch(
  batchData: BatchCreateData
): Promise<CreateBatchResult> {
  const { AlignerSetID, IsActive } = batchData;

  if (!AlignerSetID) {
    throw new AlignerValidationError(
      'AlignerSetID is required',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  // Verify set exists
  const setExists = await alignerQueries.getAlignerSetById(AlignerSetID);
  if (!setExists) {
    throw new AlignerValidationError('Aligner set not found', 'SET_NOT_FOUND', {
      setId: AlignerSetID,
    });
  }

  // Check for currently active batch (before creating new one)
  let deactivatedBatch: DeactivatedBatchInfo | null = null;
  if (IsActive) {
    const batches = (await alignerQueries.getBatchesBySetId(
      AlignerSetID
    )) as BatchInfo[];
    const activeBatch = batches.find((b) => b.IsActive);
    if (activeBatch) {
      deactivatedBatch = {
        batchId: activeBatch.AlignerBatchID,
        batchSequence: activeBatch.BatchSequence,
      };
      log.info(
        `Batch #${activeBatch.BatchSequence} will be deactivated when creating new active batch`
      );
    }
  }

  log.info('Creating new aligner batch:', batchData);

  const newBatchId = (await alignerQueries.createBatch(batchData)) as number;
  log.info(`Aligner batch created successfully: Batch ${newBatchId}`);

  return {
    newBatchId,
    deactivatedBatch,
  };
}

/**
 * Validate and update a batch
 *
 * Business Rules:
 * - Batch must exist (implicit through update)
 *
 * @param batchId - Batch ID
 * @param batchData - Batch data
 * @returns Update result
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndUpdateBatch(
  batchId: number | string,
  batchData: BatchUpdateData
): Promise<BatchUpdateResult | void> {
  if (!batchId || isNaN(parseInt(String(batchId)))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  log.info(`Updating aligner batch ${batchId}:`, batchData);

  try {
    const result = (await alignerQueries.updateBatch(
      parseInt(String(batchId)),
      batchData
    )) as BatchUpdateResult | void;
    log.info(`Aligner batch ${batchId} updated successfully`);

    if (result && result.deactivatedBatch) {
      log.info(
        `Batch #${result.deactivatedBatch.batchSequence} was automatically deactivated`
      );
    }

    return result;
  } catch (error) {
    // Convert SQL validation errors (50010-50014) to AlignerValidationError
    // These are custom THROW errors from usp_UpdateAlignerBatch stored procedure
    const sqlError = error as { number?: number; message?: string };
    if (sqlError.number && sqlError.number >= 50010 && sqlError.number <= 50020) {
      // Map SQL error numbers to error codes
      const errorCodeMap: Record<number, AlignerErrorCode> = {
        50010: 'BATCH_NOT_FOUND',
        50011: 'INVALID_SET_CHANGE',
        50012: 'UPPER_ALIGNER_LIMIT_EXCEEDED',
        50013: 'LOWER_ALIGNER_LIMIT_EXCEEDED',
        50014: 'BATCH_NOT_DELIVERED',
      };
      const errorCode = errorCodeMap[sqlError.number] || 'VALIDATION_ERROR';
      throw new AlignerValidationError(
        sqlError.message || 'Batch update validation failed',
        errorCode,
        { batchId: parseInt(String(batchId)) }
      );
    }
    // Re-throw other errors as-is
    throw error;
  }
}

/**
 * Validate and delete a batch
 *
 * Business Rules:
 * - Batch must exist (implicit through delete)
 *
 * @param batchId - Batch ID
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndDeleteBatch(
  batchId: number | string
): Promise<void> {
  if (!batchId || isNaN(parseInt(String(batchId)))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  log.info(`Deleting aligner batch ${batchId}`);

  try {
    await alignerQueries.deleteBatch(parseInt(String(batchId)));
    log.info(`Aligner batch ${batchId} deleted successfully`);
  } catch (error) {
    log.error('Error deleting aligner batch:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Mark batch as delivered with automatic activation for latest batch
 *
 * Business Logic:
 * - Sets DeliveredToPatientDate = GETDATE()
 * - BatchExpiryDate is auto-computed from DeliveredToPatientDate + (Days * AlignerCount)
 * - If batch is latest (highest BatchSequence) AND not already active:
 *   - Deactivates other batches in the set
 *   - Activates this batch
 *
 * @param batchId - Batch ID
 * @param targetDate - Optional date for backdating/correction. If null, uses today's date
 * @returns Result with operation info and activation status
 * @throws AlignerValidationError If validation fails
 */
export async function markBatchDelivered(
  batchId: number | string,
  targetDate?: Date | null
): Promise<alignerQueries.UpdateBatchStatusResult> {
  if (!batchId || isNaN(parseInt(String(batchId)))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  const parsedBatchId = parseInt(String(batchId));
  log.info(`Marking batch ${parsedBatchId} as delivered`, { targetDate: targetDate?.toISOString() || 'today' });

  try {
    const result = await alignerQueries.updateBatchStatus(parsedBatchId, 'DELIVER', targetDate);

    if (result.wasAlreadyDelivered) {
      log.info(`Batch #${result.batchSequence} was already delivered`);
    } else if (result.wasActivated) {
      log.info(`Batch #${result.batchSequence} delivered and auto-activated (latest batch)`);
    } else if (result.wasAlreadyActive) {
      log.info(`Batch #${result.batchSequence} delivered (already active)`);
    } else {
      log.info(`Batch #${result.batchSequence} delivered (not latest batch)`);
    }

    return result;
  } catch (error) {
    log.error('Error marking batch as delivered:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Mark a batch as manufactured
 *
 * Business Rules:
 * - Batch must exist
 * - If no targetDate and ManufactureDate already set, returns "already manufactured" (idempotent)
 * - If targetDate provided and ManufactureDate already set, updates date (allows correction)
 *
 * @param batchId - Batch ID
 * @param targetDate - Optional date for backdating/correction. If null, uses today's date
 * @returns Result with operation info
 * @throws AlignerValidationError If validation fails
 */
export async function markBatchManufactured(
  batchId: number | string,
  targetDate?: Date | null
): Promise<alignerQueries.UpdateBatchStatusResult> {
  if (!batchId || isNaN(parseInt(String(batchId)))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  const parsedBatchId = parseInt(String(batchId));
  log.info(`Marking batch ${parsedBatchId} as manufactured`, { targetDate: targetDate?.toISOString() || 'today' });

  try {
    const result = await alignerQueries.updateBatchStatus(parsedBatchId, 'MANUFACTURE', targetDate);
    log.info(`Batch ${parsedBatchId}: ${result.message}`);
    return result;
  } catch (error) {
    log.error('Error marking batch as manufactured:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Undo manufacture - clears ManufactureDate
 *
 * Business Rules:
 * - Batch must exist
 * - Batch must not be delivered (undo delivery first)
 *
 * @param batchId - Batch ID
 * @returns Result with operation info
 * @throws AlignerValidationError If validation fails
 */
export async function undoManufactureBatch(
  batchId: number | string
): Promise<alignerQueries.UpdateBatchStatusResult> {
  if (!batchId || isNaN(parseInt(String(batchId)))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  const parsedBatchId = parseInt(String(batchId));
  log.info(`Undoing manufacture for batch ${parsedBatchId}`);

  try {
    const result = await alignerQueries.updateBatchStatus(parsedBatchId, 'UNDO_MANUFACTURE');
    log.info(`Batch ${parsedBatchId}: ${result.message}`);
    return result;
  } catch (error) {
    log.error('Error undoing manufacture:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Undo delivery - clears DeliveredToPatientDate and BatchExpiryDate
 *
 * Business Rules:
 * - Batch must exist
 * - Clears delivery date and expiry date, keeps manufacture date
 *
 * @param batchId - Batch ID
 * @returns Result with operation info
 * @throws AlignerValidationError If validation fails
 */
export async function undoDeliverBatch(
  batchId: number | string
): Promise<alignerQueries.UpdateBatchStatusResult> {
  if (!batchId || isNaN(parseInt(String(batchId)))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  const parsedBatchId = parseInt(String(batchId));
  log.info(`Undoing delivery for batch ${parsedBatchId}`);

  try {
    const result = await alignerQueries.updateBatchStatus(parsedBatchId, 'UNDO_DELIVERY');
    log.info(`Batch ${parsedBatchId}: ${result.message}`);
    return result;
  } catch (error) {
    log.error('Error undoing delivery:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// ==============================
// ALIGNER DOCTORS BUSINESS LOGIC
// ==============================

/**
 * Validate and create a new aligner doctor
 *
 * Business Rules:
 * - Doctor name is required
 * - Email must be unique (if provided)
 *
 * @param doctorData - Doctor data
 * @returns New doctor ID
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreateDoctor(
  doctorData: DoctorCreateData
): Promise<number> {
  const { DoctorName, DoctorEmail } = doctorData;

  if (!DoctorName || DoctorName.trim() === '') {
    throw new AlignerValidationError(
      'Doctor name is required',
      'MISSING_DOCTOR_NAME'
    );
  }

  // Business Rule: Email must be unique (only check if email is provided)
  const emailExists = DoctorEmail ? await alignerQueries.isDoctorEmailTaken(DoctorEmail) : false;
  if (emailExists) {
    throw new AlignerValidationError(
      'A doctor with this email already exists',
      'EMAIL_ALREADY_EXISTS',
      { email: DoctorEmail }
    );
  }

  try {
    const newDrID = (await alignerQueries.createDoctor(doctorData)) as number;
    log.info(
      `Aligner doctor created successfully: Dr ${newDrID} - ${DoctorName}`
    );
    return newDrID;
  } catch (error) {
    log.error('Error creating aligner doctor:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Validate and update an aligner doctor
 *
 * Business Rules:
 * - Doctor name is required
 * - Email must be unique among other doctors (if provided)
 *
 * @param drID - Doctor ID
 * @param doctorData - Doctor data
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndUpdateDoctor(
  drID: number | string,
  doctorData: DoctorUpdateData
): Promise<void> {
  const { DoctorName, DoctorEmail } = doctorData;

  if (!DoctorName || DoctorName.trim() === '') {
    throw new AlignerValidationError(
      'Doctor name is required',
      'MISSING_DOCTOR_NAME'
    );
  }

  // Business Rule: Email must be unique (excluding this doctor, only check if email is provided)
  const emailExists = DoctorEmail
    ? await alignerQueries.isDoctorEmailTaken(DoctorEmail, parseInt(String(drID)))
    : false;
  if (emailExists) {
    throw new AlignerValidationError(
      'Another doctor with this email already exists',
      'EMAIL_ALREADY_EXISTS',
      { email: DoctorEmail }
    );
  }

  try {
    await alignerQueries.updateDoctor(parseInt(String(drID)), doctorData);
    log.info(
      `Aligner doctor updated successfully: Dr ${drID} - ${DoctorName}`
    );
  } catch (error) {
    log.error('Error updating aligner doctor:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Validate and delete an aligner doctor
 *
 * Business Rules:
 * - Cannot delete doctor if they have aligner sets
 * - Must reassign or delete sets first
 *
 * @param drID - Doctor ID
 * @throws AlignerValidationError If doctor has dependencies
 */
export async function validateAndDeleteDoctor(
  drID: number | string
): Promise<void> {
  // Business Rule: Check for dependencies
  const setCount = (await alignerQueries.getDoctorSetCount(
    parseInt(String(drID))
  )) as number;

  if (setCount > 0) {
    throw new AlignerValidationError(
      `Cannot delete doctor. They have ${setCount} aligner set(s) associated with them. Please reassign or delete those sets first.`,
      'DOCTOR_HAS_SETS',
      { setCount }
    );
  }

  try {
    await alignerQueries.deleteDoctor(parseInt(String(drID)));
    log.info(`Aligner doctor deleted successfully: Dr ${drID}`);
  } catch (error) {
    log.error('Error deleting aligner doctor:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// ==============================
// ALIGNER NOTES BUSINESS LOGIC
// ==============================

/**
 * Validate and create a note
 *
 * Business Rules:
 * - Set must exist
 * - Note text is required
 *
 * @param setId - Set ID
 * @param noteText - Note text
 * @returns New note ID
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreateNote(
  setId: number | string,
  noteText: string
): Promise<number> {
  if (!setId || isNaN(parseInt(String(setId)))) {
    throw new AlignerValidationError('Valid setId is required', 'INVALID_SET_ID');
  }

  if (!noteText || noteText.trim() === '') {
    throw new AlignerValidationError(
      'Note text is required',
      'MISSING_NOTE_TEXT'
    );
  }

  // Verify that the set exists
  const setExists = await alignerQueries.alignerSetExists(
    parseInt(String(setId))
  );
  if (!setExists) {
    throw new AlignerValidationError('Aligner set not found', 'SET_NOT_FOUND', {
      setId: parseInt(String(setId)),
    });
  }

  try {
    const noteId = (await alignerQueries.createNote(
      parseInt(String(setId)),
      noteText,
      'Lab'
    )) as number;
    log.info(`Lab added note to aligner set ${setId}`);
    return noteId;
  } catch (error) {
    log.error('Error adding lab note:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Validate and update a note
 *
 * Business Rules:
 * - Note must exist
 * - Note text is required
 *
 * @param noteId - Note ID
 * @param noteText - Note text
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndUpdateNote(
  noteId: number | string,
  noteText: string
): Promise<void> {
  if (!noteId || isNaN(parseInt(String(noteId)))) {
    throw new AlignerValidationError(
      'Valid noteId is required',
      'INVALID_NOTE_ID'
    );
  }

  if (!noteText || noteText.trim() === '') {
    throw new AlignerValidationError(
      'Note text is required',
      'MISSING_NOTE_TEXT'
    );
  }

  // Verify note exists
  const existingNote = await alignerQueries.getNoteById(
    parseInt(String(noteId))
  );
  if (!existingNote) {
    throw new AlignerValidationError('Note not found', 'NOTE_NOT_FOUND', {
      noteId: parseInt(String(noteId)),
    });
  }

  try {
    await alignerQueries.updateNote(parseInt(String(noteId)), noteText);
    log.info(`Note ${noteId} updated`);
  } catch (error) {
    log.error('Error updating note:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Validate and delete a note
 *
 * Business Rules:
 * - Note must exist
 *
 * @param noteId - Note ID
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndDeleteNote(
  noteId: number | string
): Promise<void> {
  if (!noteId || isNaN(parseInt(String(noteId)))) {
    throw new AlignerValidationError(
      'Valid noteId is required',
      'INVALID_NOTE_ID'
    );
  }

  // Verify note exists
  const existingNote = await alignerQueries.getNoteById(
    parseInt(String(noteId))
  );
  if (!existingNote) {
    throw new AlignerValidationError('Note not found', 'NOTE_NOT_FOUND', {
      noteId: parseInt(String(noteId)),
    });
  }

  try {
    await alignerQueries.deleteNote(parseInt(String(noteId)));
    log.info(`Note ${noteId} deleted`);
  } catch (error) {
    log.error('Error deleting note:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// ==============================
// ALIGNER PAYMENTS BUSINESS LOGIC
// ==============================

/**
 * Validate and create a payment
 *
 * Business Rules:
 * - workid, Amountpaid, and Dateofpayment are required
 *
 * @param paymentData - Payment data
 * @returns New invoice ID
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreatePayment(
  paymentData: PaymentCreateData
): Promise<number> {
  const { workid, AlignerSetID, Amountpaid, Dateofpayment } = paymentData;

  if (!workid || !Amountpaid || !Dateofpayment) {
    throw new AlignerValidationError(
      'workid, Amountpaid, and Dateofpayment are required',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  // Validate payment doesn't exceed set balance
  if (AlignerSetID) {
    const setBalance = (await alignerQueries.getAlignerSetBalance(
      AlignerSetID
    )) as SetBalanceInfo | null;

    if (!setBalance) {
      throw new AlignerValidationError(
        'Aligner set not found',
        'SET_NOT_FOUND'
      );
    }

    if (setBalance.SetCost === null) {
      throw new AlignerValidationError(
        'Set cost must be defined before accepting payments',
        'SET_COST_NOT_DEFINED'
      );
    }

    const paymentAmount = parseFloat(String(Amountpaid));

    if (paymentAmount <= 0) {
      throw new AlignerValidationError(
        'Payment amount must be greater than zero',
        'INVALID_AMOUNT'
      );
    }

    if (paymentAmount > setBalance.Balance) {
      throw new AlignerValidationError(
        `Payment amount (${paymentAmount}) exceeds remaining balance (${setBalance.Balance})`,
        'PAYMENT_EXCEEDS_BALANCE'
      );
    }
  }

  log.info(
    `Adding payment for work ID: ${workid}, Set ID: ${AlignerSetID || 'general'}, Amount: ${Amountpaid}`
  );

  try {
    const invoiceID = (await alignerQueries.createAlignerPayment(
      paymentData
    )) as number;
    log.info(`Payment added successfully: Invoice ${invoiceID}`);
    return invoiceID;
  } catch (error) {
    log.error('Error adding payment:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// ==============================
// ALIGNER PATIENTS SEARCH LOGIC
// ==============================

/**
 * Search for aligner patients with validation
 *
 * Business Rules:
 * - Search term must be at least 2 characters
 *
 * @param searchTerm - Search term
 * @param doctorId - Optional doctor ID
 * @returns Array of patients
 * @throws AlignerValidationError If validation fails
 */
export async function searchPatients(
  searchTerm: string,
  doctorId: number | null = null
): Promise<AlignerPatientSearchResult[]> {
  if (!searchTerm || searchTerm.trim().length < 2) {
    throw new AlignerValidationError(
      'Search term must be at least 2 characters',
      'INVALID_SEARCH_TERM'
    );
  }

  const trimmedSearch = searchTerm.trim();
  log.info(
    `Searching for aligner patients: ${trimmedSearch}${doctorId ? ` (Doctor ID: ${doctorId})` : ''}`
  );

  try {
    return (await alignerQueries.searchAlignerPatients(
      trimmedSearch,
      doctorId
    )) as AlignerPatientSearchResult[];
  } catch (error) {
    log.error('Error searching aligner patients:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

// Export all functions
export default {
  // Sets
  validateAndCreateSet,
  validateAndUpdateSet,
  validateAndDeleteSet,

  // Batches
  validateAndCreateBatch,
  validateAndUpdateBatch,
  validateAndDeleteBatch,
  markBatchDelivered,
  markBatchManufactured,
  undoManufactureBatch,
  undoDeliverBatch,

  // Doctors
  validateAndCreateDoctor,
  validateAndUpdateDoctor,
  validateAndDeleteDoctor,

  // Notes
  validateAndCreateNote,
  validateAndUpdateNote,
  validateAndDeleteNote,

  // Payments
  validateAndCreatePayment,

  // Search
  searchPatients,

  // Error class
  AlignerValidationError,
};
