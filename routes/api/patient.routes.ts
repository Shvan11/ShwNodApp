/**
 * Patient Management API Routes
 *
 * This module handles all patient-related API endpoints including:
 * - Patient information retrieval
 * - Time points and imaging
 * - QR code generation
 * - Patient CRUD operations (create, read, update, delete)
 * - Patient search and phone number retrieval
 * - Patient folder settings
 */

import { Router, type Request, type Response } from 'express';
import { sql, type RawBuilder } from 'kysely';
import { log } from '../../utils/logger.js';
import { isUniqueViolation } from '../../utils/pg-errors.js';
import { getKysely } from '../../services/database/kysely.js';
import {
  getPatientsPhones,
  getPatientById,
  updatePatient,
  hasNextAppointment
} from '../../services/database/queries/patient-queries.js';
import {
  getAlertsByPersonId,
  createAlert,
  setAlertStatus,
  setAlertSnooze,
  updateAlert,
  getAlertAssignedTo
} from '../../services/database/queries/alert-queries.js';
import { employeeIsActive } from '../../services/database/queries/employee-queries.js';
import { notifyTaskAssignment } from '../../services/messaging/task-notify.js';
import * as imaging from '../../services/imaging/index.js';
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
import * as PatientPortalService from '../../services/business/PatientPortalService.js';
import {
  getNativeTimePoint,
  updateNativeTimePoint,
  deleteNativeTimePoint,
} from '../../services/database/queries/native-timepoint-queries.js';
import { updatePhotoDate, fillMissingPatientName } from '../../services/database/queries/photo-session-queries.js';
import {
  deleteWorkingFilesForTimepoint,
  timepointFolderName,
} from '../../services/imaging/photo-cleanup.service.js';
import {
  renameEntry,
  hardDelete,
  entryExists,
  sanitizeName,
  FileExplorerError,
} from '../../services/files/file-explorer.service.js';
const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// `type` (not interface) — feeds the tightened looseObject `patientSearch`
// response via `sendData`; an interface isn't assignable to the inferred string
// index signature (TS2345). See the looseObject-index-signature Finding in
// docs/shared-contract-progress.md.
type PatientSearchResult = {
  person_id: number;
  patient_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  date_of_birth: Date | null;
  gender: number | null;
  address_id: number | null;
  referral_source_id: number | null;
  patient_type_id: number | null;
  tag_id: number | null;
  notes: string | null;
  language: string | null;
  country_code: string | null;
  estimated_cost: number | null;
  currency: string | null;
  date_added: string | null;
  last_visit: string | null;
  GenderName: string | null;
  AddressName: string | null;
  ReferralSource: string | null;
  PatientTypeName: string | null;
  TagName: string | null;
  ActiveWorkTypes: string | null;
};

// Request schemas + the shared param schemas (`personIdParams`/`alertIdParams`/
// `timepointParams`) now live in shared/contracts/patient.contract.ts (imported as
// `patientContract`) — shared with the client. The create/update/alert/photo bodies
// are FULLY ENUMERATED there and are the `z.infer` SSoT; the handlers below type
// from `patientContract.*Body` (the hand-written interfaces were deleted).
const { personIdParams, alertIdParams, timepointParams } = patientContract;

// `type` (not interface) — feed looseObject `sendData` responses (tag/type options).
type TagOption = {
  id: number;
  tag: string;
};

type PatientTypeOption = {
  id: number;
  type: string;
};

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
// TIME POINTS AND IMAGING ROUTES
// ============================================================================

/**
 * Get time points for a patient
 * GET /patients/:personId/timepoints
 */
router.get(
  '/patients/:personId/timepoints',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      const timepoints = await PatientService.getPatientTimePoints(personId);
      sendData(res, patientContract.timepoints.response, timepoints);
    } catch (error) {
      if (error instanceof PatientValidationError) {
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...(error.details ?? {})
        });
        return;
      }
      log.error('Error fetching time points:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch time points',
        error as Error
      );
    }
  }
);

/**
 * Get time point images for a patient
 * GET /patients/:personId/timepoints/:tp/images
 */
router.get(
  '/patients/:personId/timepoints/:tp/images',
  async (
    req: Request<{ personId: string; tp: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId, tp } = req.params;
      const timepointimgs = await PatientService.getPatientTimePointImages(
        personId,
        tp
      );
      sendData(res, patientContract.timepointImages.response, timepointimgs);
    } catch (error) {
      if (error instanceof PatientValidationError) {
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...(error.details ?? {})
        });
        return;
      }
      log.error('Error fetching time point images:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch time point images',
        error as Error
      );
    }
  }
);

/**
 * Check whether a time point's originals folder ({name}_{DD-MM-YYYY}) exists on
 * disk. Used by the kebab menu to enable/disable "Open original folder" — the
 * single stat runs only when the menu is opened, never on list load.
 * GET /patients/:personId/timepoints/:tpCode/folder  ->  { folder, exists }
 */
