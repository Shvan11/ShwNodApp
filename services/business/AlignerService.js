/**
 * Aligner Service - Business Logic Layer
 *
 * This service handles all aligner-related business logic including:
 * - Aligner set creation with active set management
 * - Aligner set update and deletion with validation
 * - Aligner batch management
 * - Aligner doctor email validation and dependency checking
 * - Aligner notes validation
 * - Business rules enforcement
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { log } from '../../utils/logger.js';
import * as alignerQueries from '../database/queries/aligner-queries.js';

/**
 * Validation error class for aligner business logic
 */
export class AlignerValidationError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'AlignerValidationError';
        this.code = code;
        this.details = details;
    }
}

// ==============================
// ALIGNER SETS BUSINESS LOGIC
// ==============================

/**
 * Validate and create a new aligner set
 *
 * Business Rules:
 * - WorkID and AlignerDrID are required
 * - If creating an active set (IsActive = 1), deactivates all other sets for the same work
 * - Initializes remaining aligners count equal to total count
 * - Sets creation date automatically
 *
 * @param {Object} setData - Set data
 * @returns {Promise<number>} New set ID
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndCreateSet(setData) {
    const startTime = Date.now();
    const { WorkID, AlignerDrID } = setData;

    // Validation
    if (!WorkID || !AlignerDrID) {
        throw new AlignerValidationError(
            'WorkID and AlignerDrID are required',
            'MISSING_REQUIRED_FIELDS'
        );
    }

    const afterValidation = Date.now();
    log.info(`⏱️  [SERVICE TIMING] Validation took: ${afterValidation - startTime}ms`);
    log.info('Creating new aligner set with business logic:', setData);

    try {
        const dbStartTime = Date.now();
        const newSetId = await alignerQueries.createAlignerSet(setData);
        const dbEndTime = Date.now();

        log.info(`⏱️  [SERVICE TIMING] Database query took: ${dbEndTime - dbStartTime}ms`);
        log.info(`⏱️  [SERVICE TIMING] Total service time: ${dbEndTime - startTime}ms`);
        log.info(`Aligner set created successfully: Set ${newSetId} for Work ${WorkID}`);
        return newSetId;
    } catch (error) {
        const errorTime = Date.now() - startTime;
        log.error(`⏱️  [SERVICE TIMING] Error after ${errorTime}ms:`, error);
        throw error;
    }
}

/**
 * Validate and update an aligner set
 *
 * Business Rules:
 * - Set must exist
 * - If provided, AlignerDrID must be valid
 *
 * @param {number} setId - Set ID
 * @param {Object} setData - Set data to update
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndUpdateSet(setId, setData) {
    if (!setId || isNaN(parseInt(setId))) {
        throw new AlignerValidationError(
            'Valid setId is required',
            'INVALID_SET_ID'
        );
    }

    // Check if set exists
    const setExists = await alignerQueries.getAlignerSetById(setId);
    if (!setExists) {
        throw new AlignerValidationError(
            'Aligner set not found',
            'SET_NOT_FOUND',
            { setId }
        );
    }

    log.info(`Updating aligner set ${setId}:`, setData);

    try {
        await alignerQueries.updateAlignerSet(setId, setData);
        log.info(`Aligner set ${setId} updated successfully`);
    } catch (error) {
        log.error('Error updating aligner set:', error);
        throw error;
    }
}

/**
 * Validate and delete an aligner set
 *
 * Business Rules:
 * - Set must exist
 * - Deletes all batches first (cascade delete)
 *
 * @param {number} setId - Set ID
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndDeleteSet(setId) {
    if (!setId || isNaN(parseInt(setId))) {
        throw new AlignerValidationError(
            'Valid setId is required',
            'INVALID_SET_ID'
        );
    }

    // Check if set exists
    const setExists = await alignerQueries.getAlignerSetById(setId);
    if (!setExists) {
        throw new AlignerValidationError(
            'Aligner set not found',
            'SET_NOT_FOUND',
            { setId }
        );
    }

    log.info(`Deleting aligner set ${setId}`);

    try {
        // Delete batches first (foreign key constraint)
        await alignerQueries.deleteBatchesBySetId(setId);

        // Then delete the set
        await alignerQueries.deleteAlignerSet(setId);

        log.info(`Aligner set ${setId} and its batches deleted successfully`);
    } catch (error) {
        log.error('Error deleting aligner set:', error);
        throw error;
    }
}

// ==============================
// ALIGNER BATCHES BUSINESS LOGIC
// ==============================

/**
 * Validate and create a new batch
 *
 * Business Rules:
 * - AlignerSetID is required
 * - Set must exist
 * - If IsActive=1, automatically deactivates other active batches for the same set
 *
 * @param {Object} batchData - Batch data
 * @returns {Promise<Object>} Object with newBatchId and deactivatedBatch info
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndCreateBatch(batchData) {
    const { AlignerSetID, IsActive } = batchData;

    if (!AlignerSetID) {
        throw new AlignerValidationError(
            'AlignerSetID is required',
            'MISSING_REQUIRED_FIELDS'
        );
    }

    // Verify set exists
    const setExists = await alignerQueries.getAlignerSetById(AlignerSetID);
    if (!setExists) {
        throw new AlignerValidationError(
            'Aligner set not found',
            'SET_NOT_FOUND',
            { setId: AlignerSetID }
        );
    }

    // Check for currently active batch (before creating new one)
    let deactivatedBatch = null;
    if (IsActive) {
        const batches = await alignerQueries.getBatchesBySetId(AlignerSetID);
        const activeBatch = batches.find(b => b.IsActive);
        if (activeBatch) {
            deactivatedBatch = {
                batchId: activeBatch.AlignerBatchID,
                batchSequence: activeBatch.BatchSequence
            };
            log.info(`Batch #${activeBatch.BatchSequence} will be deactivated when creating new active batch`);
        }
    }

    log.info('Creating new aligner batch:', batchData);

    try {
        const newBatchId = await alignerQueries.createBatch(batchData);
        log.info(`Aligner batch created successfully: Batch ${newBatchId}`);

        return {
            newBatchId,
            deactivatedBatch
        };
    } catch (error) {
        log.error('Error creating aligner batch:', error);
        throw error;
    }
}

/**
 * Validate and update a batch
 *
 * Business Rules:
 * - Batch must exist (implicit through update)
 *
 * @param {number} batchId - Batch ID
 * @param {Object} batchData - Batch data
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndUpdateBatch(batchId, batchData) {
    if (!batchId || isNaN(parseInt(batchId))) {
        throw new AlignerValidationError(
            'Valid batchId is required',
            'INVALID_BATCH_ID'
        );
    }

    log.info(`Updating aligner batch ${batchId}:`, batchData);

    try {
        const result = await alignerQueries.updateBatch(batchId, batchData);
        log.info(`Aligner batch ${batchId} updated successfully`);

        // Return any deactivated batch info for user notification
        if (result && result.deactivatedBatch) {
            log.info(`Batch #${result.deactivatedBatch.batchSequence} was automatically deactivated`);
        }

        return result;
    } catch (error) {
        log.error('Error updating aligner batch:', error);
        throw error;
    }
}

/**
 * Validate and delete a batch
 *
 * Business Rules:
 * - Batch must exist (implicit through delete)
 *
 * @param {number} batchId - Batch ID
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndDeleteBatch(batchId) {
    if (!batchId || isNaN(parseInt(batchId))) {
        throw new AlignerValidationError(
            'Valid batchId is required',
            'INVALID_BATCH_ID'
        );
    }

    log.info(`Deleting aligner batch ${batchId}`);

    try {
        await alignerQueries.deleteBatch(batchId);
        log.info(`Aligner batch ${batchId} deleted successfully`);
    } catch (error) {
        log.error('Error deleting aligner batch:', error);
        throw error;
    }
}

/**
 * Mark batch as delivered
 *
 * @param {number} batchId - Batch ID
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If validation fails
 */
