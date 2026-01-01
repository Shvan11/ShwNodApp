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

import { log } from '../../utils/logger.js';
import * as database from '../database/index.js';
import {
  getDailyAppointmentsOptimized,
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
  PersonID: number | string;
  AppDate: string;
  AppDetail: string;
  DrID: number | string;
}

/**
 * Created appointment result
 */
export interface CreatedAppointment {
  appointmentID: number | undefined;
  PersonID: number;
  AppDate: string;
  AppDetail: string;
  DrID: number;
  doctorName: string;
}

/**
 * Doctor info from verification
 */
export interface DoctorInfo {
  ID: number;
  employeeName: string;
  PositionName: string;
}

/**
 * Quick check-in data
 */
export interface QuickCheckInData {
  PersonID: number | string;
  AppDetail?: string;
  DrID?: number | string;
}

/**
 * Quick check-in result
 */
export interface QuickCheckInResult {
  success: boolean;
  alreadyCheckedIn?: boolean;
  checkedIn?: boolean;
  created?: boolean;
  appointmentID: number | undefined;
  message: string;
  appointment: {
    appointmentID: number | undefined;
    PersonID: number;
    AppDate: string;
    AppDetail?: string;
    DrID?: number | null;
    Present?: string | Date;
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
  const { PersonID, AppDate, AppDetail, DrID } = appointmentData;

  // Validate required fields
  if (!PersonID || !AppDate || !AppDetail || !DrID) {
    throw new AppointmentValidationError(
      'Missing required fields: PersonID, AppDate, AppDetail, DrID',
      'MISSING_REQUIRED_FIELDS'
    );
  }

  // Validate data types
  if (isNaN(parseInt(String(PersonID))) || isNaN(parseInt(String(DrID)))) {
    throw new AppointmentValidationError(
      'PersonID and DrID must be valid numbers',
      'INVALID_DATA_TYPE'
    );
  }

  // Validate date format
  const appointmentDate = new Date(AppDate);
  if (isNaN(appointmentDate.getTime())) {
    throw new AppointmentValidationError(
      'Invalid date format for AppDate',
      'INVALID_DATE_FORMAT'
    );
  }
}

/**
 * Verify that an employee is a doctor
 * @param drID - Doctor/Employee ID
 * @returns Doctor information
 * @throws AppointmentValidationError If employee is not a doctor
 */
export async function verifyDoctor(drID: number | string): Promise<DoctorInfo> {
  const doctorCheck = await database.executeQuery<DoctorInfo>(
    `
        SELECT e.ID, e.employeeName, p.PositionName
        FROM tblEmployees e
        INNER JOIN tblPositions p ON e.Position = p.ID
        WHERE e.ID = @drID AND p.PositionName = 'Doctor'
    `,
    [['drID', database.TYPES.Int, parseInt(String(drID))]],
    (columns) => ({
      ID: columns[0].value as number,
      employeeName: columns[1].value as string,
      PositionName: columns[2].value as string,
    })
  );

  if (!doctorCheck || doctorCheck.length === 0) {
    throw new AppointmentValidationError(
      'Invalid doctor ID or employee is not a doctor',
      'INVALID_DOCTOR'
    );
  }

  return doctorCheck[0];
}

/**
 * Check for appointment conflicts (same patient, same day)
 * @param personID - Patient ID
 * @param appDate - Appointment date
 * @returns null if no conflict
 * @throws AppointmentValidationError If conflict exists
 */
export async function checkAppointmentConflict(
  personID: number | string,
  appDate: string
): Promise<null> {
  interface ConflictResult {
    appointmentID: number;
  }

  const conflictCheck = await database.executeQuery<ConflictResult>(
    `
        SELECT appointmentID
        FROM tblappointments
        WHERE PersonID = @personID AND CAST(AppDate AS DATE) = CAST(@appDate AS DATE)
    `,
    [
      ['personID', database.TYPES.Int, parseInt(String(personID))],
      ['appDate', database.TYPES.DateTime, appDate],
    ],
    (columns) => ({
      appointmentID: columns[0].value as number,
    })
  );

  if (conflictCheck && conflictCheck.length > 0) {
    throw new AppointmentValidationError(
      'Patient already has an appointment on this date',
      'APPOINTMENT_CONFLICT',
      { existingAppointmentID: conflictCheck[0].appointmentID }
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
      `Cannot create appointment on ${holiday.HolidayName} (${dateOnly})`,
      'HOLIDAY_CONFLICT',
      {
        holidayId: holiday.ID,
        holidayName: holiday.HolidayName,
        holidayDate: holiday.Holidaydate.toISOString().split('T')[0],
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
 * @returns Created appointment with ID and doctor info
 * @throws AppointmentValidationError If validation fails
 */
export async function validateAndCreateAppointment(
  appointmentData: AppointmentCreateData
): Promise<CreatedAppointment> {
  const { PersonID, AppDate, AppDetail, DrID } = appointmentData;

  // Validate required fields
  validateAppointmentRequiredFields(appointmentData);

  // Check if date is a holiday (block appointments on holidays)
  await checkHolidayConflict(AppDate);

  // Verify doctor exists and is actually a doctor
  const doctor = await verifyDoctor(DrID);

  // Check for appointment conflicts
  await checkAppointmentConflict(PersonID, AppDate);

  // Insert new appointment
  const insertQuery = `
        INSERT INTO tblappointments (
            PersonID,
            AppDate,
            AppDetail,
            DrID,
            LastUpdated
        ) VALUES (@personID, CAST(@appDate AS datetime2), @appDetail, @drID, GETDATE())
    `;

  interface InsertResult {
    insertId?: number;
    recordset?: { appointmentID: number }[];
  }

  const result = (await database.executeQuery(
    insertQuery,
    [
      ['personID', database.TYPES.Int, parseInt(String(PersonID))],
      ['appDate', database.TYPES.NVarChar, AppDate],
      ['appDetail', database.TYPES.NVarChar, AppDetail],
      ['drID', database.TYPES.Int, parseInt(String(DrID))],
    ],
    (columns) => ({ value: columns[0]?.value })
  )) as unknown as InsertResult;

  const newAppointmentId =
    result.insertId || result.recordset?.[0]?.appointmentID;

  log.info(
    `Appointment created: ID ${newAppointmentId}, Patient ${PersonID}, Doctor ${doctor.employeeName}, Date ${AppDate}`
  );

  return {
    appointmentID: newAppointmentId,
    PersonID: parseInt(String(PersonID)),
    AppDate,
    AppDetail,
    DrID: parseInt(String(DrID)),
    doctorName: doctor.employeeName,
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
  const { PersonID, AppDetail, DrID } = checkInData;

  // Validate PersonID
  if (!PersonID || isNaN(parseInt(String(PersonID)))) {
    throw new AppointmentValidationError(
      'PersonID is required and must be a valid number',
      'INVALID_PERSON_ID'
    );
  }

  // Set defaults for optional fields
  const detail = AppDetail || 'Walk-in';
  const doctorId = DrID ? parseInt(String(DrID)) : null;

  // Get formatted current date/time
  const { dateTime, dateOnly, timeObject } = formatCurrentDateTime();

  // Generate present time string (avoids UTC conversion issue with Date objects)
  const now = new Date();
  const presentTimeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  // Check if patient already has an appointment today
  interface ExistingAppointment {
    appointmentID: number;
    Present: string | null;
    Seated: string | null;
    Dismissed: string | null;
  }

  const existingAppointment = await database.executeQuery<ExistingAppointment>(
    `
        SELECT appointmentID, Present, Seated, Dismissed
        FROM tblappointments
        WHERE PersonID = @personID
          AND CAST(AppDate AS DATE) = @today
    `,
    [
      ['personID', database.TYPES.Int, parseInt(String(PersonID))],
      ['today', database.TYPES.NVarChar, dateOnly],
    ],
    (columns) => ({
      appointmentID: columns[0].value as number,
      Present: columns[1].value as string | null,
      Seated: columns[2].value as string | null,
      Dismissed: columns[3].value as string | null,
    })
  );

  // Scenario 1: Appointment exists and patient already checked in
  if (existingAppointment && existingAppointment.length > 0) {
    const apt = existingAppointment[0];

    if (apt.Present) {
      log.info(
        `Patient ${PersonID} already checked in today (Appointment ${apt.appointmentID})`
      );
      return {
        success: true,
        alreadyCheckedIn: true,
        appointmentID: apt.appointmentID,
        message: 'Patient already checked in today',
        appointment: {
          appointmentID: apt.appointmentID,
          PersonID: parseInt(String(PersonID)),
          AppDate: dateTime,
          Present: apt.Present,
        },
      };
    }

    // Scenario 2: Appointment exists but not checked in - update with Present time
    await database.executeQuery(
      `
            UPDATE tblappointments
            SET Present = @presentTime,
                LastUpdated = GETDATE()
            WHERE appointmentID = @appointmentID
        `,
      [
        ['presentTime', database.TYPES.VarChar, presentTimeString],
        ['appointmentID', database.TYPES.Int, apt.appointmentID],
      ],
      (columns) => ({ value: columns[0]?.value })
    );

    log.info(
      `Patient ${PersonID} checked in to existing appointment ${apt.appointmentID}`
    );

    return {
      success: true,
      checkedIn: true,
      appointmentID: apt.appointmentID,
      message: 'Patient checked in successfully',
      appointment: {
        appointmentID: apt.appointmentID,
        PersonID: parseInt(String(PersonID)),
        AppDate: dateTime,
        Present: timeObject,
      },
    };
  }

  // Scenario 3: No appointment exists - create new with Present time

  // Check if today is a holiday (block walk-in appointments on holidays)
  await checkHolidayConflict(dateTime);

  // If doctor ID provided, verify it's valid
  if (doctorId) {
    await verifyDoctor(doctorId);
  }

  // Create new appointment with Present time already set
  const insertQuery = `
        INSERT INTO tblappointments (
            PersonID,
            AppDate,
            AppDetail,
            DrID,
            Present,
            LastUpdated
        )
        VALUES (
            @personID,
            CAST(@appDate AS datetime2),
            @appDetail,
            @drID,
            @presentTime,
            GETDATE()
        );
        SELECT SCOPE_IDENTITY() AS appointmentID;
    `;

  interface InsertResult {
    appointmentID: number;
  }

  const result = await database.executeQuery<InsertResult>(
    insertQuery,
    [
      ['personID', database.TYPES.Int, parseInt(String(PersonID))],
      ['appDate', database.TYPES.NVarChar, dateTime],
      ['appDetail', database.TYPES.NVarChar, detail],
      ['drID', database.TYPES.Int, doctorId],
      ['presentTime', database.TYPES.VarChar, presentTimeString],
    ],
    (columns) => ({
      appointmentID: columns[0].value as number,
    })
  );

  const newAppointmentId = result?.[0]?.appointmentID;

  log.info(
    `Quick check-in: Created appointment ${newAppointmentId} for patient ${PersonID} with Present time`
  );

  return {
    success: true,
    created: true,
    checkedIn: true,
    appointmentID: newAppointmentId,
    message: 'Appointment created and patient checked in successfully',
    appointment: {
      appointmentID: newAppointmentId,
      PersonID: parseInt(String(PersonID)),
      AppDate: dateTime,
      AppDetail: detail,
      DrID: doctorId,
      Present: timeObject,
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
