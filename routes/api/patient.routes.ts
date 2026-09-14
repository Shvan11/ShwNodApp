/**
 * Patient Management API Routes
 *
 * Patient information, search, phone lookup, the reference dropdowns
 * (tags / patient types), full CRUD and the estimated-cost + has-appointment
 * reads.
 *
 * Three neighbouring routers, all mounted at the same `/api` prefix, own the
 * rest of what used to live here (C1): `patient-timepoint.routes.ts` (time
 * points + imaging), `alert.routes.ts` (the alerts/tasks table) and
 * `patient-portal-admin.routes.ts` (staff-side portal access + photo privacy).
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { isUniqueViolation } from '../../utils/pg-errors.js';
import {
  getPatientsPhones,
  getPatientById,
  updatePatient,
  hasNextAppointment,
  getTagOptions,
  getPatientTypeOptions,
  updateEstimatedCost
} from '../../services/database/queries/patient-queries.js';
import { searchPatients } from '../../services/database/queries/patient-search-queries.js';
import { getAlertsByPersonId } from '../../services/database/queries/alert-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES, FINANCE_ROLES } from '../../shared/auth/roles.js';
import {
  requireRecordAge,
  getPatientCreationDate
} from '../../middleware/time-based-auth.js';
import { getOption } from '../../services/database/queries/options-queries.js';
import { ErrorResponses, sendSuccess, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import * as patientContract from '../../shared/contracts/patient.contract.js';
import * as PatientService from '../../services/business/PatientService.js';
import { PatientValidationError, IntakeConfigError, deletePatientCascade } from '../../services/business/PatientService.js';
import { enqueueApproval } from '../../services/approvals/approval-service.js';
import { transliterateNameToEnglish, transliterateNameForBackfill } from '../../services/business/name-transliteration.js';
import { fillMissingPatientName } from '../../services/database/queries/photo-session-queries.js';
const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// Request schemas + the shared `personIdParams` now live in
// shared/contracts/patient.contract.ts (imported as `patientContract`) — shared
// with the client. The create/update bodies are FULLY ENUMERATED there and are
// the `z.infer` SSoT; the handlers below type from `patientContract.*Body` (the
// hand-written interfaces were deleted).
const { personIdParams } = patientContract;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Parse a comma-separated id list from a query string ("3,7,12") into numbers,
 * dropping anything non-numeric. Used by the search filters.
 */
function parseIdList(csv: string | undefined): number[] {
  return csv
    ? csv
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id))
    : [];
}

// ============================================================================
// PATIENT INFORMATION ROUTES
// ============================================================================

/**
 * Get patient information
 * GET /patients/:personId/info
 */
router.get(
  '/patients/:personId/info',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      const info = await PatientService.getPatientInfo(personId);
      sendData(res, patientContract.patientInfo.response, info);
    } catch (error) {
      if (error instanceof PatientValidationError) {
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...(error.details ?? {})
        });
        return;
      }
      log.error('Error fetching patient info:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch patient information',
        error as Error
      );
    }
  }
);

/**
 * Get PatientsFolder setting from tbloptions
 * GET /settings/patients-folder
 */
router.get(
  '/settings/patients-folder',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const patientsFolder = await getOption('PatientsFolder');
      sendData(res, patientContract.patientsFolder.response, { patientsFolder: patientsFolder || '' });
    } catch (error) {
      log.error('Error fetching PatientsFolder setting:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch PatientsFolder setting',
        error as Error
      );
    }
  }
);


// ============================================================================
// PATIENT PHONE NUMBERS
// ============================================================================

/**
 * Get all patient phone numbers
 * GET /patients/phones
 */
router.get(
  '/patients/phones',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const phonesList = await getPatientsPhones();
      sendData(res, patientContract.patientPhones.response, phonesList);
    } catch (error) {
      log.error('Error fetching patients phones:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch patients phones',
        error as Error
      );
    }
  }
);

// ============================================================================
// PATIENT SEARCH
// ============================================================================

/**
 * Search patients by name, phone, id, work type, keywords, tags, patient type,
 * last-appointment age/date-range, final/progress-photo presence, and unpaid balance.
 * GET /patients/search — query params are the contract's `patientSearch.query`.
 */
