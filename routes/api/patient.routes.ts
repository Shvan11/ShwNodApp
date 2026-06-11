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
  createPatient,
  getPatientById,
  updatePatient,
  deletePatient,
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
import {
  requireRecordAge,
  getPatientCreationDate
} from '../../middleware/time-based-auth.js';
import { getOption } from '../../services/database/queries/options-queries.js';
import { ErrorResponses, sendSuccess, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import * as patientContract from '../../shared/contracts/patient.contract.js';
import * as PatientService from '../../services/business/PatientService.js';
import { PatientValidationError } from '../../services/business/PatientService.js';
import { transliterateNameToEnglish } from '../../services/business/name-transliteration.js';
import * as PatientPortalService from '../../services/business/PatientPortalService.js';
import {
  getNativeTimePoint,
  updateNativeTimePoint,
  deleteNativeTimePoint,
  getTimePointCodesForPatient,
} from '../../services/database/queries/native-timepoint-queries.js';
import { updatePhotoDate, updatePatientName } from '../../services/database/queries/photo-session-queries.js';
import {
  deleteWorkingFilesForTimepoint,
  deleteWorkingFilesForPatient,
  timepointFolderName,
} from '../../services/imaging/photo-cleanup.service.js';
import { purgeDolphinPatient } from '../../services/sync/cdc/dolphin-sink.js';
import {
  renameEntry,
  hardDelete,
  deletePatientFolder,
  entryExists,
  sanitizeName,
  FileExplorerError,
} from '../../services/files/file-explorer.service.js';
import type { PatientSearchQuery } from '../../types/api.types.js';

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
  authorize(['admin', 'secretary']),
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
  authorize(['admin', 'secretary']),
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
 * Search patients by name, phone, id, work type, keywords, and tags
 * GET /patients/search?q={query}&patientName={name}&firstName={first}&lastName={last}&workTypes={ids}&keywords={ids}&tags={ids}
 */
router.get(
  '/patients/search',
  async (
    req: Request<unknown, unknown, unknown, PatientSearchQuery & { q?: string }>,
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
      const hasFinalPhotos = req.query.hasFinalPhotos === 'true';
      const nameStartsWith = req.query.nameStartsWith === 'true';

      const sortBy = req.query.sortBy || 'name';
      const order = req.query.order || 'asc';

      // Pagination parameters
      const limit = Math.min(
        parseInt(req.query.limit as string) || 100,
        500
      ); // Max 500
      const offset = parseInt(req.query.offset as string) || 0;

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
      if (searchQuery.trim()) {
        const searchPattern = `${namePrefix}${searchQuery.trim()}%`;
        whereConditions.push(
          sql`(p."phone"::text ILIKE ${searchPattern} OR p."phone2"::text ILIKE ${searchPattern})`
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

      // Filter by last appointment date
      if (lastAppointmentParam) {
        let dateCondition: RawBuilder<unknown>;
        switch (lastAppointmentParam) {
          case '1month':
            dateCondition = sql`(LOCALTIMESTAMP - interval '1 month')`;
            break;
          case '3months':
            dateCondition = sql`(LOCALTIMESTAMP - interval '3 months')`;
            break;
          case '6months':
            dateCondition = sql`(LOCALTIMESTAMP - interval '6 months')`;
            break;
          case '1year':
            dateCondition = sql`(LOCALTIMESTAMP - interval '1 year')`;
            break;
          default:
            // Custom date (ISO format)
            dateCondition = sql`${lastAppointmentParam}::timestamp`;
        }

        whereConditions.push(sql`EXISTS (
          SELECT 1 FROM (
            SELECT "person_id", MAX("app_date") AS "LatestApp"
            FROM "appointments"
            GROUP BY "person_id"
          ) la
          WHERE la."person_id" = p."person_id"
          AND la."LatestApp" < ${dateCondition}
        )`);
      }

      // Filter by has final photos (local timepoint with 'Final' in description)
      if (hasFinalPhotos) {
        whereConditions.push(sql`EXISTS (
                SELECT 1 FROM "time_points" tp
                WHERE tp."person_id" = p."person_id"
                AND tp."tp_description" LIKE '%Final%'
            )`);
      }

      const whereClause = whereConditions.length
        ? sql`WHERE ${sql.join(whereConditions, sql` AND `)}`
        : sql``;

      // Determine ORDER BY clause
      let orderByClause: RawBuilder<unknown> = sql`ORDER BY p."patient_name" ASC`;
      if (sortBy === 'date') {
        // Reference the output alias, not p."date_added": SELECT DISTINCT
        // requires every ORDER BY expression to appear in the select list, and
        // date_added is exposed there only as the to_char(...)'d alias. The
        // alias is a 'YYYY-MM-DD' string, which sorts correctly by day.
        orderByClause =
          order === 'desc'
            ? sql`ORDER BY "date_added" DESC NULLS LAST`
            : sql`ORDER BY "date_added" ASC NULLS LAST`;
      } else {
        orderByClause =
          order === 'desc'
            ? sql`ORDER BY p."patient_name" DESC`
            : sql`ORDER BY p."patient_name" ASC`;
      }

      // First, get the total count of matching patients.
      // No JOINs here: every filter references p.* directly or via EXISTS
      // subqueries, so the 5 lookup-table joins added nothing to the count.
      const countResult = await sql<{ totalCount: number | string }>`
            SELECT COUNT(DISTINCT p."person_id") as "totalCount"
            FROM "patients" p
            ${whereClause}
        `.execute(db);

      const totalCount = Number(countResult.rows[0]?.totalCount ?? 0);

      // Now get the paginated results
      const { rows: patients } = await sql<PatientSearchResult>`
            SELECT DISTINCT
                    p."person_id", p."patient_name", p."first_name", p."last_name",
                    p."phone", p."phone2", p."email", p."date_of_birth", p."gender",
                    p."address_id", p."referral_source_id", p."patient_type_id", p."tag_id",
                    p."notes", p."language", p."country_code",
                    p."estimated_cost", p."currency", to_char(p."date_added", 'YYYY-MM-DD') as "date_added",
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

      // Trim string values and prepare data for createPatient
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
        patientTypeID?: number;
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
        patientTypeID: patientData.patientTypeID,
        tagID: patientData.tagID,
        notes: patientData.notes?.trim() || undefined,
        language: patientData.language?.trim() || undefined,
        countryCode: patientData.countryCode?.trim() || undefined,
        estimatedCost: patientData.estimatedCost,
        currency: patientData.currency?.trim() || undefined
      };

      // Create the patient
      const result = await createPatient(processedData);

      sendData(res, patientContract.createPatient.response, { personId: result.personId }, 'Patient created successfully');

      // English first/last not supplied → auto-fill by romanizing the Arabic patientName
      // with Gemini, AFTER responding so the create request never blocks on the API call.
      // Best-effort, fire-and-forget: only fills the missing field(s), and silently keeps
      // them empty if Gemini is unconfigured / errors / can't produce a clean Latin name.
      if (!processedData.firstName || !processedData.lastName) {
        void (async () => {
          try {
            const ai = await transliterateNameToEnglish(processedData.patientName);
            if (!ai) return;
            await updatePatientName(
              String(result.personId),
              processedData.firstName || ai.firstName,
              processedData.lastName || ai.lastName
            );
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
  authorize(['admin', 'secretary']),
  validate({ params: personIdParams }),
  requireRecordAge({
    resourceType: 'patient',
    operation: 'delete',
    getRecordDate: getPatientCreationDate
  }),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId);

      // Capture the patient's tpCodes BEFORE the delete — deletePatient's cascade
      // (fk_time_points_tblpatients ON DELETE CASCADE) drops the timepoint rows, so
      // afterwards we'd have no way to name the rendered working/ files to remove.
      const tpCodes = await getTimePointCodesForPatient(personId);

      await deletePatient(personId);
      // DB cascade is authoritative; the on-share photo folder is removed after it
      // succeeds. Best-effort + logged: a locked file on the SMB share (EBUSY) must
      // not leave the request hanging in a "record gone but call failed" state.
      let folderRemoved = true;
      try {
        await deletePatientFolder(personId);
      } catch (folderErr) {
        folderRemoved = false;
        log.error('Patient record deleted but folder removal failed', {
          personId,
          error: (folderErr as Error).message,
        });
      }

      // Wipe the rendered working/ gallery files (the originals folder above does NOT
      // cover them — they live in the flat shared working/ dir). Best-effort: each file
      // delete already swallows its own error.
      try {
        await deleteWorkingFilesForPatient(personId, tpCodes);
      } catch (workingErr) {
        log.error('Patient deleted but working/ files cleanup failed', {
          personId,
          error: (workingErr as Error).message,
        });
      }

      // Finish the Dolphin wipe: the CDC sink removes the Dolphin timepoints/images
      // (via the cascade deletes), but never the Dolphin patient row — purge it here so
      // the patient fully disappears from Dolphin Imaging. No-op if Dolphin sync is off.
      try {
        await purgeDolphinPatient(personId);
      } catch (dolphinErr) {
        log.error('Patient deleted but Dolphin purge failed', {
          personId,
          error: (dolphinErr as Error).message,
        });
      }
      sendData(
        res,
        patientContract.deletePatient.response,
        { folderRemoved },
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
  authorize(['admin', 'secretary', 'doctor']),
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
  authorize(['admin', 'secretary', 'doctor']),
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
  authorize(['admin', 'secretary', 'doctor']),
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
  authorize(['admin', 'secretary', 'doctor']),
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
  authorize(['admin', 'secretary', 'doctor']),
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
  authorize(['admin', 'secretary']),
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
  authorize(['admin', 'secretary']),
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
  authorize(['admin', 'secretary']),
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
  authorize(['admin', 'secretary']),
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
  authorize(['admin', 'secretary']),
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
  authorize(['admin', 'secretary']),
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
