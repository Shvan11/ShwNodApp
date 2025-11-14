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
 * Validation error class for aligner PDF business logic
 */
export class AlignerPdfError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'AlignerPdfError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Get aligner set information for PDF operations
 * @param {number} setId - Aligner set ID
 * @returns {Promise<Object>} Set information
 * @throws {AlignerPdfError} If set not found
 */
async function getSetInfo(setId) {
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

    const result = await database.executeQuery(setQuery, [
        ['setId', database.TYPES.Int, setId]
    ]);

    if (!result || result.length === 0) {
        throw new AlignerPdfError(
            'Aligner set not found',
            'SET_NOT_FOUND',
            { setId }
        );
    }

    return result[0];
}

/**
 * Delete old PDF from Google Drive (with error tolerance)
 * @param {string} driveFileId - Drive file ID
 */
async function deleteOldPdfFromDrive(driveFileId) {
    if (!driveFileId) {
        return; // Nothing to delete
    }

    try {
        await driveUploadService.deletePdf(driveFileId);
        log.info(`Old PDF deleted from Drive: ${driveFileId}`);
    } catch (error) {
        log.warn('Failed to delete old PDF from Drive:', error);
        // Continue even if deletion fails - Drive cleanup is best-effort
    }
}

/**
 * Update database with new PDF information
 * @param {number} setId - Aligner set ID
 * @param {Object} uploadResult - Upload result from Drive service
 * @param {string} uploaderEmail - Email of uploader
 */
async function updateDatabaseWithPdf(setId, uploadResult, uploaderEmail) {
    const updateQuery = `
        UPDATE tblAlignerSets
        SET
            SetPdfUrl = @url,
            DriveFileId = @fileId,
            PdfUploadedAt = GETDATE(),
            PdfUploadedBy = @uploadedBy
        WHERE AlignerSetID = @setId
    `;

    await database.executeQuery(updateQuery, [
        ['url', database.TYPES.NVarChar, uploadResult.url],
        ['fileId', database.TYPES.NVarChar, uploadResult.fileId],
        ['uploadedBy', database.TYPES.NVarChar, uploaderEmail],
        ['setId', database.TYPES.Int, setId]
    ]);

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
 * @param {number} setId - Aligner set ID
 * @param {Object} file - Uploaded file object
 * @param {Buffer} file.buffer - File buffer
 * @param {string} file.originalname - Original filename
 * @param {string} uploaderEmail - Email of uploader
 * @returns {Promise<Object>} Upload result
 * @throws {AlignerPdfError} If workflow fails
 */
export async function uploadPdfForSet(setId, file, uploaderEmail) {
    try {
        log.info(`Starting PDF upload workflow for set ${setId}`);

        // Step 1: Get set information
        const setInfo = await getSetInfo(setId);
        const patientName = setInfo.PatientName || `${setInfo.FirstName} ${setInfo.LastName}`;

        // Step 2: Delete old file from Drive if exists (best-effort)
        await deleteOldPdfFromDrive(setInfo.DriveFileId);

        // Step 3: Upload to Google Drive
        const uploadResult = await driveUploadService.uploadPdfForSet(
            {
                buffer: file.buffer,
                originalName: file.originalname
            },
            {
                patientId: setInfo.PersonID,
                patientName: patientName,
                workId: setInfo.WorkID,
                setSequence: setInfo.SetSequence
            },
            uploaderEmail
        );

        log.info(`PDF uploaded to Drive: ${uploadResult.fileName}`);

        // Step 4: Update database with new PDF metadata
        await updateDatabaseWithPdf(setId, uploadResult, uploaderEmail);

        log.info(`PDF upload workflow completed successfully for set ${setId}`);

        return {
            url: uploadResult.url,
            fileName: uploadResult.fileName,
            size: uploadResult.size
        };

    } catch (error) {
        // Wrap any errors in AlignerPdfError for consistent error handling
        if (error instanceof AlignerPdfError) {
            throw error;
        }

        log.error('PDF upload workflow failed:', error);
        throw new AlignerPdfError(
            'Failed to upload PDF',
            'UPLOAD_FAILED',
            { originalError: error.message }
        );
    }
}

/**
 * Clear PDF information from database
 * @param {number} setId - Aligner set ID
 */
async function clearPdfFromDatabase(setId) {
    const updateQuery = `
        UPDATE tblAlignerSets
        SET
            SetPdfUrl = NULL,
            DriveFileId = NULL,
            PdfUploadedAt = NULL,
            PdfUploadedBy = NULL
        WHERE AlignerSetID = @setId
    `;

    await database.executeQuery(updateQuery, [
        ['setId', database.TYPES.Int, setId]
    ]);

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
 * @param {number} setId - Aligner set ID
 * @returns {Promise<void>}
 * @throws {AlignerPdfError} If workflow fails
 */
export async function deletePdfFromSet(setId) {
    try {
        log.info(`Starting PDF deletion workflow for set ${setId}`);

        // Step 1: Get set information
        const setQuery = `
            SELECT DriveFileId
            FROM tblAlignerSets
            WHERE AlignerSetID = @setId
        `;

        const result = await database.executeQuery(setQuery, [
            ['setId', database.TYPES.Int, setId]
        ]);

        if (!result || result.length === 0) {
            throw new AlignerPdfError(
                'Aligner set not found',
                'SET_NOT_FOUND',
                { setId }
            );
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

        log.error('PDF deletion workflow failed:', error);
        throw new AlignerPdfError(
            'Failed to delete PDF',
            'DELETION_FAILED',
            { originalError: error.message }
        );
    }
}

export default {
    uploadPdfForSet,
    deletePdfFromSet,
    AlignerPdfError
};
