/**
 * File Upload Middleware
 * Configures Multer for handling file uploads
 */
import multer, { type FileFilterCallback, type StorageEngine } from 'multer';
import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ErrorResponses } from '../utils/error-response.js';

/**
 * Request with file from memory storage
 */
export interface FileRequest extends Request {
  file?: Express.Multer.File;
}

/**
 * Custom multer error with code
 */
interface MulterError extends Error {
  code: string;
  field?: string;
}

/** Multer's own `MulterError` codes (multer v1/v2). */
const MULTER_CODES = new Set([
  'LIMIT_PART_COUNT',
  'LIMIT_FILE_SIZE',
  'LIMIT_FILE_COUNT',
  'LIMIT_FIELD_KEY',
  'LIMIT_FIELD_VALUE',
  'LIMIT_FIELD_COUNT',
  'LIMIT_UNEXPECTED_FILE',
]);

/**
 * An upload refused for a reason the USER is meant to read — a `fileFilter`
 * verdict ("Only PDF files are allowed", "Unsupported file type. Allowed: …").
 *
 * Multer hands a `fileFilter`'s `cb(err)` straight back to the caller unchanged,
 * so without a marker type an upload handler cannot tell that curated message
 * apart from an `EACCES` off the staging `mkdir` or a pg SQLSTATE that happened
 * to surface in the same callback. Every handler used to forward all of them as
 * `Upload error: <raw message>`, which is the leak this type closes.
 */
export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejectedError';
  }
}

function isMulterError(err: unknown): err is MulterError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string' &&
    MULTER_CODES.has((err as MulterError).code)
  );
}

/**
 * The message to show the client for an error out of a multer callback — or
 * `null` when the error did NOT come from the upload layer and therefore must not
 * be described to the client at all (the caller should answer a fixed string and
 * put the error in dev-only `details`).
 *
 * Shared by the three upload error handlers — `handleUploadError` here plus the
 * route-local ones in `media.routes.ts` and `file-explorer.routes.ts` — which
 * each had their own copy of the same `'code' in err` test. Two of the three
 * never got the narrowing fix, and all three ended in a raw-message fallback.
 *
 * @param tooLarge Per-route copy for `LIMIT_FILE_SIZE`; each upload has its own cap.
 */
export function uploadErrorMessage(
  err: unknown,
  tooLarge = 'File is too large.'
): string | null {
  if (err instanceof UploadRejectedError) return err.message;
  if (!isMulterError(err)) return null;
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return tooLarge;
    case 'LIMIT_FILE_COUNT':
      return 'Too many files for this upload.';
    case 'LIMIT_UNEXPECTED_FILE':
      return 'Unexpected file field name.';
    default:
      // Remaining codes are multer's own field/part limits — its message names the
      // limit that was hit and carries nothing internal.
      return `Upload error: ${err.message}`;
  }
}

// Configure multer for memory storage (we'll upload directly to Google Drive)
const storage: StorageEngine = multer.memoryStorage();

// File filter to only accept PDFs
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
): void => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new UploadRejectedError('Only PDF files are allowed'));
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
    files: 1 // Only one file per upload
  }
});

/**
 * Middleware for single PDF upload
 */
export const uploadSinglePdf = upload.single('pdf');

/**
 * Error handler for multer errors
 */
export const handleUploadError: ErrorRequestHandler = (
  err: Error | MulterError,
  _req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!err) {
    next();
    return;
  }

  // `uploadErrorMessage` identifies a real upload error by multer's own codes (or
  // the UploadRejectedError marker), NOT by "has a string `code`" — a pg SQLSTATE
  // ('23505') or a Node fs error ('ENOENT') reaching this handler would otherwise
  // be reported to the client as `Upload error: <raw message>` with a 400, leaking
  // exactly the raw text the global error handler suppresses.
  const message = uploadErrorMessage(err, 'File is too large. Maximum size is 100MB.');
  if (message) {
    ErrorResponses.badRequest(res, message);
    return;
  }

  // Not an upload error at all: hand it to the global error handler rather than
  // relabelling someone else's failure as a 400 "Upload error". The previous
  // `else if (err)` branch answered `badRequest(res, err.message)` here, so the
  // narrowing above only ever covered half the paths into this function.
  next(err);
};

export default upload;