router.get(
  '/patients/search',
  validate({ query: patientContract.patientSearch.query }),
  async (
    req: Request<unknown, unknown, unknown, patientContract.PatientSearchQuery>,
    res: Response
  ): Promise<void> => {
    try {
      // Query-string shape (CSV id lists, 'true'/'false' flags) is adapted here;
      // the builder itself takes typed filters. See patient-search-queries.ts.
      const page = await searchPatients({
        q: req.query.q,
        patientName: req.query.patientName,
        firstName: req.query.firstName,
        lastName: req.query.lastName,
        nameStartsWith: req.query.nameStartsWith === 'true',
        workTypeIds: parseIdList(req.query.workTypes),
        keywordIds: parseIdList(req.query.keywords),
        tagIds: parseIdList(req.query.tags),
        patientTypeIds: parseIdList(req.query.patientTypes),
        lastAppointment: req.query.lastAppointment,
        lastAppointmentFrom: req.query.lastAppointmentFrom,
        lastAppointmentTo: req.query.lastAppointmentTo,
        finalPhotos: req.query.finalPhotos,
        progressPhotos: req.query.progressPhotos,
        hasDebt: req.query.hasDebt === 'true',
        sortBy: req.query.sortBy,
        order: req.query.order,
        limit: req.query.limit,
        offset: req.query.offset,
      });

      sendData(res, patientContract.patientSearch.response, page);
    } catch (error) {
      log.error('Error searching patients:', error);
      ErrorResponses.internalError(
        res,
        'Failed to search patients',
        error as Error
      );
    }
  }
);

// ============================================================================
// TAG OPTIONS
// ============================================================================

/**
 * Get all tag options
 * GET /patients/tag-options
 * NOTE: Must be defined BEFORE /patients/:personId to avoid route conflicts
 */
router.get(
  '/patients/tag-options',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      sendData(res, patientContract.tagOptions.response, await getTagOptions());
    } catch (error) {
      log.error('Error fetching tag options:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch tag options',
        error as Error
      );
    }
  }
);

/**
 * Get all patient type options
 * GET /patients/type-options
 * NOTE: Must be defined BEFORE /patients/:personId to avoid route conflicts
 */
router.get(
  '/patients/type-options',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      sendData(res, patientContract.typeOptions.response, await getPatientTypeOptions());
    } catch (error) {
      log.error('Error fetching patient type options:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch patient type options',
        error as Error
      );
    }
  }
);

// ============================================================================
// PATIENT CRUD OPERATIONS
// ============================================================================

/**
 * Get single patient by id with alerts
 * GET /patients/:personId
 */
router.get(
  '/patients/:personId',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      if (!personId) {
        log.warn('Get patient request missing personId');
        ErrorResponses.missingParameter(res, 'personId');
        return;
      }

      const parsedId = parseInt(personId, 10);
      if (isNaN(parsedId)) {
        log.warn('Get patient request invalid personId', { personId });
        ErrorResponses.badRequest(res, 'Invalid personId: must be a number');
        return;
      }

      const patient = await getPatientById(parsedId);

      if (!patient) {
        log.warn('Patient not found', { personId: parsedId });
        ErrorResponses.notFound(res, 'Patient');
        return;
      }

      // Fetch and attach alerts
      const alerts = await getAlertsByPersonId(patient.person_id);
      const patientWithAlerts = patient as typeof patient & { alerts: typeof alerts };
      patientWithAlerts.alerts = alerts;

      sendData(res, patientContract.patientById.response, patientWithAlerts);
    } catch (error) {
      log.error('Error fetching patient:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch patient',
        error as Error
      );
    }
  }
);

/**
 * Transliterate an Arabic patient name into English on demand.
 * POST /patients/transliterate-name
 *
 * Powers the Edit Patient form's "Translate with AI" button. Bounded fail-fast
 * (a single Gemini attempt capped at 10s — a user is waiting): 400s with the
 * real reason when the model is unconfigured/unavailable or can't produce a
 * clean Latin first+last, so the UI surfaces it and falls back to manual entry.
 * No DB write — the user reviews the suggestion and saves the form themselves.
 * Registered before POST /patients so the literal path can never be shadowed.
 */
router.post(
  '/patients/transliterate-name',
  // Gated because it spends money: the handler calls out to Gemini. CLINICAL_ROLES
  // (every staff role) matches the demographics forms that use it — front desk on
  // intake, clinical on edit — but it is no longer reachable by a bare session.
  authorize(CLINICAL_ROLES),
  validate({ body: patientContract.transliterateName.body }),
  async (
    req: Request<unknown, unknown, patientContract.TransliterateNameBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { patientName } = req.body;
      const { firstName, lastName } = await transliterateNameToEnglish(patientName);
      sendData(res, patientContract.transliterateName.response, { firstName, lastName });
    } catch (err) {
      // Clean success-or-error: surface the real reason (not configured / no usable
      // result / API error) so the UI shows it directly — no silent empty fallback.
      const message = err instanceof Error ? err.message : 'Could not translate the name';
      log.warn('Transliterate name failed', { error: message });
      ErrorResponses.badRequest(res, message);
    }
  }
);

