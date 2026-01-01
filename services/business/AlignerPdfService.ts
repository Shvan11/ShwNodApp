/**
 * Aligner PDF Service - Business Logic Layer
 *
 * This service handles all aligner PDF-related business logic including:
 * - PDF upload workflow with Google Drive integration
 * - PDF deletion with Drive cleanup
 * - Set information retrieval
 * - Multi-step orchestration of Drive + Database operations
 *
 * This layer sits between route handlers and database/Drive services,
 * orchestrating complex workflows.
 */

import { log } from '../../utils/logger.js';
import * as database from '../database/index.js';
import driveUploadService from '../google-drive/drive-upload.js';

/**
 * PDF error codes
 */
export type PdfErrorCode = 'SET_NOT_FOUND' | 'UPLOAD_FAILED' | 'DELETION_FAILED';

/**
 * PDF error details
 */
export interface PdfErrorDetails {
  setId?: number;
  originalError?: string;
  fileId?: string;
  fileName?: string;
}

/**
 * Validation error class for aligner PDF business logic
 */
export class AlignerPdfError extends Error {
  public readonly code: PdfErrorCode;
  public readonly details: PdfErrorDetails;

  constructor(
    message: string,
    code: PdfErrorCode,
    details: PdfErrorDetails = {}
  ) {
    super(message);
    this.name = 'AlignerPdfError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Set information for PDF operations
 */
export interface SetInfo {
  AlignerSetID: number;
  WorkID: number;
  SetSequence: number;
  DriveFileId: string | null;
  PersonID: number;
  PatientName: string;
  FirstName: string | null;
  LastName: string | null;
}

/**
 * Uploaded file object
 */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
}

/**
 * Upload result from Drive service
 */
interface DriveUploadResult {
  url: string;
  fileId: string;
  fileName: string;
  size: string | number;
}

/**
 * PDF upload result
 */
export interface PdfUploadResult {
  url: string;
  fileName: string;
  size: string | number;
}

/**
 * Get aligner set information for PDF operations
 * @param setId - Aligner set ID
 * @returns Set information
 * @throws AlignerPdfError If set not found
 */
async function getSetInfo(setId: number): Promise<SetInfo> {
  const setQuery = `
        SELECT
            s.AlignerSetID,
            s.WorkID,
            s.SetSequence,
            s.DriveFileId,
            w.PersonID,
            p.PatientName,
            p.FirstName,
            p.LastName
        FROM tblAlignerSets s
        INNER JOIN tblWork w ON s.WorkID = w.workid
        INNER JOIN tblPatients p ON w.PersonID = p.PersonID
        WHERE s.AlignerSetID = @setId
    `;

  const result = await database.executeQuery<SetInfo>(
    setQuery,
    [['setId', database.TYPES.Int, setId]],
    (columns) => ({
      AlignerSetID: columns[0].value as number,
      WorkID: columns[1].value as number,
      SetSequence: columns[2].value as number,
      DriveFileId: columns[3].value as string | null,
      PersonID: columns[4].value as number,
      PatientName: columns[5].value as string,
      FirstName: columns[6].value as string | null,
      LastName: columns[7].value as string | null,
    })
  );

  if (!result || result.length === 0) {
    throw new AlignerPdfError('Aligner set not found', 'SET_NOT_FOUND', {
      setId,
    });
  }

  return result[0];
}

/**
 * Delete old PDF from Google Drive (with error tolerance)
 * @param driveFileId - Drive file ID
 */
async function deleteOldPdfFromDrive(
  driveFileId: string | null
): Promise<void> {
  if (!driveFileId) {
    return; // Nothing to delete
  }

  try {
    await driveUploadService.deletePdf(driveFileId);
    log.info(`Old PDF deleted from Drive: ${driveFileId}`);
  } catch (error) {
    log.warn('Failed to delete old PDF from Drive:', { error: error instanceof Error ? error.message : String(error) });
    // Continue even if deletion fails - Drive cleanup is best-effort
  }
}

/**
 * Update database with new PDF information
 * @param setId - Aligner set ID
 * @param uploadResult - Upload result from Drive service
 * @param uploaderEmail - Email of uploader
 */
async function updateDatabaseWithPdf(
  setId: number,
  uploadResult: DriveUploadResult,
  uploaderEmail: string
): Promise<void> {
  const updateQuery = `
        UPDATE tblAlignerSets
        SET
            SetPdfUrl = @url,
            DriveFileId = @fileId,
            PdfUploadedAt = GETDATE(),
            PdfUploadedBy = @uploadedBy
        WHERE AlignerSetID = @setId
    `;

  await database.executeQuery(
    updateQuery,
    [
      ['url', database.TYPES.NVarChar, uploadResult.url],
      ['fileId', database.TYPES.NVarChar, uploadResult.fileId],
      ['uploadedBy', database.TYPES.NVarChar, uploaderEmail],
      ['setId', database.TYPES.Int, setId],
    ],
    (columns) => ({ value: columns[0]?.value })
  );

  log.info(`Database updated with PDF info for set ${setId}`);
}

/**
 * Upload PDF for an aligner set
 *
 * Multi-step workflow:
 * 1. Fetch set information (patient, work, sequence)
 * 2. Delete old PDF from Drive if exists (best-effort)
 * 3. Upload new PDF to Google Drive
 * 4. Update database with new PDF metadata
 *
 * @param setId - Aligner set ID
 * @param file - Uploaded file object
 * @param uploaderEmail - Email of uploader
 * @returns Upload result
 * @throws AlignerPdfError If workflow fails
 */
export async function uploadPdfForSet(
  setId: number,
  file: UploadedFile,
  uploaderEmail: string
): Promise<PdfUploadResult> {
  try {
    log.info(`Starting PDF upload workflow for set ${setId}`);

    // Step 1: Get set information
    const setInfo = await getSetInfo(setId);
    const patientName =
      setInfo.PatientName || `${setInfo.FirstName} ${setInfo.LastName}`;

    // Step 2: Delete old file from Drive if exists (best-effort)
    await deleteOldPdfFromDrive(setInfo.DriveFileId);

    // Step 3: Upload to Google Drive
    const uploadResult = await driveUploadService.uploadPdfForSet(
      {
        buffer: file.buffer,
        originalName: file.originalname,
      },
      {
        patientId: String(setInfo.PersonID),
        patientName: patientName,
        workId: String(setInfo.WorkID),
        setSequence: setInfo.SetSequence,
      },
      uploaderEmail
    );

    // Map the result to our expected format
    const driveResult: DriveUploadResult = {
      url: uploadResult.url || '',
      fileId: uploadResult.fileId || '',
      fileName: uploadResult.fileName || '',
      size: uploadResult.size || 0,
    };

    log.info(`PDF uploaded to Drive: ${driveResult.fileName}`);

    // Step 4: Update database with new PDF metadata
    await updateDatabaseWithPdf(setId, driveResult, uploaderEmail);

    log.info(`PDF upload workflow completed successfully for set ${setId}`);

    return {
      url: driveResult.url,
      fileName: driveResult.fileName,
      size: driveResult.size,
    };
  } catch (error) {
    // Wrap any errors in AlignerPdfError for consistent error handling
    if (error instanceof AlignerPdfError) {
      throw error;
    }

    log.error('PDF upload workflow failed:', { error: error instanceof Error ? error.message : String(error) });
    throw new AlignerPdfError('Failed to upload PDF', 'UPLOAD_FAILED', {
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Clear PDF information from database
 * @param setId - Aligner set ID
 */
async function clearPdfFromDatabase(setId: number): Promise<void> {
  const updateQuery = `
        UPDATE tblAlignerSets
        SET
            SetPdfUrl = NULL,
            DriveFileId = NULL,
            PdfUploadedAt = NULL,
            PdfUploadedBy = NULL
        WHERE AlignerSetID = @setId
    `;

  await database.executeQuery(
    updateQuery,
    [['setId', database.TYPES.Int, setId]],
    (columns) => ({ value: columns[0]?.value })
  );

  log.info(`PDF metadata cleared from database for set ${setId}`);
}

/**
 * Delete PDF from an aligner set
 *
 * Multi-step workflow:
 * 1. Fetch set information to get Drive file ID
 * 2. Delete from Google Drive if exists (best-effort)
 * 3. Clear PDF metadata from database
 *
 * @param setId - Aligner set ID
 * @throws AlignerPdfError If workflow fails
 */
export async function deletePdfFromSet(setId: number): Promise<void> {
  try {
    log.info(`Starting PDF deletion workflow for set ${setId}`);

    // Step 1: Get set information
    interface DriveFileResult {
      DriveFileId: string | null;
    }

    const setQuery = `
            SELECT DriveFileId
            FROM tblAlignerSets
            WHERE AlignerSetID = @setId
        `;

    const result = await database.executeQuery<DriveFileResult>(
      setQuery,
      [['setId', database.TYPES.Int, setId]],
      (columns) => ({
        DriveFileId: columns[0].value as string | null,
      })
    );

    if (!result || result.length === 0) {
      throw new AlignerPdfError('Aligner set not found', 'SET_NOT_FOUND', {
        setId,
      });
    }

    const driveFileId = result[0].DriveFileId;

    // Step 2: Delete from Google Drive if exists (best-effort)
    await deleteOldPdfFromDrive(driveFileId);

    // Step 3: Clear PDF metadata from database
    await clearPdfFromDatabase(setId);

    log.info(`PDF deletion workflow completed successfully for set ${setId}`);
  } catch (error) {
    // Wrap any errors in AlignerPdfError for consistent error handling
    if (error instanceof AlignerPdfError) {
      throw error;
    }

    log.error('PDF deletion workflow failed:', { error: error instanceof Error ? error.message : String(error) });
    throw new AlignerPdfError('Failed to delete PDF', 'DELETION_FAILED', {
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
}

export default {
  uploadPdfForSet,
  deletePdfFromSet,
  AlignerPdfError,
};
