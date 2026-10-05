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
 * A PARTIAL update: an omitted field keeps its stored value (FE-F17-1 — it was a
 * full replace, so a page loaded before the doctor changed `days` in the portal
 * wrote the old days back). `days: null` clears it. `aligner_set_id`, when sent,
 * must equal the stored set (a batch cannot move between sets).
 */
export interface BatchUpdateData {
  aligner_set_id?: number;
  is_active?: boolean;
  notes?: string;
  upper_aligner_count?: number;
  lower_aligner_count?: number;
  days?: number | null;
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
  const newBatchId = (await withMappedBatchErrors({ setId: aligner_set_id }, () =>
    alignerBatchQueries.createBatch({
      ...batchData,
      upper_aligner_count: upperCount,
      lower_aligner_count: lowerCount,
      days,
    })
  )) as number;
  log.info(`Aligner batch created successfully: Batch ${newBatchId}`);

  return {
    newBatchId,
    deactivatedBatch,
  };
}

/**
 * Map a business-rule message thrown by `aligner-batch-queries.ts` onto its `AlignerErrorCode`.
 *
 * ONE map for every batch path — create, update, delete and all four status transitions — because
 * three partial maps is how the gaps happened (audit finding F3). Until 2026-09-15 `create` and the
 * two undo paths had no mapping at all, so the commonest data-entry mistake at the front desk
 * ("this batch needs more aligners than the set has left") answered *500 Failed to create aligner
 * batch* with the real message — `requested upper aligners (12) exceed remaining count (8)` —
 * discarded. And the update map keyed on `'Cannot update aligner batch: requested upper'` while
 * create throws `'Cannot ADD aligner batch: …'`, so wiring the old map into create would have
 * matched nothing.
 *
 * The query layer throws plain `Error`s (the replacement for the deleted stored procedures' numeric
 * RAISERROR codes, which have no equivalent under pg), so the message text IS the contract between
 * the two layers. Keep this in sync with the `throw new Error` sites in aligner-batch-queries.ts;
 * an unrecognised message returns null and stays a 500, which is correct for an infrastructure
 * fault and wrong for a business rule — so a new rule belongs here in the same commit.
 */
function mapBatchError(message: string): AlignerErrorCode | null {
  // -- existence ------------------------------------------------------------------------------
  if (message === 'Aligner batch not found') return 'BATCH_NOT_FOUND';
  if (message === 'AlignerSet not found') return 'SET_NOT_FOUND';
  if (message.startsWith('AlignerSet has no aligner counts set')) return 'SET_COUNTS_NOT_DEFINED';
  if (message === 'Cannot change aligner_set_id') return 'INVALID_SET_CHANGE';

  // -- capacity: create says "add", update says "update"; both are the same rule to a caller ---
  if (
    message.startsWith('Cannot add aligner batch: requested upper') ||
    message.startsWith('Cannot update aligner batch: requested upper')
  )
    return 'UPPER_ALIGNER_LIMIT_EXCEEDED';
  if (
    message.startsWith('Cannot add aligner batch: requested lower') ||
    message.startsWith('Cannot update aligner batch: requested lower')
  )
    return 'LOWER_ALIGNER_LIMIT_EXCEEDED';

  // -- lifecycle ------------------------------------------------------------------------------
  if (message === 'Cannot set is_active: batch must be delivered first') return 'BATCH_NOT_DELIVERED';
  if (message === 'Cannot deliver: batch not yet manufactured') return 'BATCH_NOT_MANUFACTURED';
  if (message.startsWith('Cannot undo manufacture: batch already delivered')) return 'BATCH_ALREADY_DELIVERED';
  if (
    message.startsWith('Cannot deliver: delivery date cannot be earlier') ||
    message.startsWith('Cannot set manufacture date later')
  )
    return 'INVALID_DATE_ORDER';

  // -- sequence integrity (update AND delete both refuse to renumber a locked batch) -----------
  if (message.includes('would be renumbered')) return 'SEQUENCE_LOCKED';

  // -- template flags / counts ----------------------------------------------------------------
  if (
    message === 'Enter an upper or lower aligner count' ||
    message.startsWith('Template flag') ||
    message.includes('requires upper_aligner_count') ||
    message.includes('requires lower_aligner_count')
  )
    return 'VALIDATION_ERROR';

  return null;
}

