/**
 * Waiting-room TV signage management (`/api/tv-display*`).
 *
 * The staff-facing half of the signage feature — Settings → TV Display. Edits
 * the slideshow's schedule/appearance, manages the media folder (upload, delete,
 * reorder), and queues one-shot commands for the LG daemon. Open to every
 * signed-in staff role (see the authorize() note below); uploads here land in a
 * folder the TV then reads without a session, so it is signage content only —
 * never PHI (the public half's posture note has the details).
 *
 * The TV itself never touches these routes — it reads the session-less
 * `routes/public/tv-display.routes.ts`. Both share `services/files/tv-display-store.ts`,
 * which owns the media folder + the settings file (no database involved).
 *
 * Follows the shared-contract pattern: validate(...) against
 * `shared/contracts/tv-display.contract.ts`, then sendData(...). Every mutation
 * returns the whole refreshed state, because a media write can rename files
 * (reorder renumbers prefixes) and the UI must not guess the result.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { randomBytes } from 'crypto';
import { mkdir } from 'fs/promises';
import { authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import { ALL_ROLES } from '../../shared/auth/roles.js';
import {
  ALLOWED_EXTENSIONS,
  MEDIA_DIR,
  SETTINGS_FILE,
  UPLOAD_STAGE_DIR,
  broadcastCommand,
  broadcastState,
  classify,
  commitUpload,
  deleteMedia,
  getConnections,
  getSettings,
  listMediaDetailed,
  listUnsupportedFiles,
  reorderMedia,
  saveSettings,
} from '../../services/files/tv-display-store.js';
import * as tvDisplay from '../../shared/contracts/tv-display.contract.js';

const router = Router();

// Open to every signed-in staff role: the waiting-room screen is reception's to
// run day to day, and the media folder holds signage content only (never PHI).
// The staff-session gate on /api still applies, so nothing session-less gets in.
// Narrow to ADMIN_ROLES here AND re-add `adminOnly` to the UI tab if that ever
// needs to change — the two must move together.
router.use('/tv-display', authorize(ALL_ROLES));

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

/**
 * Signage videos are hundreds of MB, so uploads stage to DISK (never memory) —
 * inside the media folder, so the commit step is a same-volume rename with no
 * EXDEV risk on a network-mounted deployment. Staged names are random; the real
 * (sanitized, de-duplicated) name is chosen at commit time by the store.
 */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdir(UPLOAD_STAGE_DIR, { recursive: true })
        .then(() => cb(null, UPLOAD_STAGE_DIR))
        .catch((err: Error) => cb(err, UPLOAD_STAGE_DIR));
    },
    filename: (_req, file, cb) => {
      cb(null, `stage-${Date.now()}-${randomBytes(6).toString('hex')}${path.extname(file.originalname)}`);
    },
  }),
  // One 4K-ish clip can legitimately be large; 1 GB per file with 20 files per
  // request is comfortably above real signage content and far below anything
  // that could fill the clinic volume by accident.
  limits: { fileSize: 1024 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (!classify(path.extname(file.originalname).toLowerCase())) {
      cb(new Error(`Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
      return;
    }
    cb(null, true);
  },
});

/** Run multer, turning its errors (oversized file, bad type) into clean 400s. */
function uploadMediaFiles(req: Request, res: Response, next: NextFunction): void {
  upload.array('media', 20)(req, res, (err: unknown) => {
    if (err) {
      ErrorResponses.badRequest(res, err instanceof Error ? err.message : 'Upload failed');
      return;
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** The whole management view: settings, media (with sizes), paths, liveness. */
async function buildState(): Promise<tvDisplay.TvDisplayState> {
  const [settings, media, ignoredFiles] = await Promise.all([
    getSettings(),
    listMediaDetailed(),
    listUnsupportedFiles(),
  ]);
  return {
    settings,
    media,
    ignoredFiles,
    mediaDir: MEDIA_DIR,
    settingsFile: SETTINGS_FILE,
    allowedExtensions: ALLOWED_EXTENSIONS,
    status: {
      ...getConnections(),
      serverTime: new Date().toISOString(),
    },
  };
}

/**
 * Shared tail for every handler: push the change to the TV and the daemon, then
 * reply with the refreshed state. Pushing here (rather than in each handler)
 * is what makes "save" reach the screen in about a second — and means no caller
 * can forget it.
 */
async function respondWithState(
  res: Response,
  schema: typeof tvDisplay.getState.response,
  failure: string,
  push = false
): Promise<void> {
  try {
    if (push) await broadcastState();
    sendData(res, schema, await buildState());
  } catch (error) {
    log.error(`[TV Display] ${failure}`, { error: (error as Error).message });
    ErrorResponses.internalError(res, failure, error as Error);
  }
}

// GET /api/tv-display — settings + media + liveness.
router.get('/tv-display', async (_req: Request, res: Response): Promise<void> => {
  await respondWithState(res, tvDisplay.getState.response, 'Failed to read TV display state');
});

// PUT /api/tv-display/settings — replace the whole settings object.
router.put(
  '/tv-display/settings',
  validate({ body: tvDisplay.updateSettings.body }),
  async (
    req: Request<unknown, unknown, tvDisplay.UpdateSettingsBody>,
    res: Response
  ): Promise<void> => {
    try {
      await saveSettings(req.body);
    } catch (error) {
      log.error('[TV Display] settings save failed', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to save settings', error as Error);
      return;
    }
    await respondWithState(res, tvDisplay.updateSettings.response, 'Failed to read TV display state', true);
  }
);

// POST /api/tv-display/media — multipart upload (field `media`).
router.post('/tv-display/media', uploadMediaFiles, async (req: Request, res: Response): Promise<void> => {
  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) {
    ErrorResponses.badRequest(res, 'No files received');
    return;
  }
  try {
    for (const file of files) {
      await commitUpload(file.path, file.originalname);
    }
  } catch (error) {
    log.error('[TV Display] upload commit failed', { error: (error as Error).message });
    ErrorResponses.badRequest(res, (error as Error).message || 'Upload failed');
    return;
  }
  await respondWithState(res, tvDisplay.uploadMedia.response, 'Failed to read TV display state', true);
});

// DELETE /api/tv-display/media/:name — remove one file.
router.delete(
  '/tv-display/media/:name',
  validate({ params: tvDisplay.deleteMedia.params }),
  async (req: Request<tvDisplay.DeleteMediaParams>, res: Response): Promise<void> => {
    try {
      const removed = await deleteMedia(req.params.name);
      if (!removed) {
        ErrorResponses.notFound(res, 'Media file');
        return;
      }
    } catch (error) {
      log.error('[TV Display] delete failed', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to delete media', error as Error);
      return;
    }
    await respondWithState(res, tvDisplay.deleteMedia.response, 'Failed to read TV display state', true);
  }
);

// PUT /api/tv-display/media/order — renumber filename prefixes to match.
router.put(
  '/tv-display/media/order',
  validate({ body: tvDisplay.reorderMedia.body }),
  async (
    req: Request<unknown, unknown, tvDisplay.ReorderMediaBody>,
    res: Response
  ): Promise<void> => {
    try {
      await reorderMedia(req.body.names);
    } catch (error) {
      log.error('[TV Display] reorder failed', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to reorder media', error as Error);
      return;
    }
    await respondWithState(res, tvDisplay.reorderMedia.response, 'Failed to read TV display state', true);
  }
);

/**
 * POST /api/tv-display/command — push a one-shot action to the daemon.
 *
 * Nothing is queued: the daemon holds a stream open, so the action either
 * reaches it now or there is no daemon to reach. A 409 in the latter case is
 * deliberate — a button that silently does nothing is worse than an error, and
 * the UI already shows the scheduler as disconnected.
 */
router.post(
  '/tv-display/command',
  validate({ body: tvDisplay.sendCommand.body }),
  async (
    req: Request<unknown, unknown, tvDisplay.SendCommandBody>,
    res: Response
  ): Promise<void> => {
    if (!broadcastCommand(req.body.action)) {
      ErrorResponses.conflict(
        res,
        'The TV scheduler is not connected, so nothing received the command. Check that the "LG TV Signage" task is running.'
      );
      return;
    }
    await respondWithState(res, tvDisplay.sendCommand.response, 'Failed to read TV display state');
  }
);

export default router;
