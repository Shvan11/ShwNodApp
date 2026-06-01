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
  updateAlert
} from '../../services/database/queries/alert-queries.js';
import * as imaging from '../../services/imaging/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import {
  requireRecordAge,
  getPatientCreationDate
} from '../../middleware/time-based-auth.js';
import { getOption } from '../../services/database/queries/options-queries.js';
import { ErrorResponses } from '../../utils/error-response.js';
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

interface PatientSearchResult {
  PersonID: number;
  PatientName: string;
  FirstName: string | null;
  LastName: string | null;
  Phone: string | null;
  Phone2: string | null;
  Email: string | null;
  DateofBirth: Date | null;
  Gender: number | null;
  AddressID: number | null;
  ReferralSourceID: number | null;
  PatientTypeID: number | null;
  TagID: number | null;
  Notes: string | null;
  Language: string | null;
  CountryCode: string | null;
  EstimatedCost: number | null;
  Currency: string | null;
  DateAdded: Date | null;
  GenderName: string | null;
  AddressName: string | null;
  ReferralSource: string | null;
  PatientTypeName: string | null;
  TagName: string | null;
  ActiveWorkTypes: string | null;
}

interface CreatePatientBody {
  patientName: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  dateOfBirth?: string;
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
}

interface UpdatePatientBody {
  PatientName: string;
  FirstName?: string;
  LastName?: string;
  Phone?: string;
  Phone2?: string;
  Email?: string;
  DateofBirth?: string;
  Gender?: number;
  AddressID?: number;
  ReferralSourceID?: number;
  PatientTypeID?: number;
  TagID?: number;
  Notes?: string;
  Language?: string;
  CountryCode?: string;
  EstimatedCost?: number;
  Currency?: string;
}

interface CreateAlertBody {
  alertTypeId: string | number;
  alertSeverity: string | number;
  alertDetails: string;
}

interface UpdateAlertStatusBody {
  isActive: boolean;
}

interface UpdateAlertBody {
  alertTypeId: number;
  alertSeverity: number;
  alertDetails: string;
}

interface TagOption {
  id: number;
  tag: string;
}

interface PatientTypeOption {
  id: number;
  type: string;
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
      res.json(info);
    } catch (error) {
      if (error instanceof PatientValidationError) {
        res.status(400).json({
          error: error.message,
          code: error.code,
          details: error.details
        });
        return;
      }
      log.error('Error fetching patient info:', error);
      res.status(500).json({
        error: 'Failed to fetch patient information',
        message: (error as Error).message
      });
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
      res.json({ patientsFolder: patientsFolder || '' });
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
      res.json(timepoints);
    } catch (error) {
      if (error instanceof PatientValidationError) {
        res.status(400).json({
          error: error.message,
          code: error.code,
          details: error.details
        });
        return;
      }
      log.error('Error fetching time points:', error);
      res.status(500).json({
        error: 'Failed to fetch time points',
        message: (error as Error).message
      });
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
      res.json(timepointimgs);
    } catch (error) {
      if (error instanceof PatientValidationError) {
        res.status(400).json({
          error: error.message,
          code: error.code,
          details: error.details
        });
        return;
      }
      log.error('Error fetching time point images:', error);
      res.status(500).json({
        error: 'Failed to fetch time point images',
        message: (error as Error).message
      });
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
      const folder = timepointFolderName(existing.tpDescription ?? '', existing.tpDateTime);
      const exists = folder ? await entryExists(personId, folder) : false;
      res.json({ folder, exists });
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
      const finalName = (tpDescription ?? existing.tpDescription ?? '').trim();
      const finalDate = tpDateTime ?? existing.tpDateTime;
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
      const oldFolder = timepointFolderName(existing.tpDescription ?? '', existing.tpDateTime);
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
      const dateChanged = tpDateTime !== undefined && finalDate !== existing.tpDateTime;
      const lname = finalName.toLowerCase();
      if (dateChanged && (lname === 'initial' || lname === 'final')) {
        const parsed = parseLocalDate(finalDate);
        if (parsed) {
          await updatePhotoDate(String(personId), lname === 'initial' ? 'IPhotoDate' : 'FPhotoDate', parsed);
          log.info('[TimePoint] synced tblwork photo date', { personId, field: lname, date: finalDate });
        }
      }

      res.json({ success: true, tpCode, tpDescription: finalName, tpDateTime: finalDate });
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
        const folder = timepointFolderName(existing.tpDescription ?? '', existing.tpDateTime);
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
      res.json({ success: true, scope });
    } catch (error) {
      log.error('Error deleting time point:', error);
      ErrorResponses.internalError(res, 'Failed to delete time point', error as Error);
    }
  }
);

/**
 * Generate and get QR code for a patient
 * GET /patients/:personId/qrcode
 */
