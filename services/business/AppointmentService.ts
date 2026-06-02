/**
 * Appointment Service - Business Logic Layer
 *
 * This service handles all appointment business logic including:
 * - Appointment creation with comprehensive validation
 * - Doctor verification (ensuring employee is actually a doctor)
 * - Conflict detection (preventing duplicate appointments)
 * - Quick check-in operations (creating and checking in simultaneously)
 * - Date/time formatting and normalization
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { sql } from 'kysely';
import { log } from '../../utils/logger.js';
import { toDateOnly } from '../../utils/date.js';
import { getKysely } from '../database/kysely.js';
import {
  getDailyAppointmentsOptimized,
  updatePresent,
  createAppointment,
  type DailyAppointmentsOptimizedResult,
} from '../database/queries/appointment-queries.js';
import { isDateHoliday } from '../database/queries/holiday-queries.js';

/**
 * Appointment error codes
 */
export type AppointmentErrorCode =
  | 'MISSING_REQUIRED_FIELDS'
  | 'INVALID_DATA_TYPE'
  | 'INVALID_DATE_FORMAT'
  | 'INVALID_DOCTOR'
  | 'APPOINTMENT_CONFLICT'
  | 'HOLIDAY_CONFLICT'
  | 'INVALID_PERSON_ID'
  | 'INVALID_STATE_TRANSITION'
  | 'MISSING_DATE';

/**
 * Error details for appointment validation
 */
export interface AppointmentErrorDetails {
  [key: string]: unknown;
  existingAppointmentID?: number;
  holidayId?: number;
  holidayName?: string;
  holidayDate?: string;
  providedValue?: string | number;
  expectedType?: string;
  field?: string;
  personId?: number;
  date?: string;
  doctorId?: number;
}

/**
 * Validation error class for appointment business logic
 */
export class AppointmentValidationError extends Error {
  public readonly code: AppointmentErrorCode;
  public readonly details: AppointmentErrorDetails;