router.get(
  '/patients/:personId/timepoints/:tpCode/folder',
  async (req: Request<{ personId: string; tpCode: string }>, res: Response): Promise<void> => {
    try {
      const personId = Number.parseInt(req.params.personId, 10);
      const tpCode = Number.parseInt(req.params.tpCode, 10);
      if (!Number.isInteger(personId) || !Number.isInteger(tpCode)) {
        ErrorResponses.badRequest(res, 'Invalid patient id or time point code');
        return;
      }
      const existing = await getNativeTimePoint(personId, tpCode);
      if (!existing) {
        ErrorResponses.notFound(res, 'Time point');
        return;
      }
      const folder = timepointFolderName(existing.tp_description ?? '', existing.tp_date_time);
      const exists = folder ? await entryExists(personId, folder) : false;
      sendData(res, patientContract.timepointFolder.response, { folder, exists });
    } catch (error) {
      log.error('Error checking time point folder:', error);
      ErrorResponses.internalError(res, 'Failed to check time point folder', error as Error);
    }
  }
);

/** Parse 'YYYY-MM-DD' to a LOCAL-midnight Date (matches photo-editor.routes.ts). */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Edit a time point's name and/or date.
 * PUT /patients/:personId/timepoints/:tpCode
 * Body: { tpDescription?: string, tpDateTime?: 'YYYY-MM-DD' }
 *
 * The rendered gallery photos are keyed by tpCode, so they are untouched. The
 * originals folder ({name}_{DD-MM-YYYY}) is renamed to stay in sync, and for an
 * Initial/Final time point a date change is mirrored into tblwork.
 */
router.put(
  '/patients/:personId/timepoints/:tpCode',
  authorize(FINANCE_ROLES),
  validate({ params: timepointParams, body: patientContract.updateTimepoint.body }),
  async (req: Request<{ personId: string; tpCode: string }>, res: Response): Promise<void> => {
    try {
      const personId = Number.parseInt(req.params.personId, 10);
      const tpCode = Number.parseInt(req.params.tpCode, 10);
      if (!Number.isInteger(personId) || !Number.isInteger(tpCode)) {
        ErrorResponses.badRequest(res, 'Invalid patient id or time point code');
        return;
      }

      const { tpDescription, tpDateTime } = req.body as {
        tpDescription?: string;
        tpDateTime?: string;
      };
      if (tpDescription === undefined && tpDateTime === undefined) {
        ErrorResponses.badRequest(res, 'Nothing to update: provide tpDescription and/or tpDateTime');
        return;
      }
      if (tpDateTime !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(tpDateTime)) {
        ErrorResponses.badRequest(res, 'Invalid tpDateTime (expected YYYY-MM-DD)');
        return;
      }

      const existing = await getNativeTimePoint(personId, tpCode);
      if (!existing) {
        ErrorResponses.notFound(res, 'Time point');
        return;
      }

      // Resolve the final (name, date) as a partial patch over the current row.
      const finalName = (tpDescription ?? existing.tp_description ?? '').trim();
      const finalDate = tpDateTime ?? existing.tp_date_time;
      if (!finalName) {
        ErrorResponses.badRequest(res, 'Time point name cannot be empty');
        return;
      }
      // The name becomes a folder segment on the share — reject unsafe characters.
      try {
        sanitizeName(finalName);
      } catch {
        ErrorResponses.badRequest(res, 'Name cannot contain path characters such as / \\ :');
        return;
      }

      const result = await updateNativeTimePoint(personId, tpCode, finalName, finalDate);
      if (!result.ok && result.conflict) {
        ErrorResponses.conflict(res, 'Another time point already has that name and date');
        return;
      }

      // Rename the originals folder if the (name, date)-derived folder changed.
      const oldFolder = timepointFolderName(existing.tp_description ?? '', existing.tp_date_time);
      const newFolder = timepointFolderName(finalName, finalDate);
      if (oldFolder && newFolder && oldFolder !== newFolder) {
        try {
          await renameEntry(personId, oldFolder, newFolder);
          log.info('[TimePoint] renamed originals folder', { personId, from: oldFolder, to: newFolder });
        } catch (err) {
          if (err instanceof FileExplorerError && err.status === 404) {
            // No originals folder for this time point — nothing to rename.
          } else if (err instanceof FileExplorerError && err.status === 409) {
            log.warn('[TimePoint] originals folder rename skipped — target exists', { personId, newFolder });
          } else {
            log.warn('[TimePoint] originals folder rename failed', {
              personId,
              from: oldFolder,
              to: newFolder,
              error: (err as Error).message,
            });
          }
        }
      }

      // Keep tblwork's Initial/Final photo date in sync when the date changed.
      const dateChanged = tpDateTime !== undefined && finalDate !== existing.tp_date_time;
      const lname = finalName.toLowerCase();
      if (dateChanged && (lname === 'initial' || lname === 'final')) {
        const parsed = parseLocalDate(finalDate);
        if (parsed) {
          await updatePhotoDate(String(personId), lname === 'initial' ? 'i_photo_date' : 'f_photo_date', parsed);
          log.info('[TimePoint] synced tblwork photo date', { personId, field: lname, date: finalDate });
        }
      }

      sendData(res, patientContract.updateTimepoint.response, { tpCode, tp_description: finalName, tp_date_time: finalDate });
    } catch (error) {
      log.error('Error updating time point:', error);
      ErrorResponses.internalError(res, 'Failed to update time point', error as Error);
    }
  }
);

