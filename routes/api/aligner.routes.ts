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

import { Router, type Request, type Response } from 'express';
import {
  uploadSinglePdf,
  handleUploadError
} from '../../middleware/upload.js';
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

// Label generator
import labelGenerator from '../../services/pdf/aligner-label-generator.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AlignerQueryParams {
  search?: string;
  doctorId?: string;
}

interface AddPaymentBody {
  workid: number;
  AlignerSetID: number;
  Amountpaid: number | string;
  Dateofpayment: string;
  Currency?: string;
  USDReceived?: number;
  IQDReceived?: number;
  Change?: number;
  Notes?: string;
}

interface CreateSetBody {
  WorkID: number;
  AlignerDrID: number;
  DoctorID?: number;
  Notes?: string;
  OrderDate?: string;
  IsActive?: boolean;
  TotalAligners?: number;
  RemainingAligners?: number;
  SetCost?: number;
  SetSequence?: number;
  Type?: string;
  UpperAlignersCount?: number;
  LowerAlignersCount?: number;
}

interface UpdateSetBody {
  DoctorID?: number;
  Notes?: string;
  OrderDate?: string;
}

interface CreateBatchBody {
  AlignerSetID: number;
  UpperCount?: number;
  LowerCount?: number;
  IsActive?: boolean;
  Notes?: string;
}

interface UpdateBatchBody {
  UpperCount?: number;
  LowerCount?: number;
  IsActive?: boolean;
  Notes?: string;
}

interface CreateNoteBody {
  AlignerSetID: number;
  NoteText: string;
}

interface UpdateNoteBody {
  NoteText: string;
}

interface CreateDoctorBody {
  DoctorName: string;
  DoctorEmail?: string;
  DoctorPhone?: string;
  IsActive?: boolean;
  Address?: string;
  Notes?: string;
}

interface UpdateDoctorBody {
  DoctorName: string;
  DoctorEmail?: string;
  DoctorPhone?: string;
  IsActive?: boolean;
  Address?: string;
  Notes?: string;
}

interface LabelData {
  text: string;
  patientName: string;
  doctorName?: string;
  includeLogo?: boolean;
}

interface GenerateLabelsBody {
  labels: LabelData[];
  startingPosition: number;
  arabicFont?: 'cairo' | 'noto';
}

interface AlignerSetRow {
  NextBatchPresent?: string;
  UnreadActivityCount?: number;
  AlignerSetID?: number;
}

// ============================================================================
// ALIGNER DOCTORS QUERIES
// ============================================================================

/**
 * Get all aligner doctors with unread notes count
 */
router.get(
  '/aligner/doctors',
  async (_req: Request, res: Response): Promise<void> => {
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
      ErrorResponses.internalError(
        res,
        'Failed to fetch aligner doctors',
        error as Error
      );
    }
  }
);

/**
 * Get all patients from v_allsets view
 */
router.get(
  '/aligner/all-sets',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Fetching all aligner sets from v_allsets');
      const sets = (await alignerQueries.getAllAlignerSets()) as AlignerSetRow[];

      res.json({
        success: true,
        sets: sets || [],
        count: sets ? sets.length : 0,
        noNextBatchCount: sets
          ? sets.filter((s) => s.NextBatchPresent === 'False').length
          : 0
      });
    } catch (error) {
      log.error('Error fetching all aligner sets:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch aligner sets',
        error as Error
      );
    }
  }
);

/**
 * Get all aligner patients (all doctors)
 */
router.get(
  '/aligner/patients/all',
  async (_req: Request, res: Response): Promise<void> => {
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
      ErrorResponses.internalError(
        res,
        'Failed to fetch all aligner patients',
        error as Error
      );
    }
  }
);

/**
 * Get all patients by doctor ID
 */
router.get(
  '/aligner/patients/by-doctor/:doctorId',
  async (
    req: Request<{ doctorId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { doctorId } = req.params;

      if (!doctorId || isNaN(parseInt(doctorId))) {
        ErrorResponses.badRequest(res, 'Valid doctorId is required');
        return;
      }

      log.info(`Fetching all patients for doctor ID: ${doctorId}`);
      const patients = await alignerQueries.getAlignerPatientsByDoctor(parseInt(doctorId, 10));

      res.json({
        success: true,
        patients: patients || [],
        count: patients ? patients.length : 0
      });
    } catch (error) {
      log.error('Error fetching patients by doctor:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch patients by doctor',
        error as Error
      );
    }
  }
);

