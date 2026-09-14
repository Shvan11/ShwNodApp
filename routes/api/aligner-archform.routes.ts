/**
 * Archform matching API Routes — browsing the patients in Archform's own SQLite
 * database and linking one of them to an aligner set.
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
import * as alignerArchformQueries from '../../services/database/queries/aligner-archform-queries.js';
import {
  getArchformPatients,
  getArchformPatientById,
  updateArchformPatient,
  deleteArchformPatient,
  isArchformAvailable,
  ArchformDbUnavailableError,
} from '../../services/archform/archform-db.js';

const router = Router();

// ============================================================================
// ARCHFORM PATIENT MATCHING
// ============================================================================

/**
 * Get all patients from Archform SQLite database
 */
router.get(
  '/aligner/archform/patients',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Fetching Archform patients');
      const patients = await getArchformPatients();

      sendData(res, contract.archformPatients.response, {
        patients,
        count: patients.length
      });
    } catch (error) {
      if (error instanceof ArchformDbUnavailableError) {
        log.warn('Archform database unavailable', { path: error.dbPath });
        res.status(503).json({
          success: false,
          unavailable: true,
          message: 'Archform database is not accessible',
          path: error.dbPath,
        });
        return;
      }
      log.error('Error fetching Archform patients:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch Archform patients',
        error as Error
      );
    }
  }
);

/**
 * Check Archform database availability
 */
router.get(
  '/aligner/archform/status',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const status = await isArchformAvailable();
      sendData(res, contract.archformStatus.response, status);
    } catch (error) {
      log.error('Error checking Archform status:', error);
      ErrorResponses.internalError(
        res,
        'Failed to check Archform status',
        error as Error
      );
    }
  }
);

/**
 * Get all aligner sets with archform_id data for matching UI
 */
router.get(
  '/aligner/archform/matches',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Fetching aligner sets with Archform IDs');
      const sets = await alignerArchformQueries.getSetsWithArchformIds();

      sendData(res, contract.archformMatches.response, {
        sets: sets || [],
        count: sets ? sets.length : 0
      });
    } catch (error) {
      log.error('Error fetching Archform matches:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch Archform matches',
        error as Error
      );
    }
  }
);

/**
 * Save or clear archform_id on an aligner set
 */
router.patch(
  '/aligner/sets/:setId/archform',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.setIdParams, body: contract.setArchformMatch.body }),
  async (
    req: Request<{ setId: string }, unknown, contract.SetArchformMatchBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { setId } = req.params;
      const { archformId } = req.body;

      if (!setId || isNaN(parseInt(setId, 10))) {
        ErrorResponses.badRequest(res, 'Valid setId is required');
        return;
      }

      await alignerArchformQueries.updateArchformId(
        parseInt(setId, 10),
        archformId ?? null
      );

      log.info('Updated archform_id', { setId, archformId });

      sendSuccess(
        res,
        null,
        archformId
          ? 'Archform patient matched successfully'
          : 'Archform match removed successfully'
      );
    } catch (error) {
      log.error('Error updating archform_id:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update Archform match',
        error as Error
      );
    }
  }
);

/**
 * Update an Archform patient's name
 */
router.put(
  '/aligner/archform/patients/:id',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.archformPatientIdParams, body: contract.updateArchformPatient.body }),
  async (
    req: Request<{ id: string }, unknown, { name: string; lastName: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        ErrorResponses.badRequest(res, 'Valid patient id is required');
        return;
      }

      const { name, lastName } = req.body;
      if (!name || !name.trim() || !lastName || !lastName.trim()) {
        ErrorResponses.badRequest(res, 'Name and last name are required');
        return;
      }

      await updateArchformPatient(id, name.trim(), lastName.trim());
      log.info('Updated Archform patient', { id, name: name.trim(), lastName: lastName.trim() });

      sendSuccess(res, null, 'Archform patient updated successfully');
    } catch (error) {
      if (error instanceof ArchformDbUnavailableError) {
        res.status(503).json({
          success: false,
          unavailable: true,
          message: 'Archform database is not accessible',
          path: error.dbPath,
        });
        return;
      }
      log.error('Error updating Archform patient:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update Archform patient',
        error as Error
      );
    }
  }
);

/**
 * Delete an Archform patient (SQLite + clear SQL Server references)
 */
router.delete(
  '/aligner/archform/patients/:id',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.archformPatientIdParams }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        ErrorResponses.badRequest(res, 'Valid patient id is required');
        return;
      }

      // Verify patient exists
      const patient = await getArchformPatientById(id);
      if (!patient) {
        ErrorResponses.notFound(res, 'Archform patient');
        return;
      }

      // Clear SQL Server references first (safer partial failure mode)
      await alignerArchformQueries.clearArchformIdByPatientId(id);

      // Delete from Archform SQLite
      const result = await deleteArchformPatient(id);

      log.info('Deleted Archform patient', {
        id,
        name: `${patient.Name} ${patient.LastName}`,
        deletedFromTables: result.deletedFromTables
      });

      sendData(
        res,
        contract.deleteArchformPatient.response,
        { deletedFromTables: result.deletedFromTables },
        'Archform patient deleted successfully'
      );
    } catch (error) {
      if (error instanceof ArchformDbUnavailableError) {
        res.status(503).json({
          success: false,
          unavailable: true,
          message: 'Archform database is not accessible',
          path: error.dbPath,
        });
        return;
      }
      log.error('Error deleting Archform patient:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete Archform patient',
        error as Error
      );
    }
  }
);

export default router;