/**
 * Delete a time point and all of its on-disk artifacts (permanent).
 * DELETE /patients/:personId/timepoints/:tpCode
 *
 * DB delete is authoritative (cascades to tblTimePointImages). Filesystem
 * cleanup — the rendered working/ files and the originals folder — is
 * best-effort so a missing file/folder never fails the request.
 */
router.delete(
  '/patients/:personId/timepoints/:tpCode',
  authorize(FINANCE_ROLES),
  validate({ params: timepointParams }),
  async (req: Request<{ personId: string; tpCode: string }>, res: Response): Promise<void> => {
    try {
      const personId = Number.parseInt(req.params.personId, 10);
      const tpCode = Number.parseInt(req.params.tpCode, 10);
      if (!Number.isInteger(personId) || !Number.isInteger(tpCode)) {
        ErrorResponses.badRequest(res, 'Invalid patient id or time point code');
        return;
      }

      // Scope controls how much is removed:
      //   'cropped' — only the rendered working/ files (keep DB entry + originals folder)
      //   'entry'   — working/ files + DB time-point row (keep originals folder)
      //   'all'     — working/ files + DB row + originals folder (full, permanent)
      const scope = String(req.query.scope ?? 'all');
      if (scope !== 'all' && scope !== 'entry' && scope !== 'cropped') {
        ErrorResponses.badRequest(res, "Invalid scope (expected 'all', 'entry', or 'cropped')");
        return;
      }

      const existing = await getNativeTimePoint(personId, tpCode);
      if (!existing) {
        ErrorResponses.notFound(res, 'Time point');
        return;
      }

      // Always remove the rendered (cropped) working files for this time point.
      await deleteWorkingFilesForTimepoint(personId, tpCode);

      // Remove the DB entry unless we're only clearing cropped photos.
      if (scope === 'all' || scope === 'entry') {
        await deleteNativeTimePoint(personId, tpCode);
      }

      // Remove the originals folder only for a full delete (best-effort).
      if (scope === 'all') {
        const folder = timepointFolderName(existing.tp_description ?? '', existing.tp_date_time);
        if (folder) {
          try {
            await hardDelete(personId, folder);
          } catch (err) {
            log.warn('[TimePoint] originals folder delete failed', {
              personId,
              folder,
              error: (err as Error).message,
            });
          }
        }
      }

      log.info('[TimePoint] deleted', { userId: req.session?.userId, personId, tpCode, scope });
      sendData(res, patientContract.deleteTimepoint.response, { scope });
    } catch (error) {
      log.error('Error deleting time point:', error);
      ErrorResponses.internalError(res, 'Failed to delete time point', error as Error);
    }
  }
);

/**
 * Get gallery images for a patient
 * GET /patients/:personId/gallery/:tp
 */
router.get(
  '/patients/:personId/gallery/:tp',
  async (
    req: Request<{ personId: string; tp: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId, tp } = req.params;
      const images = await imaging.getImageSizes(personId, tp);
      sendData(res, patientContract.gallery.response, images);
    } catch (error) {
      log.error('Error getting gallery images:', error);
      ErrorResponses.internalError(res, 'Failed to load gallery images', {
        message: (error as Error).message
      });
    }
  }
);

/**
 * Get and process X-ray image
 * GET /patients/:personId/xray?file={filename}&detailsDir={directory}
 */