/**
 * Search for aligner patients
 */
router.get(
  '/aligner/patients',
  async (
    req: Request<unknown, unknown, unknown, AlignerQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { search, doctorId } = req.query;

      const patients = await AlignerService.searchPatients(
        search || '',
        doctorId ? parseInt(doctorId, 10) : null
      );

      res.json({
        success: true,
        patients: patients || [],
        count: patients ? patients.length : 0
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error searching aligner patients:', error);
      ErrorResponses.internalError(
        res,
        'Failed to search aligner patients',
        error as Error
      );
    }
  }
);

/**
 * Get aligner sets for a specific work
 */
router.get(
  '/aligner/sets/:workId',
  async (req: Request<{ workId: string }>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;

      if (!workId || isNaN(parseInt(workId))) {
        ErrorResponses.badRequest(res, 'Valid workId is required');
        return;
      }

      log.info(`Fetching aligner sets for work ID: ${workId}`);
      const sets = (await alignerQueries.getAlignerSetsByWorkId(
        parseInt(workId, 10)
      )) as AlignerSetRow[];

      // DEBUG: Log unread activity counts
      const setsWithUnread = (sets || []).filter(
        (s) => (s.UnreadActivityCount ?? 0) > 0
      );
      if (setsWithUnread.length > 0) {
        log.info(
          '🔔 [MAIN APP] Sets with unread doctor notes:',
          setsWithUnread.map((s) => ({
            SetID: s.AlignerSetID,
            UnreadCount: s.UnreadActivityCount
          }))
        );
      } else {
        log.info(
          '📭 [MAIN APP] No sets with unread doctor notes for workId:',
          workId
        );
      }

      res.json({
        success: true,
        sets: sets || [],
        count: sets ? sets.length : 0
      });
    } catch (error) {
      log.error('Error fetching aligner sets:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch aligner sets',
        error as Error
      );
    }
  }
);

/**
 * Add payment for an aligner set
 */
router.post(
  '/aligner/payments',
  async (
    req: Request<unknown, unknown, AddPaymentBody>,
    res: Response
  ): Promise<void> => {
    try {
      const invoiceID = await AlignerService.validateAndCreatePayment(req.body);

      res.json({
        success: true,
        invoiceID: invoiceID,
        message: 'Payment added successfully'
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error adding payment:', error);
      ErrorResponses.internalError(res, 'Failed to add payment', error as Error);
    }
  }
);

/**
 * Get batches for a specific aligner set
 */
router.get(
  '/aligner/batches/:setId',
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const { setId } = req.params;

      if (!setId || isNaN(parseInt(setId))) {
        ErrorResponses.badRequest(res, 'Valid setId is required');
        return;
      }

      log.info(`Fetching batches for aligner set ID: ${setId}`);
      const batches = await alignerQueries.getBatchesBySetId(parseInt(setId, 10));

      res.json({
        success: true,
        batches: batches || [],
        count: batches ? batches.length : 0
      });
    } catch (error) {
      log.error('Error fetching aligner batches:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch aligner batches',
        error as Error
      );
    }
  }
);

// ============================================================================
// ALIGNER SETS CRUD OPERATIONS
// ============================================================================

/**
 * Create a new aligner set
 */
router.post(
  '/aligner/sets',
  async (
    req: Request<unknown, unknown, CreateSetBody>,
    res: Response
  ): Promise<void> => {
    const startTime = Date.now();
    log.info('⏱️  [TIMING] POST /aligner/sets - Request received');

    try {
      const serviceStartTime = Date.now();
      const newSetId = await AlignerService.validateAndCreateSet(req.body);
      const serviceEndTime = Date.now();

      log.info(
        `⏱️  [TIMING] Service layer took: ${serviceEndTime - serviceStartTime}ms`
      );

      const totalTime = Date.now() - startTime;
      log.info(`⏱️  [TIMING] TOTAL request time: ${totalTime}ms`);

      res.json({
        success: true,
        setId: newSetId,
        message: 'Aligner set created successfully',
        _timing: {
          total_ms: totalTime,
          service_ms: serviceEndTime - serviceStartTime
        }
      });
    } catch (error) {
      const errorTime = Date.now() - startTime;
      log.error(`⏱️  [TIMING] Error after ${errorTime}ms:`, error);

      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }
      log.error('Error creating aligner set:', error);
      ErrorResponses.internalError(
        res,
        'Failed to create aligner set',
        error as Error
      );
    }
  }
);

