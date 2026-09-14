/**
 * Aligner Management API Routes — the aligner dashboard reads and the SET CRUD.
 *
 * This module handles:
 * - The dashboard/list reads (doctors with unread counts, all sets, patients,
 *   sets by work, batches by set) and `POST /aligner/payments`
 * - Aligner sets CRUD operations
 *
 * Six sibling routers were split out of this file (S2/C4) and mount at the same
 * `/api` prefix immediately after it, in the order their sections appeared here:
 * `aligner-note`, `aligner-batch`, `aligner-file` (PDF + portal photos),
 * `aligner-archform`, `aligner-label`, `aligner-doctor` (`/api/aligner-doctors*`).
 *
 * Authorization: mounted under the global `/api` `authenticate` gate, and every
 * mutating route additionally carries an explicit `authorize()` — CLINICAL_ROLES
 * (all three staff roles) for the clinical/aligner workflow, FINANCE_ROLES for
 * `POST /aligner/payments`, which writes an invoice like its siblings in
 * payment.routes.ts. The gates are per-route on purpose: this router is mounted
 * at `/` inside the api router, so a pathless `router.use(authorize(...))` would
 * gate every `/api/*` request that merely passes through it (the 2026-07-11
 * admin-403 incident — see routes/admin.ts).
 *
 * Architecture:
 * - Routes handle HTTP requests/responses only
 * - Business logic delegated to the Aligner*Service modules
 * - Data access delegated to the aligner-*-queries modules
 */

import { Router, type Request, type Response } from 'express';
import { sendSuccess, sendData, ErrorResponses } from '../../utils/error-response.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES, FINANCE_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { isForeignKeyViolation } from '../../utils/pg-errors.js';
import { log } from '../../utils/logger.js';

// Request/response contract (shared with the client via @shared). The boundary
// param + body guards and every response shape live in the contract. Every write
// body is now FULLY ENUMERATED there as a strict `z.object` (mirroring the
// Aligner*Service `*Data` input types — which the route interfaces under-described)
// and is the `z.infer` SSoT; the handlers below type from `contract.*Body`. See
// shared/contracts/aligner.contract.ts + docs/shared-contract-progress.md.
import * as contract from '../../shared/contracts/aligner.contract.js';

// Query layer imports
import * as alignerBatchQueries from '../../services/database/queries/aligner-batch-queries.js';
import * as alignerDoctorQueries from '../../services/database/queries/aligner-doctor-queries.js';
import * as alignerPatientQueries from '../../services/database/queries/aligner-patient-queries.js';
import * as alignerSetQueries from '../../services/database/queries/aligner-set-queries.js';

// Service layer imports
import * as alignerPatientService from '../../services/business/AlignerPatientService.js';
import * as alignerPaymentService from '../../services/business/AlignerPaymentService.js';
import * as alignerSetService from '../../services/business/AlignerSetService.js';
import { AlignerValidationError } from '../../services/business/AlignerErrors.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type AlignerQueryParams = contract.AlignerQueryParams;

// ============================================================================
// ALIGNER DOCTORS QUERIES
// ============================================================================

/**
 * Get all aligner doctors with unread notes count
 */
router.get(
  '/aligner/doctors',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Fetching aligner doctors');
      const doctors = await alignerDoctorQueries.getDoctorsWithUnreadCounts();

      sendData(res, contract.alignerDoctors.response, {
        doctors: doctors || [],
        count: doctors ? doctors.length : 0
      });
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
 * Get all patients from v_allsets view
 */
router.get(
  '/aligner/all-sets',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Fetching all aligner sets from v_allsets');
      const sets = await alignerSetQueries.getAllAlignerSets();

      sendData(res, contract.allSets.response, { sets: sets || [] });
    } catch (error) {
      log.error('Error fetching all aligner sets:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch aligner sets',
        error as Error
      );
    }
  }
);

/**
 * Get all aligner patients (all doctors)
 */
router.get(
  '/aligner/patients/all',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Fetching all aligner patients');
      const patients = await alignerPatientQueries.getAllAlignerPatients();

      sendData(res, contract.allPatients.response, {
        patients: patients || [],
        count: patients ? patients.length : 0
      });
    } catch (error) {
      log.error('Error fetching all aligner patients:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch all aligner patients',
        error as Error
      );
    }
  }
);

/**
 * Get all patients by doctor id
 */
router.get(
  '/aligner/patients/by-doctor/:doctorId',
  async (
    req: Request<{ doctorId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { doctorId } = req.params;

      if (!doctorId || isNaN(parseInt(doctorId, 10))) {
        ErrorResponses.badRequest(res, 'Valid doctorId is required');
        return;
      }

      log.info(`Fetching all patients for doctor id: ${doctorId}`);
      const patients = await alignerPatientQueries.getAlignerPatientsByDoctor(parseInt(doctorId, 10));

      sendData(res, contract.patientsByDoctor.response, {
        patients: patients || [],
        count: patients ? patients.length : 0
      });
    } catch (error) {
      log.error('Error fetching patients by doctor:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch patients by doctor',
        error as Error
      );
    }
  }
);

