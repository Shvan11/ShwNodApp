/**
 * Aligner BATCH API Routes — creating, editing and moving a batch through its
 * manufacture/deliver lifecycle (and undoing either).
 *
 * Split out of aligner.routes.ts (S2/C4), mounted at the same prefix in the order the
 * sections appeared in that file, so the route table's registration order is unchanged.
 *
 * Authorization: mounted under the global `/api` `authenticate` gate, and every
 * mutating route additionally carries an explicit `authorize()`. The gates are
 * per-route on purpose: this router is mounted at `/` inside the api router, so a
 * pathless `router.use(authorize(...))` would gate every `/api/*` request that
 * merely passes through it (the 2026-07-11 admin-403 incident — see routes/admin.ts).
 */

import { Router, type Request, type Response } from 'express';
import { sendSuccess, sendData, ErrorResponses } from '../../utils/error-response.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { log } from '../../utils/logger.js';
import * as contract from '../../shared/contracts/aligner.contract.js';
import * as alignerBatchService from '../../services/business/AlignerBatchService.js';
import { AlignerValidationError } from '../../services/business/AlignerErrors.js';

const router = Router();

// ============================================================================
// ALIGNER BATCHES CRUD OPERATIONS
// ============================================================================

/**
 * Create a new aligner batch
 */
router.post(
  '/aligner/batches',
  authorize(CLINICAL_ROLES),
  validate({ body: contract.createBatch.body }),
  async (
    req: Request<unknown, unknown, contract.CreateBatchBody>,
    res: Response
  ): Promise<void> => {
    try {
      const result = await alignerBatchService.validateAndCreateBatch(req.body);

      sendData(
        res,
        contract.createBatch.response,
        { batchId: result.newBatchId, deactivatedBatch: result.deactivatedBatch },
        'Aligner batch created successfully'
      );
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'SET_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Aligner set');
          return;
        }
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error creating aligner batch:', error);
      ErrorResponses.internalError(
        res,
        'Failed to create aligner batch',
        error as Error
      );
    }
  }
);

/**
 * Update an existing aligner batch
 */
router.put(
  '/aligner/batches/:batchId',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.batchIdParams, body: contract.updateBatch.body }),
  async (
    req: Request<{ batchId: string }, unknown, contract.UpdateBatchBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { batchId } = req.params;

      const result = await alignerBatchService.validateAndUpdateBatch(
        batchId,
        req.body
      );

      const data: Record<string, unknown> = {};
      if (result && result.deactivatedBatch) {
        data.deactivatedBatch = result.deactivatedBatch;
      }

      sendData(res, contract.updateBatch.response, data, 'Aligner batch updated successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error updating aligner batch:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update aligner batch',
        error as Error
      );
    }
  }
);

/**
 * Mark batch as manufactured
 * @body targetDate - Optional ISO date string for backdating/correction
 */
router.patch(
  '/aligner/batches/:batchId/manufacture',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.batchIdParams, body: contract.targetDateBody }),
  async (req: Request<{ batchId: string }, unknown, { targetDate?: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const { targetDate } = req.body || {};

      // Pass the contract's 'YYYY-MM-DD' string THROUGH — `new Date(str)` here
      // would parse it as UTC midnight and `toDateOnly` downstream would shift it
      // back a day on a negative-offset host.
      const result = await alignerBatchService.markBatchManufactured(batchId, targetDate ?? null);

      sendData(
        res,
        contract.manufactureBatch.response,
        {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
          action: result.action,
          // Structured idempotency flag (symmetric with /deliver's wasAlreadyDelivered)
          // so funneled callers don't have to string-match the envelope message, which
          // core/http.ts's unwrapEnvelope strips. See audit N19.
          wasAlreadyManufactured: result.wasAlreadyManufactured,
        },
        result.message
      );
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error marking batch as manufactured:', error);
      ErrorResponses.internalError(
        res,
        'Failed to mark batch as manufactured',
        error as Error
      );
    }
  }
);

/**
 * Mark batch as delivered with automatic activation for latest batch
 * batch_expiry_date is auto-computed from delivered_to_patient_date + (days * AlignerCount)
 * @body targetDate - Optional ISO date string for backdating/correction
 */
router.patch(
  '/aligner/batches/:batchId/deliver',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.batchIdParams, body: contract.targetDateBody }),
  async (req: Request<{ batchId: string }, unknown, { targetDate?: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const { targetDate } = req.body || {};

      // See the manufacture handler: the date string is passed through verbatim.
      const result = await alignerBatchService.markBatchDelivered(batchId, targetDate ?? null);

      sendData(
        res,
        contract.deliverBatch.response,
        {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
          setId: result.setId,
          wasActivated: result.wasActivated,
          wasAlreadyActive: result.wasAlreadyActive,
          wasAlreadyDelivered: result.wasAlreadyDelivered,
          previouslyActiveBatchSequence: result.previouslyActiveBatchSequence,
        },
        result.message
      );
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error marking batch as delivered:', error);
      ErrorResponses.internalError(
        res,
        'Failed to mark batch as delivered',
        error as Error
      );
    }
  }
);

/**
 * Undo manufacture
 */
router.patch(
  '/aligner/batches/:batchId/undo-manufacture',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.batchIdParams }),
  async (req: Request<{ batchId: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      const result = await alignerBatchService.undoManufactureBatch(batchId);

      sendData(
        res,
        contract.undoManufacture.response,
        { batchId: result.batchId, batchSequence: result.batchSequence },
        result.message
      );
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error undoing manufacture:', error);
      ErrorResponses.internalError(
        res,
        'Failed to undo manufacture',
        error as Error
      );
    }
  }
);

/**
 * Undo delivery
 */
router.patch(
  '/aligner/batches/:batchId/undo-deliver',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.batchIdParams }),
  async (req: Request<{ batchId: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      const result = await alignerBatchService.undoDeliverBatch(batchId);

      sendData(
        res,
        contract.undoDeliver.response,
        { batchId: result.batchId, batchSequence: result.batchSequence },
        result.message
      );
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error undoing delivery:', error);
      ErrorResponses.internalError(
        res,
        'Failed to undo delivery',
        error as Error
      );
    }
  }
);

/**
 * Delete an aligner batch
 */
router.delete(
  '/aligner/batches/:batchId',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.batchIdParams }),
  async (req: Request<{ batchId: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      await alignerBatchService.validateAndDeleteBatch(batchId);

      sendSuccess(res, null, 'Aligner batch deleted successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error deleting aligner batch:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete aligner batch',
        error as Error
      );
    }
  }
);

export default router;