/**
 * Update an existing aligner set
 */
router.put(
  '/aligner/sets/:setId',
  async (
    req: Request<{ setId: string }, unknown, UpdateSetBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { setId } = req.params;

      await AlignerService.validateAndUpdateSet(setId, req.body);

      res.json({
        success: true,
        message: 'Aligner set updated successfully'
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error updating aligner set:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update aligner set',
        error as Error
      );
    }
  }
);

/**
 * Delete an aligner set (and its batches)
 */
router.delete(
  '/aligner/sets/:setId',
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const { setId } = req.params;

      await AlignerService.validateAndDeleteSet(setId);

      res.json({
        success: true,
        message: 'Aligner set and its batches deleted successfully'
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error deleting aligner set:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete aligner set',
        error as Error
      );
    }
  }
);

// ============================================================================
// ALIGNER NOTES MANAGEMENT
// ============================================================================

/**
 * Get notes for an aligner set
 */
router.get(
  '/aligner/notes/:setId',
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const { setId } = req.params;

      if (!setId || isNaN(parseInt(setId))) {
        ErrorResponses.badRequest(res, 'Valid setId is required');
        return;
      }

      const notes = await alignerQueries.getNotesBySetId(parseInt(setId, 10));

      res.json({
        success: true,
        notes: notes || [],
        count: notes ? notes.length : 0
      });
    } catch (error) {
      log.error('Error fetching aligner set notes:', error);
      ErrorResponses.internalError(res, 'Failed to fetch notes', error as Error);
    }
  }
);

/**
 * Add a new note from lab staff
 */
router.post(
  '/aligner/notes',
  async (
    req: Request<unknown, unknown, CreateNoteBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { AlignerSetID, NoteText } = req.body;

      const noteId = await AlignerService.validateAndCreateNote(
        AlignerSetID,
        NoteText
      );

      res.json({
        success: true,
        noteId: noteId,
        message: 'Note added successfully'
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'SET_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Aligner set');
          return;
        }
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error adding lab note:', error);
      ErrorResponses.internalError(res, 'Failed to add note', error as Error);
    }
  }
);

/**
 * Toggle note read/unread status
 */
router.patch(
  '/aligner/notes/:noteId/toggle-read',
  async (req: Request<{ noteId: string }>, res: Response): Promise<void> => {
    try {
      const { noteId } = req.params;

      if (!noteId || isNaN(parseInt(noteId))) {
        ErrorResponses.badRequest(res, 'Valid note ID is required');
        return;
      }

      await alignerQueries.toggleNoteReadStatus(parseInt(noteId, 10));

      res.json({
        success: true,
        message: 'Note read status toggled successfully'
      });
    } catch (error) {
      log.error('Error toggling note read status:', error);
      ErrorResponses.internalError(
        res,
        'Failed to toggle read status',
        error as Error
      );
    }
  }
);

/**
 * Update an existing note
 */
router.patch(
  '/aligner/notes/:noteId',
  async (
    req: Request<{ noteId: string }, unknown, UpdateNoteBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { noteId } = req.params;
      const { NoteText } = req.body;

      await AlignerService.validateAndUpdateNote(noteId, NoteText);

      res.json({
        success: true,
        message: 'Note updated successfully'
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'NOTE_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Note');
          return;
        }
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error updating note:', error);
      ErrorResponses.internalError(res, 'Failed to update note', error as Error);
    }
  }
);

/**
 * Delete a note
 */
router.delete(
  '/aligner/notes/:noteId',
  async (req: Request<{ noteId: string }>, res: Response): Promise<void> => {
    try {
      const { noteId } = req.params;

      await AlignerService.validateAndDeleteNote(noteId);

      res.json({
        success: true,
        message: 'Note deleted successfully'
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'NOTE_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Note');
          return;
        }
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error deleting note:', error);
      ErrorResponses.internalError(res, 'Failed to delete note', error as Error);
    }
  }
);

/**
 * Get note read status
 */
router.get(
  '/aligner/notes/:noteId/status',
  async (req: Request<{ noteId: string }>, res: Response): Promise<void> => {
    try {
      const { noteId } = req.params;

      if (!noteId || isNaN(parseInt(noteId))) {
        ErrorResponses.badRequest(res, 'Valid note ID is required');
        return;
      }

      const isRead = await alignerQueries.getNoteReadStatus(parseInt(noteId, 10));

      if (isRead !== null) {
        res.json({
          success: true,
          isRead: isRead
        });
      } else {
        ErrorResponses.notFound(res, 'Note');
      }
    } catch (error) {
      log.error('Error getting note status:', error);
      ErrorResponses.internalError(
        res,
        'Failed to get note status',
        error as Error
      );
    }
  }
);