export async function markBatchDelivered(batchId) {
    if (!batchId || isNaN(parseInt(batchId))) {
        throw new AlignerValidationError(
            'Valid batchId is required',
            'INVALID_BATCH_ID'
        );
    }

    log.info(`Marking batch ${batchId} as delivered`);

    try {
        await alignerQueries.markBatchAsDelivered(batchId);
        log.info(`Batch ${batchId} marked as delivered`);
    } catch (error) {
        log.error('Error marking batch as delivered:', error);
        throw error;
    }
}

// ==============================
// ALIGNER DOCTORS BUSINESS LOGIC
// ==============================

/**
 * Validate and create a new aligner doctor
 *
 * Business Rules:
 * - Doctor name is required
 * - Email must be unique (if provided)
 *
 * @param {Object} doctorData - Doctor data
 * @returns {Promise<number>} New doctor ID
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndCreateDoctor(doctorData) {
    const { DoctorName, DoctorEmail } = doctorData;

    if (!DoctorName || DoctorName.trim() === '') {
        throw new AlignerValidationError(
            'Doctor name is required',
            'MISSING_DOCTOR_NAME'
        );
    }

    // Business Rule: Email must be unique
    const emailExists = await alignerQueries.isDoctorEmailTaken(DoctorEmail);
    if (emailExists) {
        throw new AlignerValidationError(
            'A doctor with this email already exists',
            'EMAIL_ALREADY_EXISTS',
            { email: DoctorEmail }
        );
    }

    try {
        const newDrID = await alignerQueries.createDoctor(doctorData);
        log.info(`Aligner doctor created successfully: Dr ${newDrID} - ${DoctorName}`);
        return newDrID;
    } catch (error) {
        log.error('Error creating aligner doctor:', error);
        throw error;
    }
}

/**
 * Validate and update an aligner doctor
 *
 * Business Rules:
 * - Doctor name is required
 * - Email must be unique among other doctors (if provided)
 *
 * @param {number} drID - Doctor ID
 * @param {Object} doctorData - Doctor data
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndUpdateDoctor(drID, doctorData) {
    const { DoctorName, DoctorEmail } = doctorData;

    if (!DoctorName || DoctorName.trim() === '') {
        throw new AlignerValidationError(
            'Doctor name is required',
            'MISSING_DOCTOR_NAME'
        );
    }

    // Business Rule: Email must be unique (excluding this doctor)
    const emailExists = await alignerQueries.isDoctorEmailTaken(DoctorEmail, drID);
    if (emailExists) {
        throw new AlignerValidationError(
            'Another doctor with this email already exists',
            'EMAIL_ALREADY_EXISTS',
            { email: DoctorEmail }
        );
    }

    try {
        await alignerQueries.updateDoctor(drID, doctorData);
        log.info(`Aligner doctor updated successfully: Dr ${drID} - ${DoctorName}`);
    } catch (error) {
        log.error('Error updating aligner doctor:', error);
        throw error;
    }
}

/**
 * Validate and delete an aligner doctor
 *
 * Business Rules:
 * - Cannot delete doctor if they have aligner sets
 * - Must reassign or delete sets first
 *
 * @param {number} drID - Doctor ID
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If doctor has dependencies
 */
