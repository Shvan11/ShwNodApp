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
import { sql } from 'kysely';
import { getKysely } from '../database/kysely.js';
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
  aligner_set_id: number;
  work_id: number;
  set_sequence: number;
  drive_file_id: string | null;
  person_id: number;
  patient_name: string;
  first_name: string | null;
  last_name: string | null;
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
 * @param setId - Aligner set id
 * @returns Set information
 * @throws AlignerPdfError If set not found
 */
async function getSetInfo(setId: number): Promise<SetInfo> {
  const db = getKysely();
  const { rows: result } = await sql<SetInfo>`
        SELECT
            s."aligner_set_id",
            s."work_id",
            s."set_sequence",
            s."drive_file_id",
            w."person_id",
            p."patient_name",
            p."first_name",
            p."last_name"
        FROM "aligner_sets" s
        INNER JOIN "works" w ON s."work_id" = w."work_id"
        INNER JOIN "patients" p ON w."person_id" = p."person_id"
        WHERE s."aligner_set_id" = ${setId}
    `.execute(db);

  if (!result || result.length === 0) {
    throw new AlignerPdfError('Aligner set not found', 'SET_NOT_FOUND', {
      setId,
    });
  }

  return result[0];
}

/**
 * Delete old PDF from Google Drive (with error tolerance)
 * @param driveFileId - Drive file id
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
 * @param setId - Aligner set id
 * @param uploadResult - Upload result from Drive service
 * @param uploaderEmail - email of uploader
 */
async function updateDatabaseWithPdf(
  setId: number,
  uploadResult: DriveUploadResult,
  uploaderEmail: string
): Promise<void> {
  const db = getKysely();
  await sql`
        UPDATE "aligner_sets"
        SET
            "set_pdf_url" = ${uploadResult.url},
            "drive_file_id" = ${uploadResult.fileId},
            "pdf_uploaded_at" = LOCALTIMESTAMP,
            "pdf_uploaded_by" = ${uploaderEmail}
        WHERE "aligner_set_id" = ${setId}
    `.execute(db);

  log.info(`Database updated with PDF info for set ${setId}`);
}

/**
 * Upload PDF for an aligner set
 *
 * Multi-step workflow:
 * 1. Fetch set information (patient, work, sequence)
 * 2. Upload new PDF to Google Drive
 * 3. Update database with new PDF metadata
 * 4. Delete old PDF from Drive if it existed (best-effort, only after the
 *    new file + DB row are safely in place — otherwise a failed upload
 *    leaves the DB pointing at an already-deleted file)
 *
 * @param setId - Aligner set id
 * @param file - Uploaded file object
 * @param uploaderEmail - email of uploader
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
      setInfo.patient_name || `${setInfo.first_name} ${setInfo.last_name}`;
    const previousDriveFileId = setInfo.drive_file_id;

    // Step 2: Upload to Google Drive
    const uploadResult = await driveUploadService.uploadPdfForSet(
      {
        buffer: file.buffer,
        originalName: file.originalname,
      },
      {
        patientId: String(setInfo.person_id),
        patientName: patientName,
        workId: String(setInfo.work_id),
        setSequence: setInfo.set_sequence,
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

    // Step 3: Update database with new PDF metadata
    await updateDatabaseWithPdf(setId, driveResult, uploaderEmail);

    // Step 4: Delete the old file from Drive now that the new one is live (best-effort)
    await deleteOldPdfFromDrive(previousDriveFileId);

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
 * @param setId - Aligner set id
 */
async function clearPdfFromDatabase(setId: number): Promise<void> {
  const db = getKysely();
  await sql`
        UPDATE "aligner_sets"
        SET
            "set_pdf_url" = NULL,
            "drive_file_id" = NULL,
            "pdf_uploaded_at" = NULL,
            "pdf_uploaded_by" = NULL
        WHERE "aligner_set_id" = ${setId}
    `.execute(db);

  log.info(`PDF metadata cleared from database for set ${setId}`);
}

/**
 * Delete PDF from an aligner set
 *
 * Multi-step workflow:
 * 1. Fetch set information to get Drive file id
 * 2. Delete from Google Drive if exists (best-effort)
 * 3. Clear PDF metadata from database
 *
 * @param setId - Aligner set id
 * @throws AlignerPdfError If workflow fails
 */
export async function deletePdfFromSet(setId: number): Promise<void> {
  try {
    log.info(`Starting PDF deletion workflow for set ${setId}`);

    // Step 1: Get set information
    interface DriveFileResult {
      drive_file_id: string | null;
    }

    const db = getKysely();
    const { rows: result } = await sql<DriveFileResult>`
            SELECT "drive_file_id"
            FROM "aligner_sets"
            WHERE "aligner_set_id" = ${setId}
        `.execute(db);

    if (!result || result.length === 0) {
      throw new AlignerPdfError('Aligner set not found', 'SET_NOT_FOUND', {
        setId,
      });
    }

    const driveFileId = result[0].drive_file_id;

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
