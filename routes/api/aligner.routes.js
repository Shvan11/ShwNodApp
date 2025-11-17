/**
 * Aligner Management API Routes
 *
 * This module handles all API endpoints related to aligner management including:
 * - Aligner doctors management
 * - Aligner sets CRUD operations
 * - Aligner batches CRUD operations
 * - Aligner notes and activity tracking
 * - Patient queries for aligner work types
 * - PDF upload/delete for aligner sets
 * - Payment tracking for aligner sets
 *
 * Total endpoints: 30
 *
 * Architecture:
 * - Routes handle HTTP requests/responses only
 * - Business logic delegated to AlignerService
 * - Data access delegated to aligner-queries
 */

import express from 'express';
import { uploadSinglePdf, handleUploadError } from '../../middleware/upload.js';
import driveUploadService from '../../services/google-drive/drive-upload.js';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import { timeouts } from '../../middleware/timeout.js';

// Query layer imports
import * as alignerQueries from '../../services/database/queries/aligner-queries.js';

// Service layer imports
import * as AlignerService from '../../services/business/AlignerService.js';
import { AlignerValidationError } from '../../services/business/AlignerService.js';
import {
    uploadPdfForSet,
    deletePdfFromSet,
    AlignerPdfError
} from '../../services/business/AlignerPdfService.js';

const router = express.Router();

// ==============================
// ALIGNER DOCTORS QUERIES
// ==============================

/**
 * Get all aligner doctors with unread notes count
 */
router.get('/aligner/doctors', async (req, res) => {
    try {
        log.info('Fetching aligner doctors');
        const doctors = await alignerQueries.getDoctorsWithUnreadCounts();

        res.json({
            success: true,
            doctors: doctors || [],
            count: doctors ? doctors.length : 0
        });
    } catch (error) {
        log.error('Error fetching aligner doctors:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch aligner doctors', error);
    }
});

/**
 * Get all patients from v_allsets view
 * Shows all aligner sets with visual indicators for those without next batch
 */
router.get('/aligner/all-sets', async (req, res) => {
    try {
        log.info('Fetching all aligner sets from v_allsets');
        const sets = await alignerQueries.getAllAlignerSets();

        res.json({
            success: true,
            sets: sets || [],
            count: sets ? sets.length : 0,
            noNextBatchCount: sets ? sets.filter(s => s.NextBatchPresent === 'False').length : 0
        });
    } catch (error) {
        log.error('Error fetching all aligner sets:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch aligner sets', error);
    }
});

/**
 * Get all aligner patients (all doctors)
 * Returns all patients with aligner sets
 */
router.get('/aligner/patients/all', async (req, res) => {
    try {
        log.info('Fetching all aligner patients');
        const patients = await alignerQueries.getAllAlignerPatients();

        res.json({
            success: true,
            patients: patients || [],
            count: patients ? patients.length : 0
        });
    } catch (error) {
        log.error('Error fetching all aligner patients:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch all aligner patients', error);
    }
});

/**
 * Get all patients by doctor ID
 * Returns all patients with aligner sets assigned to a specific doctor
 */
router.get('/aligner/patients/by-doctor/:doctorId', async (req, res) => {
    try {
        const { doctorId } = req.params;

        if (!doctorId || isNaN(parseInt(doctorId))) {
            return ErrorResponses.invalidParameter(res, 'doctorId', 'Valid doctorId is required');
        }

        log.info(`Fetching all patients for doctor ID: ${doctorId}`);
        const patients = await alignerQueries.getAlignerPatientsByDoctor(doctorId);

        res.json({
            success: true,
            patients: patients || [],
            count: patients ? patients.length : 0
        });
    } catch (error) {
        log.error('Error fetching patients by doctor:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch patients by doctor', error);
    }
});

/**
 * Search for aligner patients
 * Returns patients who have aligner work types (19, 20, 21)
 * Optional doctor filter
 */
