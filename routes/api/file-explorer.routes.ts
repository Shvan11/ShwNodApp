/**
 * Patient File Explorer routes.
 *
 * Per-patient filesystem browser: list/flat-walk, properties, content (inline preview +
 * download + thumbnail), and full management (upload, mkdir, rename, move,
 * copy, soft delete). All path safety lives in services/files/file-explorer.service.ts.
 *
 * Reads ride the global `/api` `authenticate` gate (index.ts). Writes add
 * `authorize(CLINICAL_ROLES)` — all three staff roles: doctors and assistants
 * manage a patient's files and photo sessions too (owner decision, FE-F12-6).
 * Every content fetch + mutation is audit-logged with the acting user id.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { createReadStream, promises as fsp } from 'fs';
import sharp from 'sharp';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendError, sendData } from '../../utils/error-response.js';
import { createUpload, uploadErrorMessage } from '../../middleware/upload.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { timeouts } from '../../middleware/timeout.js';
import * as fileExplorer from '../../shared/contracts/file-explorer.contract.js';
import { getFileMimeType, sniffImageMime } from '../../utils/file-mime.js';
import { imageCacheControl, REVALIDATE } from '../../utils/image-cache-control.js';
import { folderOwner } from '../../shared/photo-session-folder.js';
import { getTimePoints } from '../../services/database/queries/timepoint-queries.js';
import {
  FileExplorerError,
  listDirectory,
  walkFlat,
  getEntryProperties,
  resolveFileForServe,
  createFolder,
  renameEntry,
  softDelete,
  softDeleteBatch,
  transferEntries,
  validateUploadTargetDir,
  getUploadStagingDir,
  finalizeUpload,
  type FileEntry,
} from '../../services/files/file-explorer.service.js';
import { getThumbnail, getWorkingThumbnail } from '../../services/files/thumbnail.service.js';
import {
  listPatientWorkingFiles,
  resolveWorkingFile,
  trashWorkingFile,
} from '../../services/files/working-files.service.js';
import { getTimePointCodes } from '../../services/database/queries/timepoint-queries.js';
import { getPhotoSlotLabels } from '../../services/database/queries/photo-slot-queries.js';
import {
  getNativeTimePoint,
  deleteNativeTimePointImage,
} from '../../services/database/queries/native-timepoint-queries.js';
import { timepointFolderName } from '../../services/imaging/photo-cleanup.service.js';
import { untagOriginalForView } from '../../services/imaging/photo-original-tags.js';

const router = Router();

/** Browser lifetime of a thumbnail whose URL names its version (see imageCacheControl). */
const THUMB_MAX_AGE_S = 7 * 24 * 60 * 60;

const MAX_UPLOAD_BYTES =
  parseInt(process.env.FILE_EXPLORER_MAX_UPLOAD_MB || '200', 10) * 1024 * 1024;

// ===========================================
// HELPERS
// ===========================================

// Derived from the contract's own params schema, never hand-written — the alias
// keeps the handler generics readable while `fileExplorer.personIdParams` stays
// the single source of truth for what `:personId` is.
type PersonIdParams = fileExplorer.PersonIdParams;

const isTruthy = (v: unknown): boolean => v === '1' || v === 'true';
const queryString = (v: unknown): string => (typeof v === 'string' ? v : '');

// Boundary guards live in the shared contract
// (`shared/contracts/file-explorer.contract.ts`). `:personId` is validated numeric
// so a non-numeric/traversal-y id is rejected up front (defense-in-depth ahead of
// the service's path safety, and — for upload — BEFORE any bytes are accepted).
// The folder/rename bodies only assert a string TYPE; all path-safety (traversal,
// emptiness) stays in file-explorer.service.ts, which remains the authority.

/** Map a thrown error to a response (FileExplorerError carries its own status). */
function handleError(res: Response, err: unknown, op: string): void {
  if (err instanceof FileExplorerError) {
    sendError(res, err.status, err.message);
    return;
  }
  log.error(`[Files] ${op} failed`, { error: (err as Error).message });
  ErrorResponses.serverError(res, 'File operation failed', err as Error);
}