export async function validateAndDeleteDoctor(drID) {
    // Business Rule: Check for dependencies
    const setCount = await alignerQueries.getDoctorSetCount(drID);

    if (setCount > 0) {
        throw new AlignerValidationError(
            `Cannot delete doctor. They have ${setCount} aligner set(s) associated with them. Please reassign or delete those sets first.`,
            'DOCTOR_HAS_SETS',
            { setCount }
        );
    }

    try {
        await alignerQueries.deleteDoctor(drID);
        log.info(`Aligner doctor deleted successfully: Dr ${drID}`);
    } catch (error) {
        log.error('Error deleting aligner doctor:', error);
        throw error;
    }
}

// ==============================
// ALIGNER NOTES BUSINESS LOGIC
// ==============================

/**
 * Validate and create a note
 *
 * Business Rules:
 * - Set must exist
 * - Note text is required
 *
 * @param {number} setId - Set ID
 * @param {string} noteText - Note text
 * @returns {Promise<number>} New note ID
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndCreateNote(setId, noteText) {
    if (!setId || isNaN(parseInt(setId))) {
        throw new AlignerValidationError(
            'Valid setId is required',
            'INVALID_SET_ID'
        );
    }

    if (!noteText || noteText.trim() === '') {
        throw new AlignerValidationError(
            'Note text is required',
            'MISSING_NOTE_TEXT'
        );
    }

    // Verify that the set exists
    const setExists = await alignerQueries.alignerSetExists(setId);
    if (!setExists) {
        throw new AlignerValidationError(
            'Aligner set not found',
            'SET_NOT_FOUND',
            { setId }
        );
    }

    try {
        const noteId = await alignerQueries.createNote(setId, noteText, 'Lab');
        log.info(`Lab added note to aligner set ${setId}`);
        return noteId;
    } catch (error) {
        log.error('Error adding lab note:', error);
        throw error;
    }
}

/**
 * Validate and update a note
 *
 * Business Rules:
 * - Note must exist
 * - Note text is required
 *
 * @param {number} noteId - Note ID
 * @param {string} noteText - Note text
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndUpdateNote(noteId, noteText) {
    if (!noteId || isNaN(parseInt(noteId))) {
        throw new AlignerValidationError(
            'Valid noteId is required',
            'INVALID_NOTE_ID'
        );
    }

    if (!noteText || noteText.trim() === '') {
        throw new AlignerValidationError(
            'Note text is required',
            'MISSING_NOTE_TEXT'
        );
    }

    // Verify note exists
    const existingNote = await alignerQueries.getNoteById(noteId);
    if (!existingNote) {
        throw new AlignerValidationError(
            'Note not found',
            'NOTE_NOT_FOUND',
            { noteId }
        );
    }

    try {
        await alignerQueries.updateNote(noteId, noteText);
        log.info(`Note ${noteId} updated`);
    } catch (error) {
        log.error('Error updating note:', error);
        throw error;
    }
}

/**
 * Validate and delete a note
 *
 * Business Rules:
 * - Note must exist
 *
 * @param {number} noteId - Note ID
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndDeleteNote(noteId) {
    if (!noteId || isNaN(parseInt(noteId))) {
        throw new AlignerValidationError(
            'Valid noteId is required',
            'INVALID_NOTE_ID'
        );
    }

    // Verify note exists
    const existingNote = await alignerQueries.getNoteById(noteId);
    if (!existingNote) {
        throw new AlignerValidationError(
            'Note not found',
            'NOTE_NOT_FOUND',
            { noteId }
        );
    }

    try {
        await alignerQueries.deleteNote(noteId);
        log.info(`Note ${noteId} deleted`);
    } catch (error) {
        log.error('Error deleting note:', error);
        throw error;
    }
}

// ==============================
// ALIGNER PAYMENTS BUSINESS LOGIC
// ==============================

/**
 * Validate and create a payment
 *
 * Business Rules:
 * - workid, Amountpaid, and Dateofpayment are required
 *
 * @param {Object} paymentData - Payment data
 * @returns {Promise<number>} New invoice ID
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndCreatePayment(paymentData) {
    const { workid, AlignerSetID, Amountpaid, Dateofpayment } = paymentData;

    if (!workid || !Amountpaid || !Dateofpayment) {
        throw new AlignerValidationError(
            'workid, Amountpaid, and Dateofpayment are required',
            'MISSING_REQUIRED_FIELDS'
        );
    }

    // Validate payment doesn't exceed set balance
    if (AlignerSetID) {
        const setBalance = await alignerQueries.getAlignerSetBalance(AlignerSetID);

        if (!setBalance) {
            throw new AlignerValidationError(
                'Aligner set not found',
                'SET_NOT_FOUND'
            );
        }

        if (setBalance.SetCost === null) {
            throw new AlignerValidationError(
                'Set cost must be defined before accepting payments',
                'SET_COST_NOT_DEFINED'
            );
        }

        const paymentAmount = parseFloat(Amountpaid);

        if (paymentAmount <= 0) {
            throw new AlignerValidationError(
                'Payment amount must be greater than zero',
                'INVALID_AMOUNT'
            );
        }

        if (paymentAmount > setBalance.Balance) {
            throw new AlignerValidationError(
                `Payment amount (${paymentAmount}) exceeds remaining balance (${setBalance.Balance})`,
                'PAYMENT_EXCEEDS_BALANCE'
            );
        }
    }

    log.info(`Adding payment for work ID: ${workid}, Set ID: ${AlignerSetID || 'general'}, Amount: ${Amountpaid}`);

    try {
        const invoiceID = await alignerQueries.createAlignerPayment(paymentData);
        log.info(`Payment added successfully: Invoice ${invoiceID}`);
        return invoiceID;
    } catch (error) {
        log.error('Error adding payment:', error);
        throw error;
    }
}

// ==============================
// ALIGNER PATIENTS SEARCH LOGIC
// ==============================

/**
 * Search for aligner patients with validation
 *
 * Business Rules:
 * - Search term must be at least 2 characters
 *
 * @param {string} searchTerm - Search term
 * @param {number} doctorId - Optional doctor ID
 * @returns {Promise<Array>} Array of patients
 * @throws {AlignerValidationError} If validation fails
 */