router.get('/aligner/patients', async (req, res) => {
    try {
        const { search, doctorId } = req.query;

        // Delegate to service layer for validation
        const patients = await AlignerService.searchPatients(search, doctorId);

        res.json({
            success: true,
            patients: patients || [],
            count: patients ? patients.length : 0
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error searching aligner patients:', error);
        return ErrorResponses.internalError(res, 'Failed to search aligner patients', error);
    }
});

/**
 * Get aligner sets for a specific work
 */
router.get('/aligner/sets/:workId', async (req, res) => {
    try {
        const { workId } = req.params;

        if (!workId || isNaN(parseInt(workId))) {
            return ErrorResponses.invalidParameter(res, 'workId', 'Valid workId is required');
        }

        log.info(`Fetching aligner sets for work ID: ${workId}`);
        const sets = await alignerQueries.getAlignerSetsByWorkId(workId);

        // DEBUG: Log unread activity counts
        const setsWithUnread = (sets || []).filter(s => s.UnreadActivityCount > 0);
        if (setsWithUnread.length > 0) {
            log.info('🔔 [MAIN APP] Sets with unread doctor notes:', setsWithUnread.map(s => ({
                SetID: s.AlignerSetID,
                UnreadCount: s.UnreadActivityCount
            })));
        } else {
            log.info('📭 [MAIN APP] No sets with unread doctor notes for workId:', workId);
        }

        res.json({
            success: true,
            sets: sets || [],
            count: sets ? sets.length : 0
        });
    } catch (error) {
        log.error('Error fetching aligner sets:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch aligner sets', error);
    }
});

/**
 * Add payment for an aligner set
 */
router.post('/aligner/payments', async (req, res) => {
    try {
        // Delegate to service layer for validation and creation
        const invoiceID = await AlignerService.validateAndCreatePayment(req.body);

        res.json({
            success: true,
            invoiceID: invoiceID,
            message: 'Payment added successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error adding payment:', error);
        return ErrorResponses.internalError(res, 'Failed to add payment', error);
    }
});

/**
 * Get batches for a specific aligner set
 */
router.get('/aligner/batches/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return ErrorResponses.invalidParameter(res, 'setId', 'Valid setId is required');
        }

        log.info(`Fetching batches for aligner set ID: ${setId}`);
        const batches = await alignerQueries.getBatchesBySetId(setId);

        res.json({
            success: true,
            batches: batches || [],
            count: batches ? batches.length : 0
        });
    } catch (error) {
        log.error('Error fetching aligner batches:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch aligner batches', error);
    }
});

// ===== ALIGNER SETS CRUD OPERATIONS =====

/**
 * Create a new aligner set
 */
router.post('/aligner/sets', async (req, res) => {
    try {
        // Delegate to service layer for business logic and creation
        const newSetId = await AlignerService.validateAndCreateSet(req.body);

        res.json({
            success: true,
            setId: newSetId,
            message: 'Aligner set created successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, { code: error.code, ...error.details });
        }
        log.error('Error creating aligner set:', error);
        return ErrorResponses.internalError(res, 'Failed to create aligner set', error);
    }
});

/**
 * Update an existing aligner set
 */
router.put('/aligner/sets/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        // Delegate to service layer for validation and update
        await AlignerService.validateAndUpdateSet(setId, req.body);

        res.json({
            success: true,
            message: 'Aligner set updated successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error updating aligner set:', error);
        return ErrorResponses.internalError(res, 'Failed to update aligner set', error);
    }
});

/**
 * Delete an aligner set (and its batches)
 */
router.delete('/aligner/sets/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        // Delegate to service layer for cascade deletion
        await AlignerService.validateAndDeleteSet(setId);

        res.json({
            success: true,
            message: 'Aligner set and its batches deleted successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error deleting aligner set:', error);
        return ErrorResponses.internalError(res, 'Failed to delete aligner set', error);
    }
});

// ===== ALIGNER NOTES MANAGEMENT =====

/**
 * Get notes for an aligner set
 */