router.get(
  '/patients/:personId/xray',
  async (
    req: Request<{ personId: string }, unknown, unknown, { file?: string; detailsDir?: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      const { file, detailsDir } = req.query;

      if (!file) {
        log.warn('X-ray request missing file parameter', { personId });
        ErrorResponses.badRequest(
          res,
          'Missing required parameter: file'
        );
        return;
      }

      const imagePath = await imaging.processXrayImage(
        personId,
        file,
        detailsDir || ''
      );
      res.sendFile(imagePath);
    } catch (error) {
      log.error('Error processing X-ray:', error);
      ErrorResponses.internalError(res, 'X-ray processing failed', {
        message: (error as Error).message,
        note: 'X-ray processing tool may not be available in this environment'
      });
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
 * last-appointment age/date-range, final-photo presence, and unpaid balance.
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
      const searchQuery = req.query.q || '';
      const patientName = req.query.patientName || '';
      const firstName = req.query.firstName || '';
      const lastName = req.query.lastName || '';
      const workTypesParam = req.query.workTypes || '';
      const keywordsParam = req.query.keywords || '';
      const tagsParam = req.query.tags || '';
      const patientTypesParam = req.query.patientTypes || '';
      const lastAppointmentParam = req.query.lastAppointment || '';
      const lastAppointmentFrom = req.query.lastAppointmentFrom || '';
      const lastAppointmentTo = req.query.lastAppointmentTo || '';
      const finalPhotos = req.query.finalPhotos || '';
      const hasDebt = req.query.hasDebt === 'true';
      const nameStartsWith = req.query.nameStartsWith === 'true';

      const sortBy = req.query.sortBy || 'name';
      const order = req.query.order || 'asc';

      // Pagination (validated + coerced by the contract). Max 500 per page.
      const limit = Math.min(req.query.limit ?? 100, 500);
      const offset = req.query.offset ?? 0;

      // Parse comma-separated IDs into arrays
      const workTypeIds = workTypesParam
        ? workTypesParam
            .split(',')
            .map((id) => parseInt(id.trim()))
            .filter((id) => !isNaN(id))
        : [];
      const keywordIds = keywordsParam
        ? keywordsParam
            .split(',')
            .map((id) => parseInt(id.trim()))
            .filter((id) => !isNaN(id))
        : [];
      const tagIds = tagsParam
        ? tagsParam
            .split(',')
            .map((id) => parseInt(id.trim()))
            .filter((id) => !isNaN(id))
        : [];
      const patientTypeIds = patientTypesParam
        ? patientTypesParam
            .split(',')
            .map((id) => parseInt(id.trim()))
            .filter((id) => !isNaN(id))
        : [];

      const db = getKysely();

      // Build WHERE conditions as composable SQL fragments. Each fragment
      // carries its own inline bindings, so we no longer maintain a separate
      // parameter tuple array (PG binds positionally via the sql tag).
      const whereConditions: RawBuilder<unknown>[] = [];

      // Search by individual name fields
      // Use 'starts with' pattern if nameStartsWith is true, otherwise 'contains'
      const namePrefix = nameStartsWith ? '' : '%';

      // `col::text ILIKE` (not citext LIKE): same case-insensitive semantics, but it matches the
      // gin_trgm_ops expression indexes ix_patients_*_trgm — citext's own LIKE operator can't use
      // them and would seq-scan. Keep cast + operator in lockstep with the index expressions.
      if (patientName.trim()) {
        whereConditions.push(
          sql`p."patient_name"::text ILIKE ${`${namePrefix}${patientName.trim()}%`}`
        );
      }

      if (firstName.trim()) {
        whereConditions.push(
          sql`p."first_name"::text ILIKE ${`${namePrefix}${firstName.trim()}%`}`
        );
      }

      if (lastName.trim()) {
        whereConditions.push(
          sql`p."last_name"::text ILIKE ${`${namePrefix}${lastName.trim()}%`}`
        );
      }

      // General search (phone or id). Honours the same nameStartsWith flag as
      // the name fields: prefix match (index-seekable) when set, substring
      // otherwise — substring stays the default so "last 4 digits" search works.
      // An all-digit query also matches person_id exactly: the client's
      // "Phone/ID" combobox offers ID jumps, so the built list must honour IDs too.
      if (searchQuery.trim()) {
        const q = searchQuery.trim();
        const searchPattern = `${namePrefix}${q}%`;
        const phoneMatch = sql`(p."phone"::text ILIKE ${searchPattern} OR p."phone2"::text ILIKE ${searchPattern})`;
        whereConditions.push(
          /^\d+$/.test(q) && Number.isSafeInteger(Number(q))
            ? sql`(${phoneMatch} OR p."person_id" = ${Number(q)})`
            : phoneMatch
        );
      }

      // Filter by work types (ANY work, past or current)
      if (workTypeIds.length > 0) {
        whereConditions.push(sql`EXISTS (
                SELECT 1 FROM "works" w
                WHERE w."person_id" = p."person_id"
                AND w."type_of_work" IN (${sql.join(workTypeIds)})
            )`);
      }

      // Filter by keywords (check all 5 keyword columns)
      if (keywordIds.length > 0) {
        const keywordList = sql.join(keywordIds);
        whereConditions.push(sql`EXISTS (
                SELECT 1 FROM "works" w
                WHERE w."person_id" = p."person_id"
                AND (
                    w."keyword_id_1" IN (${keywordList})
                    OR w."keyword_id_2" IN (${keywordList})
                    OR w."keyword_id_3" IN (${keywordList})
                    OR w."keyword_id_4" IN (${keywordList})
                    OR w."keyword_id_5" IN (${keywordList})
                )
            )`);
      }

      // Filter by patient tags
      if (tagIds.length > 0) {
        whereConditions.push(sql`p."tag_id" IN (${sql.join(tagIds)})`);
      }

      // Filter by patient types
      if (patientTypeIds.length > 0) {
        whereConditions.push(
          sql`p."patient_type_id" IN (${sql.join(patientTypeIds)})`
        );
      }

      // Filter by last appointment. The correlated MAX is an index-only probe on
      // ix_pid_all (person_id, app_date); a NULL max (patient with no
      // appointments) fails every comparison, so such patients are excluded —
      // same semantics as the old EXISTS-over-GROUP-BY, without scanning the
      // whole appointments table per condition.
      const latestAppointment = sql`(
        SELECT MAX(a."app_date") FROM "appointments" a
        WHERE a."person_id" = p."person_id"
      )`;

      // Presets: "more than N ago".
      if (lastAppointmentParam) {
        const presetIntervals: Record<string, RawBuilder<unknown>> = {
          '1month': sql`interval '1 month'`,
          '3months': sql`interval '3 months'`,
          '6months': sql`interval '6 months'`,
          '1year': sql`interval '1 year'`,
        };
        whereConditions.push(
          sql`${latestAppointment} < (LOCALTIMESTAMP - ${presetIntervals[lastAppointmentParam]})`
        );
      }

      // Custom range: last appointment on/after From and/or on/before To (each
      // bound optional). app_date is a timestamp, so "on/before To" means
      // strictly before the following midnight.
      if (lastAppointmentFrom) {
        whereConditions.push(sql`${latestAppointment} >= ${lastAppointmentFrom}::date`);
      }
      if (lastAppointmentTo) {
        whereConditions.push(sql`${latestAppointment} < (${lastAppointmentTo}::date + 1)`);
      }

      // Filter by final-photo presence (tri-state: absent | 'has' | 'none').
      // A patient "has final photos" when EITHER marker is set: a 'Final' time
      // point (Dolphin imaging) or a work's f_photo_date (the Works form field).
      // The two overlap ~98% in practice but each catches rows the other misses.
      if (finalPhotos) {
        const hasFinalPhotosCondition = sql`(EXISTS (
                SELECT 1 FROM "time_points" tp
                WHERE tp."person_id" = p."person_id"
                AND tp."tp_description" LIKE '%Final%'
            ) OR EXISTS (
                SELECT 1 FROM "works" wf
                WHERE wf."person_id" = p."person_id"
                AND wf."f_photo_date" IS NOT NULL
            ))`;
        whereConditions.push(
          finalPhotos === 'has' ? hasFinalPhotosCondition : sql`NOT ${hasFinalPhotosCondition}`
        );
      }

      // Filter by outstanding balance on any work: total_required − discount −
      // Σ invoices.amount_paid > 0 — the same remaining-balance formula
      // PaymentService enforces on payment creation. Per-work, so the dual
      // currencies never mix; ix_works_personid + ix_wid_date_sum (work_id
      // INCLUDE amount_paid) keep both probes index-only.
      if (hasDebt) {
        whereConditions.push(sql`EXISTS (
                SELECT 1 FROM "works" wd
                WHERE wd."person_id" = p."person_id"
                AND wd."total_required" - COALESCE(wd."discount", 0) > COALESCE(
                    (SELECT SUM(i."amount_paid") FROM "invoices" i WHERE i."work_id" = wd."work_id"), 0)
            )`);
      }

      const whereClause = whereConditions.length
        ? sql`WHERE ${sql.join(whereConditions, sql` AND `)}`
        : sql``;

      // Determine ORDER BY clause
      let orderByClause: RawBuilder<unknown> = sql`ORDER BY p."patient_name" ASC`;
      if (sortBy === 'date') {
        // References the to_char(...)'d select-list alias — a 'YYYY-MM-DD'
        // string, which sorts correctly by day.
        orderByClause =
          order === 'desc'
            ? sql`ORDER BY "date_added" DESC NULLS LAST`
            : sql`ORDER BY "date_added" ASC NULLS LAST`;
      } else if (sortBy === 'lastVisit') {
        // Same alias-reference as date_added: the last_visit subquery is
        // exposed only as its select-list alias, a 'YYYY-MM-DD' string that
        // sorts correctly by day. Patients with no appointments sort last.
        orderByClause =
          order === 'desc'
            ? sql`ORDER BY "last_visit" DESC NULLS LAST`
            : sql`ORDER BY "last_visit" ASC NULLS LAST`;
      } else if (sortBy === 'id') {
        orderByClause =
          order === 'desc'
            ? sql`ORDER BY p."person_id" DESC`
            : sql`ORDER BY p."person_id" ASC`;
      } else {
        orderByClause =
          order === 'desc'
            ? sql`ORDER BY p."patient_name" DESC`
            : sql`ORDER BY p."patient_name" ASC`;
      }

      // First, get the total count of matching patients.
      // No JOINs here: every filter references p.* directly or via EXISTS /
      // correlated subqueries, so the lookup-table joins add nothing to the count.
      const countResult = await sql<{ totalCount: number | string }>`
            SELECT COUNT(*) as "totalCount"
            FROM "patients" p
            ${whereClause}
        `.execute(db);

      const totalCount = Number(countResult.rows[0]?.totalCount ?? 0);

      // Now get the paginated results. No DISTINCT: patients is keyed by
      // person_id and every join below is on the target table's PK (at most one
      // row each), so rows can't multiply — DISTINCT only forced the planner to
      // dedupe over the whole select list (subselects included) for nothing.
      const { rows: patients } = await sql<PatientSearchResult>`
            SELECT
                    p."person_id", p."patient_name", p."first_name", p."last_name",
                    p."phone", p."phone2", p."email", p."date_of_birth", p."gender",
                    p."address_id", p."referral_source_id", p."patient_type_id", p."tag_id",
                    p."notes", p."language", p."country_code",
                    p."estimated_cost", p."currency", to_char(p."date_added", 'YYYY-MM-DD') as "date_added",
                    (
                        SELECT to_char(MAX(la."app_date"), 'YYYY-MM-DD')
                        FROM "appointments" la
                        WHERE la."person_id" = p."person_id"
                    ) as "last_visit",
                    CASE p."gender" WHEN 1 THEN 'Male' WHEN 2 THEN 'Female' END as "GenderName", a."zone" as "AddressName",
                    r."referral" as "ReferralSource", pt."patient_type" as "PatientTypeName",
                    tag."tag" as "TagName",
                    (
                        SELECT STRING_AGG(wt."work_type", ', ')
                        FROM (
                            SELECT DISTINCT wt2."work_type"
                            FROM "works" w2
                            INNER JOIN "work_types" wt2 ON w2."type_of_work" = wt2."id"
                            WHERE w2."person_id" = p."person_id" AND w2."status" = 1
                        ) wt
                    ) as "ActiveWorkTypes"
            FROM "patients" p
            LEFT JOIN "addresses" a ON p."address_id" = a."id"
            LEFT JOIN "referrals" r ON p."referral_source_id" = r."id"
            LEFT JOIN "patient_types" pt ON p."patient_type_id" = pt."id"
            LEFT JOIN "tag_options" tag ON p."tag_id" = tag."id"
            ${whereClause}
            ${orderByClause}
            LIMIT ${limit} OFFSET ${offset}
        `.execute(db);

      const hasMore = offset + patients.length < totalCount;

      sendData(res, patientContract.patientSearch.response, {
        patients,
        totalCount,
        hasMore
      });
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
      const { rows: tags } = await sql<TagOption>`
        SELECT "id" as "id", "tag" as "tag" FROM "tag_options" ORDER BY "tag"
      `.execute(getKysely());
      sendData(res, patientContract.tagOptions.response, tags);
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
      const { rows: types } = await sql<PatientTypeOption>`
        SELECT "id" as "id", "patient_type" as "type" FROM "patient_types" ORDER BY "patient_type"
      `.execute(getKysely());
      sendData(res, patientContract.typeOptions.response, types);
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
 */
router.post(
  '/patients',
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
        dateOfBirth?: Date;
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
        dateOfBirth: patientData.dateOfBirth
          ? new Date(patientData.dateOfBirth)
          : undefined,
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
 */
router.put(
  '/patients/:personId',
  validate({ params: personIdParams, body: patientContract.updatePatient.body }),
  async (
    req: Request<{ personId: string }, unknown, patientContract.UpdatePatientBody>,
    res: Response
  ): Promise<void> => {
    const patientData = req.body;

    try {
      const personId = parseInt(req.params.personId);

      // Basic validation
      if (!patientData.patient_name || !patientData.patient_name.trim()) {
        log.warn('Update patient missing name', { personId });
        ErrorResponses.badRequest(res, 'Patient name is required');
        return;
      }

      // Convert date string to Date object for the database layer
      const updateData = {
        ...patientData,
        date_of_birth: patientData.date_of_birth
          ? new Date(patientData.date_of_birth)
          : undefined
      };

      await updatePatient(personId, updateData);
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
      const personId = parseInt((req.params as { personId: string }).personId);
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
      const personId = parseInt(req.params.personId);
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

      await sql`
        UPDATE "patients"
        SET "estimated_cost" = ${estimatedCost || null},
            "currency" = ${currency || 'IQD'}
        WHERE "person_id" = ${personId}
      `.execute(getKysely());

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
// ALERT MANAGEMENT
// ============================================================================

/**
 * Get alerts for a patient
 * GET /patients/:personId/alerts
 */
router.get(
  '/patients/:personId/alerts',
  authenticate,
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);

      if (isNaN(personId)) {
        log.warn('Get alerts invalid patient id', { personId: req.params.personId });
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }

      const alerts = await getAlertsByPersonId(personId);
      sendData(res, patientContract.alerts.response, alerts);
    } catch (error) {
      log.error('Error fetching patient alerts:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch alerts',
        error as Error
      );
    }
  }
);

/**
 * Create a new alert for a patient
 * POST /patients/:personId/alerts
 */
router.post(
  '/patients/:personId/alerts',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ params: personIdParams, body: patientContract.alertBody }),
  async (
    req: Request<{ personId: string }, unknown, patientContract.AlertBody>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { alertTypeId, alertSeverity, alertDetails, surfaceMode, expiresAt, escalateAt, assignedTo } = req.body;

      if (!alertDetails) {
        log.warn('Create alert missing details', { personId });
        ErrorResponses.badRequest(res, 'Alert details are required');
        return;
      }

      // Quit employees can't be newly assigned (hidden everywhere but Settings).
      if (assignedTo != null && !(await employeeIsActive(assignedTo))) {
        ErrorResponses.badRequest(res, 'Cannot assign to an inactive (quit) employee');
        return;
      }

      // Use defaults for quick-add (alertTypeId=1 General, alertSeverity=2 Medium)
      await createAlert({
        person_id: personId,
        alert_type_id: alertTypeId ? parseInt(String(alertTypeId), 10) : 1,
        alert_severity: alertSeverity ? parseInt(String(alertSeverity), 10) : 2,
        alert_details: alertDetails,
        surface_mode: surfaceMode,
        expires_at: expiresAt,
        escalate_at: escalateAt,
        assigned_to: assignedTo ?? null,
      });

      // Notify the assignee over WhatsApp (fire-and-forget; never blocks/fails the create).
      if (assignedTo != null) {
        void notifyTaskAssignment(assignedTo, alertDetails);
      }

      sendSuccess(res, null, 'Alert created successfully', 201);
    } catch (error) {
      log.error('Error creating alert:', error);
      ErrorResponses.internalError(
        res,
        'Failed to create alert',
        error as Error
      );
    }
  }
);

/**
 * Activate or deactivate an alert
 * PUT /alerts/:alertId/status
 */
router.put(
  '/alerts/:alertId/status',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ params: alertIdParams, body: patientContract.alertStatus.body }),
  async (
    req: Request<{ alertId: string }, unknown, patientContract.AlertStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const alertId = parseInt(req.params.alertId, 10);
      const { status } = req.body;

      await setAlertStatus(alertId, status, req.session.username ?? null);

      sendSuccess(res, null, `Alert status updated to ${status}`);
    } catch (error) {
      log.error('Error updating alert status:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update alert status',
        error as Error
      );
    }
  }
);

