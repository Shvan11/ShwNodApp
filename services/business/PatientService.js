/**
 * Patient Service - Business Logic Layer
 *
 * This service handles all patient business logic including:
 * - Patient data retrieval with validation
 * - Patient ID validation (ensuring valid numeric IDs)
 * - Time points and imaging data retrieval
 * - Patient existence verification
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { log } from '../../utils/logger.js';
import { getInfos } from '../database/queries/patient-queries.js';
import { getTimePoints, getTimePointImgs } from '../database/queries/timepoint-queries.js';
import { getPayments } from '../database/queries/payment-queries.js';

/**
 * Validation error class for patient business logic
 */
export class PatientValidationError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'PatientValidationError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Validate patient ID
 * @param {string|number} patientId - Patient ID to validate
 * @throws {PatientValidationError} If validation fails
 * @returns {string} Validated patient ID as string
 */
function validatePatientId(patientId) {
    // Check if provided
    if (!patientId && patientId !== 0) {
        throw new PatientValidationError(
            'Patient ID is required',
            'MISSING_PATIENT_ID'
        );
    }

    // Convert to string for validation
    const pidString = String(patientId).trim();

    // Check if valid number
    const pid = parseInt(pidString);
    if (isNaN(pid)) {
        throw new PatientValidationError(
            'Patient ID must be a valid number',
            'INVALID_PATIENT_ID',
            { provided: patientId }
        );
    }

    // Check if positive
    if (pid < 1) {
        throw new PatientValidationError(
            'Patient ID must be a positive number',
            'INVALID_PATIENT_ID',
            { provided: pid }
        );
    }

    // Return validated string (not the parsed integer)
    return pidString;
}

/**
 * Get patient information with validation
 * @param {string|number} patientId - Patient ID
 * @returns {Promise<Object>} Patient information
 * @throws {PatientValidationError} If validation fails
 */
export async function getPatientInfo(patientId) {
    const pid = validatePatientId(patientId);

    try {
        const info = await getInfos(pid);

        if (!info || Object.keys(info).length === 0) {
            log.warn(`Patient not found: ${pid}`);
            throw new PatientValidationError(
                'Patient not found',
                'PATIENT_NOT_FOUND',
                { patientId: pid }
            );
        }

        return info;
    } catch (error) {
        if (error instanceof PatientValidationError) {
            throw error;
        }
        log.error(`Error fetching patient info for ID ${pid}:`, error);
        throw new Error('Failed to fetch patient information');
    }
}

/**
 * Get patient time points with validation
 * @param {string|number} patientId - Patient ID
 * @returns {Promise<Array>} Array of time points
 * @throws {PatientValidationError} If validation fails
 */
export async function getPatientTimePoints(patientId) {
    const pid = validatePatientId(patientId);

    try {
        const timePoints = await getTimePoints(pid);
        return timePoints || [];
    } catch (error) {
        if (error instanceof PatientValidationError) {
            throw error;
        }
        log.error(`Error fetching time points for patient ${pid}:`, error);
        throw new Error('Failed to fetch patient time points');
    }
}

/**
 * Get patient time point images with validation
 * @param {string|number} patientId - Patient ID
 * @param {string|number} timePoint - Time point code
 * @returns {Promise<Array>} Array of time point images
 * @throws {PatientValidationError} If validation fails
 */
export async function getPatientTimePointImages(patientId, timePoint) {
    const pid = validatePatientId(patientId);

    // Validate time point (can be 0 for latest)
    if (timePoint === undefined || timePoint === null) {
        throw new PatientValidationError(
            'Time point is required',
            'MISSING_TIME_POINT'
        );
    }

    try {
        const images = await getTimePointImgs(pid, timePoint);
        return images || [];
    } catch (error) {
        if (error instanceof PatientValidationError) {
            throw error;
        }
        log.error(`Error fetching time point images for patient ${pid}, tp ${timePoint}:`, error);
        throw new Error('Failed to fetch time point images');
    }
}

/**
 * Get patient payments with validation
 * @param {string|number} patientId - Patient ID
 * @returns {Promise<Array>} Array of payments
 * @throws {PatientValidationError} If validation fails
 */
export async function getPatientPayments(patientId) {
    const pid = validatePatientId(patientId);

    try {
        const payments = await getPayments(pid);
        return payments || [];
    } catch (error) {
        if (error instanceof PatientValidationError) {
            throw error;
        }
        log.error(`Error fetching payments for patient ${pid}:`, error);
        throw new Error('Failed to fetch patient payments');
    }
}

// Note: Additional patient-related methods (QR code, gallery, appointments)
// can be added here when the corresponding query functions are implemented
