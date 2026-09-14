/**
 * HTTP file streaming with correct Range handling and stream-error safety.
 *
 * Centralizes the pattern that was duplicated (and partly unsafe) across the
 * video routes:
 *  - Parses the Range header per RFC 9110 §14 — `bytes=a-b`, the open-ended
 *    `bytes=a-`, and the SUFFIX form `bytes=-N` ("the last N bytes"), which
 *    download managers and some players send to probe a file tail. A garbage or
 *    unsatisfiable range (e.g. `bytes=abc-`, or a start past EOF) returns 416
 *    with an unsatisfied-range Content-Range header instead of piping a read
 *    stream with NaN or negative bounds (which produced a hung / malformed
 *    response).
 *  - A MULTI-range request (`bytes=0-10,20-30`) is answered with the whole file
 *    (200), which RFC 9110 explicitly permits — the alternative would be a
 *    `multipart/byteranges` body. What it must never do is silently answer the
 *    first range with a 206 the client will read as the complete response.
 *  - Attaches an `'error'` handler to the read stream so a file that vanishes
 *    or becomes unreadable mid-stream emits a handled error rather than an
 *    unhandled `'error'` event, which would crash the process.
 *  - Destroys the read stream when the response closes. Without this, a client
 *    abort — routine when scrubbing a video — leaves the `fs.ReadStream` reading
 *    on to EOF with nothing consuming it, burning I/O and holding an fd per
 *    abandoned seek.
 *
 * The caller is responsible for stat()ing the file first (so ENOENT → 404) and
 * for setting any extra headers (Cache-Control, Content-Disposition, etc.) via
 * res.setHeader BEFORE calling this — those are preserved and merged by
 * res.writeHead.
 */
import fs from 'node:fs';
import type { Request, Response } from 'express';
import { log } from './logger.js';

/**
 * A resolved byte range, or a directive:
 *  - `'ignore'`       — not a bytes range we serve as 206; send the whole file (200).
 *  - `'unsatisfiable'` — syntactically a byte range, but not one this file has (416).
 */
export type ParsedRange = { start: number; end: number } | 'ignore' | 'unsatisfiable';

/** Parse a `Range` header value against a known file size. Exported for testing. */
export function parseByteRange(header: string, fileSize: number): ParsedRange {
  const match = /^\s*bytes\s*=\s*(.*)$/i.exec(header);
  if (!match) return 'ignore'; // unknown unit — RFC 9110: ignore the header
  const specs = match[1].split(',');
  if (specs.length !== 1) return 'ignore'; // multi-range → whole file

  const spec = specs[0].trim();
  const dash = spec.indexOf('-');
  if (dash === -1) return 'unsatisfiable';

  const firstStr = spec.slice(0, dash).trim();
  const lastStr = spec.slice(dash + 1).trim();

  // Suffix range: `bytes=-500` is the LAST 500 bytes, not "bytes 0..500".
  if (firstStr === '') {
    if (!/^\d+$/.test(lastStr)) return 'unsatisfiable';
    const suffix = Number(lastStr);
    if (suffix === 0 || fileSize === 0) return 'unsatisfiable';
    return { start: Math.max(0, fileSize - suffix), end: fileSize - 1 };
  }

  if (!/^\d+$/.test(firstStr)) return 'unsatisfiable';
  const start = Number(firstStr);
  if (start >= fileSize) return 'unsatisfiable';

  if (lastStr === '') return { start, end: fileSize - 1 };
  if (!/^\d+$/.test(lastStr)) return 'unsatisfiable';
  const end = Math.min(Number(lastStr), fileSize - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
}

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

  const rangeHeader = req.headers.range;
  const range = rangeHeader ? parseByteRange(rangeHeader, fileSize) : 'ignore';

  if (range === 'unsatisfiable') {
    res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
    res.end();
    return;
  }

  let stream: fs.ReadStream;

  if (range === 'ignore') {
    stream = fs.createReadStream(filePath);
    stream.on('error', (err) => onStreamError(res, filePath, err));
    res.writeHead(200, {
      'Content-Length': String(fileSize),
      'Content-Type': mimeType,
    });
  } else {
    const { start, end } = range;
    stream = fs.createReadStream(filePath, { start, end });
    // Attach the error handler before committing headers so an open error
    // (e.g. TOCTOU delete) is still caught.
    stream.on('error', (err) => onStreamError(res, filePath, err));
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': String(end - start + 1),
      'Content-Type': mimeType,
    });
  }

  // Fires on a client abort as well as a clean finish; destroying an already
  // ended stream is a no-op, so this needs no "did it complete?" bookkeeping.
  res.on('close', () => stream.destroy());

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
