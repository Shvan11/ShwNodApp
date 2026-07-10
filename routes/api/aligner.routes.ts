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
import { sendSuccess, sendData, ErrorResponses } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { log } from '../../utils/logger.js';
import { timeouts } from '../../middleware/timeout.js';

// Request/response contract (shared with the client via @shared). The boundary
// param + body guards and every response shape live in the contract. Every write
// body is now FULLY ENUMERATED there as a strict `z.object` (mirroring the
// AlignerService `*Data` input types — which the route interfaces under-described)
// and is the `z.infer` SSoT; the handlers below type from `contract.*Body`. See
// shared/contracts/aligner.contract.ts + docs/shared-contract-progress.md.
import * as contract from '../../shared/contracts/aligner.contract.js';

// Query layer imports
import * as alignerQueries from '../../services/database/queries/aligner-queries.js';

// Archform SQLite service
import {
  getArchformPatients,
  getArchformPatientById,
  updateArchformPatient,
  deleteArchformPatient,
  isArchformAvailable,
  ArchformDbUnavailableError,
} from '../../services/archform/archform-db.js';

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

type AlignerQueryParams = contract.AlignerQueryParams;

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

      sendData(res, contract.alignerDoctors.response, {
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
      const sets = await alignerQueries.getAllAlignerSets();

      sendData(res, contract.allSets.response, { sets: sets || [] });
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

      sendData(res, contract.allPatients.response, {
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
 * Get all patients by doctor id
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

      log.info(`Fetching all patients for doctor id: ${doctorId}`);
      const patients = await alignerQueries.getAlignerPatientsByDoctor(parseInt(doctorId, 10));

      sendData(res, contract.patientsByDoctor.response, {
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

      sendData(res, contract.searchAlignerPatients.response, {
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

      log.info(`Fetching aligner sets for work id: ${workId}`);
      const sets = await alignerQueries.getAlignerSetsByWorkId(
        parseInt(workId, 10)
      );

      sendData(res, contract.setsByWorkId.response, {
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
  validate({ body: contract.addPayment.body }),
  async (
    req: Request<unknown, unknown, contract.AddPaymentBody>,
    res: Response
  ): Promise<void> => {
    try {
      const invoiceID = await AlignerService.validateAndCreatePayment(req.body);

      sendData(res, contract.addPayment.response, { invoice_id: invoiceID }, 'Payment added successfully');
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

      log.info(`Fetching batches for aligner set id: ${setId}`);
      const batches = await alignerQueries.getBatchesBySetId(parseInt(setId, 10));

      sendData(res, contract.batchesBySetId.response, {
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
  validate({ body: contract.createSet.body }),
  async (
    req: Request<unknown, unknown, contract.CreateSetBody>,
    res: Response
  ): Promise<void> => {
    try {
      const newSetId = await AlignerService.validateAndCreateSet(req.body);

      sendData(res, contract.createSet.response, { setId: newSetId }, 'Aligner set created successfully');
    } catch (error) {
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
  validate({ params: contract.setIdParams, body: contract.updateSet.body }),
  async (
    req: Request<{ setId: string }, unknown, contract.UpdateSetBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { setId } = req.params;

      await AlignerService.validateAndUpdateSet(setId, req.body);

      sendSuccess(res, null, 'Aligner set updated successfully');
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
  validate({ params: contract.setIdParams }),
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const { setId } = req.params;

      await AlignerService.validateAndDeleteSet(setId);

      sendSuccess(res, null, 'Aligner set and its batches deleted successfully');
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

      sendData(res, contract.notesBySetId.response, {
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
  validate({ body: contract.createNote.body }),
  async (
    req: Request<unknown, unknown, contract.CreateNoteBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { aligner_set_id, note_text } = req.body;

      const noteId = await AlignerService.validateAndCreateNote(
        aligner_set_id,
        note_text
      );

      sendData(res, contract.createNote.response, { noteId }, 'note added successfully');
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
  validate({ params: contract.noteIdParams }),
  async (req: Request<{ noteId: string }>, res: Response): Promise<void> => {
    try {
      const { noteId } = req.params;

      if (!noteId || isNaN(parseInt(noteId))) {
        ErrorResponses.badRequest(res, 'Valid note id is required');
        return;
      }

      await alignerQueries.toggleNoteReadStatus(parseInt(noteId, 10));

      sendSuccess(res, null, 'note read status toggled successfully');
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
  validate({ params: contract.noteIdParams, body: contract.updateNote.body }),
  async (
    req: Request<{ noteId: string }, unknown, contract.UpdateNoteBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { noteId } = req.params;
      const { note_text } = req.body;

      await AlignerService.validateAndUpdateNote(noteId, note_text);

      sendSuccess(res, null, 'note updated successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'NOTE_NOT_FOUND') {
          ErrorResponses.notFound(res, 'note');
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
  validate({ params: contract.noteIdParams }),
  async (req: Request<{ noteId: string }>, res: Response): Promise<void> => {
    try {
      const { noteId } = req.params;

      await AlignerService.validateAndDeleteNote(noteId);

      sendSuccess(res, null, 'note deleted successfully');
    } catch (error) {
      if (error instanceof AlignerValidationError) {
        if (error.code === 'NOTE_NOT_FOUND') {
          ErrorResponses.notFound(res, 'note');
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
        ErrorResponses.badRequest(res, 'Valid note id is required');
        return;
      }

      const isRead = await alignerQueries.getNoteReadStatus(parseInt(noteId, 10));

      if (isRead !== null) {
        sendData(res, contract.noteStatus.response, { isRead });
      } else {
        ErrorResponses.notFound(res, 'note');
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
// ALIGNER BATCHES CRUD OPERATIONS
// ============================================================================

/**
 * Create a new aligner batch
 */
router.post(
  '/aligner/batches',
  validate({ body: contract.createBatch.body }),
  async (
    req: Request<unknown, unknown, contract.CreateBatchBody>,
    res: Response
  ): Promise<void> => {
    try {
      const result = await AlignerService.validateAndCreateBatch(req.body);

      sendData(
        res,
        contract.createBatch.response,
        { batchId: result.newBatchId, deactivatedBatch: result.deactivatedBatch },
        'Aligner batch created successfully'
      );
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
  validate({ params: contract.batchIdParams, body: contract.updateBatch.body }),
  async (
    req: Request<{ batchId: string }, unknown, contract.UpdateBatchBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { batchId } = req.params;

      const result = await AlignerService.validateAndUpdateBatch(
        batchId,
        req.body
      );

      const data: Record<string, unknown> = {};
      if (result && result.deactivatedBatch) {
        data.deactivatedBatch = result.deactivatedBatch;
      }

      sendData(res, contract.updateBatch.response, data, 'Aligner batch updated successfully');
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
  validate({ params: contract.batchIdParams, body: contract.targetDateBody }),
  async (req: Request<{ batchId: string }, unknown, { targetDate?: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const { targetDate } = req.body || {};

      const result = await AlignerService.markBatchManufactured(
        batchId,
        targetDate ? new Date(targetDate) : null
      );

      sendData(
        res,
        contract.manufactureBatch.response,
        {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
          action: result.action,
          // Structured idempotency flag (symmetric with /deliver's wasAlreadyDelivered)
          // so funneled callers don't have to string-match the envelope message, which
          // core/http.ts's unwrapEnvelope strips. See audit N19.
          wasAlreadyManufactured: result.wasAlreadyManufactured,
        },
        result.message
      );
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
 * batch_expiry_date is auto-computed from delivered_to_patient_date + (days * AlignerCount)
 * @body targetDate - Optional ISO date string for backdating/correction
 */
router.patch(
  '/aligner/batches/:batchId/deliver',
  validate({ params: contract.batchIdParams, body: contract.targetDateBody }),
  async (req: Request<{ batchId: string }, unknown, { targetDate?: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;
      const { targetDate } = req.body || {};

      const result = await AlignerService.markBatchDelivered(
        batchId,
        targetDate ? new Date(targetDate) : null
      );

      sendData(
        res,
        contract.deliverBatch.response,
        {
          batchId: result.batchId,
          batchSequence: result.batchSequence,
          setId: result.setId,
          wasActivated: result.wasActivated,
          wasAlreadyActive: result.wasAlreadyActive,
          wasAlreadyDelivered: result.wasAlreadyDelivered,
          previouslyActiveBatchSequence: result.previouslyActiveBatchSequence,
        },
        result.message
      );
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
  validate({ params: contract.batchIdParams }),
  async (req: Request<{ batchId: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      const result = await AlignerService.undoManufactureBatch(batchId);

      sendData(
        res,
        contract.undoManufacture.response,
        { batchId: result.batchId, batchSequence: result.batchSequence },
        result.message
      );
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
  validate({ params: contract.batchIdParams }),
  async (req: Request<{ batchId: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      const result = await AlignerService.undoDeliverBatch(batchId);

      sendData(
        res,
        contract.undoDeliver.response,
        { batchId: result.batchId, batchSequence: result.batchSequence },
        result.message
      );
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
  validate({ params: contract.batchIdParams }),
  async (req: Request<{ batchId: string }>, res: Response): Promise<void> => {
    try {
      const { batchId } = req.params;

      await AlignerService.validateAndDeleteBatch(batchId);

      sendSuccess(res, null, 'Aligner batch deleted successfully');
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
  validate({ params: contract.setIdParams }),
  timeouts.long,
  uploadSinglePdf,
  handleUploadError,
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const setId = parseInt(req.params.setId, 10);
      if (!Number.isInteger(setId) || setId <= 0) {
        ErrorResponses.badRequest(res, 'Invalid aligner set ID');
        return;
      }
      const uploaderEmail = req.session?.username || 'unknown';

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

      sendData(res, contract.uploadPdf.response, result, 'PDF uploaded successfully');
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
  validate({ params: contract.setIdParams }),
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const setId = parseInt(req.params.setId, 10);
      if (!Number.isInteger(setId) || setId <= 0) {
        ErrorResponses.badRequest(res, 'Invalid aligner set ID');
        return;
      }

      await deletePdfFromSet(setId);

      sendSuccess(res, null, 'PDF deleted successfully');
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
// ARCHFORM PATIENT MATCHING
// ============================================================================

/**
 * Get all patients from Archform SQLite database
 */
router.get(
  '/aligner/archform/patients',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Fetching Archform patients');
      const patients = await getArchformPatients();

      sendData(res, contract.archformPatients.response, {
        patients,
        count: patients.length
      });
    } catch (error) {
      if (error instanceof ArchformDbUnavailableError) {
        log.warn('Archform database unavailable', { path: error.dbPath });
        res.status(503).json({
          success: false,
          unavailable: true,
          message: 'Archform database is not accessible',
          path: error.dbPath,
        });
        return;
      }
      log.error('Error fetching Archform patients:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch Archform patients',
        error as Error
      );
    }
  }
);

/**
 * Check Archform database availability
 */
router.get(
  '/aligner/archform/status',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const status = await isArchformAvailable();
      sendData(res, contract.archformStatus.response, status);
    } catch (error) {
      log.error('Error checking Archform status:', error);
      ErrorResponses.internalError(
        res,
        'Failed to check Archform status',
        error as Error
      );
    }
  }
);

/**
 * Get all aligner sets with archform_id data for matching UI
 */
router.get(
  '/aligner/archform/matches',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      log.info('Fetching aligner sets with Archform IDs');
      const sets = await alignerQueries.getSetsWithArchformIds();

      sendData(res, contract.archformMatches.response, {
        sets: sets || [],
        count: sets ? sets.length : 0
      });
    } catch (error) {
      log.error('Error fetching Archform matches:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch Archform matches',
        error as Error
      );
    }
  }
);

/**
 * Save or clear archform_id on an aligner set
 */
router.patch(
  '/aligner/sets/:setId/archform',
  validate({ params: contract.setIdParams, body: contract.setArchformMatch.body }),
  async (
    req: Request<{ setId: string }, unknown, contract.SetArchformMatchBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { setId } = req.params;
      const { archformId } = req.body;

      if (!setId || isNaN(parseInt(setId))) {
        ErrorResponses.badRequest(res, 'Valid setId is required');
        return;
      }

      await alignerQueries.updateArchformId(
        parseInt(setId, 10),
        archformId ?? null
      );

      log.info('Updated archform_id', { setId, archformId });

      sendSuccess(
        res,
        null,
        archformId
          ? 'Archform patient matched successfully'
          : 'Archform match removed successfully'
      );
    } catch (error) {
      log.error('Error updating archform_id:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update Archform match',
        error as Error
      );
    }
  }
);

/**
 * Update an Archform patient's name
 */
router.put(
  '/aligner/archform/patients/:id',
  validate({ params: contract.archformPatientIdParams, body: contract.updateArchformPatient.body }),
  async (
    req: Request<{ id: string }, unknown, { name: string; lastName: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        ErrorResponses.badRequest(res, 'Valid patient id is required');
        return;
      }

      const { name, lastName } = req.body;
      if (!name || !name.trim() || !lastName || !lastName.trim()) {
        ErrorResponses.badRequest(res, 'Name and last name are required');
        return;
      }

      await updateArchformPatient(id, name.trim(), lastName.trim());
      log.info('Updated Archform patient', { id, name: name.trim(), lastName: lastName.trim() });

      sendSuccess(res, null, 'Archform patient updated successfully');
    } catch (error) {
      if (error instanceof ArchformDbUnavailableError) {
        res.status(503).json({
          success: false,
          unavailable: true,
          message: 'Archform database is not accessible',
          path: error.dbPath,
        });
        return;
      }
      log.error('Error updating Archform patient:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update Archform patient',
        error as Error
      );
    }
  }
);

/**
 * Delete an Archform patient (SQLite + clear SQL Server references)
 */
router.delete(
  '/aligner/archform/patients/:id',
  validate({ params: contract.archformPatientIdParams }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        ErrorResponses.badRequest(res, 'Valid patient id is required');
        return;
      }

      // Verify patient exists
      const patient = await getArchformPatientById(id);
      if (!patient) {
        ErrorResponses.notFound(res, 'Archform patient');
        return;
      }

      // Clear SQL Server references first (safer partial failure mode)
      await alignerQueries.clearArchformIdByPatientId(id);

      // Delete from Archform SQLite
      const result = await deleteArchformPatient(id);

      log.info('Deleted Archform patient', {
        id,
        name: `${patient.Name} ${patient.LastName}`,
        deletedFromTables: result.deletedFromTables
      });

      sendData(
        res,
        contract.deleteArchformPatient.response,
        { deletedFromTables: result.deletedFromTables },
        'Archform patient deleted successfully'
      );
    } catch (error) {
      if (error instanceof ArchformDbUnavailableError) {
        res.status(503).json({
          success: false,
          unavailable: true,
          message: 'Archform database is not accessible',
          path: error.dbPath,
        });
        return;
      }
      log.error('Error deleting Archform patient:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete Archform patient',
        error as Error
      );
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
  validate({ body: contract.generateLabels.body }),
  async (
    req: Request<unknown, unknown, contract.GenerateLabelsBody>,
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

      res.setHeader('Content-type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('X-Total-Labels', String(result.totalLabels));
      res.setHeader('X-Total-Pages', String(result.totalPages));
      res.setHeader('X-Next-position', String(result.nextPosition));
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

      sendData(res, contract.doctorsList.response, { doctors: doctors || [] });
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
  validate({ body: contract.doctorBody }),
  async (
    req: Request<unknown, unknown, contract.DoctorBody>,
    res: Response
  ): Promise<void> => {
    try {
      const newDrID = await AlignerService.validateAndCreateDoctor(req.body);

      sendData(res, contract.createDoctor.response, { drID: newDrID }, 'Doctor added successfully');
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
  validate({ params: contract.drIdParams, body: contract.doctorBody }),
  async (
    req: Request<{ drID: string }, unknown, contract.DoctorBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { drID } = req.params;

      await AlignerService.validateAndUpdateDoctor(drID, req.body);

      sendSuccess(res, null, 'Doctor updated successfully');
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
  validate({ params: contract.drIdParams }),
  async (req: Request<{ drID: string }>, res: Response): Promise<void> => {
    try {
      const { drID } = req.params;

      await AlignerService.validateAndDeleteDoctor(drID);

      sendSuccess(res, null, 'Doctor deleted successfully');
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
