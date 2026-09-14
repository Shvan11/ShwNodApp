/**
 * Aligner BATCH business logic — creating and editing a batch, and moving it through
 * the manufacture/deliver lifecycle (with undo for both).
 *
 * Split out of AlignerService.ts (S2/C4). NB the set's `remaining_*_aligners` means
 * NOT-YET-BATCHED (consumed at batch creation) — never derive "delivered" from
 * total − remaining; use the per-batch delivered sums.
 */

import { log } from '../../utils/logger.js';
import { toDateOnly } from '../../utils/date.js';
import * as alignerBatchQueries from '../database/queries/aligner-batch-queries.js';
import * as alignerSetQueries from '../database/queries/aligner-set-queries.js';
import { AlignerValidationError, type AlignerErrorCode } from './AlignerErrors.js';

/**
 * Batch creation data
 *
 * Server-derived, so deliberately NOT accepted from the caller: `batch_sequence`
 * and the four upper/lower start/end sequences (createBatch computes them from
 * MAX() over the set's existing batches), `batch_expiry_date`/`validity_period`
 * (generated columns), and the retired `AlignersInBatch`.
 */
export interface BatchCreateData {
  aligner_set_id: number;
  is_active?: boolean;
  is_last?: boolean;
  notes?: string;
  upper_aligner_count?: number;
  lower_aligner_count?: number;
  days?: number;
  has_upper_template?: boolean;
  has_lower_template?: boolean;
}

/**
 * Batch update data
 *
 * Same server-derived exclusions as BatchCreateData. manufacture_date and
 * delivered_to_patient_date are managed via markBatchManufactured/markBatchDelivered.
 *
 * A FULL REPLACE, not a partial patch: `updateBatch` writes every editable column
 * unconditionally, so an omitted count persists as 0 and an omitted days/notes as
 * NULL. `aligner_set_id` is REQUIRED and identifies the owning set — the query layer
 * rejects a value that differs from the stored one (a batch cannot move between
 * sets), so omitting it used to 400 with a misleading "Cannot change aligner_set_id".
 */
export interface BatchUpdateData {
  aligner_set_id: number;
  is_active?: boolean;
  notes?: string;
  upper_aligner_count?: number;
  lower_aligner_count?: number;
  days?: number;
  is_last?: boolean;
  has_upper_template?: boolean;
  has_lower_template?: boolean;
}

/**
 * Batch update result — mirrors `aligner-batch-queries.updateBatch`'s return EXACTLY:
 * `{ deactivatedBatch }` when activating this batch turned another one off, else
 * `null`. (This used to declare `deactivatedBatch` as an optional `{ batchSequence }`
 * and was reached via an `as` cast, which both dropped `batchId` from the type and
 * mis-modelled the no-deactivation case as `void` when the query returns `null`.)
 */
export interface BatchUpdateResult {
  deactivatedBatch: DeactivatedBatchInfo;
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
  const days = parseOptionalDays(batchData.days);

  // A batch with no aligners on either arch is meaningless.
  if (upperCount <= 0 && lowerCount <= 0) {
    throw new AlignerValidationError(
      'Enter an upper or lower aligner count',
      'VALIDATION_ERROR'
    );
  }

  // Verify set exists
  const setExists = await alignerSetQueries.getAlignerSetById(aligner_set_id);
  if (!setExists) {
    throw new AlignerValidationError('Aligner set not found', 'SET_NOT_FOUND', {
      setId: aligner_set_id,
    });
  }

