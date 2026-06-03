/**
 * HTTP file streaming with correct Range handling and stream-error safety.
 *
 * Centralizes the pattern that was duplicated (and partly unsafe) across the
 * video routes:
 *  - Validates the Range header. A garbage or unsatisfiable range (e.g.
 *    `bytes=abc-`, or a start past EOF) now returns 416 with an
 *    unsatisfied-range Content-Range header instead of piping a read stream
 *    with NaN or negative bounds (which produced a hung / malformed response).
 *  - Attaches an `'error'` handler to the read stream so a file that vanishes
 *    or becomes unreadable mid-stream emits a handled error rather than an
 *    unhandled `'error'` event, which would crash the process.
 *
 * The caller is responsible for stat()ing the file first (so ENOENT → 404) and
 * for setting any extra headers (Cache-Control, Content-Disposition, etc.) via
 * res.setHeader BEFORE calling this — those are preserved and merged by
 * res.writeHead.
 */
import fs from 'node:fs';
import type { Request, Response } from 'express';
import { log } from './logger.js';

export function streamFile(
  // Only the Range header is needed; accept any Request shape so callers with
  // a narrower params generic (e.g. Request<VideoIdParams>) can pass through.
  req: Pick<Request, 'headers'>,
  res: Response,
  filePath: string,
  fileSize: number,
  mimeType: string
): void {
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  let stream: fs.ReadStream;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      start > end ||
      end >= fileSize
    ) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }

    stream = fs.createReadStream(filePath, { start, end });
    // Attach the error handler before committing headers so an open error
    // (e.g. TOCTOU delete) is still caught.
    stream.on('error', (err) => onStreamError(res, filePath, err));
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': String(end - start + 1),
      'Content-Type': mimeType,
    });
  } else {
    stream = fs.createReadStream(filePath);
    stream.on('error', (err) => onStreamError(res, filePath, err));
    res.writeHead(200, {
      'Content-Length': String(fileSize),
      'Content-Type': mimeType,
    });
  }

  stream.pipe(res);
}

function onStreamError(res: Response, filePath: string, err: unknown): void {
  log.error('[streamFile] read stream error', {
    filePath,
    error: (err as Error).message,
  });
  if (!res.headersSent) {
    res.status(500).end();
  } else {
    res.destroy();
  }
}