/**
 * Refuse (409) a write that would detach a top-level folder from its owner — a photo
 * session's originals or a folder the X-ray card reads by name (FE-F14-5) — unless
 * the caller confirmed with `force`. Returns true when it answered the request.
 * `verb` names the write in the message ("Renaming", "Moving").
 */
async function refuseOwnedFolders(
  res: Response,
  personId: string,
  relPaths: string[],
  verb: string
): Promise<boolean> {
  const tops = relPaths
    .map((p) => p.replace(/^[\\/]+|[\\/]+$/g, ''))
    .filter((p) => p && !/[\\/]/.test(p));
  if (tops.length === 0) return false;
  const sessions = await getTimePoints(personId);
  for (const top of tops) {
    const owner = folderOwner(top, sessions);
    if (owner?.kind === 'session') {
      ErrorResponses.conflict(
        res,
        `"${top}" holds the originals of the photo session "${owner.name}" (${owner.date}). ${verb} it detaches them from that session.`,
        { code: 'SESSION_FOLDER', tpCode: owner.tpCode }
      );
      return true;
    }
    if (owner?.kind === 'reserved') {
      ErrorResponses.conflict(
        res,
        `"${top}" is read by the app under that exact name (X-rays). ${verb} it empties that view.`,
        { code: 'RESERVED_FOLDER' }
      );
      return true;
    }
  }
  return false;
}

/**
 * Manual Range/streaming fallback for the content endpoint. Used only if
 * `res.sendFile` rejects the path (notably UNC-rooted absolute paths on
 * Windows — see CLAUDE.md "Deployment & environments"). Mirrors the proven
 * pattern in video.routes.ts.
 */