export async function searchPatients(searchTerm, doctorId = null) {
    if (!searchTerm || searchTerm.trim().length < 2) {
        throw new AlignerValidationError(
            'Search term must be at least 2 characters',
            'INVALID_SEARCH_TERM'
        );
    }

    const trimmedSearch = searchTerm.trim();
    log.info(`Searching for aligner patients: ${trimmedSearch}${doctorId ? ` (Doctor ID: ${doctorId})` : ''}`);

    try {
        return await alignerQueries.searchAlignerPatients(trimmedSearch, doctorId);
    } catch (error) {
        log.error('Error searching aligner patients:', error);
        throw error;
    }
}

// Export all functions
export default {
    // Sets
    validateAndCreateSet,
    validateAndUpdateSet,
    validateAndDeleteSet,

    // Batches
    validateAndCreateBatch,
    validateAndUpdateBatch,
    validateAndDeleteBatch,
    markBatchDelivered,

    // Doctors
    validateAndCreateDoctor,
    validateAndUpdateDoctor,
    validateAndDeleteDoctor,

    // Notes
    validateAndCreateNote,
    validateAndUpdateNote,
    validateAndDeleteNote,

    // Payments
    validateAndCreatePayment,

    // Search
    searchPatients,

    // Error class
    AlignerValidationError
};