/**
 * Update an alert
 * PUT /alerts/:alertId
 */
router.put(
  '/alerts/:alertId',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ params: alertIdParams, body: patientContract.alertBody }),
  async (
    req: Request<{ alertId: string }, unknown, patientContract.AlertBody>,
    res: Response
  ): Promise<void> => {
    try {
      const alertId = parseInt(req.params.alertId, 10);
      const { alertTypeId, alertSeverity, alertDetails, surfaceMode, expiresAt, escalateAt, assignedTo } = req.body;

      if (isNaN(alertId)) {
        log.warn('Update alert invalid alert id', { alertId: req.params.alertId });
        ErrorResponses.badRequest(res, 'Invalid alert id');
        return;
      }

      if (!alertDetails) {
        log.warn('Update alert missing details', { alertId });
        ErrorResponses.badRequest(res, 'Alert details are required');
        return;
      }

      // Block re-assigning to a quit employee, but allow KEEPING an existing
      // assignment to one — we deliberately leave those in place when an
      // employee quits, so re-saving an already-assigned task must not 400.
      // `isNewAssignee` also gates the WhatsApp notification: only a genuinely
      // changed assignee is notified, so a plain edit/re-save doesn't re-ping them.
      let isNewAssignee = false;
      if (assignedTo != null) {
        const current = await getAlertAssignedTo(alertId);
        isNewAssignee = assignedTo !== current;
        if (isNewAssignee && !(await employeeIsActive(assignedTo))) {
          ErrorResponses.badRequest(res, 'Cannot assign to an inactive (quit) employee');
          return;
        }
      }

      await updateAlert(alertId, {
        alert_type_id: alertTypeId,
        alert_severity: alertSeverity,
        alert_details: alertDetails,
        surface_mode: surfaceMode,
        expires_at: expiresAt,
        escalate_at: escalateAt,
        assigned_to: assignedTo,
      });

      // Notify a newly-assigned employee over WhatsApp (fire-and-forget).
      if (isNewAssignee && assignedTo != null) {
        void notifyTaskAssignment(assignedTo, alertDetails);
      }

      sendSuccess(res, null, 'Alert updated successfully');
    } catch (error) {
      log.error('Error updating alert:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update alert',
        error as Error
      );
    }
  }
);