async function streamFileFallback(
  req: Request,
  res: Response,
  abs: string,
  mime: string,
  download: boolean,
  filename: string
): Promise<void> {
  const st = await fsp.stat(abs);
  const total = st.size;

  res.setHeader('Content-type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Last-Modified', st.mtime.toUTCString());
  // Explicit, like the `sendFile` path: with Last-Modified and no Cache-Control a
  // browser may guess a lifetime of ~10% of the file's age — weeks for an old photo.
  res.setHeader('Cache-Control', REVALIDATE);
  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/["\r\n]/g, '')}"`);
  } else {
    // Same stored-XSS guard as the `res.sendFile` path — see the comment there.
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    if (isNaN(start) || isNaN(end) || start < 0 || start > end || end >= total) {
      res.status(416).setHeader('Content-Range', `bytes */${total}`);
      res.end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(end - start + 1));
    createReadStream(abs, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', String(total));
    createReadStream(abs).pipe(res);
  }
}

// ===========================================
// LIST  (read — global authenticate gate)
// ===========================================

router.get(
  '/patients/:personId/files',
  async (req: Request<PersonIdParams>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const relPath = queryString(req.query.path);
      const flat = isTruthy(req.query.flat);

      const listing = flat
        ? await walkFlat(personId, relPath)
        : await listDirectory(personId, relPath);

      log.info('[Files] list', { userId: req.session?.userId, personId, relPath, flat });
      sendData(res, fileExplorer.list.response, listing);
    } catch (err) {
      handleError(res, err, 'list');
    }
  }
);

// One entry's Properties (right-click → Properties): size, dates, a folder's counts.
router.get(
  '/patients/:personId/files/properties',
  validate({ params: fileExplorer.properties.params, query: fileExplorer.properties.query }),
  async (
    req: Request<PersonIdParams, unknown, unknown, fileExplorer.PropertiesQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      const relPath = req.query.path ?? '';
      const props = await getEntryProperties(personId, relPath);
      sendData(res, fileExplorer.properties.response, props);
    } catch (err) {
      handleError(res, err, 'properties');
    }
  }
);

// ===========================================
// CONTENT  (read — inline preview / download / thumbnail)
// ===========================================

router.get(
  '/patients/:personId/files/content',
  async (req: Request<PersonIdParams>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const relPath = queryString(req.query.path);
      const download = isTruthy(req.query.download);
      const thumbRaw = queryString(req.query.thumb);

      // ── Thumbnail branch ──
      if (thumbRaw && thumbRaw !== '0') {
        const width = parseInt(thumbRaw, 10);
        const { path: thumbPath, mtimeMs } = await getThumbnail(personId, relPath, isNaN(width) ? 240 : width);
        log.info('[Files] thumb', { userId: req.session?.userId, personId, relPath, width });
        res.setHeader('Content-type', 'image/webp');
        // A week, privately, only when `?v=` names this file's mtime; otherwise every
        // view revalidates. A flat `public, max-age` here kept a deleted photo's
        // thumbnail on screen after a different one was uploaded under its name.
        res.setHeader('Cache-Control', imageCacheControl(req.query.v, mtimeMs, { maxAgeSeconds: THUMB_MAX_AGE_S }));
        res.sendFile(
          thumbPath,
          // `dotfiles: 'allow'` is required — the cache lives under a dot dir
          // (`.cache/thumbs/…`), which `send` would otherwise refuse to serve.
          { dotfiles: 'allow', cacheControl: false, lastModified: true },
          (err) => {
            if (err && !res.headersSent) {
              ErrorResponses.serverError(res, 'Failed to serve thumbnail');
            }
          }
        );
        return;
      }

      // ── Full file branch ──
      const { abs } = await resolveFileForServe(personId, relPath);
      const mime = getFileMimeType(abs);
      const filename = path.basename(relPath.replace(/\\/g, '/'));
      log.info('[Files] content', { userId: req.session?.userId, personId, relPath, download });

      // Always revalidated (a 304 when unchanged), and never `public` — PHI.
      res.setHeader('Cache-Control', REVALIDATE);

      // Browsers (bar Safari) can't decode TIFF, so it is viewed as a lossless,
      // full-resolution PNG. A download still gets the original file.
      if (!download && mime === 'image/tiff') {
        res.type('png').send(await sharp(abs).rotate().png().toBuffer());
        return;
      }

      const sendOpts = {
        dotfiles: 'allow' as const,
        acceptRanges: true,
        cacheControl: false,
        lastModified: true,
      };

      // `res.sendFile`/`res.download` give Range/ETag/Last-Modified/304 for free.
      // On error before headers are sent (e.g. UNC rejection on Windows) we fall
      // back to manual streaming.
      const onDone = (err: Error | undefined): void => {
        if (!err || res.headersSent) return;
        streamFileFallback(req, res, abs, mime, download, filename).catch(() => {
          if (!res.headersSent) ErrorResponses.serverError(res, 'Failed to serve file');
        });
      };

      if (download) {
        res.download(abs, filename, sendOpts, onDone);
      } else {
        // Stored-XSS guard. A patient folder is a live NTFS share the clinic
        // writes to by other means, and `POST …/files/upload` accepts any
        // extension — so a `.svg` or `.html` sitting there is served INLINE from
        // the app's own origin with an executable Content-Type. The app runs
        // helmet with `contentSecurityPolicy: false`, so without this header any
        // script in that file would run with the viewing staff member's session
        // (a front-desk account could plant a payload that fires in an admin's
        // browser). `sandbox` with no allow-tokens puts the response in a unique
        // opaque origin with scripting disabled — the file still renders, it just
        // cannot reach the session. `nosniff` is not enough on its own here: the
        // declared type is already executable.
        res.setHeader('Content-Security-Policy', 'sandbox');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-type', mime);
        res.sendFile(abs, sendOpts, onDone);
      }
    } catch (err) {
      handleError(res, err, 'content');
    }
  }
);

// ===========================================
// WORKING FILES  (this patient's slot files in the shared working/ dir: the 8 grid
//                 views and every other Dolphin slot, e.g. OPG/ceph, each as its .iNN
//                 image and Dolphin's .vNN original — list, content, and a per-slot delete)
// ===========================================

router.get(
  '/patients/:personId/working-files',
  async (req: Request<PersonIdParams>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      // The patient's own tp codes scope the shared flat `working/` dir to files
      // this patient can actually own (a `{personId}…` prefix match would pull in
      // any patient whose id starts with `{personId}`).
      const tpCodes = await getTimePointCodes(personId);
      const [files, slotNames] = await Promise.all([listPatientWorkingFiles(personId, tpCodes), getPhotoSlotLabels()]);
      // Each slot under the clinic's own name for it, where it set one (Settings → Lookups).
      const entries = files.map((e) => ({ ...e, label: slotNames.get(e.view) ?? null }));
      log.info('[Files] working-list', {
        userId: req.session?.userId,
        personId,
        count: entries.length,
      });
      // Shape mirrors FileListing so the client can reuse the file-explorer types.
      sendData(res, fileExplorer.workingFiles.response, { path: 'working', parent: null, flat: false, truncated: false, entries });
    } catch (err) {
      handleError(res, err, 'working-list');
    }
  }
);

router.get(
  '/patients/:personId/working-files/content',
  async (req: Request<PersonIdParams>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const name = queryString(req.query.name);
      const download = isTruthy(req.query.download);
      const thumbRaw = queryString(req.query.thumb);

      // Strictly validated against the exact names THIS patient's timepoints can
      // produce — no separators, no traversal, no other patient's files.
      const tpCodes = await getTimePointCodes(personId);
      const { abs, mtimeMs } = await resolveWorkingFile(personId, name, tpCodes);

      // ── Thumbnail branch ──
      if (thumbRaw && thumbRaw !== '0') {
        const width = parseInt(thumbRaw, 10);
        const thumbPath = await getWorkingThumbnail(
          personId,
          name,
          abs,
          mtimeMs,
          isNaN(width) ? 240 : width
        );
        res.setHeader('Content-Type', 'image/webp');
        // A re-render keeps the file's name, so the 7-day browser cache is only for
        // a `?v=` that names this mtime (every caller passes one); anything else
        // revalidates. `private` keeps PHI off the cloudflared edge.
        res.setHeader('Cache-Control', imageCacheControl(req.query.v, mtimeMs, { maxAgeSeconds: THUMB_MAX_AGE_S }));
        res.sendFile(
          thumbPath,
          { dotfiles: 'allow', cacheControl: false, lastModified: true },
          (err) => {
            if (err && !res.headersSent) ErrorResponses.serverError(res, 'Failed to serve thumbnail');
          }
        );
        return;
      }

      // ── Full file branch ──
      // The extension says nothing (`.iNN`, `.vNN`), so the bytes give the type: an
      // image is always JPEG, Dolphin's original of it JPEG, TIFF, BMP or PNG. Bytes that
      // aren't an image are only ever offered as a download, never served inline.
      log.info('[Files] working-content', { userId: req.session?.userId, personId, name, download });
      res.setHeader('Cache-Control', REVALIDATE);
      const mime = await sniffImageMime(abs);
      if (!download && !mime) {
        sendError(res, 415, 'Not an image a browser can show — download it instead');
        return;
      }
      // Browsers (bar Safari) can't decode TIFF, so it is viewed as a lossless,
      // full-resolution PNG, as on the Files page. A download gets the original file.
      if (!download && mime === 'image/tiff') {
        res.type('png').send(await sharp(abs).rotate().png().toBuffer());
        return;
      }
      const type = mime ?? 'application/octet-stream';
      const sendOpts = {
        dotfiles: 'allow' as const,
        acceptRanges: true,
        cacheControl: false,
        lastModified: true,
      };
      const onDone = (err: Error | undefined): void => {
        if (!err || res.headersSent) return;
        streamFileFallback(req, res, abs, type, download, name).catch(() => {
          if (!res.headersSent) ErrorResponses.serverError(res, 'Failed to serve file');
        });
      };
      if (download) {
        res.download(abs, name, sendOpts, onDone);
      } else {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-type', type);
        res.sendFile(abs, sendOpts, onDone);
      }
    } catch (err) {
      handleError(res, err, 'working-content');
    }
  }
);

/**
 * DELETE /patients/:personId/working-files?name=
 * The Working files page's Delete, for one slot (a grid view or an OPG), named by
 * either of its files: the image (`.iNN`) and Dolphin's original of it (`.vNN`) go to
 * the patient's trash together, and the slot's `time_point_images` row is deleted.
 * Deleting the row is what removes the image from Dolphin as well: the Dolphin sink
 * deletes the `TimePointImages` row it maps to (the client's confirm says so). The
 * files move first, both or neither, so a file Dolphin holds open fails the request
 * with nothing changed.
 */
router.delete(
  '/patients/:personId/working-files',
  authorize(CLINICAL_ROLES),
  validate({ params: fileExplorer.deleteWorkingFile.params, query: fileExplorer.deleteWorkingFile.query }),
  async (
    req: Request<PersonIdParams, unknown, unknown, fileExplorer.DeleteWorkingFileQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = Number.parseInt(req.params.personId, 10);
      const { name } = req.query;
      const tpCodes = await getTimePointCodes(req.params.personId);
      const { tpCode, view, removed } = await trashWorkingFile(personId, name, tpCodes);

      const tp = await getNativeTimePoint(personId, tpCode);
      if (tp) await deleteNativeTimePointImage(tp.timePointId, view.slice(1));

      // A grid view's original returns to the photo editor's Sequence Files panel, as
      // after the editor's own Remove (a no-op for the other slots). Best-effort: the
      // image and its record are already gone.
      const folder = tp ? timepointFolderName(tp.tp_description, tp.tp_date_time) : null;
      if (folder) {
        await untagOriginalForView(personId, folder, view).catch((err: Error) => {
          log.warn('[Files] working-delete: untag original failed', { personId, folder, view, error: err.message });
        });
      }

      log.info('[Files] working-delete', { userId: req.session?.userId, personId, name, tpCode, view, removed });
      sendData(res, fileExplorer.deleteWorkingFile.response, { name, removed }, 'Photo deleted');
    } catch (err) {
      handleError(res, err, 'working-delete');
    }
  }
);

// ===========================================
// UPLOAD  (write — admin/secretary)
// ===========================================

const uploadStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const personId = req.params.personId;
    const relPath = queryString(req.query.path);
    // Validate the TARGET dir up front (rejects traversal before accepting
    // bytes), but stage the temp file in the off-folder sibling staging dir.
    Promise.all([validateUploadTargetDir(personId, relPath), getUploadStagingDir(personId)])
      .then(([, staging]) => cb(null, staging))
      .catch((err) => cb(err as Error, ''));
  },
  filename: (_req, _file, cb) => {
    cb(null, `.uploading-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  },
});

