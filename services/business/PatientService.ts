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
import { getInfos, deletePatient, insertPatientRow, type PatientData } from '../database/queries/patient-queries.js';
import { insertIntakeWork } from '../database/queries/work-queries.js';
import { recomputePatientType } from '../database/queries/patient-type-classifier.js';
import { getKysely, withPgTransaction } from '../database/kysely.js';
import { WORK_TYPE_IDS } from '../../shared/treatment-taxonomy.js';
import type { PatientIntake } from '../../shared/contracts/patient.contract.js';
import { toDateOnly } from '../../utils/date.js';
import {
  getTimePoints,
  getTimePointImgs,
  type TimePoint,
} from '../database/queries/timepoint-queries.js';
import { getTimePointCodesForPatient } from '../database/queries/native-timepoint-queries.js';
import {
  deleteWorkingFilesForPatient,
} from '../imaging/photo-cleanup.service.js';
import { deletePatientFolder } from '../files/file-explorer.service.js';
import { purgePatientThumbnails } from '../files/thumbnail.service.js';
import { purgeDolphinPatient } from '../sync/cdc/dolphin-sink.js';

/**
 * Patient information returned from service — exactly what `getInfos` yields.
 *
 * Derived, NOT re-declared: this used to be a hand-written copy of
 * `PatientInfo & PatientAssets` that had to be kept in sync by hand and silently
 * narrowed the query's row for every caller.
 */
type PatientInfoResult = NonNullable<Awaited<ReturnType<typeof getInfos>>>;

/**
 * Re-exported from the query layer rather than re-declared. The local copy was a
 * structural duplicate that would have silently narrowed the row (or gone stale) the
 * moment `getTimePoints` gained or renamed a column.
 */
type TimePointResult = TimePoint;

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
 * Thrown when an intake create needs the 'Clinic' pseudo-doctor but no active one
 * exists. The route maps its `code` to a 422 with an actionable message rather than
 * a generic 500 — the fix is a deployment/config action, not a client retry.
 */
export class IntakeConfigError extends Error {
  public readonly code = 'CLINIC_DOCTOR_MISSING' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IntakeConfigError';
  }
}

/**
 * Resolve the 'Clinic' pseudo-doctor's employee id (the dr_id stamped on auto-created
 * intake works). `employee_name` is citext, so the match is case-insensitive — the
 * same by-name convention the appointment form uses. Missing → typed 422.
 */
async function resolveClinicDoctorId(): Promise<number> {
  const row = await getKysely()
    .selectFrom('employees')
    .select('id')
    .where('employee_name', '=', 'Clinic')
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (!row) {
    throw new IntakeConfigError(
      "This intake needs an active employee named 'Clinic' (the pseudo-doctor for X-ray/Consult intake works). Create one in Settings → Employees, then try again."
    );
  }
  return row.id;
}

/**
 * Create a patient and, when an intake selector value is supplied, auto-create the
 * matching FINISHED intake work (X-ray imaging or Consult) + its full-payment invoice
 * (a FREE Consult, fee 0, gets the work with NO invoice — see insertIntakeWork) — all
 * in ONE transaction, so a duplicate name or any failure rolls the whole thing back
 * (no orphan work/invoice). The derived patient type is recomputed from the new work
 * inside the same txn (classifyPatient). A 'Regular' intake (none) just inserts the
 * patient, seeded NEW_NO_WORKS by insertPatientRow.
 */
export async function createPatientWithIntake(
  patientData: PatientData,
  intake?: PatientIntake
): Promise<{ personId: number; workId?: number; invoiceId?: number }> {
  // Resolve the Clinic pseudo-doctor BEFORE opening the txn so a misconfigured
  // deployment fails fast with an actionable 422 (only needed for an intake work).
  const clinicId = intake ? await resolveClinicDoctorId() : null;

  return withPgTransaction(async (trx) => {
    const { personId } = await insertPatientRow(trx, patientData);

    if (!intake || clinicId == null) {
      return { personId };
    }

    const { workId, invoiceId } = await insertIntakeWork(trx, {
      person_id: personId,
      type_of_work: intake.kind === 'xray' ? intake.workTypeId : WORK_TYPE_IDS.CONSULT,
      total_required: intake.fee,
      currency: intake.currency,
      dr_id: clinicId,
      start_date: toDateOnly(new Date()),
    });

    // Derive + materialize the patient type from the just-created intake work.
    await recomputePatientType(trx, personId);

    return { personId, workId, invoiceId };
  });
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

  // Drop the server-local thumbnail cache too: those WebP renders outlive both
  // folders above (they sit off-share under .cache/thumbs) and are downscaled
  // copies of the same clinical photos. Never throws.
  await purgePatientThumbnails(personId);

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
