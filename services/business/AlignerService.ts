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
  | 'SET_COST_BELOW_PAID'
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
  work_id: number;
  aligner_dr_id: number;
  is_active?: boolean;
  TotalAligners?: number;
  RemainingAligners?: number;
  set_cost?: number;
  notes?: string;
  set_sequence?: number;
  type?: string;
  upper_aligners_count?: number;
  lower_aligners_count?: number;
}

/**
 * Set update data
 */
export interface SetUpdateData {
  aligner_dr_id?: number;
  is_active?: boolean;
  TotalAligners?: number;
  RemainingAligners?: number;
  set_cost?: number;
  notes?: string;
  set_sequence?: number;
  type?: string;
  upper_aligners_count?: number;
  lower_aligners_count?: number;
}

/**
 * Batch creation data
 */
export interface BatchCreateData {
  aligner_set_id: number;
  is_active?: boolean;
  batch_sequence?: number;
  AlignersInBatch?: number;
  notes?: string;
  upper_aligner_count?: number;
  lower_aligner_count?: number;
  upper_aligner_start_sequence?: number;
  upper_aligner_end_sequence?: number;
  lower_aligner_start_sequence?: number;
  lower_aligner_end_sequence?: number;
  days?: number;
  validity_period?: number;
  has_upper_template?: boolean;
  has_lower_template?: boolean;
}

/**
 * Batch update data
 * NOTE: manufacture_date and delivered_to_patient_date are managed via markBatchManufactured/markBatchDelivered
 */
export interface BatchUpdateData {
  aligner_set_id?: number;
  is_active?: boolean;
  batch_sequence?: number;
  AlignersInBatch?: number;
  // manufacture_date and delivered_to_patient_date are managed via status endpoints
  notes?: string;
  upper_aligner_count?: number;
  lower_aligner_count?: number;
  upper_aligner_start_sequence?: number;
  upper_aligner_end_sequence?: number;
  lower_aligner_start_sequence?: number;
  lower_aligner_end_sequence?: number;
  days?: number;
  is_last?: boolean;
  has_upper_template?: boolean;
  has_lower_template?: boolean;
  // note: batch_expiry_date and validity_period are computed columns - cannot be set directly
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
  doctor_name: string;
  doctor_email?: string;
  DoctorPhone?: string;
  is_active?: boolean;
  Address?: string;
  notes?: string;
}

/**
 * Doctor update data
 */
export interface DoctorUpdateData {
  doctor_name: string;
  doctor_email?: string;
  DoctorPhone?: string;
  is_active?: boolean;
  Address?: string;
  notes?: string;
}

/**
 * Payment creation data
 */
export interface PaymentCreateData {
  workid: number;
  aligner_set_id: number;
  amount_paid: number | string;
  date_of_payment: string;
  usd_received?: number;
  iqd_received?: number;
  change?: number;
  notes?: string;
}

/**
 * Set balance info
 */
interface SetBalanceInfo {
  set_cost: number | null;
  TotalPaid: number;
  Balance: number;
}

/**
 * Batch info for deactivation check
 */
interface BatchInfo {
  aligner_batch_id: number;
  batch_sequence: number;
  is_active: boolean;
}

/**
 * Aligner patient search result
 */