/**
 * Create new patient
 * POST /patients
 *
 * CLINICAL_ROLES (= every staff role) is deliberate and explicit, not an
 * oversight: chairside intake is a real workflow, so creation stays open. The
 * gate is written out so the decision is visible next to the FINANCE-gated
 * update/delete below rather than being the absence of a line.
 */
router.post(
  '/patients',
  authorize(CLINICAL_ROLES),
  validate({ body: patientContract.createPatient.body }),
  async (
    req: Request<unknown, unknown, patientContract.CreatePatientBody>,
    res: Response
  ): Promise<void> => {
    const patientData = req.body;

    try {
      // Basic validation
      if (!patientData.patientName || !patientData.patientName.trim()) {
        log.warn('Create patient missing name');
        ErrorResponses.badRequest(res, 'Patient name is required');
        return;
      }

      // Trim string values and prepare data for createPatientWithIntake. patientTypeID
      // is GONE — patient type is derived from works; the optional `intake` selector
      // (X-ray/Consult) auto-creates the patient's first work + invoice.
      const processedData: {
        patientName: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        phone2?: string;
        email?: string;
        dateOfBirth?: Date | string;
        gender?: number;
        addressID?: number;
        referralSourceID?: number;
        tagID?: number;
        notes?: string;
        language?: string;
        countryCode?: string;
        estimatedCost?: number;
        currency?: string;
      } = {
        patientName: patientData.patientName.trim(),
        firstName: patientData.firstName?.trim() || undefined,
        lastName: patientData.lastName?.trim() || undefined,
        phone: patientData.phone?.trim() || undefined,
        phone2: patientData.phone2?.trim() || undefined,
        email: patientData.email?.trim() || undefined,
        // Passed through as the contract's 'YYYY-MM-DD' string — the query layer
        // runs it through `toDateOnly`, whose pass-through guard keeps it verbatim.
        dateOfBirth: patientData.dateOfBirth || undefined,
        gender: patientData.gender,
        addressID: patientData.addressID,
        referralSourceID: patientData.referralSourceID,
        tagID: patientData.tagID,
        notes: patientData.notes?.trim() || undefined,
        language: patientData.language?.trim() || undefined,
        countryCode: patientData.countryCode?.trim() || undefined,
        estimatedCost: patientData.estimatedCost,
        currency: patientData.currency?.trim() || undefined
      };

      // Create the patient (+ intake work/invoice when an intake selector is set).
      const result = await PatientService.createPatientWithIntake(processedData, patientData.intake);

      sendData(
        res,
        patientContract.createPatient.response,
        { personId: result.personId, workId: result.workId, invoiceId: result.invoiceId },
        'Patient created successfully'
      );

      // English first/last not supplied → auto-fill by romanizing the Arabic patientName
      // with Gemini, AFTER responding so the create request never blocks on the API call.
      // Fire-and-forget with spaced retries (transliterateNameForBackfill) so a transient
      // Gemini timeout/overload still fills the name minutes later. Because a retried success
      // can be late, fillMissingPatientName only writes columns STILL empty — a name typed
      // manually in the meantime is never clobbered. A final failure just logs and leaves the
      // name for manual entry (the catch is error containment for the detached promise, not a
      // fallback path).
      if (!processedData.firstName || !processedData.lastName) {
        void (async () => {
          try {
            const { firstName, lastName } = await transliterateNameForBackfill(processedData.patientName);
            await fillMissingPatientName(String(result.personId), firstName, lastName);
          } catch (err) {
            log.warn('Background name transliteration failed', {
              personId: result.personId,
              error: err instanceof Error ? err.message : String(err)
            });
          }
        })();
      }
    } catch (error) {
      // Handle duplicate patient name error
      const err = error as Error & {
        code?: string;
        existingPatientId?: number;
      };
      if (err.code === 'DUPLICATE_PATIENT_NAME') {
        log.warn(`Duplicate patient name attempted: ${patientData.patientName}`);
        // Conflict code/context travel in `details` (unified error envelope — every
        // other conflict route nests `code` there; FE reads `errorData.details?.code`).
        ErrorResponses.conflict(res, err.message, {
          code: 'DUPLICATE_PATIENT_NAME',
          existingPatientId: err.existingPatientId
        });
        return;
      }

      // Intake requested but the 'Clinic' pseudo-doctor is missing → actionable 422
      // (a deployment/config fix, not a client retry).
      if (error instanceof IntakeConfigError) {
        log.warn('Intake create blocked: Clinic pseudo-doctor missing');
        ErrorResponses.unprocessable(res, error.message, { code: error.code });
        return;
      }

      log.error('Error creating patient', { error });
      ErrorResponses.internalError(
        res,
        'Failed to create patient',
        error as Error
      );
    }
  }
);

