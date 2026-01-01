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
import {
  getTimePoints,
  getTimePointImgs,
} from '../database/queries/timepoint-queries.js';
import { getPayments } from '../database/queries/payment-queries.js';
import type { Payment } from '../../types/database.types.js';

/**
 * Patient information returned from service
 */
interface PatientInfoResult {
  // Full patient details
  PersonID: number;
  patientID: string | null;
  PatientName: string | null;
  FirstName: string | null;
  LastName: string | null;
  Phone: string | null;
  Phone2: string | null;
  Email: string | null;
  DateOfBirth: string | null;
  Gender: number | null;
  GenderDisplay: string | null;
  Address: string | null;
  ReferralSource: string | null;
  PatientType: string | null;
  Tag: string | null;
  Notes: string | null;
  Language: number | null;
  CountryCode: string | null;
  EstimatedCost: number | null;
  Currency: string | null;
  DolphinId: number | null;
  DateAdded: string | null;
  AlertCount: number;
  // Legacy fields for backwards compatibility
  name: string | null;
  phone: string | null;
  StartDate: Date | null;
  estimatedCost: number | null;
  currency: string | null;
  activeAlert: {
    alertId: number;
    alertType: string;
    alertDetails: string;
    alertSeverity: number;
  } | null;
  xrays: Array<{ name: string; detailsDirName?: string; previewImagePartialPath?: string; date?: string | null }>;
  assets: string[];
}

/**
 * Time point returned from service
 */
interface TimePointResult {
  tpCode: string;
  tpDateTime: Date;
  tpDescription: string;
}

/**
 * Error codes for patient validation
 */
export type PatientErrorCode =
  | 'MISSING_PATIENT_ID'
  | 'INVALID_PATIENT_ID'
  | 'PATIENT_NOT_FOUND'
  | 'MISSING_TIME_POINT';

/**
 * Validation error details
 */
export interface PatientErrorDetails {
  patientId?: string | number;
  provided?: string | number;
  timePointCode?: string;
  expectedType?: string;
}

/**
 * Validation error class for patient business logic
 */
export class PatientValidationError extends Error {
  public readonly code: PatientErrorCode;
  public readonly details: PatientErrorDetails;

  constructor(
    message: string,
    code: PatientErrorCode,
    details: PatientErrorDetails = {}
  ) {
    super(message);
    this.name = 'PatientValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Time point image data
 */
export interface TimePointImage {
  name: string;
  path?: string;
  date?: string;
  width?: number;
  height?: number;
  description?: string;
  type?: string;
}

/**
 * Validate patient ID
 * @param patientId - Patient ID to validate
 * @throws PatientValidationError If validation fails
 * @returns Validated patient ID as string
 */
function validatePatientId(patientId: string | number | undefined | null): string {
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
  const pid = parseInt(pidString, 10);
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
 * @param patientId - Patient ID
 * @returns Patient information
 * @throws PatientValidationError If validation fails
 */
export async function getPatientInfo(
  patientId: string | number | undefined | null
): Promise<PatientInfoResult> {
  const pid = validatePatientId(patientId);

  try {
    const info = await getInfos(parseInt(pid, 10));

    if (!info || Object.keys(info).length === 0) {
      log.warn(`Patient not found: ${pid}`);
      throw new PatientValidationError('Patient not found', 'PATIENT_NOT_FOUND', {
        patientId: pid,
      });
    }

    return info;
  } catch (error) {
    if (error instanceof PatientValidationError) {
      throw error;
    }
    log.error(`Error fetching patient info for ID ${pid}:`, { error: error instanceof Error ? error.message : String(error) });
    throw new Error('Failed to fetch patient information');
  }
}

/**
 * Get patient time points with validation
 * @param patientId - Patient ID
 * @returns Array of time points
 * @throws PatientValidationError If validation fails
 */
export async function getPatientTimePoints(
  patientId: string | number | undefined | null
): Promise<TimePointResult[]> {
  const pid = validatePatientId(patientId);

  try {
    const timePoints = await getTimePoints(pid);
    return timePoints || [];
  } catch (error) {
    if (error instanceof PatientValidationError) {
      throw error;
    }
    log.error(`Error fetching time points for patient ${pid}:`, { error: error instanceof Error ? error.message : String(error) });
    throw new Error('Failed to fetch patient time points');
  }
}

/**
 * Get patient time point images with validation
 * @param patientId - Patient ID
 * @param timePoint - Time point code
 * @returns Array of time point images
 * @throws PatientValidationError If validation fails
 */
export async function getPatientTimePointImages(
  patientId: string | number | undefined | null,
  timePoint: string | number | undefined | null
): Promise<string[]> {
  const pid = validatePatientId(patientId);

  // Validate time point (can be 0 for latest)
  if (timePoint === undefined || timePoint === null) {
    throw new PatientValidationError(
      'Time point is required',
      'MISSING_TIME_POINT'
    );
  }

  try {
    const images = await getTimePointImgs(pid, String(timePoint));
    return images || [];
  } catch (error) {
    if (error instanceof PatientValidationError) {
      throw error;
    }
    log.error(`Error fetching time point images for patient ${pid}, tp ${timePoint}:`, { error: error instanceof Error ? error.message : String(error) });
    throw new Error('Failed to fetch time point images');
  }
}

/**
 * Get patient payments with validation
 * @param patientId - Patient ID
 * @returns Array of payments
 * @throws PatientValidationError If validation fails
 */
export async function getPatientPayments(
  patientId: string | number | undefined | null
): Promise<Payment[]> {
  const pid = validatePatientId(patientId);

  try {
    const payments = await getPayments(parseInt(pid, 10));
    return payments || [];
  } catch (error) {
    if (error instanceof PatientValidationError) {
      throw error;
    }
    log.error(`Error fetching payments for patient ${pid}:`, { error: error instanceof Error ? error.message : String(error) });
    throw new Error('Failed to fetch patient payments');
  }
}