/**
 * Run a batch query-layer call and convert its business-rule `Error` into a typed
 * `AlignerValidationError` (which the routes answer as 400 + code). Anything unrecognised is
 * re-thrown untouched so a genuine infrastructure fault still surfaces as a 500.
 *
 * Every batch write goes through this — that is the point. A path that calls the query layer
 * directly is a path whose business rules become 500s, which is exactly the state F3 found.
 */
async function withMappedBatchErrors<T>(
  details: { batchId?: number; setId?: number },
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AlignerValidationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const code = mapBatchError(message);
    if (code) throw new AlignerValidationError(message, code, details);
    throw error;
  }
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

  // PARTIAL: only the fields present are validated and written; the rest keep
  // their stored values (FE-F17-1). The 0/0 rule needs the stored counts, so the
  // query layer checks the RESULTING pair ("Enter an upper or lower aligner count").
  const has = (key: keyof BatchUpdateData) => Object.prototype.hasOwnProperty.call(batchData, key) && batchData[key] !== undefined;
  const update: BatchUpdateData = { ...batchData };
  if (has('upper_aligner_count')) {
    update.upper_aligner_count = parseOptionalCount(batchData.upper_aligner_count, 'Upper aligner count');
  }
  if (has('lower_aligner_count')) {
    update.lower_aligner_count = parseOptionalCount(batchData.lower_aligner_count, 'Lower aligner count');
  }
  if (Object.prototype.hasOwnProperty.call(batchData, 'days')) {
    update.days = batchData.days === undefined ? undefined : parseOptionalDays(batchData.days);
  }

  log.info(`Updating aligner batch ${batchId}:`, batchData);

  // Persist the validated values (see validateAndCreateBatch).
  const result = await withMappedBatchErrors({ batchId: parsedBatchId }, () =>
    alignerBatchQueries.updateBatch(parsedBatchId, update)
  );
  log.info(`Aligner batch ${batchId} updated successfully`);

  if (result && result.deactivatedBatch) {
    log.info(
      `Batch #${result.deactivatedBatch.batchSequence} was automatically deactivated`
    );
  }

  return result;
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

  await withMappedBatchErrors({ batchId: parsedBatchId }, () =>
    alignerBatchQueries.deleteBatch(parsedBatchId)
  );
  log.info(`Aligner batch ${batchId} deleted successfully`);
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

  const result = await withMappedBatchErrors({ batchId: parsedBatchId }, () =>
    alignerBatchQueries.updateBatchStatus(parsedBatchId, 'DELIVER', targetDate)
  );

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

  const result = await withMappedBatchErrors({ batchId: parsedBatchId }, () =>
    alignerBatchQueries.updateBatchStatus(parsedBatchId, 'MANUFACTURE', targetDate)
  );
  log.info(`Batch ${parsedBatchId}: ${result.message}`);
  return result;
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

  const result = await withMappedBatchErrors({ batchId: parsedBatchId }, () =>
    alignerBatchQueries.updateBatchStatus(parsedBatchId, 'UNDO_MANUFACTURE')
  );
  log.info(`Batch ${parsedBatchId}: ${result.message}`);
  return result;
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

  const result = await withMappedBatchErrors({ batchId: parsedBatchId }, () =>
    alignerBatchQueries.updateBatchStatus(parsedBatchId, 'UNDO_DELIVERY')
  );
  log.info(`Batch ${parsedBatchId}: ${result.message}`);
  return result;
}