/**
 * Update patient
 * PUT /patients/:personId
 *
 * FINANCE_ROLES, matching its siblings: DELETE /patients/:personId and
 * PUT /patients/:personId/estimated-cost are both gated the same way. This is
 * the full-record rewrite (name, phone, DOB, address, tag, notes, currency), so
 * leaving it open to `clinical` while the narrower estimated-cost write was
 * gated made no sense.
 */
router.put(
  '/patients/:personId',
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams, body: patientContract.updatePatient.body }),
  async (
    req: Request<{ personId: string }, unknown, patientContract.UpdatePatientBody>,
    res: Response
  ): Promise<void> => {
    const patientData = req.body;

    try {
      const personId = parseInt(req.params.personId, 10);

      // Basic validation
      if (!patientData.patient_name || !patientData.patient_name.trim()) {
        log.warn('Update patient missing name', { personId });
        ErrorResponses.badRequest(res, 'Patient name is required');
        return;
      }

      // `date_of_birth` is passed THROUGH as the contract's 'YYYY-MM-DD' string —
      // see the create handler above for why the `new Date()` round-trip was wrong.
      await updatePatient(personId, { ...patientData, date_of_birth: patientData.date_of_birth || undefined });
      sendSuccess(res, null, 'Patient updated successfully');
    } catch (error) {
      // Duplicate patient name → pg unique violation on index ix_name_id (was mssql 2601).
      if (isUniqueViolation(error, 'ix_name_id')) {
        log.warn(
          `Duplicate patient name attempted during update: ${patientData.patient_name}`
        );
        // Conflict code/context travel in `details` (unified error envelope).
        ErrorResponses.conflict(res, 'A patient with this name already exists', {
          code: 'DUPLICATE_PATIENT_NAME',
          duplicateName: patientData.patient_name
        });
        return;
      }

      log.error('Error updating patient:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update patient',
        error as Error
      );
    }
  }
);

/**
 * Delete patient
 * DELETE /patients/:personId
 * Protected: Secretary can only delete patients created today
 */
router.delete(
  '/patients/:personId',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams }),
  requireRecordAge({
    resourceType: 'patient',
    operation: 'delete',
    getRecordDate: getPatientCreationDate,
    enqueueIfRestricted: async (req, res) => {
      const personId = parseInt((req.params as { personId: string }).personId, 10);
      const { requestId } = await enqueueApproval('patient.delete', { personId }, req);
      sendData(res, patientContract.deletePatient.response, {
        outcome: 'pending',
        requestId,
        message: 'Submitted for admin approval',
      });
    },
  }),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { folderRemoved } = await deletePatientCascade(personId);
      sendData(
        res,
        patientContract.deletePatient.response,
        { outcome: 'applied', folderRemoved },
        folderRemoved
          ? 'Patient and folder deleted successfully'
          : 'Patient deleted, but its photo folder could not be removed (a file may be open). Please delete it manually.'
      );
    } catch (error) {
      log.error('Error deleting patient:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete patient',
        error as Error
      );
    }
  }
);

// ============================================================================
// ESTIMATED COST UPDATE
// ============================================================================

/**
 * Update patient estimated cost
 * PUT /patients/:personId/estimated-cost
 */
router.put(
  '/patients/:personId/estimated-cost',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams, body: patientContract.estimatedCost.body }),
  async (
    req: Request<{ personId: string }, unknown, patientContract.EstimatedCostBody>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { estimatedCost, currency } = req.body;

      if (isNaN(personId)) {
        log.warn('Update estimated cost invalid patient id', { personId: req.params.personId });
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }

      // `??`, not `||`: the contract already requires both fields, and `|| null`
      // turned a legitimate estimate of 0 into NULL ("not set") while `|| 'IQD'`
      // silently rewrote the currency when the body sent an empty string. The
      // contract now rejects an empty currency, so the fallback is only for absence.
      await updateEstimatedCost(personId, estimatedCost ?? null, currency ?? 'IQD');

      sendSuccess(res, null, 'Estimated cost updated successfully');
    } catch (error) {
      log.error('Error updating estimated cost:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update estimated cost',
        error as Error
      );
    }
  }
);


// ============================================================================
// APPOINTMENT CHECK ROUTE
// ============================================================================

/**
 * Check if patient has a future appointment
 * GET /patients/:personId/has-appointment
 */
router.get(
  '/patients/:personId/has-appointment',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);

      if (isNaN(personId)) {
        log.warn('Has appointment check invalid patient id', { personId: req.params.personId });
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }

      const hasAppointment = await hasNextAppointment(personId);

      sendData(res, patientContract.hasAppointment.response, { hasAppointment });
    } catch (error) {
      log.error(
        `Error checking appointment for patient ${req.params.personId}:`,
        error
      );
      ErrorResponses.internalError(
        res,
        'Failed to check appointment status',
        error as Error
      );
    }
  }
);


export default router;
