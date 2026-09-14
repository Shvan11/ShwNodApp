/**
 * Aligner NOTE API Routes — the two-way Lab↔Doctor message thread on an aligner set.
 *
 * Split out of aligner.routes.ts (S2/C4), mounted at the same prefix in the order the
 * sections appeared in that file, so the route table's registration order is unchanged.
 *
 * Authorization: mounted under the global `/api` `authenticate` gate, and every
 * mutating route additionally carries an explicit `authorize()`. The gates are
 * per-route on purpose: this router is mounted at `/` inside the api router, so a
 * pathless `router.use(authorize(...))` would gate every `/api/*` request that
 * merely passes through it (the 2026-07-11 admin-403 incident — see routes/admin.ts).
 */

import { Router, type Request, type Response } from 'express';
import { sendSuccess, sendData, ErrorResponses } from '../../utils/error-response.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { log } from '../../utils/logger.js';
import * as contract from '../../shared/contracts/aligner.contract.js';
import * as alignerNoteQueries from '../../services/database/queries/aligner-note-queries.js';
import * as alignerNoteService from '../../services/business/AlignerNoteService.js';
import { AlignerValidationError } from '../../services/business/AlignerErrors.js';

const router = Router();

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

      if (!setId || isNaN(parseInt(setId, 10))) {
        ErrorResponses.badRequest(res, 'Valid setId is required');
        return;
      }

      const notes = await alignerNoteQueries.getNotesBySetId(parseInt(setId, 10));

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
  authorize(CLINICAL_ROLES),
  validate({ body: contract.createNote.body }),
  async (
    req: Request<unknown, unknown, contract.CreateNoteBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { aligner_set_id, note_text } = req.body;

      const noteId = await alignerNoteService.validateAndCreateNote(
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
  authorize(CLINICAL_ROLES),
  validate({ params: contract.noteIdParams }),
  async (req: Request<{ noteId: string }>, res: Response): Promise<void> => {
    try {
      const { noteId } = req.params;

      if (!noteId || isNaN(parseInt(noteId, 10))) {
        ErrorResponses.badRequest(res, 'Valid note id is required');
        return;
      }

      await alignerNoteQueries.toggleNoteReadStatus(parseInt(noteId, 10));

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
  authorize(CLINICAL_ROLES),
  validate({ params: contract.noteIdParams, body: contract.updateNote.body }),
  async (
    req: Request<{ noteId: string }, unknown, contract.UpdateNoteBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { noteId } = req.params;
      const { note_text } = req.body;

      await alignerNoteService.validateAndUpdateNote(noteId, note_text);

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
  authorize(CLINICAL_ROLES),
  validate({ params: contract.noteIdParams }),
  async (req: Request<{ noteId: string }>, res: Response): Promise<void> => {
    try {
      const { noteId } = req.params;

      await alignerNoteService.validateAndDeleteNote(noteId);

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

      if (!noteId || isNaN(parseInt(noteId, 10))) {
        ErrorResponses.badRequest(res, 'Valid note id is required');
        return;
      }

      const isRead = await alignerNoteQueries.getNoteReadStatus(parseInt(noteId, 10));

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

export default router;