const uploadMw = createUpload({ storage: uploadStorage, limits: { fileSize: MAX_UPLOAD_BYTES } });

/** Run multer and translate its errors (no `payloadTooLarge` helper exists). */
function runUpload(req: Request, res: Response, next: NextFunction): void {
  uploadMw.array('files', 50)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof FileExplorerError) {
      sendError(res, err.status, err.message);
      return;
    }
    const message = uploadErrorMessage(err, 'File exceeds the size limit');
    if (message) {
      ErrorResponses.badRequest(res, message);
      return;
    }
    // Not an upload error — the storage `destination` callback also lands here
    // (`cb(err)` on a failed staging mkdir), and its message is an fs error
    // carrying a server path. Fixed string out, real error into dev-only details.
    log.error('[FileExplorer] upload failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Upload failed', err as Error);
  });
}

router.post(
  '/patients/:personId/files/upload',
  authorize(CLINICAL_ROLES),
  validate({ params: fileExplorer.upload.params }),
  // A multi-file photo/scan drop is far more than 30s of transfer; without this
  // the global requestTimeout 408s the upload while it is still streaming (the
  // client call sites carry a matching 120s override).
  timeouts.long,
  runUpload,
  async (req: Request<PersonIdParams>, res: Response): Promise<void> => {
    const files = (req.files as Express.Multer.File[]) || [];
    try {
      const { personId } = req.params;
      const relPath = queryString(req.query.path);
      const overwrite = isTruthy(req.query.overwrite);

      if (files.length === 0) {
        ErrorResponses.badRequest(res, 'No files uploaded');
        return;
      }

      const created: FileEntry[] = [];
      for (const f of files) {
        const entry = await finalizeUpload(personId, relPath, f.path, f.originalname, overwrite);
        created.push(entry);
        log.info('[Files] upload', {
          userId: req.session?.userId,
          personId,
          relPath,
          name: entry.name,
        });
      }

      sendData(res, fileExplorer.upload.response, { files: created }, `Uploaded ${created.length} file(s)`);
    } catch (err) {
      // Clean up any staged temp files that never made it to their final name.
      await Promise.all(
        files.map((f) => fsp.rm(f.path, { force: true }).catch(() => {}))
      );
      handleError(res, err, 'upload');
    }
  }
);