router.get('/aligner/notes/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return ErrorResponses.invalidParameter(res, 'setId', 'Valid setId is required');
        }

        const notes = await alignerQueries.getNotesBySetId(setId);

        res.json({
            success: true,
            notes: notes || [],
            count: notes ? notes.length : 0
        });
    } catch (error) {
        log.error('Error fetching aligner set notes:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch notes', error);
    }
});

/**
 * Add a new note from lab staff
 */
router.post('/aligner/notes', async (req, res) => {
    try {
        const { AlignerSetID, NoteText } = req.body;

        // Delegate to service layer for validation and creation
        const noteId = await AlignerService.validateAndCreateNote(AlignerSetID, NoteText);

        res.json({
            success: true,
            noteId: noteId,
            message: 'Note added successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            if (error.code === 'SET_NOT_FOUND') {
                return ErrorResponses.notFound(res, 'Aligner set');
            }
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error adding lab note:', error);
        return ErrorResponses.internalError(res, 'Failed to add note', error);
    }
});

/**
 * Toggle note read/unread status
 * NOTE: This route MUST come before the generic PATCH /aligner/notes/:noteId route
 * to ensure Express matches the more specific route first
 */
router.patch('/aligner/notes/:noteId/toggle-read', async (req, res) => {
    try {
        const { noteId } = req.params;

        if (!noteId || isNaN(parseInt(noteId))) {
            return ErrorResponses.invalidParameter(res, 'noteId', 'Valid note ID is required');
        }

        await alignerQueries.toggleNoteReadStatus(noteId);

        res.json({
            success: true,
            message: 'Note read status toggled successfully'
        });
    } catch (error) {
        log.error('Error toggling note read status:', error);
        return ErrorResponses.internalError(res, 'Failed to toggle read status', error);
    }
});

/**
 * Update an existing note
 */
router.patch('/aligner/notes/:noteId', async (req, res) => {
    try {
        const { noteId } = req.params;
        const { NoteText } = req.body;

        // Delegate to service layer for validation and update
        await AlignerService.validateAndUpdateNote(noteId, NoteText);

        res.json({
            success: true,
            message: 'Note updated successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            if (error.code === 'NOTE_NOT_FOUND') {
                return ErrorResponses.notFound(res, 'Note');
            }
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error updating note:', error);
        return ErrorResponses.internalError(res, 'Failed to update note', error);
    }
});

/**
 * Delete a note
 */
router.delete('/aligner/notes/:noteId', async (req, res) => {
    try {
        const { noteId } = req.params;

        // Delegate to service layer for validation and deletion
        await AlignerService.validateAndDeleteNote(noteId);

        res.json({
            success: true,
            message: 'Note deleted successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            if (error.code === 'NOTE_NOT_FOUND') {
                return ErrorResponses.notFound(res, 'Note');
            }
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error deleting note:', error);
        return ErrorResponses.internalError(res, 'Failed to delete note', error);
    }
});

/**
 * Get note read status
 */
router.get('/aligner/notes/:noteId/status', async (req, res) => {
    try {
        const { noteId } = req.params;

        if (!noteId || isNaN(parseInt(noteId))) {
            return ErrorResponses.invalidParameter(res, 'noteId', 'Valid note ID is required');
        }

        const isRead = await alignerQueries.getNoteReadStatus(noteId);

        if (isRead !== null) {
            res.json({
                success: true,
                isRead: isRead
            });
        } else {
            return ErrorResponses.notFound(res, 'Note');
        }
    } catch (error) {
        log.error('Error getting note status:', error);
        return ErrorResponses.internalError(res, 'Failed to get note status', error);
    }
});

// ===== ALIGNER ACTIVITY FLAGS =====

/**
 * Get unread activities for a specific aligner set
 */
router.get('/aligner/activity/:setId', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return ErrorResponses.invalidParameter(res, 'setId', 'Valid setId is required');
        }

        const activities = await alignerQueries.getUnreadActivitiesBySetId(setId);

        res.json({
            success: true,
            activities: activities || [],
            count: activities ? activities.length : 0
        });
    } catch (error) {
        log.error('Error fetching activities:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch activities', error);
    }
});

/**
 * Mark a single activity as read
 */
