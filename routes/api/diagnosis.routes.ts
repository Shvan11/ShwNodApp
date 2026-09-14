/**
 * Diagnosis & treatment-planning API Routes
 *
 * Split out of work.routes.ts (S2/C5). The `diagnoses` table is one row per work
 * (`UNIQUE (work_id)`) holding the comprehensive orthodontic diagnosis; its SQL lives
 * in diagnosis-queries.ts (carved out in B4). These three endpoints are its HTTP face.
 *
 * Mounted at the same `/api` prefix as work.routes.ts, immediately after
 * work-item.routes.ts, so the registration order of the route table is unchanged.
 */

import { Router, type Request, type Response } from 'express';
import {
  getDiagnosisByWorkId,
  upsertDiagnosis,
  deleteDiagnosisByWorkId,
} from '../../services/database/queries/diagnosis-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendError, ErrorResponses } from '../../utils/error-response.js';
import * as workContract from '../../shared/contracts/work.contract.js';
import { log } from '../../utils/logger.js';
import { parseLocalDate } from '../../utils/date.js';

const router = Router();


// ============================================================================
// DIAGNOSIS & TREATMENT PLANNING API ENDPOINTS
// ============================================================================

/**
 * GET /api/diagnosis/:workId
 * Get comprehensive diagnosis data for a specific work
 */
router.get(
  '/diagnosis/:workId',
  validate({ params: workContract.workIdParams }),
  async (req: Request<workContract.WorkIdParams>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;

      if (!workId) {
        log.warn('Get diagnosis request missing workId');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      const row = await getDiagnosisByWorkId(parseInt(workId, 10));

      // Stays raw (not sendSuccess): the "no diagnosis yet / new diagnosis"
      // state is signalled by a literal 200 `null`, which Diagnosis.tsx detects
      // via `if (diagnosis)`. sendSuccess(res, null) would omit `data` and the
      // FE would receive `{success,timestamp}` (truthy) instead of null, breaking
      // that signal. See audit H4/N18/N22.
      if (!row) {
        res.json(null);
        return;
      }

      res.json(row);
    } catch (error) {
      log.error('Error fetching diagnosis:', error);
      sendError(res, 500, 'Failed to fetch diagnosis', error as Error);
    }
  }
);

/**
 * POST /api/diagnosis
 * Create or update diagnosis (upsert operation)
 */
router.post(
  '/diagnosis',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ body: workContract.diagnosis.body }),
  async (
    req: Request<unknown, unknown, workContract.DiagnosisBody>,
    res: Response
  ): Promise<void> => {
    try {
      const diagnosisData = req.body;

      // work_id / diagnosis / treatment_plan validated by workContract.diagnosis.body
      // (work_id a positive int; both text fields trimmed + non-empty).

      const workIdNum = parseInt(String(diagnosisData.work_id), 10);

      // Normalized column values (null for empty strings — preserves original semantics).
      // `dx_date` is a `timestamp WITHOUT time zone` (wall-clock). The contract
      // sends 'YYYY-MM-DD', and `new Date('YYYY-MM-DD')` parses UTC midnight —
      // stored here as +03:00 today, but as the PREVIOUS evening on any
      // negative-UTC-offset deployment. `parseLocalDate` builds local midnight
      // instead; the fallback keeps full timestamp strings working.
      const dxDate = diagnosisData.dx_date
        ? (parseLocalDate(diagnosisData.dx_date) ?? new Date(diagnosisData.dx_date))
        : new Date();
      const inserted = await upsertDiagnosis({
        ...diagnosisData,
        work_id: workIdNum,
        dx_date: dxDate,
      });

      sendSuccess(
        res,
        null,
        inserted ? 'diagnosis created successfully' : 'diagnosis updated successfully'
      );
    } catch (error) {
      log.error('Error saving diagnosis:', error);
      sendError(res, 500, 'Failed to save diagnosis', error as Error);
    }
  }
);

/**
 * DELETE /api/diagnosis/:workId
 * Delete diagnosis for a specific work
 */
router.delete(
  '/diagnosis/:workId',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ params: workContract.workIdParams }),
  async (req: Request<workContract.WorkIdParams>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;

      if (!workId) {
        log.warn('Delete diagnosis request missing workId');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      await deleteDiagnosisByWorkId(parseInt(workId, 10));

      sendSuccess(res, null, 'diagnosis deleted successfully');
    } catch (error) {
      log.error('Error deleting diagnosis:', error);
      sendError(res, 500, 'Failed to delete diagnosis', error as Error);
    }
  }
);


export default router;
