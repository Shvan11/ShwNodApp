/**
 * Patient Time Points & Imaging API Routes
 *
 * Split out of `patient.routes.ts` (C3/C1 — pure move). Everything keyed by a
 * time point: the list, the on-disk originals folder, renaming /
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
import { xrayPreviewPath } from '../../services/files/patient-assets.service.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
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
  trashWorkingFilesForTimepoint,
  timepointFolderName,
} from '../../services/imaging/photo-cleanup.service.js';
import {
  renameEntry,
  softDelete,
  entryExists,
  sanitizeName,
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
 * originals folder ({name}_{DD-MM-YYYY}) is renamed to stay in sync — and when it
 * cannot be (the target name exists, or the rename fails) the edit is refused with
 * a 409 and nothing changes. For an Initial/Final time point a date change is
 * mirrored into tblwork.
 */
router.put(
  '/patients/:personId/timepoints/:tpCode',
  // Doctors and assistants manage their own photo sessions (owner decision, FE-F12-6):
  // they could already create and render one in the editor.
  authorize(CLINICAL_ROLES),
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

      // The originals folder ({name}_{DD-MM-YYYY}) moves with the session. Check it
      // BEFORE writing anything: a session renamed onto a folder that already exists
      // (e.g. one kept on purpose by *Cropped + session*) used to log a warning, return
      // 200, and leave the session pointing at those photos — which *Delete everything*
      // then destroyed (FE-F12-5). Refuse instead, and leave the row untouched.
      const oldFolder = timepointFolderName(existing.tp_description, existing.tp_date_time);
      const newFolder = timepointFolderName(finalName, finalDate);
      const folderMoves =
        !!oldFolder && !!newFolder && oldFolder !== newFolder && (await entryExists(personId, oldFolder));
      if (folderMoves && newFolder.toLowerCase() !== oldFolder.toLowerCase() && (await entryExists(personId, newFolder))) {
        ErrorResponses.conflict(
          res,
          `A folder named "${newFolder}" already exists in this patient's files. Rename or remove it first, or pick another name or date.`
        );
        return;
      }

      const result = await updateNativeTimePoint(personId, tpCode, finalName, finalDate);
      if (!result.ok && result.conflict) {
        ErrorResponses.conflict(res, 'Another time point already has that name and date');
        return;
      }

      if (folderMoves && oldFolder && newFolder) {
        try {
          await renameEntry(personId, oldFolder, newFolder);
          log.info('[TimePoint] renamed originals folder', { personId, from: oldFolder, to: newFolder });
        } catch (err) {
          // Put the row back, so the session and its folder never part (on Windows a
          // folder open in Explorer on another PC refuses the rename).
          await updateNativeTimePoint(personId, tpCode, existing.tp_description, existing.tp_date_time);
          log.warn('[TimePoint] originals folder rename failed — edit reverted', {
            personId,
            from: oldFolder,
            to: newFolder,
            error: (err as Error).message,
          });
          ErrorResponses.conflict(
            res,
            `The originals folder "${oldFolder}" could not be renamed (it may be open on another computer). Nothing was changed — close it and try again.`
          );
          return;
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
 * Delete a time point and its on-disk artifacts.
 * DELETE /patients/:personId/timepoints/:tpCode
 *
 * DB delete is authoritative (cascades to time_point_images; clears the
 * session's private_photos marks). Filesystem cleanup — moving the working/ slot
 * files (each image with Dolphin's original of it) to `.trash`, and for scope 'all'
 * the originals folder too — is best-effort so a missing file/folder never fails
 * the request.
 */
router.delete(
  '/patients/:personId/timepoints/:tpCode',
  authorize(CLINICAL_ROLES),
  validate({ params: timepointParams }),
  async (req: Request<{ personId: string; tpCode: string }>, res: Response): Promise<void> => {
    try {
      const personId = Number.parseInt(req.params.personId, 10);
      const tpCode = Number.parseInt(req.params.tpCode, 10);
      if (!Number.isInteger(personId) || !Number.isInteger(tpCode)) {
        ErrorResponses.badRequest(res, 'Invalid patient id or time point code');
        return;
      }

      // Scope controls how much is removed (working/ files go to the trash in pairs:
      // each image with Dolphin's `.vNN` original of it):
      //   'cropped' — the 8 views' working/ files (keep DB entry, X-rays + originals folder)
      //   'entry'   — every slot's working/ files + DB time-point row (keep originals folder)
      //   'all'     — every slot's working/ files + DB row + originals folder (to the trash)
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

      // Always move this time point's working files to the trash: the 8 views for a
      // cropped-only delete, every slot when the session itself goes (an image left
      // under its code would turn up in the next session given that code).
      await trashWorkingFilesForTimepoint(personId, tpCode, scope === 'cropped' ? 'views' : 'all');

      // Remove the DB entry unless we're only clearing cropped photos.
      if (scope === 'all' || scope === 'entry') {
        await deleteNativeTimePoint(personId, tpCode);
      }

      // Move the originals folder to the trash only for a full delete (best-effort).
      // Trash, not `fs.rm`: the explorer's own *Delete* already moves to
      // `clinic1/.trash/{personId}/{stamp}/`, and the session's *Delete everything*
      // was the one destructive path that could not be undone (FE-F12-5).
      if (scope === 'all') {
        const folder = timepointFolderName(existing.tp_description, existing.tp_date_time);
        if (folder && (await entryExists(personId, folder))) {
          try {
            await softDelete(personId, folder);
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

/**
 * An X-ray's CS-Imaging preview thumbnail.
 * GET /patients/:personId/xray/preview?detailsDir={directory}
 *
 * Served here rather than through a static mount: the file sits under
 * CS-Imaging's dot-folders, and `send`'s default `dotfiles: 'ignore'` 404s any
 * such path (FE-F9-5). `dotfiles: 'allow'` is scoped to this one fixed,
 * charset-validated location.
 */
router.get(
  '/patients/:personId/xray/preview',
  validate({ params: patientContract.xrayPreview.params, query: patientContract.xrayPreview.query }),
  (req: Request<{ personId: string }, unknown, unknown, patientContract.XrayPreviewQuery>, res: Response): void => {
    const { personId } = req.params;
    const { detailsDir } = req.query;
    res.sendFile(
      xrayPreviewPath(personId, detailsDir),
      { dotfiles: 'allow', headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-cache' } },
      (err) => {
        if (err && !res.headersSent) res.status(404).end();
      }
    );
  }
);

/**
 * The processed X-ray image's server path, for sending it as a message.
 * GET /patients/:personId/xray/send-path?file={filename}&detailsDir={directory}
 *
 * `/api/wa/sendmedia2` takes clinic FILESYSTEM paths (its containment guard
 * rejects anything outside `clinic1/`), so the X-ray card cannot hand it the
 * viewer's API URL — that 400'd on every Send (FE-F9-3). This renders the image
 * exactly as the viewer does and returns where it landed, the way
 * `/api/convert-path` serves the photo senders.
 */
router.get(
  '/patients/:personId/xray/send-path',
  validate({ params: patientContract.xraySendPath.params, query: patientContract.xraySendPath.query }),
  async (
    req: Request<{ personId: string }, unknown, unknown, patientContract.XraySendPathQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      const { file, detailsDir } = req.query;
      const imagePath = await imaging.processXrayImage(personId, file, detailsDir || '');
      sendData(res, patientContract.xraySendPath.response, { path: imagePath });
    } catch (error) {
      log.error('Error preparing X-ray for sending:', error);
      ErrorResponses.internalError(
        res,
        'Could not prepare this X-ray for sending — the processing tool may not be available on this server',
        error as Error
      );
    }
  }
);
export default router;