router.get(
  '/patients/:personId/qrcode',
  async (
    req: Request<{ personId: string }>,
    res: Response
  ): Promise<void> => {
    const { personId } = req.params;
    await imaging.generateQRCode(personId);
    res.json({ OK: 'OK' });
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
      res.json(images);
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
      res.json(phonesList);
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
 * Search patients by name, phone, ID, work type, keywords, and tags
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

      if (patientName.trim()) {
        whereConditions.push(
          sql`p."PatientName" LIKE ${`${namePrefix}${patientName.trim()}%`}`
        );
      }

      if (firstName.trim()) {
        whereConditions.push(
          sql`p."FirstName" LIKE ${`${namePrefix}${firstName.trim()}%`}`
        );
      }

      if (lastName.trim()) {
        whereConditions.push(
          sql`p."LastName" LIKE ${`${namePrefix}${lastName.trim()}%`}`
        );
      }

      // General search (phone or ID). Honours the same nameStartsWith flag as
      // the name fields: prefix match (index-seekable) when set, substring
      // otherwise — substring stays the default so "last 4 digits" search works.
      if (searchQuery.trim()) {
        const searchPattern = `${namePrefix}${searchQuery.trim()}%`;
        whereConditions.push(
          sql`(p."Phone" LIKE ${searchPattern} OR p."Phone2" LIKE ${searchPattern})`
        );
      }

      // Filter by work types (ANY work, past or current)
      if (workTypeIds.length > 0) {
        whereConditions.push(sql`EXISTS (
                SELECT 1 FROM "tblwork" w
                WHERE w."PersonID" = p."PersonID"
                AND w."Typeofwork" IN (${sql.join(workTypeIds)})
            )`);
      }

      // Filter by keywords (check all 5 keyword columns)
      if (keywordIds.length > 0) {
        const keywordList = sql.join(keywordIds);
        whereConditions.push(sql`EXISTS (
                SELECT 1 FROM "tblwork" w
                WHERE w."PersonID" = p."PersonID"
                AND (
                    w."KeyWordID1" IN (${keywordList})
                    OR w."KeyWordID2" IN (${keywordList})
                    OR w."KeywordID3" IN (${keywordList})
                    OR w."KeywordID4" IN (${keywordList})
                    OR w."KeywordID5" IN (${keywordList})
                )
            )`);
      }

      // Filter by patient tags
      if (tagIds.length > 0) {
        whereConditions.push(sql`p."TagID" IN (${sql.join(tagIds)})`);
      }

      // Filter by patient types
      if (patientTypeIds.length > 0) {
        whereConditions.push(
          sql`p."PatientTypeID" IN (${sql.join(patientTypeIds)})`
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
            SELECT "PersonID", MAX("AppDate") AS "LatestApp"
            FROM "tblappointments"
            GROUP BY "PersonID"
          ) la
          WHERE la."PersonID" = p."PersonID"
          AND la."LatestApp" < ${dateCondition}
        )`);
      }

      // Filter by has final photos (local timepoint with 'Final' in description)
      if (hasFinalPhotos) {
        whereConditions.push(sql`EXISTS (
                SELECT 1 FROM "tblTimePoints" tp
                WHERE tp."PersonID" = p."PersonID"
                AND tp."tpDescription" LIKE '%Final%'
            )`);
      }

      const whereClause = whereConditions.length
        ? sql`WHERE ${sql.join(whereConditions, sql` AND `)}`
        : sql``;

      // Determine ORDER BY clause
      let orderByClause: RawBuilder<unknown> = sql`ORDER BY p."PatientName" ASC`;
      if (sortBy === 'date') {
        orderByClause =
          order === 'desc'
            ? sql`ORDER BY p."DateAdded" DESC`
            : sql`ORDER BY p."DateAdded" ASC`;
      } else {
        orderByClause =
          order === 'desc'
            ? sql`ORDER BY p."PatientName" DESC`
            : sql`ORDER BY p."PatientName" ASC`;
      }

      // First, get the total count of matching patients.
      // No JOINs here: every filter references p.* directly or via EXISTS
      // subqueries, so the 5 lookup-table joins added nothing to the count.
      const countResult = await sql<{ totalCount: number | string }>`
            SELECT COUNT(DISTINCT p."PersonID") as "totalCount"
            FROM "tblpatients" p
            ${whereClause}
        `.execute(db);

      const totalCount = Number(countResult.rows[0]?.totalCount ?? 0);

      // Now get the paginated results
      const { rows: patients } = await sql<PatientSearchResult>`
            SELECT DISTINCT
                    p."PersonID", p."PatientName", p."FirstName", p."LastName",
                    p."Phone", p."Phone2", p."Email", p."DateofBirth", p."Gender",
                    p."AddressID", p."ReferralSourceID", p."PatientTypeID", p."TagID",
                    p."Notes", p."Language", p."CountryCode",
                    p."EstimatedCost", p."Currency", p."DateAdded",
                    g."Gender" as "GenderName", a."Zone" as "AddressName",
                    r."Referral" as "ReferralSource", pt."PatientType" as "PatientTypeName",
                    tag."Tag" as "TagName",
                    (
                        SELECT STRING_AGG(wt."WorkType", ', ')
                        FROM (
                            SELECT DISTINCT wt2."WorkType"
                            FROM "tblwork" w2
                            INNER JOIN "tblWorkType" wt2 ON w2."Typeofwork" = wt2."ID"
                            WHERE w2."PersonID" = p."PersonID" AND w2."Status" = 1
                        ) wt
                    ) as "ActiveWorkTypes"
            FROM "tblpatients" p
            LEFT JOIN "tblGender" g ON p."Gender" = g."Gender_ID"
            LEFT JOIN "tblAddress" a ON p."AddressID" = a."ID"
            LEFT JOIN "tblReferrals" r ON p."ReferralSourceID" = r."ID"
            LEFT JOIN "tblPatientType" pt ON p."PatientTypeID" = pt."ID"
            LEFT JOIN "tblTagOptions" tag ON p."TagID" = tag."ID"
            ${whereClause}
            ${orderByClause}
            LIMIT ${limit} OFFSET ${offset}
        `.execute(db);

      const hasMore = offset + patients.length < totalCount;

      res.json({
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
        SELECT "ID" as "id", "Tag" as "tag" FROM "tblTagOptions" ORDER BY "Tag"
      `.execute(getKysely());
      res.json(tags);
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
        SELECT "ID" as "id", "PatientType" as "type" FROM "tblPatientType" ORDER BY "PatientType"
      `.execute(getKysely());
      res.json(types);
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
 * Get single patient by ID with alerts
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
      const alerts = await getAlertsByPersonId(patient.PersonID);
      const patientWithAlerts = patient as typeof patient & { alerts: typeof alerts };
      patientWithAlerts.alerts = alerts;

      res.json(patientWithAlerts);
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
  async (
    req: Request<unknown, unknown, CreatePatientBody>,
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

      res.json({
        success: true,
        personId: result.personId,
        message: 'Patient created successfully'
      });

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
        res.status(409).json({
          success: false,
          error: err.message,
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
  async (
    req: Request<{ personId: string }, unknown, UpdatePatientBody>,
    res: Response
  ): Promise<void> => {
    const patientData = req.body;

    try {
      const personId = parseInt(req.params.personId);

      // Basic validation
      if (!patientData.PatientName || !patientData.PatientName.trim()) {
        log.warn('Update patient missing name', { personId });
        ErrorResponses.badRequest(res, 'Patient name is required');
        return;
      }

      // Convert date string to Date object for the database layer
      const updateData = {
        ...patientData,
        DateofBirth: patientData.DateofBirth
          ? new Date(patientData.DateofBirth)
          : undefined
      };

      await updatePatient(personId, updateData);
      res.json({ success: true, message: 'Patient updated successfully' });
    } catch (error) {
      // Duplicate patient name → pg unique violation on index IX_Name_ID (was mssql 2601).
      if (isUniqueViolation(error, 'IX_Name_ID')) {
        log.warn(
          `Duplicate patient name attempted during update: ${patientData.PatientName}`
        );
        res.status(409).json({
          success: false,
          error: 'A patient with this name already exists',
          code: 'DUPLICATE_PATIENT_NAME',
          duplicateName: patientData.PatientName
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
  requireRecordAge({
    resourceType: 'patient',
    operation: 'delete',
    getRecordDate: getPatientCreationDate
  }),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId);

      // Capture the patient's tpCodes BEFORE the delete — deletePatient's cascade
      // (FK_tblTimePoints_tblpatients ON DELETE CASCADE) drops the timepoint rows, so
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
      res.json({
        success: true,
        message: folderRemoved
          ? 'Patient and folder deleted successfully'
          : 'Patient deleted, but its photo folder could not be removed (a file may be open). Please delete it manually.',
        folderRemoved,
      });
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
  async (
    req: Request<{ personId: string }, unknown, { estimatedCost: number; currency: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { estimatedCost, currency } = req.body;

      if (isNaN(personId)) {
        log.warn('Update estimated cost invalid patient ID', { personId: req.params.personId });
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }

      await sql`
        UPDATE "tblpatients"
        SET "EstimatedCost" = ${estimatedCost || null},
            "Currency" = ${currency || 'IQD'}
        WHERE "PersonID" = ${personId}
      `.execute(getKysely());

      res.json({
        success: true,
        message: 'Estimated cost updated successfully'
      });
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
        log.warn('Get alerts invalid patient ID', { personId: req.params.personId });
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }

      const alerts = await getAlertsByPersonId(personId);
      res.json(alerts);
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
  async (
    req: Request<{ personId: string }, unknown, CreateAlertBody>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { alertTypeId, alertSeverity, alertDetails } = req.body;

      if (!alertDetails) {
        log.warn('Create alert missing details', { personId });
        ErrorResponses.badRequest(res, 'Alert details are required');
        return;
      }

      // Use defaults for quick-add (alertTypeId=1 General, alertSeverity=2 Medium)
      await createAlert({
        PersonID: personId,
        AlertTypeID: alertTypeId ? parseInt(String(alertTypeId), 10) : 1,
        AlertSeverity: alertSeverity ? parseInt(String(alertSeverity), 10) : 2,
        AlertDetails: alertDetails
      });

      res
        .status(201)
        .json({ success: true, message: 'Alert created successfully' });
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
  async (
    req: Request<{ alertId: string }, unknown, UpdateAlertStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const alertId = parseInt(req.params.alertId, 10);
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        log.warn('Update alert status invalid isActive', { alertId, isActive });
        ErrorResponses.badRequest(res, 'isActive must be a boolean value');
        return;
      }

      await setAlertStatus(alertId, isActive);

      res.json({
        success: true,
        message: `Alert status updated to ${isActive}`
      });
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
  async (
    req: Request<{ alertId: string }, unknown, UpdateAlertBody>,
    res: Response
  ): Promise<void> => {
    try {
      const alertId = parseInt(req.params.alertId, 10);
      const { alertTypeId, alertSeverity, alertDetails } = req.body;

      if (isNaN(alertId)) {
        log.warn('Update alert invalid alert ID', { alertId: req.params.alertId });
        ErrorResponses.badRequest(res, 'Invalid alert ID');
        return;
      }

      if (!alertDetails) {
        log.warn('Update alert missing details', { alertId });
        ErrorResponses.badRequest(res, 'Alert details are required');
        return;
      }

      await updateAlert(alertId, alertTypeId, alertSeverity, alertDetails);

      res.json({
        success: true,
        message: 'Alert updated successfully'
      });
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
        log.warn('Has appointment check invalid patient ID', { personId: req.params.personId });
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }

      const hasAppointment = await hasNextAppointment(personId);

      res.json({
        success: true,
        hasAppointment
      });
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
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }
      const [status, qr] = await Promise.all([
        PatientPortalService.getStatus(personId),
        PatientPortalService.getQrDataUrl(personId),
      ]);
      res.json({
        success: true,
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
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }
      const pin = await PatientPortalService.resetToDefaultPin(personId);
      res.json({ success: true, pin });
    } catch (error) {
      const msg = (error as Error).message;
      log.warn('Portal reset-pin failed', { error: msg });
      ErrorResponses.badRequest(res, msg);
    }
  }
);

/**
 * POST /api/patients/:personId/portal/set-pin
 * Manually set a PIN (4-6 digits).
 */
router.post(
  '/patients/:personId/portal/set-pin',
  authorize(['admin', 'secretary']),
  async (
    req: Request<{ personId: string }, unknown, { pin: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { pin } = req.body;
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }
      if (!pin || typeof pin !== 'string') {
        ErrorResponses.badRequest(res, 'PIN is required');
        return;
      }
      await PatientPortalService.setPin(personId, pin);
      res.json({ success: true });
    } catch (error) {
      ErrorResponses.badRequest(res, (error as Error).message);
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
  async (
    req: Request<{ personId: string }, unknown, { enabled: boolean }>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { enabled } = req.body;
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }
      if (typeof enabled !== 'boolean') {
        ErrorResponses.badRequest(res, '`enabled` must be a boolean');
        return;
      }
      await PatientPortalService.setEnabled(personId, enabled);
      res.json({ success: true });
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
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }
      await PatientPortalService.unlock(personId);
      res.json({ success: true });
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
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }
      const rows = await PatientPortalService.getPrivateList(personId);
      res.json({
        success: true,
        privateImages: rows.map((r) => ({ tp: r.TimepointCode, name: r.ImageName })),
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
  async (
    req: Request<
      { personId: string },
      unknown,
      { tp: string; name: string; isPrivate: boolean }
    >,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { tp, name, isPrivate } = req.body;
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient ID');
        return;
      }
      if (!tp || !name || typeof isPrivate !== 'boolean') {
        ErrorResponses.badRequest(res, '`tp`, `name`, and `isPrivate` are required');
        return;
      }
      const byUserId = req.session.userId ?? null;
      await PatientPortalService.togglePhotoPrivacy(personId, tp, name, isPrivate, byUserId);
      res.json({ success: true });
    } catch (error) {
      ErrorResponses.internalError(res, 'Failed to update photo visibility', error as Error);
    }
  }
);

export default router;