/**
 * Snooze (or un-snooze) an alert in the header
 * PUT /alerts/:alertId/snooze
 */
router.put(
  '/alerts/:alertId/snooze',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ params: alertIdParams, body: patientContract.alertSnooze.body }),
  async (
    req: Request<{ alertId: string }, unknown, patientContract.AlertSnoozeBody>,
    res: Response
  ): Promise<void> => {
    try {
      const alertId = parseInt(req.params.alertId, 10);
      await setAlertSnooze(alertId, req.body.snoozedUntil);
      sendSuccess(res, null, 'Alert snooze updated');
    } catch (error) {
      log.error('Error snoozing alert:', error);
      ErrorResponses.internalError(res, 'Failed to snooze alert', error as Error);
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

// ============================================================================
// PATIENT PORTAL ADMIN ROUTES (staff-facing)
// ============================================================================

/**
 * GET /api/patients/:personId/portal
 * Fetch portal status + QR code for staff UI.
 */
router.get(
  '/patients/:personId/portal',
  authorize(FINANCE_ROLES),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      const [status, qr] = await Promise.all([
        PatientPortalService.getStatus(personId),
        PatientPortalService.getQrDataUrl(personId),
      ]);
      sendData(res, patientContract.portalStatus.response, {
        enabled: status.enabled,
        hasPin: status.hasPin,
        lockedUntil: status.lockedUntil,
        lastLoginAt: status.lastLoginAt,
        failedAttempts: status.failedAttempts,
        qrDataUrl: qr.qr,
        portalUrl: qr.url,
      });
    } catch (error) {
      log.error('Portal status fetch error', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to load portal status', error as Error);
    }
  }
);

/**
 * POST /api/patients/:personId/portal/reset-pin
 * Regenerate default PIN (last-4-phone → DDMM-DOB fallback). Returns plaintext ONCE.
 */
router.post(
  '/patients/:personId/portal/reset-pin',
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams }),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      const pin = await PatientPortalService.resetToDefaultPin(personId);
      sendData(res, patientContract.resetPin.response, { pin });
    } catch (error) {
      const msg = (error as Error).message;
      log.warn('Portal reset-pin failed', { error: msg });
      ErrorResponses.badRequest(res, msg);
    }
  }
);

