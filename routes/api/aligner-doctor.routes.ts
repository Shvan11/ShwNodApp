/**
 * Aligner DOCTOR management API Routes — CRUD over the external referring dentists
 * who own aligner sets (`/api/aligner-doctors*`; the read used by the aligner
 * dashboard stays on aligner.routes.ts as `/api/aligner/doctors`).
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
import * as alignerDoctorQueries from '../../services/database/queries/aligner-doctor-queries.js';
import * as alignerDoctorService from '../../services/business/AlignerDoctorService.js';
import { AlignerValidationError } from '../../services/business/AlignerErrors.js';

const router = Router();

// ============================================================================
// ALIGNER DOCTORS MANAGEMENT
// ============================================================================

/**
 * Get all aligner doctors
 */
router.get(
  '/aligner-doctors',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const doctors = await alignerDoctorQueries.getAllDoctors();

      sendData(res, contract.doctorsList.response, { doctors: doctors || [] });
    } catch (error) {
      log.error('Error fetching aligner doctors:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch aligner doctors',
        error as Error
      );
    }
  }
);

/**
 * Add new aligner doctor
 */
router.post(
  '/aligner-doctors',
  authorize(CLINICAL_ROLES),
  validate({ body: contract.doctorBody }),
  async (
    req: Request<unknown, unknown, contract.DoctorBody>,
    res: Response
  ): Promise<void> => {
    try {
      const newDrID = await alignerDoctorService.validateAndCreateDoctor(req.body);

      sendData(res, contract.createDoctor.response, { drID: newDrID }, 'Doctor added successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'EMAIL_ALREADY_EXISTS') {
          ErrorResponses.conflict(res, error.message);
          return;
        }
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }
      log.error('Error adding aligner doctor:', error);
      ErrorResponses.internalError(
        res,
        'Failed to add aligner doctor',
        error as Error
      );
    }
  }
);

/**
 * Update aligner doctor
 */
router.put(
  '/aligner-doctors/:drID',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.drIdParams, body: contract.doctorBody }),
  async (
    req: Request<{ drID: string }, unknown, contract.DoctorBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { drID } = req.params;

      await alignerDoctorService.validateAndUpdateDoctor(drID, req.body);

      sendSuccess(res, null, 'Doctor updated successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'EMAIL_ALREADY_EXISTS') {
          ErrorResponses.conflict(res, error.message);
          return;
        }
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }
      log.error('Error updating aligner doctor:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update aligner doctor',
        error as Error
      );
    }
  }
);

/**
 * Delete aligner doctor
 */
router.delete(
  '/aligner-doctors/:drID',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.drIdParams }),
  async (req: Request<{ drID: string }>, res: Response): Promise<void> => {
    try {
      const { drID } = req.params;

      await alignerDoctorService.validateAndDeleteDoctor(drID);

      sendSuccess(res, null, 'Doctor deleted successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, error.details);
        return;
      }
      log.error('Error deleting aligner doctor:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete aligner doctor',
        error as Error
      );
    }
  }
);

export default router;
