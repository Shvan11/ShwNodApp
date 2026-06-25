/**
 * Patient Service - Business Logic Layer
 *
 * This service handles all patient business logic including:
 * - Patient data retrieval with validation
 * - Patient id validation (ensuring valid numeric IDs)
 * - Time points and imaging data retrieval
 * - Patient existence verification
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { log } from '../../utils/logger.js';
import { getInfos, deletePatient } from '../database/queries/patient-queries.js';
import {
  getTimePoints,
  getTimePointImgs,
} from '../database/queries/timepoint-queries.js';
import { getPayments, type Payment } from '../database/queries/payment-queries.js';
import { getTimePointCodesForPatient } from '../database/queries/native-timepoint-queries.js';
import {
  deleteWorkingFilesForPatient,
} from '../imaging/photo-cleanup.service.js';
import { deletePatientFolder } from '../files/file-explorer.service.js';
import { purgeDolphinPatient } from '../sync/cdc/dolphin-sink.js';

/**
 * Patient information returned from service
 */
type PatientInfoResult = {
  person_id: number;
  patient_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  DateOfBirth: string | null;
  gender: number | null;
  gender_display: string | null;
  address_name: string | null;
  referral_source: string | null;
  patient_type_name: string | null;
  tag_name: string | null;
  notes: string | null;
  language: number | null;
  country_code: string | null;
  estimated_cost: number | null;
  currency: string | null;
  DolphinId: number | null;
  date_added: string | null;
  AlertCount: number;
  name: string | null;
  start_date: string | null;
  estimatedCost: number | null;
  activeAlert: {
    alertId: number;
    alertType: string;
    alertDetails: string;
    alertSeverity: number;
  } | null;
  xrays: Array<{ name: string; detailsDirName?: string; previewImagePartialPath?: string; date?: string | null }>;
  assets: string[];
};

type TimePointResult = {
  tp_code: string;
  tp_date_time: string;
  tp_description: string;
};

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
 * Validate patient id
 * @param patientId - Patient id to validate
 * @throws PatientValidationError If validation fails
 * @returns Validated patient id as string
 */
function validatePatientId(patientId: string | number | undefined | null): string {
  // Check if provided
  if (!patientId && patientId !== 0) {
    throw new PatientValidationError(
      'Patient id is required',
      'MISSING_PATIENT_ID'
    );
  }

  // Convert to string for validation
  const pidString = String(patientId).trim();

  // Check if valid number
  const pid = parseInt(pidString, 10);
  if (isNaN(pid)) {
    throw new PatientValidationError(
      'Patient id must be a valid number',
      'INVALID_PATIENT_ID',
      { provided: patientId }
    );
  }

  // Check if positive
  if (pid < 1) {
    throw new PatientValidationError(
      'Patient id must be a positive number',
      'INVALID_PATIENT_ID',
      { provided: pid }
    );
  }

  // Return validated string (not the parsed integer)
  return pidString;
}

/**
 * Get patient information with validation
 * @param patientId - Patient id
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
    log.error(`Error fetching patient info for id ${pid}:`, { error: error instanceof Error ? error.message : String(error) });
    throw new Error('Failed to fetch patient information', { cause: error });
  }
}

/**
 * Get patient time points with validation
 * @param patientId - Patient id
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
    throw new Error('Failed to fetch patient time points', { cause: error });
  }
}

/**
 * Get patient time point images with validation
 * @param patientId - Patient id
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
    throw new Error('Failed to fetch time point images', { cause: error });
  }
}

/**
 * Get patient payments with validation
 * @param patientId - Patient id
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
    throw new Error('Failed to fetch patient payments', { cause: error });
  }
}

/**
 * Delete a patient and all its dependent records/files. Extracted from
 * `DELETE /patients/:personId` so the same cascade can be replayed from an admin
 * approval (`services/approvals/approval-actions.ts`, action `patient.delete`)
 * without duplicating the folder/working-files/Dolphin cleanup.
 */
export async function deletePatientCascade(personId: number): Promise<{ folderRemoved: boolean }> {
  // Capture the patient's tpCodes BEFORE the delete — deletePatient's cascade
  // (fk_time_points_tblpatients ON DELETE CASCADE) drops the timepoint rows, so
  // afterwards we'd have no way to name the rendered working/ files to remove.
  const tpCodes = await getTimePointCodesForPatient(personId);

  await deletePatient(personId);

  // DB cascade is authoritative; the on-share photo folder is removed after it
  // succeeds. Best-effort + logged: a locked file on the SMB share (EBUSY) must
  // not leave the request hanging in a "record gone but call failed" state.
  let folderRemoved = true;
  try {
    await deletePatientFolder(personId);
  } catch (folderErr) {
    folderRemoved = false;
    log.error('Patient record deleted but folder removal failed', {
      personId,
      error: (folderErr as Error).message,
    });
  }

  // Wipe the rendered working/ gallery files (the originals folder above does NOT
  // cover them — they live in the flat shared working/ dir). Best-effort: each file
  // delete already swallows its own error.
  try {
    await deleteWorkingFilesForPatient(personId, tpCodes);
  } catch (workingErr) {
    log.error('Patient deleted but working/ files cleanup failed', {
      personId,
      error: (workingErr as Error).message,
    });
  }

  // Finish the Dolphin wipe: the CDC sink removes the Dolphin timepoints/images
  // (via the cascade deletes), but never the Dolphin patient row — purge it here so
  // the patient fully disappears from Dolphin Imaging. No-op if Dolphin sync is off.
  try {
    await purgeDolphinPatient(personId);
  } catch (dolphinErr) {
    log.error('Patient deleted but Dolphin purge failed', {
      personId,
      error: (dolphinErr as Error).message,
    });
  }

  return { folderRemoved };
}