/**
 * POST /api/patients/:personId/portal/enable
 * Enable/disable portal access for the patient.
 */
router.post(
  '/patients/:personId/portal/enable',
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams, body: patientContract.portalEnable.body }),
  async (
    req: Request<{ personId: string }, unknown, patientContract.PortalEnableBody>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { enabled } = req.body;
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      if (typeof enabled !== 'boolean') {
        ErrorResponses.badRequest(res, '`enabled` must be a boolean');
        return;
      }
      await PatientPortalService.setEnabled(personId, enabled);
      sendSuccess(res, null);
    } catch (error) {
      ErrorResponses.internalError(res, 'Failed to update portal access', error as Error);
    }
  }
);

/**
 * POST /api/patients/:personId/portal/unlock
 * Clear lockout counter.
 */
router.post(
  '/patients/:personId/portal/unlock',
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams }),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      await PatientPortalService.unlock(personId);
      sendSuccess(res, null);
    } catch (error) {
      ErrorResponses.internalError(res, 'Failed to unlock portal', error as Error);
    }
  }
);

// ============================================================================
// PHOTO VISIBILITY ROUTES (staff-facing)
// ============================================================================

/**
 * GET /api/patients/:personId/photos/visibility
 * List photos currently marked private for this patient.
 */
