/**
 * File Upload Middleware
 * Configures Multer for handling file uploads
 */
import multer, { type FileFilterCallback, type StorageEngine } from 'multer';
import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';

/**
 * Extended file interface for multer uploads with memory storage
 */
export interface MemoryFile extends Express.Multer.File {
  buffer: Buffer;
}

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
    cb(new Error('Only PDF files are allowed'));
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
  // Check if it's a multer error by checking for the code property
  if ('code' in err && typeof err.code === 'string') {
    const multerErr = err as MulterError;

    if (multerErr.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({
        success: false,
        error: 'File is too large. Maximum size is 100MB.'
      });
      return;
    }
    if (multerErr.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({
        success: false,
        error: 'Too many files. Only one file can be uploaded at a time.'
      });
      return;
    }
    if (multerErr.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({
        success: false,
        error: 'Unexpected field name. Use "pdf" as the field name.'
      });
      return;
    }
    res.status(400).json({
      success: false,
      error: `Upload error: ${multerErr.message}`
    });
    return;
  } else if (err) {
    // Other errors (like file filter errors)
    res.status(400).json({
      success: false,
      error: err.message
    });
    return;
  }
  next();
};

export default upload;