  // Check for currently active batch (before creating new one)
  let deactivatedBatch: DeactivatedBatchInfo | null = null;
  if (is_active) {
    const batches = await alignerBatchQueries.getBatchesBySetId(aligner_set_id);
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

  // Persist the values we just validated, not the raw request ones — otherwise the
  // checks above and the stored row are derived by two different code paths (the
  // query layer's `toIntOr` safety net would re-coerce the originals).
  const newBatchId = (await alignerBatchQueries.createBatch({
    ...batchData,
    upper_aligner_count: upperCount,
    lower_aligner_count: lowerCount,
    days,
  })) as number;
  log.info(`Aligner batch created successfully: Batch ${newBatchId}`);

  return {
    newBatchId,
    deactivatedBatch,
  };
}

/**
 * Map a batch-update business-rule message to its AlignerErrorCode.
 *
 * `aligner-batch-queries.ts#updateBatch` throws plain `Error`s for validation failures
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
  if (message.includes('would be renumbered')) return 'SEQUENCE_LOCKED';
  if (
    message.startsWith('Template flag') ||
    message.includes('requires upper_aligner_count') ||
    message.includes('requires lower_aligner_count')
  )
    return 'VALIDATION_ERROR';
  return null;
}

/**
 * Map the plain `Error` messages thrown by `aligner-batch-queries.ts#updateBatchStatus`
 * (MANUFACTURE/DELIVER) onto typed error codes, so the status routes return a
 * 400 with a clear reason instead of a generic 500. Kept in sync with the throws
 * in `updateBatchStatus`. Returns null for unrecognised (infrastructure) errors.
 */
function mapBatchStatusError(message: string): AlignerErrorCode | null {
  if (message === 'Aligner batch not found') return 'BATCH_NOT_FOUND';
  if (message === 'Cannot deliver: batch not yet manufactured')
    return 'BATCH_NOT_MANUFACTURED';
  if (
    message.startsWith('Cannot deliver: delivery date cannot be earlier') ||
    message.startsWith('Cannot set manufacture date later')
  )
    return 'INVALID_DATE_ORDER';
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
): Promise<BatchUpdateResult | null> {
  if (!batchId || isNaN(parseInt(String(batchId), 10))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  const parsedBatchId = parseInt(String(batchId), 10);

  // This PUT is a FULL REPLACE, not a partial patch: `updateBatch` writes every
  // editable column unconditionally, so an omitted count is persisted as 0 and an
  // omitted days/notes as NULL. Validate on that basis — an absent count IS a
  // request to set that arch to 0, so the checks run unconditionally rather than
  // only when the field happens to be present (which let an omit-both PUT through
  // to write a meaningless 0/0 batch).
  const upperCount = parseOptionalCount(
    batchData.upper_aligner_count,
    'Upper aligner count'
  );
  const lowerCount = parseOptionalCount(
    batchData.lower_aligner_count,
    'Lower aligner count'
  );
  const days = parseOptionalDays(batchData.days);

  // A 0/0 batch is meaningless (mirrors create).
  if (upperCount <= 0 && lowerCount <= 0) {
    throw new AlignerValidationError(
      'Enter an upper or lower aligner count',
      'VALIDATION_ERROR'
    );
  }

  log.info(`Updating aligner batch ${batchId}:`, batchData);

  try {
    // Persist the validated values (see validateAndCreateBatch).
    const result = await alignerBatchQueries.updateBatch(parsedBatchId, {
      ...batchData,
      upper_aligner_count: upperCount,
      lower_aligner_count: lowerCount,
      days,
    });
    log.info(`Aligner batch ${batchId} updated successfully`);

    if (result && result.deactivatedBatch) {
      log.info(
        `Batch #${result.deactivatedBatch.batchSequence} was automatically deactivated`
      );
    }

    return result;
  } catch (error) {
    // updateBatch (aligner-batch-queries.ts) throws plain Error()s for business-rule
    // violations — the old usp_UpdateAlignerBatch numeric RAISERROR codes are gone
    // under pg. Translate the recognised messages into typed AlignerValidationErrors
    // so the route returns a 400 with a code instead of a generic 500.
    if (error instanceof AlignerValidationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = mapBatchUpdateError(message);
    if (errorCode) {
      throw new AlignerValidationError(message, errorCode, {
        batchId: parsedBatchId,
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
  if (!batchId || isNaN(parseInt(String(batchId), 10))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  const parsedBatchId = parseInt(String(batchId), 10);

  log.info(`Deleting aligner batch ${batchId}`);

  try {
    await alignerBatchQueries.deleteBatch(parsedBatchId);
    log.info(`Aligner batch ${batchId} deleted successfully`);
  } catch (error) {
    log.error('Error deleting aligner batch:', { error: error instanceof Error ? error.message : String(error) });
    // Translate the query layer's business-rule Errors into typed 400s (same
    // convention as mapBatchUpdateError for updates).
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Aligner batch not found') {
      throw new AlignerValidationError(message, 'BATCH_NOT_FOUND', {
        batchId: parsedBatchId,
      });
    }
    if (message.includes('would be renumbered')) {
      throw new AlignerValidationError(message, 'SEQUENCE_LOCKED', {
        batchId: parsedBatchId,
      });
    }
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
 * @param targetDate - Optional date for backdating/correction. If null, uses today's date.
 *                     Pass the contract's 'YYYY-MM-DD' string THROUGH — see toDateOnly.
 * @returns Result with operation info and activation status
 * @throws AlignerValidationError If validation fails
 */
export async function markBatchDelivered(
  batchId: number | string,
  targetDate?: Date | string | null
): Promise<alignerBatchQueries.UpdateBatchStatusResult> {
  if (!batchId || isNaN(parseInt(String(batchId), 10))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  const parsedBatchId = parseInt(String(batchId), 10);
  log.info(`Marking batch ${parsedBatchId} as delivered`, { targetDate: toDateOnly(targetDate) || 'today' });

  try {
    const result = await alignerBatchQueries.updateBatchStatus(parsedBatchId, 'DELIVER', targetDate);

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
    // updateBatchStatus throws plain Error()s for business-rule violations;
    // translate the recognised ones to a typed 400 (see mapBatchStatusError).
    if (error instanceof AlignerValidationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = mapBatchStatusError(message);
    if (errorCode) {
      throw new AlignerValidationError(message, errorCode, { batchId: parsedBatchId });
    }
    log.error('Error marking batch as delivered:', { error: message });
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
 * @param targetDate - Optional date for backdating/correction. If null, uses today's date.
 *                     Pass the contract's 'YYYY-MM-DD' string THROUGH — see toDateOnly.
 * @returns Result with operation info
 * @throws AlignerValidationError If validation fails
 */
export async function markBatchManufactured(
  batchId: number | string,
  targetDate?: Date | string | null
): Promise<alignerBatchQueries.UpdateBatchStatusResult> {
  if (!batchId || isNaN(parseInt(String(batchId), 10))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  const parsedBatchId = parseInt(String(batchId), 10);
  log.info(`Marking batch ${parsedBatchId} as manufactured`, { targetDate: toDateOnly(targetDate) || 'today' });

  try {
    const result = await alignerBatchQueries.updateBatchStatus(parsedBatchId, 'MANUFACTURE', targetDate);
    log.info(`Batch ${parsedBatchId}: ${result.message}`);
    return result;
  } catch (error) {
    // updateBatchStatus throws plain Error()s for business-rule violations;
    // translate the recognised ones to a typed 400 (see mapBatchStatusError).
    if (error instanceof AlignerValidationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = mapBatchStatusError(message);
    if (errorCode) {
      throw new AlignerValidationError(message, errorCode, { batchId: parsedBatchId });
    }
    log.error('Error marking batch as manufactured:', { error: message });
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
): Promise<alignerBatchQueries.UpdateBatchStatusResult> {
  if (!batchId || isNaN(parseInt(String(batchId), 10))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  const parsedBatchId = parseInt(String(batchId), 10);
  log.info(`Undoing manufacture for batch ${parsedBatchId}`);

  try {
    const result = await alignerBatchQueries.updateBatchStatus(parsedBatchId, 'UNDO_MANUFACTURE');
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
): Promise<alignerBatchQueries.UpdateBatchStatusResult> {
  if (!batchId || isNaN(parseInt(String(batchId), 10))) {
    throw new AlignerValidationError(
      'Valid batchId is required',
      'INVALID_BATCH_ID'
    );
  }

  const parsedBatchId = parseInt(String(batchId), 10);
  log.info(`Undoing delivery for batch ${parsedBatchId}`);

  try {
    const result = await alignerBatchQueries.updateBatchStatus(parsedBatchId, 'UNDO_DELIVERY');
    log.info(`Batch ${parsedBatchId}: ${result.message}`);
    return result;
  } catch (error) {
    log.error('Error undoing delivery:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
