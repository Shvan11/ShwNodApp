/**
 * Middleware Collection
 * Central export for all middleware modules
 */
import express, { type Application } from 'express';

// Re-export authentication middleware
export {
  authenticate,
  authenticateWeb,
  authorize,
  verifyCredentials,
  hashPassword
} from './auth.js';

// Re-export timeout middleware
export {
  requestTimeout,
  customTimeout,
  timeouts,
  TIMEOUTS,
  type TimeoutType,
  type TimeoutValue
} from './timeout.js';

// Re-export upload middleware
export {
  uploadSinglePdf,
  handleUploadError,
  type MemoryFile,
  type FileRequest
} from './upload.js';
export { default as upload } from './upload.js';

// Re-export time-based auth middleware
export {
  requireRecordAge,
  isToday,
  getPatientCreationDate,
  getWorkCreationDate,
  getInvoiceCreationDate,
  getExpenseCreationDate,
  type ResourceType,
  type OperationType,
  type GetRecordDateFn,
  type RecordAgeOptions
} from './time-based-auth.js';

/**
 * Common middleware setup
 * @param app - Express application
 */
export function setupMiddleware(app: Application): void {
  // CORS middleware
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, OPTIONS, PUT, PATCH, DELETE'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-Requested-With,content-type'
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    next();
  });

  // Body parser middleware
  app.use(express.json({ limit: '200mb' }));
  app.use(express.urlencoded({ extended: true, limit: '200mb' }));
}
