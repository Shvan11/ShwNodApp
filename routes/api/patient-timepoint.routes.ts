/**
 * Patient Time Points & Imaging API Routes
 *
 * Split out of `patient.routes.ts` (C3/C1 — pure move). Everything keyed by a
 * time point: the list, its images, the on-disk originals folder, renaming /
 * re-dating a time point, deleting one, and the two image readers (gallery
 * sizes, X-ray processing).
 *
 * Mounted at `/api` alongside `patient.routes.ts`, so the paths below are the
 * full ones minus that prefix — unchanged by the move.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { parseLocalDate } from '../../utils/date.js';
import * as imaging from '../../services/imaging/index.js';
import { authorize } from '../../middleware/auth.js';
import { FINANCE_ROLES } from '../../shared/auth/roles.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import * as patientContract from '../../shared/contracts/patient.contract.js';
import * as PatientService from '../../services/business/PatientService.js';
import { PatientValidationError } from '../../services/business/PatientService.js';
import {
  getNativeTimePoint,
  updateNativeTimePoint,
  deleteNativeTimePoint,
} from '../../services/database/queries/native-timepoint-queries.js';
import { updatePhotoDate } from '../../services/database/queries/photo-session-queries.js';
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

const { timepointParams } = patientContract;


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
      const folder = timepointFolderName(existing.tp_description, existing.tp_date_time);
      const exists = folder ? await entryExists(personId, folder) : false;
      sendData(res, patientContract.timepointFolder.response, { folder, exists });
    } catch (error) {
      log.error('Error checking time point folder:', error);
      ErrorResponses.internalError(res, 'Failed to check time point folder', error as Error);
    }
  }
);

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

      // Resolve the final (name, date) as a partial patch over the current row. Both
      // columns are NOT NULL (migrations/pg/1785700253568), so omitting either field
      // always falls back to a real value — no dateless/nameless row to guard against.
      // The empty-NAME check below is still live: the body allows `tpDescription: ''`.
      const finalName = (tpDescription ?? existing.tp_description).trim();
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
      const oldFolder = timepointFolderName(existing.tp_description, existing.tp_date_time);
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
        const folder = timepointFolderName(existing.tp_description, existing.tp_date_time);
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
  validate({ params: patientContract.gallery.params }),
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
      ErrorResponses.internalError(res, 'Failed to load gallery images', error as Error);
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
      // The `note` moves into the message and the error object becomes `details`:
      // a hand-built object is not dev-gated, so `message` reached the browser in
      // production. The note was the half worth showing anyway.
      ErrorResponses.internalError(
        res,
        'X-ray processing failed — the processing tool may not be available on this server',
        error as Error
      );
    }
  }
);
export default router;