router.get(
  '/patients/:personId/photos/visibility',
  authorize(FINANCE_ROLES),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      const rows = await PatientPortalService.getPrivateList(personId);
      sendData(res, patientContract.photoVisibilityList.response, {
        privateImages: rows.map((r) => ({ tp: r.timepoint_code, name: r.image_name })),
      });
    } catch (error) {
      ErrorResponses.internalError(res, 'Failed to load photo visibility', error as Error);
    }
  }
);

/**
 * POST /api/patients/:personId/photos/visibility
 * Toggle private/public for a specific photo.
 * Body: { tp: string, name: string, isPrivate: boolean }
 */
router.post(
  '/patients/:personId/photos/visibility',
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams, body: patientContract.photoVisibility.body }),
  async (
    req: Request<{ personId: string }, unknown, patientContract.PhotoVisibilityBody>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { tp, name, isPrivate } = req.body;
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      if (!tp || !name || typeof isPrivate !== 'boolean') {
        ErrorResponses.badRequest(res, '`tp`, `name`, and `isPrivate` are required');
        return;
      }
      const byUserId = req.session.userId ?? null;
      await PatientPortalService.togglePhotoPrivacy(personId, tp, name, isPrivate, byUserId);
      sendSuccess(res, null);
    } catch (error) {
      ErrorResponses.internalError(res, 'Failed to update photo visibility', error as Error);
    }
  }
);

export default router;