router.patch('/aligner/activity/:activityId/mark-read', async (req, res) => {
    try {
        const { activityId } = req.params;

        if (!activityId || isNaN(parseInt(activityId))) {
            return ErrorResponses.invalidParameter(res, 'activityId', 'Valid activityId is required');
        }

        await alignerQueries.markActivityAsRead(activityId);
        log.info(`Activity ${activityId} marked as read`);

        res.json({
            success: true,
            message: 'Activity marked as read'
        });
    } catch (error) {
        log.error('Error marking activity as read:', error);
        return ErrorResponses.internalError(res, 'Failed to mark activity as read', error);
    }
});

/**
 * Mark all activities for a set as read
 */
router.patch('/aligner/activity/set/:setId/mark-all-read', async (req, res) => {
    try {
        const { setId } = req.params;

        if (!setId || isNaN(parseInt(setId))) {
            return ErrorResponses.invalidParameter(res, 'setId', 'Valid setId is required');
        }

        await alignerQueries.markAllActivitiesAsRead(setId);
        log.info(`All activities for set ${setId} marked as read`);

        res.json({
            success: true,
            message: 'All activities marked as read'
        });
    } catch (error) {
        log.error('Error marking all activities as read:', error);
        return ErrorResponses.internalError(res, 'Failed to mark all activities as read', error);
    }
});

// ===== ALIGNER BATCHES CRUD OPERATIONS =====

/**
 * Create a new aligner batch
 */
router.post('/aligner/batches', async (req, res) => {
    try {
        // Delegate to service layer for validation and creation
        const newBatchId = await AlignerService.validateAndCreateBatch(req.body);

        res.json({
            success: true,
            batchId: newBatchId,
            message: 'Aligner batch created successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            if (error.code === 'SET_NOT_FOUND') {
                return ErrorResponses.notFound(res, 'Aligner set');
            }
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error creating aligner batch:', error);
        return ErrorResponses.internalError(res, 'Failed to create aligner batch', error);
    }
});

/**
 * Update an existing aligner batch
 */
router.put('/aligner/batches/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;

        // Delegate to service layer for validation and update
        await AlignerService.validateAndUpdateBatch(batchId, req.body);

        res.json({
            success: true,
            message: 'Aligner batch updated successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error updating aligner batch:', error);
        return ErrorResponses.internalError(res, 'Failed to update aligner batch', error);
    }
});

/**
 * Mark batch as delivered
 */