/**
 * Search for aligner patients
 */
router.get(
  '/aligner/patients',
  validate({ query: contract.patientsQuery }),
  async (
    req: Request<unknown, unknown, unknown, AlignerQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { search, doctorId } = req.query;

      const patients = await alignerPatientService.searchPatients(
        search || '',
        doctorId ? parseInt(doctorId, 10) : null
      );

      sendData(res, contract.searchAlignerPatients.response, {
        patients: patients || [],
        count: patients ? patients.length : 0
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error searching aligner patients:', error);
      ErrorResponses.internalError(
        res,
        'Failed to search aligner patients',
        error as Error
      );
    }
  }
);

/**
 * Get aligner sets for a specific work
 */
router.get(
  '/aligner/sets/:workId',
  async (req: Request<{ workId: string }>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;

      if (!workId || isNaN(parseInt(workId, 10))) {
        ErrorResponses.badRequest(res, 'Valid workId is required');
        return;
      }

      log.info(`Fetching aligner sets for work id: ${workId}`);
      const sets = await alignerSetQueries.getAlignerSetsByWorkId(
        parseInt(workId, 10)
      );

      sendData(res, contract.setsByWorkId.response, {
        sets: sets || [],
        count: sets ? sets.length : 0
      });
    } catch (error) {
      log.error('Error fetching aligner sets:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch aligner sets',
        error as Error
      );
    }
  }
);

/**
 * Add payment for an aligner set
 */
router.post(
  '/aligner/payments',
  authorize(FINANCE_ROLES),
  validate({ body: contract.addPayment.body }),
  async (
    req: Request<unknown, unknown, contract.AddPaymentBody>,
    res: Response
  ): Promise<void> => {
    try {
      const invoiceID = await alignerPaymentService.validateAndCreatePayment(req.body);

      sendData(res, contract.addPayment.response, { invoice_id: invoiceID }, 'Payment added successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error adding payment:', error);
      ErrorResponses.internalError(res, 'Failed to add payment', error as Error);
    }
  }
);

/**
 * Get batches for a specific aligner set
 */
router.get(
  '/aligner/batches/:setId',
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const { setId } = req.params;

      if (!setId || isNaN(parseInt(setId, 10))) {
        ErrorResponses.badRequest(res, 'Valid setId is required');
        return;
      }

      log.info(`Fetching batches for aligner set id: ${setId}`);
      const batches = await alignerBatchQueries.getBatchesBySetId(parseInt(setId, 10));

      sendData(res, contract.batchesBySetId.response, {
        batches: batches || [],
        count: batches ? batches.length : 0
      });
    } catch (error) {
      log.error('Error fetching aligner batches:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch aligner batches',
        error as Error
      );
    }
  }
);

// ============================================================================
// ALIGNER SETS CRUD OPERATIONS
// ============================================================================

/**
 * Create a new aligner set
 */
router.post(
  '/aligner/sets',
  authorize(CLINICAL_ROLES),
  validate({ body: contract.createSet.body }),
  async (
    req: Request<unknown, unknown, contract.CreateSetBody>,
    res: Response
  ): Promise<void> => {
    try {
      const newSetId = await alignerSetService.validateAndCreateSet(req.body);

      sendData(res, contract.createSet.response, { setId: newSetId }, 'Aligner set created successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }

      log.error('Error creating aligner set:', error);
      ErrorResponses.internalError(
        res,
        'Failed to create aligner set',
        error as Error
      );
    }
  }
);

/**
 * Update an existing aligner set
 */
router.put(
  '/aligner/sets/:setId',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.setIdParams, body: contract.updateSet.body }),
  async (
    req: Request<{ setId: string }, unknown, contract.UpdateSetBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { setId } = req.params;

      await alignerSetService.validateAndUpdateSet(setId, req.body);

      sendSuccess(res, null, 'Aligner set updated successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error updating aligner set:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update aligner set',
        error as Error
      );
    }
  }
);

/**
 * Delete an aligner set (and its batches)
 */
router.delete(
  '/aligner/sets/:setId',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.setIdParams }),
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const { setId } = req.params;

      await alignerSetService.validateAndDeleteSet(setId);

      sendSuccess(res, null, 'Aligner set and its batches deleted successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      // PG foreign_key_violation (23503) — a known, expected conflict, not a 500.
      // Every other FK onto aligner_sets cascades (batches, notes, activity flags,
      // the parent work), so the only one that can block a delete is
      // fk_invoice_alignerset: the set has payments recorded against it.
      if (isForeignKeyViolation(error)) {
        log.info('Refused to delete aligner set: payments reference it', {
          setId: req.params.setId,
        });
        ErrorResponses.conflict(
          res,
          'Cannot delete this aligner set: it has payments recorded against it. Delete those payments first.'
        );
        return;
      }
      log.error('Error deleting aligner set:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete aligner set',
        error as Error
      );
    }
  }
);

export default router;