// ===========================================
// CREATE FOLDER  (write)
// ===========================================

router.post(
  '/patients/:personId/files/folder',
  authorize(CLINICAL_ROLES),
  validate({ params: fileExplorer.folder.params, body: fileExplorer.folder.body }),
  async (req: Request<PersonIdParams, unknown, { path?: string; name?: string }>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { path: relPath = '', name = '' } = req.body || {};
      const entry = await createFolder(personId, relPath, name);
      log.info('[Files] mkdir', { userId: req.session?.userId, personId, relPath, name: entry.name });
      sendData(res, fileExplorer.folder.response, entry, 'Folder created');
    } catch (err) {
      handleError(res, err, 'mkdir');
    }
  }
);

// ===========================================
// RENAME  (write)
// ===========================================

router.post(
  '/patients/:personId/files/rename',
  authorize(CLINICAL_ROLES),
  validate({ params: fileExplorer.rename.params, body: fileExplorer.rename.body }),
  async (req: Request<PersonIdParams, unknown, fileExplorer.RenameBody>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { path: relPath = '', newName = '', force = false } = req.body || {};
      if (!relPath) {
        ErrorResponses.missingParameter(res, 'path');
        return;
      }
      // A top-level folder that a photo session or the X-ray card reads by name is
      // refused unless the caller confirmed (FE-F14-5): renaming it detaches it from
      // its owner without a word.
      if (!force && (await refuseOwnedFolders(res, String(personId), [relPath], 'Renaming'))) return;
      const entry = await renameEntry(personId, relPath, newName);
      log.info('[Files] rename', { userId: req.session?.userId, personId, relPath, newName: entry.name });
      sendData(res, fileExplorer.rename.response, entry, 'Renamed');
    } catch (err) {
      handleError(res, err, 'rename');
    }
  }
);

