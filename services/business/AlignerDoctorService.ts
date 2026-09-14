/**
 * Aligner DOCTOR business logic — CRUD over the external referring dentists, with the
 * email-uniqueness and set-dependency checks, and the Cloudflare access-list sync each
 * write schedules.
 *
 * Split out of AlignerService.ts (S2/C4).
 */

import { log } from '../../utils/logger.js';
import * as alignerDoctorQueries from '../database/queries/aligner-doctor-queries.js';
import { scheduleDoctorEmailListSync } from '../cloudflare/doctor-email-list.js';
import { AlignerValidationError } from './AlignerErrors.js';

/**
 * Doctor creation data
 */
export interface DoctorCreateData {
  doctor_name: string;
  doctor_email?: string;
  DoctorPhone?: string;
  is_active?: boolean;
  Address?: string;
  notes?: string;
}

/**
 * Doctor update data
 */
export interface DoctorUpdateData {
  doctor_name: string;
  doctor_email?: string;
  DoctorPhone?: string;
  is_active?: boolean;
  Address?: string;
  notes?: string;
}

// ==============================
// ALIGNER DOCTORS BUSINESS LOGIC
// ==============================

/**
 * Validate and create a new aligner doctor
 *
 * Business Rules:
 * - Doctor name is required
 * - email must be unique (if provided)
 *
 * @param doctorData - Doctor data
 * @returns New doctor id
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndCreateDoctor(
  doctorData: DoctorCreateData
): Promise<number> {
  const { doctor_name, doctor_email } = doctorData;

  if (!doctor_name || doctor_name.trim() === '') {
    throw new AlignerValidationError(
      'Doctor name is required',
      'MISSING_DOCTOR_NAME'
    );
  }

  // Business Rule: email must be unique (only check if email is provided)
  const emailExists = doctor_email ? await alignerDoctorQueries.isDoctorEmailTaken(doctor_email) : false;
  if (emailExists) {
    throw new AlignerValidationError(
      'A doctor with this email already exists',
      'EMAIL_ALREADY_EXISTS',
      { email: doctor_email }
    );
  }

  try {
    const newDrID = await alignerDoctorQueries.createDoctor(doctorData);
    log.info(
      `Aligner doctor created successfully: Dr ${newDrID} - ${doctor_name}`
    );
    scheduleDoctorEmailListSync(`doctor ${newDrID} created`);
    return newDrID;
  } catch (error) {
    log.error('Error creating aligner doctor:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Validate and update an aligner doctor
 *
 * Business Rules:
 * - Doctor name is required
 * - email must be unique among other doctors (if provided)
 *
 * @param drID - Doctor id
 * @param doctorData - Doctor data
 * @throws AlignerValidationError If validation fails
 */
export async function validateAndUpdateDoctor(
  drID: number | string,
  doctorData: DoctorUpdateData
): Promise<void> {
  const { doctor_name, doctor_email } = doctorData;

  if (!doctor_name || doctor_name.trim() === '') {
    throw new AlignerValidationError(
      'Doctor name is required',
      'MISSING_DOCTOR_NAME'
    );
  }

  const parsedDrId = parseInt(String(drID), 10);

  // Business Rule: email must be unique (excluding this doctor, only check if email is provided)
  const emailExists = doctor_email
    ? await alignerDoctorQueries.isDoctorEmailTaken(doctor_email, parsedDrId)
    : false;
  if (emailExists) {
    throw new AlignerValidationError(
      'Another doctor with this email already exists',
      'EMAIL_ALREADY_EXISTS',
      { email: doctor_email }
    );
  }

  try {
    await alignerDoctorQueries.updateDoctor(parsedDrId, doctorData);
    log.info(
      `Aligner doctor updated successfully: Dr ${drID} - ${doctor_name}`
    );
    scheduleDoctorEmailListSync(`doctor ${drID} updated`);
  } catch (error) {
    log.error('Error updating aligner doctor:', { error: error instanceof Error ? error.message : String(error) });
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
 * @param drID - Doctor id
 * @throws AlignerValidationError If doctor has dependencies
 */
export async function validateAndDeleteDoctor(
  drID: number | string
): Promise<void> {
  const parsedDrId = parseInt(String(drID), 10);

  // Business Rule: Check for dependencies
  const setCount = await alignerDoctorQueries.getDoctorSetCount(parsedDrId);

  if (setCount > 0) {
    throw new AlignerValidationError(
      `Cannot delete doctor. They have ${setCount} aligner set(s) associated with them. Please reassign or delete those sets first.`,
      'DOCTOR_HAS_SETS',
      { setCount }
    );
  }

  try {
    await alignerDoctorQueries.deleteDoctor(parsedDrId);
    log.info(`Aligner doctor deleted successfully: Dr ${drID}`);
    scheduleDoctorEmailListSync(`doctor ${drID} deleted`);
  } catch (error) {
    log.error('Error deleting aligner doctor:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
