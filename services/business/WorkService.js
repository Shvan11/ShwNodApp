/**
 * Work Service - Business Logic Layer
 *
 * This service handles all work (treatment) business logic including:
 * - Work creation with validation
 * - Work with invoice creation (finished work with full payment)
 * - Work deletion with dependency checking
 * - Duplicate active work validation
 * - Date field normalization
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { log } from '../../utils/logger.js';
import {
    addWork,
    getActiveWork,
    addWorkWithInvoice as dbAddWorkWithInvoice,
    deleteWork as dbDeleteWork
} from '../database/queries/work-queries.js';

/**
 * Validation error class for work business logic
 */
export class WorkValidationError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'WorkValidationError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Normalize and validate date fields in work data
 * @param {Object} workData - Work data object
 * @param {Array<string>} dateFields - Array of date field names
 * @returns {Object} Normalized work data
 * @throws {WorkValidationError} If date format is invalid
 */
function normalizeDateFields(workData, dateFields = ['StartDate', 'DebondDate', 'FPhotoDate', 'IPhotoDate', 'NotesDate']) {
    const normalized = { ...workData };

    for (const field of dateFields) {
        if (normalized[field] && typeof normalized[field] === 'string') {
            const date = new Date(normalized[field]);
            if (isNaN(date.getTime())) {
                throw new WorkValidationError(
                    `Invalid date format for ${field}`,
                    'INVALID_DATE_FORMAT',
                    { field, value: normalized[field] }
                );
            }
            normalized[field] = date;
        }
    }

    return normalized;
}

/**
 * Validate required fields for work creation
 * @param {Object} workData - Work data object
 * @throws {WorkValidationError} If validation fails
 */
function validateWorkRequiredFields(workData) {
    // Validate required fields
    if (!workData.PersonID || !workData.DrID) {
        throw new WorkValidationError(
            'Missing required fields: PersonID and DrID are required',
            'MISSING_REQUIRED_FIELDS'
        );
    }

    // Validate Typeofwork is required
    if (!workData.Typeofwork) {
        throw new WorkValidationError(
            'Typeofwork is required',
            'MISSING_TYPE_OF_WORK'
        );
    }

    // Validate data types
    if (isNaN(parseInt(workData.PersonID)) || isNaN(parseInt(workData.DrID))) {
        throw new WorkValidationError(
            'PersonID and DrID must be valid numbers',
            'INVALID_DATA_TYPE'
        );
    }
}

/**
 * Validate required fields for finished work with invoice
 * @param {Object} workData - Work data object
 * @throws {WorkValidationError} If validation fails
 */
function validateFinishedWorkRequiredFields(workData) {
    // Validate createAsFinished flag
    if (!workData.createAsFinished) {
        throw new WorkValidationError(
            'createAsFinished flag must be true for this operation',
            'INVALID_FINISHED_FLAG'
        );
    }

    // Validate TotalRequired
    if (!workData.TotalRequired || parseFloat(workData.TotalRequired) <= 0) {
        throw new WorkValidationError(
            'TotalRequired must be greater than 0 for finished work with invoice',
            'INVALID_TOTAL_REQUIRED'
        );
    }

    // Validate Currency
    if (!workData.Currency) {
        throw new WorkValidationError(
            'Currency is required for finished work with invoice',
            'MISSING_CURRENCY'
        );
    }
}

/**
 * Format duplicate active work error with existing work details
 * @param {number} personId - Patient ID
 * @returns {Promise<Object>} Error details with existing work information
 */
async function formatDuplicateActiveWorkError(personId) {
    try {
        const existingWork = await getActiveWork(personId);
        return {
            message: 'This patient already has an active (unfinished) work record. You can finish the existing work and add the new one.',
            code: 'DUPLICATE_ACTIVE_WORK',
            existingWork: existingWork ? {
                workId: existingWork.workid,
                typeOfWork: existingWork.Typeofwork,
                typeName: existingWork.TypeName,
                doctor: existingWork.DoctorName,
                additionDate: existingWork.AdditionDate,
                totalRequired: existingWork.TotalRequired,
                currency: existingWork.Currency
            } : null
        };
    } catch (fetchError) {
        // If we can't fetch the existing work, return basic error
        return {
            message: 'This patient already has an active (unfinished) work record. Please complete or finish the existing work before adding a new one.',
            code: 'DUPLICATE_ACTIVE_WORK'
        };
    }
}

/**
 * Validate and create a new work record
 * @param {Object} workData - Work data object
 * @param {number} workData.PersonID - Patient ID
 * @param {number} workData.DrID - Doctor ID
 * @param {number} workData.Typeofwork - Type of work ID
 * @param {number} workData.TotalRequired - Total amount required (optional, defaults to 0)
 * @param {string} workData.Currency - Currency (USD or IQD)
 * @param {string} workData.Notes - Notes (optional)
 * @param {Date} workData.StartDate - Start date (optional)
 * @param {Date} workData.DebondDate - Debond date (optional)
 * @param {Date} workData.FPhotoDate - Final photo date (optional)
 * @param {Date} workData.IPhotoDate - Initial photo date (optional)
 * @param {Date} workData.NotesDate - Notes date (optional)
 * @returns {Promise<Object>} Created work record with workId
 * @throws {WorkValidationError} If validation fails or duplicate active work exists
 */