// ===========================================
// DELETE  (write — soft delete to .trash)
// ===========================================

router.delete(
  '/patients/:personId/files',
  authorize(CLINICAL_ROLES),
  validate({ params: fileExplorer.deleteEntry.params }),
  async (req: Request<PersonIdParams>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const relPath = queryString(req.query.path);
      if (!relPath) {
        ErrorResponses.missingParameter(res, 'path');
        return;
      }
      await softDelete(personId, relPath);
      log.info('[Files] delete', { userId: req.session?.userId, personId, relPath });
      sendData(res, fileExplorer.deleteEntry.response, { path: relPath }, 'Moved to trash');
    } catch (err) {
      handleError(res, err, 'delete');
    }
  }
);

// ===========================================
// BATCH DELETE  (write — soft delete many to one .trash stamp dir)
// ===========================================

/** Matches the service's listing cap — a "select all" can't exceed it. */
const MAX_BATCH_DELETE = 5000;

router.post(
  '/patients/:personId/files/delete-batch',
  authorize(CLINICAL_ROLES),
  validate({ params: fileExplorer.deleteBatch.params }),
  timeouts.long, // bulk renames over SMB can exceed the global 30s gate
  async (
    req: Request<PersonIdParams, unknown, { paths?: unknown }>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId } = req.params;
      const { paths } = req.body || {};

      if (!Array.isArray(paths) || paths.length === 0) {
        ErrorResponses.badRequest(res, 'paths must be a non-empty array');
        return;
      }
      if (paths.length > MAX_BATCH_DELETE) {
        ErrorResponses.badRequest(res, `Cannot delete more than ${MAX_BATCH_DELETE} items at once`);
        return;
      }
      const relPaths = paths.filter((p): p is string => typeof p === 'string' && p.length > 0);
      if (relPaths.length === 0) {
        ErrorResponses.badRequest(res, 'No valid paths supplied');
        return;
      }

      const result = await softDeleteBatch(personId, relPaths);
      log.info('[Files] delete-batch', {
        userId: req.session?.userId,
        personId,
        requested: relPaths.length,
        succeeded: result.succeeded,
        failed: result.failed,
      });
      sendData(
        res,
        fileExplorer.deleteBatch.response,
        result,
        result.failed === 0
          ? `Moved ${result.succeeded} item(s) to trash`
          : `Moved ${result.succeeded}, ${result.failed} failed`
      );
    } catch (err) {
      handleError(res, err, 'delete-batch');
    }
  }
);