router.patch('/aligner/batches/:batchId/deliver', async (req, res) => {
    try {
        const { batchId } = req.params;

        // Delegate to service layer
        await AlignerService.markBatchDelivered(batchId);

        res.json({
            success: true,
            message: 'Batch marked as delivered'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error marking batch as delivered:', error);
        return ErrorResponses.internalError(res, 'Failed to mark batch as delivered', error);
    }
});

/**
 * Delete an aligner batch
 */
router.delete('/aligner/batches/:batchId', async (req, res) => {
    try {
        const { batchId } = req.params;

        // Delegate to service layer for validation and deletion
        await AlignerService.validateAndDeleteBatch(batchId);

        res.json({
            success: true,
            message: 'Aligner batch deleted successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, { code: error.code });
        }
        log.error('Error deleting aligner batch:', error);
        return ErrorResponses.internalError(res, 'Failed to delete aligner batch', error);
    }
});

// ==============================
// ALIGNER PDF UPLOAD/DELETE
// ==============================

/**
 * Upload PDF for an aligner set (staff page)
 * Note: Uses extended timeout (2 minutes) for file upload to Google Drive
 */
router.post('/aligner/sets/:setId/upload-pdf', timeouts.long, uploadSinglePdf, handleUploadError, async (req, res) => {
    try {
        const setId = parseInt(req.params.setId);
        const uploaderEmail = 'staff@shwan.local'; // Staff uploads (no auth required)

        // Validate file exists
        if (!req.file) {
            return ErrorResponses.badRequest(res, 'No file uploaded. Please select a PDF file.');
        }

        // Validate PDF
        const validation = driveUploadService.validatePdfFile(req.file.buffer, req.file.mimetype);
        if (!validation.valid) {
            return ErrorResponses.badRequest(res, validation.error);
        }

        // Delegate to service layer for PDF upload workflow
        const result = await uploadPdfForSet(setId, req.file, uploaderEmail);

        res.json({
            success: true,
            message: 'PDF uploaded successfully',
            data: result
        });
    } catch (error) {
        if (error instanceof AlignerPdfError) {
            if (error.code === 'SET_NOT_FOUND') {
                return ErrorResponses.notFound(res, 'Aligner set');
            }
            return ErrorResponses.internalError(res, error.message, error.details);
        }
        log.error('Error uploading PDF:', error);
        return ErrorResponses.internalError(res, 'Failed to upload PDF', error);
    }
});

/**
 * Delete PDF from an aligner set (staff page)
 */
router.delete('/aligner/sets/:setId/pdf', async (req, res) => {
    try {
        const setId = parseInt(req.params.setId);

        // Delegate to service layer for PDF deletion workflow
        await deletePdfFromSet(setId);

        res.json({
            success: true,
            message: 'PDF deleted successfully'
        });
    } catch (error) {
        if (error instanceof AlignerPdfError) {
            if (error.code === 'SET_NOT_FOUND') {
                return ErrorResponses.notFound(res, 'Aligner set');
            }
            return ErrorResponses.internalError(res, error.message, error.details);
        }
        log.error('Error deleting PDF:', error);
        return ErrorResponses.internalError(res, 'Failed to delete PDF', error);
    }
});

// ==============================
// ALIGNER DOCTORS MANAGEMENT
// ==============================

/**
 * Get all aligner doctors
 */
router.get('/aligner-doctors', async (req, res) => {
    try {
        const doctors = await alignerQueries.getAllDoctors();

        res.json({
            success: true,
            doctors: doctors || []
        });
    } catch (error) {
        log.error('Error fetching aligner doctors:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch aligner doctors', error);
    }
});

/**
 * Add new aligner doctor
 */
router.post('/aligner-doctors', async (req, res) => {
    try {
        // Delegate to service layer for validation and creation
        const newDrID = await AlignerService.validateAndCreateDoctor(req.body);

        res.json({
            success: true,
            message: 'Doctor added successfully',
            drID: newDrID
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            if (error.code === 'EMAIL_ALREADY_EXISTS') {
                return ErrorResponses.conflict(res, error.message);
            }
            return ErrorResponses.badRequest(res, error.message, { code: error.code, ...error.details });
        }
        log.error('Error adding aligner doctor:', error);
        return ErrorResponses.internalError(res, 'Failed to add aligner doctor', error);
    }
});

/**
 * Update aligner doctor
 */
router.put('/aligner-doctors/:drID', async (req, res) => {
    try {
        const { drID } = req.params;

        // Delegate to service layer for validation and update
        await AlignerService.validateAndUpdateDoctor(drID, req.body);

        res.json({
            success: true,
            message: 'Doctor updated successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            if (error.code === 'EMAIL_ALREADY_EXISTS') {
                return ErrorResponses.conflict(res, error.message);
            }
            return ErrorResponses.badRequest(res, error.message, { code: error.code, ...error.details });
        }
        log.error('Error updating aligner doctor:', error);
        return ErrorResponses.internalError(res, 'Failed to update aligner doctor', error);
    }
});

/**
 * Delete aligner doctor
 */
router.delete('/aligner-doctors/:drID', async (req, res) => {
    try {
        const { drID } = req.params;

        // Delegate to service layer for dependency checking and deletion
        await AlignerService.validateAndDeleteDoctor(drID);

        res.json({
            success: true,
            message: 'Doctor deleted successfully'
        });
    } catch (error) {
        if (error instanceof AlignerValidationError) {
            return ErrorResponses.badRequest(res, error.message, error.details);
        }
        log.error('Error deleting aligner doctor:', error);
        return ErrorResponses.internalError(res, 'Failed to delete aligner doctor', error);
    }
});

export default router;