  constructor(
    message: string,
    code: AppointmentErrorCode,
    details: AppointmentErrorDetails = {}
  ) {
    super(message);
    this.name = 'AppointmentValidationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Appointment creation data
 */
export interface AppointmentCreateData {
  person_id: number | string;
  app_date: string;
  app_detail: string;
  dr_id: number | string;
}

/**
 * Created appointment result
 */
export interface CreatedAppointment {
  appointment_id: number | undefined;
  person_id: number;
  app_date: string;
  app_detail: string;
  dr_id: number;
  doctorName: string;
}

/**
 * Doctor info from verification
 */
export interface DoctorInfo {
  id: number;
  employee_name: string;
  position_name: string;
}

/**
 * Quick check-in data
 */
export interface QuickCheckInData {
  person_id: number | string;
  app_detail?: string;
  dr_id?: number | string;
}

/**
 * Quick check-in result
 */
export interface QuickCheckInResult {
  success: boolean;
  alreadyCheckedIn?: boolean;
  checkedIn?: boolean;
  created?: boolean;
  appointment_id: number | undefined;
  message: string;
  appointment: {
    appointment_id: number | undefined;
    person_id: number;
    app_date: string;
    app_detail?: string;
    dr_id?: number | null;
    present?: string | Date;
  };
}

/**
 * Formatted date time object
 */
interface FormattedDateTime {
  dateTime: string;
  dateOnly: string;
  timeObject: Date;
}

/**
 * Validate required fields for appointment creation
 * @throws AppointmentValidationError If validation fails
 */
function validateAppointmentRequiredFields(
  appointmentData: AppointmentCreateData
): void {
  const { person_id, app_date, app_detail, dr_id } = appointmentData;

  // Validate required fields
  if (!person_id || !app_date || !app_detail || !dr_id) {
    throw new AppointmentValidationError(
      'Missing required fields: person_id, app_date, app_detail, dr_id',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  // Validate data types
  if (isNaN(parseInt(String(person_id))) || isNaN(parseInt(String(dr_id)))) {
    throw new AppointmentValidationError(
      'person_id and dr_id must be valid numbers',
      'INVALID_DATA_TYPE'
    );
  }

  // Validate date format
  const appointmentDate = new Date(app_date);
  if (isNaN(appointmentDate.getTime())) {
    throw new AppointmentValidationError(
      'Invalid date format for app_date',
      'INVALID_DATE_FORMAT'
    );
  }
}

/**
 * Verify that an employee is a doctor
 * @param drID - Doctor/Employee id
 * @returns Doctor information
 * @throws AppointmentValidationError If employee is not a doctor
 */
export async function verifyDoctor(drID: number | string): Promise<DoctorInfo> {
  const db = getKysely();
  const { rows: doctorCheck } = await sql<DoctorInfo>`
        SELECT e."id", e."employee_name", p."position_name"
        FROM "employees" e
        INNER JOIN "positions" p ON e."position" = p."id"
        WHERE e."id" = ${parseInt(String(drID))} AND p."position_name" = 'Doctor'
    `.execute(db);

  if (!doctorCheck || doctorCheck.length === 0) {
    throw new AppointmentValidationError(
      'Invalid doctor id or employee is not a doctor',
      'INVALID_DOCTOR'
    );
  }

  return doctorCheck[0];
}

/**
 * Check for appointment conflicts (same patient, same day)
 * @param personID - Patient id
 * @param appDate - Appointment date
 * @returns null if no conflict
 * @throws AppointmentValidationError If conflict exists
 */
export async function checkAppointmentConflict(
  personID: number | string,
  appDate: string
): Promise<null> {
  interface ConflictResult {
    appointment_id: number;
  }

  const db = getKysely();
  const { rows: conflictCheck } = await sql<ConflictResult>`
        SELECT "appointment_id"
        FROM "appointments"
        WHERE "person_id" = ${parseInt(String(personID))} AND "app_date"::date = ${appDate}::date
    `.execute(db);

  if (conflictCheck && conflictCheck.length > 0) {
    throw new AppointmentValidationError(
      'Patient already has an appointment on this date',
      'APPOINTMENT_CONFLICT',
      { existingAppointmentID: conflictCheck[0].appointment_id }
    );
  }

  return null;
}

/**
 * Check if appointment date falls on a holiday
 * @param appDate - Appointment date
 * @throws AppointmentValidationError If date is a holiday
 */
export async function checkHolidayConflict(appDate: string): Promise<void> {
  // Extract date portion (YYYY-MM-DD)
  const dateOnly = appDate.split('T')[0];

  const holiday = await isDateHoliday(dateOnly);
  if (holiday) {
    throw new AppointmentValidationError(
      `Cannot create appointment on ${holiday.holiday_name} (${dateOnly})`,
      'HOLIDAY_CONFLICT',
      {
        holidayId: holiday.id,
        holidayName: holiday.holiday_name,
        holidayDate: toDateOnly(holiday.holiday_date),
      }
    );
  }
}

/**
 * Format current date/time for appointment operations
 */
function formatCurrentDateTime(): FormattedDateTime {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return {
    dateTime: `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`,
    dateOnly: `${year}-${month}-${day}`,
    timeObject: now,
  };
}

/**
 * Validate and create a new appointment
 * @param appointmentData - Appointment data to create
 * @returns Created appointment with id and doctor info
 * @throws AppointmentValidationError If validation fails
 */
export async function validateAndCreateAppointment(
  appointmentData: AppointmentCreateData
): Promise<CreatedAppointment> {
  const { person_id, app_date, app_detail, dr_id } = appointmentData;

  // Validate required fields
  validateAppointmentRequiredFields(appointmentData);

  // Check if date is a holiday (block appointments on holidays)
  await checkHolidayConflict(app_date);

  // Verify doctor exists and is actually a doctor
  const doctor = await verifyDoctor(dr_id);

  // Check for appointment conflicts
  await checkAppointmentConflict(person_id, app_date);

  // Insert new appointment (+ AppoPatientType trigger, in createAppointment)
  const newAppointmentId = await createAppointment({
    person_id: parseInt(String(person_id)),
    app_date,
    app_detail,
    dr_id: parseInt(String(dr_id)),
  });

  log.info(
    `Appointment created: id ${newAppointmentId}, Patient ${person_id}, Doctor ${doctor.employee_name}, Date ${app_date}`
  );

  return {
    appointment_id: newAppointmentId,
    person_id: parseInt(String(person_id)),
    app_date,
    app_detail,
    dr_id: parseInt(String(dr_id)),
    doctorName: doctor.employee_name,
  };
}

/**
 * Quick check-in: Create appointment and mark as present in one operation
 *
 * This handles three scenarios:
 * 1. Patient already checked in today - return existing appointment
 * 2. Patient has appointment today but not checked in - update with check-in time
 * 3. Patient has no appointment today - create new appointment with check-in
 *
 * @param checkInData - Check-in data
 * @returns Check-in result with appointment details
 * @throws AppointmentValidationError If validation fails
 */
export async function quickCheckIn(
  checkInData: QuickCheckInData
): Promise<QuickCheckInResult> {
  const { person_id, app_detail, dr_id } = checkInData;

  // Validate person_id
  if (!person_id || isNaN(parseInt(String(person_id)))) {
    throw new AppointmentValidationError(
      'person_id is required and must be a valid number',
      'INVALID_PERSON_ID'
    );
  }

  // Set defaults for optional fields
  const detail = app_detail || 'Walk-in';
  const doctorId = dr_id ? parseInt(String(dr_id)) : null;

  // Get formatted current date/time
  const { dateTime, dateOnly, timeObject } = formatCurrentDateTime();

  // Generate present time string (avoids UTC conversion issue with Date objects)
  const now = new Date();
  const presentTimeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  // Check if patient already has an appointment today
  interface ExistingAppointment {
    appointment_id: number;
    present: string | null;
    seated: string | null;
    dismissed: string | null;
  }

  const db = getKysely();
  const { rows: existingAppointment } = await sql<ExistingAppointment>`
        SELECT "appointment_id", "present", "seated", "dismissed"
        FROM "appointments"
        WHERE "person_id" = ${parseInt(String(person_id))}
          AND "app_date"::date = ${dateOnly}::date
    `.execute(db);

  // Scenario 1: Appointment exists and patient already checked in
  if (existingAppointment && existingAppointment.length > 0) {
    const apt = existingAppointment[0];

    if (apt.present) {
      log.info(
        `Patient ${person_id} already checked in today (Appointment ${apt.appointment_id})`
      );
      return {
        success: true,
        alreadyCheckedIn: true,
        appointment_id: apt.appointment_id,
        message: 'Patient already checked in today',
        appointment: {
          appointment_id: apt.appointment_id,
          person_id: parseInt(String(person_id)),
          app_date: dateTime,
          present: apt.present,
        },
      };
    }

    // Scenario 2: Appointment exists but not checked in - route through the
    // state-machine proc so a stale view can't re-check-in a patient who has
    // already moved to seated or dismissed since the existence check above.
    try {
      await updatePresent(apt.appointment_id, 'present', presentTimeString);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('[INVALID_STATE_TRANSITION]')) {
        throw new AppointmentValidationError(
          message,
          'INVALID_STATE_TRANSITION',
          { existingAppointmentID: apt.appointment_id }
        );
      }
      throw err;
    }

    log.info(
      `Patient ${person_id} checked in to existing appointment ${apt.appointment_id}`
    );

    return {
      success: true,
      checkedIn: true,
      appointment_id: apt.appointment_id,
      message: 'Patient checked in successfully',
      appointment: {
        appointment_id: apt.appointment_id,
        person_id: parseInt(String(person_id)),
        app_date: dateTime,
        present: timeObject,
      },
    };
  }

  // Scenario 3: No appointment exists - create new with present time

  // Check if today is a holiday (block walk-in appointments on holidays)
  await checkHolidayConflict(dateTime);

  // If doctor id provided, verify it's valid
  if (doctorId) {
    await verifyDoctor(doctorId);
  }

  // Create new appointment with present time already set (+ AppoPatientType in createAppointment)
  const newAppointmentId = await createAppointment({
    person_id: parseInt(String(person_id)),
    app_date: dateTime,
    app_detail: detail,
    dr_id: doctorId,
    present: presentTimeString,
  });

  log.info(
    `Quick check-in: Created appointment ${newAppointmentId} for patient ${person_id} with present time`
  );

  return {
    success: true,
    created: true,
    checkedIn: true,
    appointment_id: newAppointmentId,
    message: 'Appointment created and patient checked in successfully',
    appointment: {
      appointment_id: newAppointmentId,
      person_id: parseInt(String(person_id)),
      app_date: dateTime,
      app_detail: detail,
      dr_id: doctorId,
      present: timeObject,
    },
  };
}

/**
 * Get daily appointments with business logic (OPTIMIZED - Phase 2)
 * Fetches all appointment data in single call and structures response
 * @param AppsDate - The date for which to retrieve appointments
 * @returns Structured appointment data with stats
 */
export async function getDailyAppointments(
  AppsDate: string
): Promise<DailyAppointmentsOptimizedResult> {
  // Validate date parameter
  if (!AppsDate) {
    throw new AppointmentValidationError('AppsDate is required', 'MISSING_DATE');
  }

  // Validate date format
  const appointmentDate = new Date(AppsDate);
  if (isNaN(appointmentDate.getTime())) {
    throw new AppointmentValidationError(
      'Invalid date format for AppsDate',
      'INVALID_DATE_FORMAT'
    );
  }

  // Get typed data from database layer
  const result = await getDailyAppointmentsOptimized(AppsDate);

  log.info(
    `Retrieved daily appointments for ${AppsDate}: ${result.stats.total} total, ${result.stats.checkedIn} checked in`
  );

  return {
    allAppointments: result.allAppointments,
    checkedInAppointments: result.checkedInAppointments,
    stats: result.stats,
  };
}

export default {
  validateAndCreateAppointment,
  verifyDoctor,
  checkAppointmentConflict,
  checkHolidayConflict,
  quickCheckIn,
  getDailyAppointments,
  AppointmentValidationError,
};
