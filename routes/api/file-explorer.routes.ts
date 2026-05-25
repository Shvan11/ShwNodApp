/**
 * Patient File Explorer routes.
 *
 * Per-patient filesystem browser: list/flat-walk, content (inline preview +
 * download + thumbnail), and full management (upload, mkdir, rename, soft
 * delete). All path safety lives in services/files/file-explorer.service.ts.
 *
 * Reads ride the global `/api` `authenticate` gate (index.ts). Writes add
 * `authorize(['admin','secretary'])`. Every content fetch + mutation is
 * audit-logged with the acting user id.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { createReadStream, promises as fsp } from 'fs';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendError, sendSuccess } from '../../utils/error-response.js';
import { authorize } from '../../middleware/auth.js';
import { getFileMimeType } from '../../utils/file-mime.js';
import {
  FileExplorerError,
  listDirectory,
  walkFlat,
  resolveFileForServe,
  createFolder,
  renameEntry,
  softDelete,
  validateUploadTargetDir,
  getUploadStagingDir,
  finalizeUpload,
  type FileEntry,
} from '../../services/files/file-explorer.service.js';
import { getThumbnail } from '../../services/files/thumbnail.service.js';

const router = Router();

const MAX_UPLOAD_BYTES =
  parseInt(process.env.FILE_EXPLORER_MAX_UPLOAD_MB || '200', 10) * 1024 * 1024;

// ===========================================
// HELPERS
// ===========================================

// `type` (not `interface`) so it carries an implicit index signature and stays
// assignable to Express's ParamsDictionary in handler/middleware generics.
type PersonIdParams = { personId: string };

const isTruthy = (v: unknown): boolean => v === '1' || v === 'true';
const queryString = (v: unknown): string => (typeof v === 'string' ? v : '');

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

  res.setHeader('Content-Type', mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Last-Modified', st.mtime.toUTCString());
  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/["\r\n]/g, '')}"`);
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
      sendSuccess(res, listing);
    } catch (err) {
      handleError(res, err, 'list');
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
        const thumbPath = await getThumbnail(personId, relPath, isNaN(width) ? 240 : width);
        log.info('[Files] thumb', { userId: req.session?.userId, personId, relPath, width });
        res.setHeader('Content-Type', 'image/webp');
        res.sendFile(
          thumbPath,
          // `dotfiles: 'allow'` is required — the cache lives under a dot dir
          // (`.cache/thumbs/…`), which `send` would otherwise refuse to serve.
          { dotfiles: 'allow', cacheControl: true, lastModified: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
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

      const sendOpts = {
        dotfiles: 'allow' as const,
        acceptRanges: true,
        cacheControl: true,
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
        res.setHeader('Content-Type', mime);
        res.sendFile(abs, sendOpts, onDone);
      }
    } catch (err) {
      handleError(res, err, 'content');
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

const uploadMw = multer({ storage: uploadStorage, limits: { fileSize: MAX_UPLOAD_BYTES } });

/** Run multer and translate its errors (no `payloadTooLarge` helper exists). */
function runUpload(req: Request, res: Response, next: NextFunction): void {
  uploadMw.array('files', 50)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if ((err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
      ErrorResponses.badRequest(res, 'File exceeds the size limit');
      return;
    }
    if (err instanceof FileExplorerError) {
      sendError(res, err.status, err.message);
      return;
    }
    ErrorResponses.badRequest(res, `Upload error: ${(err as Error).message}`);
  });
}

router.post(
  '/patients/:personId/files/upload',
  authorize(['admin', 'secretary']),
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

      sendSuccess(res, { files: created }, `Uploaded ${created.length} file(s)`);
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
  authorize(['admin', 'secretary']),
  async (req: Request<PersonIdParams, unknown, { path?: string; name?: string }>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { path: relPath = '', name = '' } = req.body || {};
      const entry = await createFolder(personId, relPath, name);
      log.info('[Files] mkdir', { userId: req.session?.userId, personId, relPath, name: entry.name });
      sendSuccess(res, entry, 'Folder created');
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
  authorize(['admin', 'secretary']),
  async (req: Request<PersonIdParams, unknown, { path?: string; newName?: string }>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      const { path: relPath = '', newName = '' } = req.body || {};
      if (!relPath) {
        ErrorResponses.missingParameter(res, 'path');
        return;
      }
      const entry = await renameEntry(personId, relPath, newName);
      log.info('[Files] rename', { userId: req.session?.userId, personId, relPath, newName: entry.name });
      sendSuccess(res, entry, 'Renamed');
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
  authorize(['admin', 'secretary']),
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
      sendSuccess(res, { path: relPath }, 'Moved to trash');
    } catch (err) {
      handleError(res, err, 'delete');
    }
  }
);

export default router;