// ============================================================================
// ALIGNER ACTIVITY FLAGS
// ============================================================================

/**
 * Get unread activities for a specific aligner set
 */
router.get(
  '/aligner/activity/:setId',
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const { setId } = req.params;

      if (!setId || isNaN(parseInt(setId))) {
        ErrorResponses.badRequest(res, 'Valid setId is required');
        return;
      }

      const activities = await alignerQueries.getUnreadActivitiesBySetId(parseInt(setId, 10));

      res.json({
        success: true,
        activities: activities || [],
        count: activities ? activities.length : 0
      });
    } catch (error) {
      log.error('Error fetching activities:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch activities',
        error as Error
      );
    }
  }
);

/**
 * Mark a single activity as read
 */
router.patch(
  '/aligner/activity/:activityId/mark-read',
  async (
    req: Request<{ activityId: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { activityId } = req.params;

      if (!activityId || isNaN(parseInt(activityId))) {
        ErrorResponses.badRequest(res, 'Valid activityId is required');
        return;
      }

      await alignerQueries.markActivityAsRead(parseInt(activityId, 10));
      log.info(`Activity ${activityId} marked as read`);

      res.json({
        success: true,
        message: 'Activity marked as read'
      });
    } catch (error) {
      log.error('Error marking activity as read:', error);
      ErrorResponses.internalError(
        res,
        'Failed to mark activity as read',
        error as Error
      );
    }
  }
);

/**
 * Mark all activities for a set as read
 */
router.patch(
  '/aligner/activity/set/:setId/mark-all-read',
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const { setId } = req.params;

      if (!setId || isNaN(parseInt(setId))) {
        ErrorResponses.badRequest(res, 'Valid setId is required');
        return;
      }

      await alignerQueries.markAllActivitiesAsRead(parseInt(setId, 10));
      log.info(`All activities for set ${setId} marked as read`);

      res.json({
        success: true,
        message: 'All activities marked as read'
      });
    } catch (error) {
      log.error('Error marking all activities as read:', error);
      ErrorResponses.internalError(
        res,
        'Failed to mark all activities as read',
        error as Error
      );
    }
  }
);

// ============================================================================
// ALIGNER BATCHES CRUD OPERATIONS
// ============================================================================

/**
 * Create a new aligner batch
 */
router.post(
  '/aligner/batches',
  async (
    req: Request<unknown, unknown, CreateBatchBody>,
    res: Response
  ): Promise<void> => {
    try {
      const result = await AlignerService.validateAndCreateBatch(req.body);

      res.json({
        success: true,
        batchId: result.newBatchId,
        message: 'Aligner batch created successfully',
        deactivatedBatch: result.deactivatedBatch
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'SET_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Aligner set');
          return;
        }
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error creating aligner batch:', error);
      ErrorResponses.internalError(
        res,
        'Failed to create aligner batch',
        error as Error
      );
    }
  }
);

/**
 * Update an existing aligner batch
 */
router.put(
  '/aligner/batches/:batchId',
  async (
    req: Request<{ batchId: string }, unknown, UpdateBatchBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { batchId } = req.params;

      const result = await AlignerService.validateAndUpdateBatch(
        batchId,
        req.body
      );

      const response: Record<string, unknown> = {
        success: true,
        message: 'Aligner batch updated successfully'
      };

      if (result && result.deactivatedBatch) {
        response.deactivatedBatch = result.deactivatedBatch;
      }

      res.json(response);
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error updating aligner batch:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update aligner batch',
        error as Error
      );
    }
  }
);

/**
 * Mark batch as manufactured
 * @body targetDate - Optional ISO date string for backdating/correction
 */