export interface AlignerPatientSearchResult {
  person_id: number;
  patient_name: string;
  phone?: string | null;
  work_id?: number;
  doctor_name?: string | null;
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
 * - work_id and aligner_dr_id are required
 * - If creating an active set (is_active = 1), deactivates all other sets for the same work
 * - Initializes remaining aligners count equal to total count
 * - Sets creation date automatically
 *
 * @param setData - Set data
 * @returns New set id
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreateSet(
  setData: SetCreateData
): Promise<number> {
  const startTime = Date.now();
  const { work_id, aligner_dr_id } = setData;

  // Validation
  if (!work_id || !aligner_dr_id) {
    throw new AlignerValidationError(
      'work_id and aligner_dr_id are required',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  // Sanitize numeric fields - convert empty strings to undefined
  const sanitizedData: SetCreateData = {
    ...setData,
    set_cost: setData.set_cost !== undefined && setData.set_cost !== null && String(setData.set_cost) !== ''
      ? Number(setData.set_cost)
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
      `Aligner set created successfully: Set ${newSetId} for Work ${work_id}`
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
 * - If provided, aligner_dr_id must be valid
 *
 * @param setId - Set id
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
    set_cost: setData.set_cost !== undefined && setData.set_cost !== null && String(setData.set_cost) !== ''
      ? Number(setData.set_cost)
      : undefined,
  };

  // Re-enforce the dropped CK_MoreThanTotalW invariant in TS: a set's cost must never
  // drop below what's already been paid for it, otherwise the set becomes overpaid.
  if (sanitizedData.set_cost !== undefined) {
    const balance = await alignerQueries.getAlignerSetBalance(parseInt(String(setId)));
    const alreadyPaid = Number(balance?.TotalPaid ?? 0);
    if (Number(sanitizedData.set_cost) < alreadyPaid) {
      throw new AlignerValidationError(
        `Set cost (${sanitizedData.set_cost}) cannot be less than the amount already paid for this set (${alreadyPaid}).`,
        'SET_COST_BELOW_PAID',
        {
          setId: parseInt(String(setId)),
          setCost: Number(sanitizedData.set_cost),
          alreadyPaid,
        }
      );
    }
  }

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
 * @param setId - Set id
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
    // Batches + set deleted atomically in one transaction (batches first for the FK).
    await alignerQueries.deleteSetWithBatches(parsedSetId);

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
 * - aligner_set_id is required
 * - Set must exist
 * - If is_active=1, automatically deactivates other active batches for the same set
 *
 * @param batchData - Batch data
 * @returns Object with newBatchId and deactivatedBatch info
 * @throws AlignerValidationError If validation fails
 */
/**
 * Parse an optional aligner count from request input.
 *
 * Blank (`''` / null / undefined) → 0: the count is optional, e.g. a
 * single-arch batch leaves one side empty. A *present* but non-numeric,
 * negative, or fractional value is a client mistake → 400 (caller surfaces
 * it via the route's AlignerValidationError → badRequest mapping). This is the
 * friendly counterpart to the query layer's `toIntOr` safety-net coercion.
 */
function parseOptionalCount(value: unknown, label: string): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new AlignerValidationError(
      `${label} must be a whole number of 0 or more`,
      'VALIDATION_ERROR'
    );
  }
  return n;
}

/**
 * Parse the optional "days per aligner" value. Blank → null (unset);
 * a present value must be a whole number of 1 or more.
 */
function parseOptionalDays(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new AlignerValidationError(
      'Days per aligner must be a whole number of 1 or more',
      'VALIDATION_ERROR'
    );
  }
  return n;
}

export async function validateAndCreateBatch(
  batchData: BatchCreateData
): Promise<CreateBatchResult> {
  const { aligner_set_id, is_active } = batchData;

  if (!aligner_set_id) {
    throw new AlignerValidationError(
      'aligner_set_id is required',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  // Validate numeric inputs up front so a blank/garbage field returns a
  // friendly 400 instead of a raw PG 22P02 (or a silently-defaulted batch).
  const upperCount = parseOptionalCount(
    batchData.upper_aligner_count,
    'Upper aligner count'
  );
  const lowerCount = parseOptionalCount(
    batchData.lower_aligner_count,
    'Lower aligner count'
  );
  parseOptionalDays(batchData.days); // format check; value applied in createBatch

  // A batch with no aligners on either arch is meaningless.
  if (upperCount <= 0 && lowerCount <= 0) {
    throw new AlignerValidationError(
      'Enter an upper or lower aligner count',
      'VALIDATION_ERROR'
    );
  }

  // Verify set exists
  const setExists = await alignerQueries.getAlignerSetById(aligner_set_id);
  if (!setExists) {
    throw new AlignerValidationError('Aligner set not found', 'SET_NOT_FOUND', {
      setId: aligner_set_id,
    });
  }

  // Check for currently active batch (before creating new one)
  let deactivatedBatch: DeactivatedBatchInfo | null = null;
  if (is_active) {
    const batches = (await alignerQueries.getBatchesBySetId(
      aligner_set_id
    )) as BatchInfo[];
    const activeBatch = batches.find((b) => b.is_active);
    if (activeBatch) {
      deactivatedBatch = {
        batchId: activeBatch.aligner_batch_id,
        batchSequence: activeBatch.batch_sequence,
      };
      log.info(
        `Batch #${activeBatch.batch_sequence} will be deactivated when creating new active batch`
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
 * Map a batch-update business-rule message to its AlignerErrorCode.
 *
 * `aligner-queries.ts#updateBatch` throws plain `Error`s for validation failures
 * — the replacement for the deleted `usp_UpdateAlignerBatch` RAISERROR codes
 * 50010-50020. Under pg there is no numeric `err.number`, so we key off the
 * message text the query layer throws (kept in sync with `updateBatch`). Returns
 * null for messages that aren't recognised batch-validation errors.
 */
function mapBatchUpdateError(message: string): AlignerErrorCode | null {
  if (message === 'Aligner batch not found') return 'BATCH_NOT_FOUND';
  if (message === 'Cannot change aligner_set_id') return 'INVALID_SET_CHANGE';
  if (message.startsWith('Cannot update aligner batch: requested upper'))
    return 'UPPER_ALIGNER_LIMIT_EXCEEDED';
  if (message.startsWith('Cannot update aligner batch: requested lower'))
    return 'LOWER_ALIGNER_LIMIT_EXCEEDED';
  if (message === 'Cannot set is_active: batch must be delivered first')
    return 'BATCH_NOT_DELIVERED';
  if (
    message.startsWith('Template flag') ||
    message.includes('requires upper_aligner_count') ||
    message.includes('requires lower_aligner_count')
  )
    return 'VALIDATION_ERROR';
  return null;
}

/**
 * Validate and update a batch
 *
 * Business Rules:
 * - Batch must exist (implicit through update)
 *
 * @param batchId - Batch id
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

  // Validate the numeric fields that were supplied (a PUT may be partial — e.g.
  // toggling is_active only — so unsupplied fields keep their stored values). A
  // blank/garbage value returns a friendly 400 instead of a raw PG 22P02.
  const hasUpper = batchData.upper_aligner_count !== undefined;
  const hasLower = batchData.lower_aligner_count !== undefined;
  const upperCount = hasUpper
    ? parseOptionalCount(batchData.upper_aligner_count, 'Upper aligner count')
    : null;
  const lowerCount = hasLower
    ? parseOptionalCount(batchData.lower_aligner_count, 'Lower aligner count')
    : null;
  if (batchData.days !== undefined) parseOptionalDays(batchData.days);

  // When both counts are being set, a 0/0 batch is meaningless (mirror create).
  if (hasUpper && hasLower && (upperCount ?? 0) <= 0 && (lowerCount ?? 0) <= 0) {
    throw new AlignerValidationError(
      'Enter an upper or lower aligner count',
      'VALIDATION_ERROR'
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
    // updateBatch (aligner-queries.ts) throws plain Error()s for business-rule
    // violations — the old usp_UpdateAlignerBatch numeric RAISERROR codes are gone
    // under pg. Translate the recognised messages into typed AlignerValidationErrors
    // so the route returns a 400 with a code instead of a generic 500.
    if (error instanceof AlignerValidationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = mapBatchUpdateError(message);
    if (errorCode) {
      throw new AlignerValidationError(message, errorCode, {
        batchId: parseInt(String(batchId)),
      });
    }
    // Re-throw unexpected (infrastructure) errors as-is
    throw error;
  }
}

/**
 * Validate and delete a batch
 *
 * Business Rules:
 * - Batch must exist (implicit through delete)
 *
 * @param batchId - Batch id
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
 * - Sets delivered_to_patient_date = GETDATE()
 * - batch_expiry_date is auto-computed from delivered_to_patient_date + (days * AlignerCount)
 * - If batch is latest (highest batch_sequence) AND not already active:
 *   - Deactivates other batches in the set
 *   - Activates this batch
 *
 * @param batchId - Batch id
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
 * - If no targetDate and manufacture_date already set, returns "already manufactured" (idempotent)
 * - If targetDate provided and manufacture_date already set, updates date (allows correction)
 *
 * @param batchId - Batch id
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
 * Undo manufacture - clears manufacture_date
 *
 * Business Rules:
 * - Batch must exist
 * - Batch must not be delivered (undo delivery first)
 *
 * @param batchId - Batch id
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
 * Undo delivery - clears delivered_to_patient_date and batch_expiry_date
 *
 * Business Rules:
 * - Batch must exist
 * - Clears delivery date and expiry date, keeps manufacture date
 *
 * @param batchId - Batch id
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
 * - email must be unique (if provided)
 *
 * @param doctorData - Doctor data
 * @returns New doctor id
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreateDoctor(
  doctorData: DoctorCreateData
): Promise<number> {
  const { doctor_name, doctor_email } = doctorData;

  if (!doctor_name || doctor_name.trim() === '') {
    throw new AlignerValidationError(
      'Doctor name is required',
      'MISSING_DOCTOR_NAME'
    );
  }

  // Business Rule: email must be unique (only check if email is provided)
  const emailExists = doctor_email ? await alignerQueries.isDoctorEmailTaken(doctor_email) : false;
  if (emailExists) {
    throw new AlignerValidationError(
      'A doctor with this email already exists',
      'EMAIL_ALREADY_EXISTS',
      { email: doctor_email }
    );
  }

  try {
    const newDrID = (await alignerQueries.createDoctor(doctorData)) as number;
    log.info(
      `Aligner doctor created successfully: Dr ${newDrID} - ${doctor_name}`
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
 * - email must be unique among other doctors (if provided)
 *
 * @param drID - Doctor id
 * @param doctorData - Doctor data
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndUpdateDoctor(
  drID: number | string,
  doctorData: DoctorUpdateData
): Promise<void> {
  const { doctor_name, doctor_email } = doctorData;

  if (!doctor_name || doctor_name.trim() === '') {
    throw new AlignerValidationError(
      'Doctor name is required',
      'MISSING_DOCTOR_NAME'
    );
  }

  // Business Rule: email must be unique (excluding this doctor, only check if email is provided)
  const emailExists = doctor_email
    ? await alignerQueries.isDoctorEmailTaken(doctor_email, parseInt(String(drID)))
    : false;
  if (emailExists) {
    throw new AlignerValidationError(
      'Another doctor with this email already exists',
      'EMAIL_ALREADY_EXISTS',
      { email: doctor_email }
    );
  }

  try {
    await alignerQueries.updateDoctor(parseInt(String(drID)), doctorData);
    log.info(
      `Aligner doctor updated successfully: Dr ${drID} - ${doctor_name}`
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
 * @param drID - Doctor id
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
 * - note text is required
 *
 * @param setId - Set id
 * @param noteText - note text
 * @returns New note id
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
      'note text is required',
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
 * - note must exist
 * - note text is required
 *
 * @param noteId - note id
 * @param noteText - note text
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
      'note text is required',
      'MISSING_NOTE_TEXT'
    );
  }

  // Verify note exists
  const existingNote = await alignerQueries.getNoteById(
    parseInt(String(noteId))
  );
  if (!existingNote) {
    throw new AlignerValidationError('note not found', 'NOTE_NOT_FOUND', {
      noteId: parseInt(String(noteId)),
    });
  }

  try {
    await alignerQueries.updateNote(parseInt(String(noteId)), noteText);
    log.info(`note ${noteId} updated`);
  } catch (error) {
    log.error('Error updating note:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Validate and delete a note
 *
 * Business Rules:
 * - note must exist
 *
 * @param noteId - note id
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
    throw new AlignerValidationError('note not found', 'NOTE_NOT_FOUND', {
      noteId: parseInt(String(noteId)),
    });
  }

  try {
    await alignerQueries.deleteNote(parseInt(String(noteId)));
    log.info(`note ${noteId} deleted`);
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
 * - workid, amount_paid, and date_of_payment are required
 *
 * @param paymentData - Payment data
 * @returns New invoice id
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreatePayment(
  paymentData: PaymentCreateData
): Promise<number> {
  const { workid, aligner_set_id, amount_paid, date_of_payment } = paymentData;

  if (!workid || !amount_paid || !date_of_payment) {
    throw new AlignerValidationError(
      'workid, amount_paid, and date_of_payment are required',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  // Validate payment doesn't exceed set balance
  if (aligner_set_id) {
    const setBalance = (await alignerQueries.getAlignerSetBalance(
      aligner_set_id
    )) as SetBalanceInfo | null;

    if (!setBalance) {
      throw new AlignerValidationError(
        'Aligner set not found',
        'SET_NOT_FOUND'
      );
    }

    if (setBalance.set_cost === null) {
      throw new AlignerValidationError(
        'Set cost must be defined before accepting payments',
        'SET_COST_NOT_DEFINED'
      );
    }

    const paymentAmount = parseFloat(String(amount_paid));

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
    `Adding payment for work id: ${workid}, Set id: ${aligner_set_id || 'general'}, amount: ${amount_paid}`
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
 * @param doctorId - Optional doctor id
 * @returns Array of patients
 * @throws AlignerValidationError If validation fails
 */
export async function searchPatients(
  searchTerm: string,
  doctorId: number | null = null
) {
  if (!searchTerm || searchTerm.trim().length < 2) {
    throw new AlignerValidationError(
      'Search term must be at least 2 characters',
      'INVALID_SEARCH_TERM'
    );
  }

  const trimmedSearch = searchTerm.trim();
  log.info(
    `Searching for aligner patients: ${trimmedSearch}${doctorId ? ` (Doctor id: ${doctorId})` : ''}`
  );

  try {
    return alignerQueries.searchAlignerPatients(trimmedSearch, doctorId);
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

  // notes
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
