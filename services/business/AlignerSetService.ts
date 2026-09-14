/**
 * Aligner SET business logic — creating, updating and deleting an aligner set.
 *
 * Split out of AlignerService.ts (S2/C4). This layer sits between the route handlers
 * and the query modules, encapsulating business rules and validation.
 */

import { log } from '../../utils/logger.js';
import * as alignerPaymentQueries from '../database/queries/aligner-payment-queries.js';
import * as alignerSetQueries from '../database/queries/aligner-set-queries.js';
import { AlignerValidationError } from './AlignerErrors.js';

/**
 * Set creation data
 *
 * NB the retired SQL-Server-era `TotalAligners`/`RemainingAligners` are NOT here:
 * `createAlignerSet` seeds `remaining_upper_aligners`/`remaining_lower_aligners`
 * from the upper/lower counts and never read them.
 */
export interface SetCreateData {
  work_id: number;
  aligner_dr_id: number;
  is_active?: boolean;
  set_cost?: number;
  notes?: string;
  set_sequence?: number;
  type?: string;
  upper_aligners_count?: number;
  lower_aligners_count?: number;
  days?: number;
  set_url?: string;
  set_video?: string;
  currency?: string;
}

/**
 * Set update data
 */
export interface SetUpdateData {
  aligner_dr_id?: number;
  is_active?: boolean;
  // Clearable on update: null = clear the column, undefined = leave unchanged.
  set_cost?: number | null;
  notes?: string | null;
  set_sequence?: number;
  type?: string | null;
  upper_aligners_count?: number;
  lower_aligners_count?: number;
  // Clearable on update: null = clear the column, undefined = leave unchanged.
  days?: number | null;
  set_url?: string | null;
  set_video?: string | null;
  set_pdf_url?: string | null;
  currency?: string | null;
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

  try {
    const newSetId = await alignerSetQueries.createAlignerSet(sanitizedData);
    log.info(
      `Aligner set created successfully: Set ${newSetId} for Work ${work_id}`
    );
    return newSetId;
  } catch (error) {
    log.error('Error creating aligner set:', { error: error instanceof Error ? error.message : String(error) });
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
  if (!setId || isNaN(parseInt(String(setId), 10))) {
    throw new AlignerValidationError('Valid setId is required', 'INVALID_SET_ID');
  }

  const parsedSetId = parseInt(String(setId), 10);

  // Check if set exists
  const setExists = await alignerSetQueries.getAlignerSetById(parsedSetId);
  if (!setExists) {
    throw new AlignerValidationError('Aligner set not found', 'SET_NOT_FOUND', {
      setId: parsedSetId,
    });
  }

  // Sanitize set_cost but keep the null/undefined distinction: null means "clear
  // the column" (blanked form field, via the contract's clearableNum), undefined
  // means "not provided — leave unchanged". Only '' collapses to undefined.
  const sanitizedData: SetUpdateData = {
    ...setData,
    set_cost: setData.set_cost === null
      ? null
      : setData.set_cost !== undefined && String(setData.set_cost) !== ''
        ? Number(setData.set_cost)
        : undefined,
  };

  // Re-enforce the dropped CK_MoreThanTotalW invariant in TS: a set's cost must never
  // drop below what's already been paid for it, otherwise the set becomes overpaid.
  // A clear (null) is exempt, as it always was: NULL means "no cost set", not zero.
  if (sanitizedData.set_cost !== undefined && sanitizedData.set_cost !== null) {
    const balance = await alignerPaymentQueries.getAlignerSetBalance(parsedSetId);
    const alreadyPaid = Number(balance?.TotalPaid ?? 0);
    if (Number(sanitizedData.set_cost) < alreadyPaid) {
      throw new AlignerValidationError(
        `Set cost (${sanitizedData.set_cost}) cannot be less than the amount already paid for this set (${alreadyPaid}).`,
        'SET_COST_BELOW_PAID',
        {
          setId: parsedSetId,
          setCost: Number(sanitizedData.set_cost),
          alreadyPaid,
        }
      );
    }
  }

  log.info(`Updating aligner set ${setId}:`, sanitizedData);

  try {
    await alignerSetQueries.updateAlignerSet(parsedSetId, sanitizedData);
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
  if (!setId || isNaN(parseInt(String(setId), 10))) {
    throw new AlignerValidationError('Valid setId is required', 'INVALID_SET_ID');
  }

  const parsedSetId = parseInt(String(setId), 10);

  // Check if set exists
  const setExists = await alignerSetQueries.getAlignerSetById(parsedSetId);
  if (!setExists) {
    throw new AlignerValidationError('Aligner set not found', 'SET_NOT_FOUND', {
      setId: parsedSetId,
    });
  }

  log.info(`Deleting aligner set ${setId}`);

  try {
    // Batches + set deleted atomically in one transaction (batches first for the FK).
    await alignerSetQueries.deleteSetWithBatches(parsedSetId);

    log.info(`Aligner set ${setId} and its batches deleted successfully`);
  } catch (error) {
    log.error('Error deleting aligner set:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