// ===========================================
// MOVE / COPY  (write — batch, into one existing folder of the same patient)
// ===========================================

/** The response message shared by move and copy, e.g. "Moved 3, 1 failed". */
function transferMessage(verb: string, succeeded: number, failed: number): string {
  return failed === 0 ? `${verb} ${succeeded} item(s)` : `${verb} ${succeeded}, ${failed} failed`;
}

router.post(
  '/patients/:personId/files/move',
  authorize(CLINICAL_ROLES),
  validate({ params: fileExplorer.move.params, body: fileExplorer.move.body }),
  timeouts.long, // one rename per entry, but a select-all can be thousands
  async (req: Request<PersonIdParams, unknown, fileExplorer.MoveBody>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { paths, dest, force = false } = req.body;
      // Moving a session's originals folder (or OPG/CBCT) detaches it exactly as a
      // rename does — same guard, same confirm-then-force round trip on the client.
      if (!force && (await refuseOwnedFolders(res, String(personId), paths, 'Moving'))) return;

      const result = await transferEntries(personId, paths, dest, 'move');
      log.info('[Files] move', {
        userId: req.session?.userId,
        personId,
        dest,
        requested: paths.length,
        succeeded: result.succeeded,
        failed: result.failed,
      });
      sendData(res, fileExplorer.move.response, result, transferMessage('Moved', result.succeeded, result.failed));
    } catch (err) {
      handleError(res, err, 'move');
    }
  }
);

router.post(
  '/patients/:personId/files/copy',
  authorize(CLINICAL_ROLES),
  validate({ params: fileExplorer.copy.params, body: fileExplorer.copy.body }),
  // A copy writes every byte again, and a CBCT study is gigabytes: the upload preset
  // (10 min), matched by the client call's own timeout.
  timeouts.upload,
  async (req: Request<PersonIdParams, unknown, fileExplorer.CopyBody>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { paths, dest } = req.body;
      const result = await transferEntries(personId, paths, dest, 'copy');
      log.info('[Files] copy', {
        userId: req.session?.userId,
        personId,
        dest,
        requested: paths.length,
        succeeded: result.succeeded,
        failed: result.failed,
      });
      sendData(res, fileExplorer.copy.response, result, transferMessage('Copied', result.succeeded, result.failed));
    } catch (err) {
      handleError(res, err, 'copy');
    }
  }
);

export default router;
