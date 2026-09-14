/**
 * Work TRANSFER API Routes (admin only)
 *
 * Split out of work.routes.ts (S2/C5). Moving a work to another patient carries every
 * related record with it (they link via `work_id`, not `person_id`), so the UI shows a
 * preview of those counts before the admin confirms.
 *
 * Mounted at the same `/api` prefix as work.routes.ts, immediately after
 * diagnosis.routes.ts, so the registration order of the route table is unchanged.
 */

import { Router, type Request, type Response } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { ADMIN_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { sendData, sendError, ErrorResponses } from '../../utils/error-response.js';
import * as workContract from '../../shared/contracts/work.contract.js';
import { log } from '../../utils/logger.js';
import { getWorkDetails } from '../../services/database/queries/work-queries.js';
import {
  validateAndTransferWork,
  getTransferPreview,
  WorkValidationError,
} from '../../services/business/WorkService.js';

const router = Router();


// ============================================================================
// WORK TRANSFER API ENDPOINTS (Admin Only)
// ============================================================================

/**
 * GET /api/work/:workId/transfer-preview
 * Get preview of what will be transferred (related record counts)
 * Admin only
 */
router.get(
  '/work/:workId/transfer-preview',
  authenticate,
  authorize(ADMIN_ROLES),
  async (req: Request<{ workId: string }>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;

      if (!workId || isNaN(parseInt(workId, 10))) {
        log.warn('Transfer preview invalid workId', { workId });
        ErrorResponses.badRequest(res, 'workId must be a valid number');
        return;
      }

      // Get work details
      const work = await getWorkDetails(parseInt(workId, 10));
      if (!work) {
        log.warn('Work not found for transfer preview', { workId });
        ErrorResponses.notFound(res, 'Work');
        return;
      }

      // Get related record counts
      const relatedCounts = await getTransferPreview(parseInt(workId, 10));

      sendData(res, workContract.transferPreview.response, {
        work: {
          workId: work.work_id,
          type: work.type_name,
          status: work.status_name,
          doctor: work.doctor_name,
          totalRequired: work.total_required,
          currency: work.currency,
          currentPatient: {
            personId: work.person_id,
            name: work.patient_name
          }
        },
        relatedRecords: relatedCounts
      });
    } catch (error) {
      if (error instanceof WorkValidationError) {
        log.warn('Transfer preview rejected by validation', {
          code: error.code
        });
        if (error.code === 'WORK_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Work');
          return;
        }
        ErrorResponses.badRequest(res, error.message, error.details);
        return;
      }

      log.error('Error getting transfer preview:', error);
      sendError(res, 500, 'Failed to get transfer preview', error as Error);
    }
  }
);

/**
 * POST /api/work/:workId/transfer
 * Transfer a work to a different patient
 * Admin only
 */
router.post(
  '/work/:workId/transfer',
  authenticate,
  authorize(ADMIN_ROLES),
  validate({ body: workContract.transfer.body }),
  async (
    req: Request<{ workId: string }, unknown, workContract.TransferBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.params;
      const { targetPatientId } = req.body;

      // Validate workId
      if (!workId || isNaN(parseInt(workId, 10))) {
        log.warn('Transfer work invalid workId', { workId });
        ErrorResponses.badRequest(res, 'workId must be a valid number');
        return;
      }

      // Validate targetPatientId
      if (!targetPatientId || isNaN(parseInt(String(targetPatientId), 10))) {
        log.warn('Transfer work missing targetPatientId', { workId });
        ErrorResponses.missingParameter(res, 'targetPatientId');
        return;
      }

      // Execute transfer with validation
      const result = await validateAndTransferWork(
        parseInt(workId, 10),
        parseInt(String(targetPatientId), 10)
      );

      log.info('Work transferred successfully', {
        workId: result.workId,
        sourcePatientId: result.sourcePatientId,
        targetPatientId: result.targetPatientId
      });

      sendData(res, workContract.transfer.response, result, 'Work transferred successfully');
    } catch (error) {
      if (error instanceof WorkValidationError) {
        log.warn('Work transfer rejected by validation', {
          code: error.code,
          workId: req.params?.workId
        });
        switch (error.code) {
          case 'WORK_NOT_FOUND':
          case 'TARGET_PATIENT_NOT_FOUND':
            ErrorResponses.notFound(res, error.message);
            return;
          case 'ACTIVE_WORK_CONFLICT':
            ErrorResponses.conflict(res, error.message, error.details);
            return;
          case 'SAME_PATIENT':
            ErrorResponses.badRequest(res, error.message, error.details);
            return;
          default:
            ErrorResponses.badRequest(res, error.message, error.details);
            return;
        }
      }

      log.error('Error transferring work:', error);
      sendError(res, 500, 'Failed to transfer work', error as Error);
    }
  }
);

export default router;
