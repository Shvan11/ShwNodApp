/**
 * Aligner NOTE business logic — validation around the Lab↔Doctor thread on a set.
 *
 * Split out of AlignerService.ts (S2/C4).
 */

import { log } from '../../utils/logger.js';
import * as alignerNoteQueries from '../database/queries/aligner-note-queries.js';
import * as alignerSetQueries from '../database/queries/aligner-set-queries.js';
import { AlignerValidationError } from './AlignerErrors.js';

// ==============================
// ALIGNER NOTES BUSINESS LOGIC
// ==============================

/**
 * Validate and create a note
 *
 * Business Rules:
 * - Set must exist
 * - note text is required
 *
 * @param setId - Set id
 * @param noteText - note text
 * @returns New note id
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreateNote(
  setId: number | string,
  noteText: string
): Promise<number> {
  if (!setId || isNaN(parseInt(String(setId), 10))) {
    throw new AlignerValidationError('Valid setId is required', 'INVALID_SET_ID');
  }

  if (!noteText || noteText.trim() === '') {
    throw new AlignerValidationError(
      'note text is required',
      'MISSING_NOTE_TEXT'
    );
  }

  const parsedSetId = parseInt(String(setId), 10);

  // Verify that the set exists
  const setExists = await alignerSetQueries.alignerSetExists(parsedSetId);
  if (!setExists) {
    throw new AlignerValidationError('Aligner set not found', 'SET_NOT_FOUND', {
      setId: parsedSetId,
    });
  }

  try {
    const noteId = await alignerNoteQueries.createNote(parsedSetId, noteText, 'Lab');
    log.info(`Lab added note to aligner set ${setId}`);
    return noteId;
  } catch (error) {
    log.error('Error adding lab note:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Validate and update a note
 *
 * Business Rules:
 * - note must exist
 * - note text is required
 *
 * @param noteId - note id
 * @param noteText - note text
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndUpdateNote(
  noteId: number | string,
  noteText: string
): Promise<void> {
  if (!noteId || isNaN(parseInt(String(noteId), 10))) {
    throw new AlignerValidationError(
      'Valid noteId is required',
      'INVALID_NOTE_ID'
    );
  }

  if (!noteText || noteText.trim() === '') {
    throw new AlignerValidationError(
      'note text is required',
      'MISSING_NOTE_TEXT'
    );
  }

  const parsedNoteId = parseInt(String(noteId), 10);

  // Verify note exists
  const existingNote = await alignerNoteQueries.getNoteById(parsedNoteId);
  if (!existingNote) {
    throw new AlignerValidationError('note not found', 'NOTE_NOT_FOUND', {
      noteId: parsedNoteId,
    });
  }

  try {
    await alignerNoteQueries.updateNote(parsedNoteId, noteText);
    log.info(`note ${noteId} updated`);
  } catch (error) {
    log.error('Error updating note:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Validate and delete a note
 *
 * Business Rules:
 * - note must exist
 *
 * @param noteId - note id
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndDeleteNote(
  noteId: number | string
): Promise<void> {
  if (!noteId || isNaN(parseInt(String(noteId), 10))) {
    throw new AlignerValidationError(
      'Valid noteId is required',
      'INVALID_NOTE_ID'
    );
  }

  const parsedNoteId = parseInt(String(noteId), 10);

  // Verify note exists
  const existingNote = await alignerNoteQueries.getNoteById(parsedNoteId);
  if (!existingNote) {
    throw new AlignerValidationError('note not found', 'NOTE_NOT_FOUND', {
      noteId: parsedNoteId,
    });
  }

  try {
    await alignerNoteQueries.deleteNote(parsedNoteId);
    log.info(`note ${noteId} deleted`);
  } catch (error) {
    log.error('Error deleting note:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