export async function validateAndCreateWork(workData) {
    // Validate required fields
    validateWorkRequiredFields(workData);

    // Default TotalRequired to 0 if empty or not provided
    const normalizedData = { ...workData };
    if (normalizedData.TotalRequired === '' || normalizedData.TotalRequired === null || normalizedData.TotalRequired === undefined) {
        normalizedData.TotalRequired = 0;
    }

    // Normalize date fields
    const dataWithDates = normalizeDateFields(normalizedData);

    try {
        // Create work in database
        const result = await addWork(dataWithDates);
        log.info(`Work created successfully: Work ${result.workid} for Patient ${workData.PersonID}`);
        return result;
    } catch (error) {
        // Handle duplicate active work constraint violation
        if (error.number === 2601 && error.message.includes('UNQ_tblWork_Active')) {
            const errorDetails = await formatDuplicateActiveWorkError(workData.PersonID);
            throw new WorkValidationError(
                'Patient already has an active work',
                errorDetails.code,
                errorDetails
            );
        }
        throw error;
    }
}

/**
 * Validate and create a finished work with invoice (full payment)
 *
 * This creates a work record that is marked as finished and has a full payment invoice.
 * Used for completed treatments that are paid in full immediately.
 *
 * @param {Object} workData - Work data object (same as validateAndCreateWork)
 * @param {boolean} workData.createAsFinished - Must be true
 * @param {number} workData.TotalRequired - Total amount (must be > 0)
 * @param {string} workData.Currency - Currency (required)
 * @returns {Promise<Object>} Created work and invoice with { workId, invoiceId }
 * @throws {WorkValidationError} If validation fails
 */
export async function validateAndCreateWorkWithInvoice(workData) {
    // Validate standard work fields
    validateWorkRequiredFields(workData);

    // Validate additional fields for finished work with invoice
    validateFinishedWorkRequiredFields(workData);

    // Normalize date fields
    const dataWithDates = normalizeDateFields(workData);

    try {
        // Create work and invoice in database (transaction handled by query layer)
        const result = await dbAddWorkWithInvoice(dataWithDates);
        log.info(`Work with invoice created successfully: Work ${result.workId}, Invoice ${result.invoiceId} for Patient ${workData.PersonID}`);
        return result;
    } catch (error) {
        // Handle duplicate active work constraint violation
        if (error.number === 2601 && error.message.includes('UNQ_tblWork_Active')) {
            const errorDetails = await formatDuplicateActiveWorkError(workData.PersonID);
            throw new WorkValidationError(
                'Patient already has an active work',
                errorDetails.code,
                errorDetails
            );
        }
        throw error;
    }
}

/**
 * Check work dependencies before deletion
 * @param {number} workId - Work ID
 * @returns {Promise<Object>} Dependency information
 */
export async function checkWorkDependencies(workId) {
    const result = await dbDeleteWork(workId);

    if (!result.canDelete) {
        const deps = result.dependencies;
        const dependencyMessages = [];

        if (deps.InvoiceCount > 0) dependencyMessages.push(`${deps.InvoiceCount} payment(s)`);
        if (deps.VisitCount > 0) dependencyMessages.push(`${deps.VisitCount} visit(s)`);
        if (deps.DetailCount > 0) dependencyMessages.push(`${deps.DetailCount} detail(s)`);
        if (deps.DiagnosisCount > 0) dependencyMessages.push(`${deps.DiagnosisCount} diagnosis(es)`);
        if (deps.ImplantCount > 0) dependencyMessages.push(`${deps.ImplantCount} implant(s)`);
        if (deps.ScrewCount > 0) dependencyMessages.push(`${deps.ScrewCount} screw(s)`);

        throw new WorkValidationError(
            'Cannot delete work with existing records',
            'WORK_HAS_DEPENDENCIES',
            {
                message: `This work has ${dependencyMessages.join(', ')} that must be deleted first.`,
                dependencies: deps
            }
        );
    }

    return result;
}

/**
 * Validate and delete a work record
 * @param {number} workId - Work ID
 * @returns {Promise<Object>} Deletion result with rowsAffected
 * @throws {WorkValidationError} If work has dependencies
 */
export async function validateAndDeleteWork(workId) {
    log.info(`Attempting to delete work ${workId}`);

    const result = await checkWorkDependencies(workId);

    log.info(`Work ${workId} deleted successfully`);
    return result;
}

export default {
    validateAndCreateWork,
    validateAndCreateWorkWithInvoice,
    checkWorkDependencies,
    validateAndDeleteWork,
    WorkValidationError
};