router.patch(
  '/aligner/batches/:batchId/manufacture',
  async (req: Request<{ batchId: string }, unknown, { targetDate?: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const { targetDate } = req.body || {};

      const result = await AlignerService.markBatchManufactured(
        batchId,
        targetDate ? new Date(targetDate) : null
      );

      res.json({
        success: true,
        message: result.message,
        data: {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
          action: result.action,
        }
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error marking batch as manufactured:', error);
      ErrorResponses.internalError(
        res,
        'Failed to mark batch as manufactured',
        error as Error
      );
    }
  }
);

/**
 * Mark batch as delivered with automatic activation for latest batch
 * BatchExpiryDate is auto-computed from DeliveredToPatientDate + (Days * AlignerCount)
 * @body targetDate - Optional ISO date string for backdating/correction
 */
router.patch(
  '/aligner/batches/:batchId/deliver',
  async (req: Request<{ batchId: string }, unknown, { targetDate?: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const { targetDate } = req.body || {};

      const result = await AlignerService.markBatchDelivered(
        batchId,
        targetDate ? new Date(targetDate) : null
      );

      res.json({
        success: true,
        message: result.message,
        data: {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
          setId: result.setId,
          wasActivated: result.wasActivated,
          wasAlreadyActive: result.wasAlreadyActive,
          wasAlreadyDelivered: result.wasAlreadyDelivered,
          previouslyActiveBatchSequence: result.previouslyActiveBatchSequence,
        }
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error marking batch as delivered:', error);
      ErrorResponses.internalError(
        res,
        'Failed to mark batch as delivered',
        error as Error
      );
    }
  }
);

/**
 * Undo manufacture
 */
router.patch(
  '/aligner/batches/:batchId/undo-manufacture',
  async (req: Request<{ batchId: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      const result = await AlignerService.undoManufactureBatch(batchId);

      res.json({
        success: true,
        message: result.message,
        data: {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
        }
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error undoing manufacture:', error);
      ErrorResponses.internalError(
        res,
        'Failed to undo manufacture',
        error as Error
      );
    }
  }
);

/**
 * Undo delivery
 */
router.patch(
  '/aligner/batches/:batchId/undo-deliver',
  async (req: Request<{ batchId: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      const result = await AlignerService.undoDeliverBatch(batchId);

      res.json({
        success: true,
        message: result.message,
        data: {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
        }
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error undoing delivery:', error);
      ErrorResponses.internalError(
        res,
        'Failed to undo delivery',
        error as Error
      );
    }
  }
);

/**
 * Delete an aligner batch
 */
router.delete(
  '/aligner/batches/:batchId',
  async (req: Request<{ batchId: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      await AlignerService.validateAndDeleteBatch(batchId);

      res.json({
        success: true,
        message: 'Aligner batch deleted successfully'
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, { code: error.code });
        return;
      }
      log.error('Error deleting aligner batch:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete aligner batch',
        error as Error
      );
    }
  }
);

// ============================================================================
// ALIGNER PDF UPLOAD/DELETE
// ============================================================================

/**
 * Upload PDF for an aligner set (staff page)
 */
router.post(
  '/aligner/sets/:setId/upload-pdf',
  timeouts.long,
  uploadSinglePdf,
  handleUploadError,
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const setId = parseInt(req.params.setId);
      const uploaderEmail = 'staff@shwan.local';

      // Validate file exists
      if (!req.file) {
        ErrorResponses.badRequest(
          res,
          'No file uploaded. Please select a PDF file.'
        );
        return;
      }

      // Validate PDF
      const validation = driveUploadService.validatePdfFile(
        req.file.buffer,
        req.file.mimetype
      );
      if (!validation.valid) {
        ErrorResponses.badRequest(res, validation.error || 'Invalid PDF file');
        return;
      }

      const result = await uploadPdfForSet(setId, req.file, uploaderEmail);

      res.json({
        success: true,
        message: 'PDF uploaded successfully',
        data: result
      });
    } catch (error) {
      if (error instanceof AlignerPdfError) {
        if (error.code === 'SET_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Aligner set');
          return;
        }
        ErrorResponses.internalError(res, error.message, error.details as Error);
        return;
      }
      log.error('Error uploading PDF:', error);
      ErrorResponses.internalError(res, 'Failed to upload PDF', error as Error);
    }
  }
);

/**
 * Delete PDF from an aligner set (staff page)
 */
router.delete(
  '/aligner/sets/:setId/pdf',
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const setId = parseInt(req.params.setId);

      await deletePdfFromSet(setId);

      res.json({
        success: true,
        message: 'PDF deleted successfully'
      });
    } catch (error) {
      if (error instanceof AlignerPdfError) {
        if (error.code === 'SET_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Aligner set');
          return;
        }
        ErrorResponses.internalError(res, error.message, error.details as Error);
        return;
      }
      log.error('Error deleting PDF:', error);
      ErrorResponses.internalError(res, 'Failed to delete PDF', error as Error);
    }
  }
);

// ============================================================================
// ALIGNER LABEL GENERATION
// ============================================================================

/**
 * Generate printable aligner labels PDF
 */
router.post(
  '/aligner/labels/generate',
  async (
    req: Request<unknown, unknown, GenerateLabelsBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { labels, startingPosition, arabicFont = 'cairo' } = req.body;

      // Validate labels array
      if (!labels || !Array.isArray(labels) || labels.length === 0) {
        ErrorResponses.badRequest(
          res,
          'Labels array is required and cannot be empty'
        );
        return;
      }

      // Validate starting position
      if (
        !startingPosition ||
        !Number.isInteger(startingPosition) ||
        startingPosition < 1 ||
        startingPosition > 12
      ) {
        ErrorResponses.badRequest(
          res,
          'Starting position must be between 1 and 12'
        );
        return;
      }

      // Validate each label has required fields
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        if (!label.text) {
          ErrorResponses.badRequest(res, `labels[${i}].text is required`);
          return;
        }
        if (!label.patientName) {
          ErrorResponses.badRequest(
            res,
            `labels[${i}].patientName is required`
          );
          return;
        }
      }

      log.info('Generating aligner labels', {
        totalLabels: labels.length,
        startingPosition,
        arabicFont
      });

      // Generate PDF
      const result = await labelGenerator.generate({
        labels,
        startingPosition,
        arabicFont
      });

      // Send PDF response
      const firstPatient = labels[0].patientName
        .replace(/[^a-zA-Z0-9]/g, '_')
        .substring(0, 30);
      const filename = `Labels_${firstPatient}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('X-Total-Labels', String(result.totalLabels));
      res.setHeader('X-Total-Pages', String(result.totalPages));
      res.setHeader('X-Next-Position', String(result.nextPosition));
      res.send(result.buffer);
    } catch (error) {
      log.error('Error generating aligner labels:', error);
      ErrorResponses.internalError(
        res,
        'Failed to generate labels: ' + (error as Error).message,
        error as Error
      );
    }
  }
);

// ============================================================================
// ALIGNER DOCTORS MANAGEMENT
// ============================================================================

/**
 * Get all aligner doctors
 */
router.get(
  '/aligner-doctors',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const doctors = await alignerQueries.getAllDoctors();

      res.json({
        success: true,
        doctors: doctors || []
      });
    } catch (error) {
      log.error('Error fetching aligner doctors:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch aligner doctors',
        error as Error
      );
    }
  }
);

/**
 * Add new aligner doctor
 */
router.post(
  '/aligner-doctors',
  async (
    req: Request<unknown, unknown, CreateDoctorBody>,
    res: Response
  ): Promise<void> => {
    try {
      const newDrID = await AlignerService.validateAndCreateDoctor(req.body);

      res.json({
        success: true,
        message: 'Doctor added successfully',
        drID: newDrID
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'EMAIL_ALREADY_EXISTS') {
          ErrorResponses.conflict(res, error.message);
          return;
        }
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }
      log.error('Error adding aligner doctor:', error);
      ErrorResponses.internalError(
        res,
        'Failed to add aligner doctor',
        error as Error
      );
    }
  }
);

/**
 * Update aligner doctor
 */
router.put(
  '/aligner-doctors/:drID',
  async (
    req: Request<{ drID: string }, unknown, UpdateDoctorBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { drID } = req.params;

      await AlignerService.validateAndUpdateDoctor(drID, req.body);

      res.json({
        success: true,
        message: 'Doctor updated successfully'
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'EMAIL_ALREADY_EXISTS') {
          ErrorResponses.conflict(res, error.message);
          return;
        }
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }
      log.error('Error updating aligner doctor:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update aligner doctor',
        error as Error
      );
    }
  }
);

/**
 * Delete aligner doctor
 */
router.delete(
  '/aligner-doctors/:drID',
  async (req: Request<{ drID: string }>, res: Response): Promise<void> => {
    try {
      const { drID } = req.params;

      await AlignerService.validateAndDeleteDoctor(drID);

      res.json({
        success: true,
        message: 'Doctor deleted successfully'
      });
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        ErrorResponses.badRequest(res, error.message, error.details);
        return;
      }
      log.error('Error deleting aligner doctor:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete aligner doctor',
        error as Error
      );
    }
  }
);

export default router;
