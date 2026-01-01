/**
 * Appointment-related database queries
 */
import { Request } from 'tedious';
import type { ColumnValue } from '../../../types/database.types.js';
import { executeStoredProcedure, executeMultipleResultSets, TYPES } from '../index.js';

// Type definitions
export interface AppointmentRow {
  Num: number;
  apptime: string;
  PatientType: string;
  PatientName: string;
  AppDetail: string;
  Present: string | null;
  Seated: string | null;
  Dismissed: string | null;
  HasVisit: boolean;
  appointmentID: number;
  PersonID?: number;
  Phone?: string | null;
  Notes?: string | null;
  DrID?: number | null;
  WorkID?: number | null;
}

interface AppointmentStats {
  all: number;
  present: number;
  waiting: number;
  completed: number;
  seated?: number;
  dismissed?: number;
}

interface AppointmentsResponse extends AppointmentStats {
  appointments: AppointmentRow[];
}

interface UpdatePresentResult {
  success: boolean;
  appointmentID: number;
  state: string;
  time: string;
}

interface UndoStateResult {
  appointmentID: number;
  stateCleared: string;
  success: boolean;
}

/**
 * Daily appointments optimized result set
 */
export interface DailyAppointmentStats {
  total: number;
  checkedIn: number;
  absent: number;
  waiting: number;
  seated?: number;
  dismissed?: number;
  present?: number;
  completed?: number;
}

export interface DailyAppointmentsOptimizedResult {
  allAppointments: AppointmentRow[];
  checkedInAppointments: AppointmentRow[];
  stats: DailyAppointmentStats;
}

interface OutputParam {
  parameterName: string;
  value: unknown;
}

/**
 * Retrieves appointment information for a given date.
 */
export function getPresentAps(PDate: string): Promise<AppointmentsResponse> {
  return executeStoredProcedure<AppointmentRow, AppointmentsResponse>(
    'PTodayAppsWeb',
    [['AppsDate', TYPES.NVarChar, PDate]],
    (request: Request) => {
      request.addOutputParameter('all', TYPES.Int);
      request.addOutputParameter('present', TYPES.Int);
      request.addOutputParameter('waiting', TYPES.Int);
      request.addOutputParameter('completed', TYPES.Int);
    },
    (columns: ColumnValue[]) => ({
      Num: columns[0].value as number,
      apptime: columns[1].value as string,
      PatientType: columns[2].value as string,
      PatientName: columns[3].value as string,
      AppDetail: columns[4].value as string,
      Present: columns[5].value as string | null,
      Seated: columns[6].value as string | null,
      Dismissed: columns[7].value as string | null,
      HasVisit: columns[8].value as boolean,
      appointmentID: columns[9].value as number,
    }),
    (result: AppointmentRow[], outParams: OutputParam[]) => {
      const responseObject: AppointmentsResponse = {
        appointments: result,
        all: 0,
        present: 0,
        waiting: 0,
        completed: 0,
      };
      if (outParams) {
        for (const outParam of outParams) {
          const name = outParam.parameterName as keyof AppointmentStats;
          if (name in responseObject && typeof outParam.value === 'number') {
            responseObject[name] = outParam.value;
          }
        }
      }
      return responseObject;
    }
  );
}

/**
 * Updates patient appointment state (Present, Seated, Dismissed).
 */
export function updatePresent(
  Aid: number,
  state: string,
  Tim: string
): Promise<UpdatePresentResult> {
  return executeStoredProcedure<ColumnValue[], UpdatePresentResult>(
    'UpdatePresent',
    [
      ['Aid', TYPES.Int, Aid],
      ['state', TYPES.VarChar, state],
      ['Tim', TYPES.VarChar, Tim],
    ],
    undefined,
    (columns: ColumnValue[]) => columns,
    () => ({ success: true, appointmentID: Aid, state: state, time: Tim })
  );
}

/**
 * Undo appointment state by setting field to NULL.
 */
export function undoAppointmentState(
  appointmentID: number,
  stateField: string
): Promise<UndoStateResult> {
  return executeStoredProcedure<UndoStateResult, UndoStateResult>(
    'UndoAppointmentState',
    [
      ['AppointmentID', TYPES.Int, appointmentID],
      ['StateField', TYPES.VarChar, stateField],
    ],
    undefined,
    (columns: ColumnValue[]) => ({
      appointmentID: columns[0].value as number,
      stateCleared: columns[1].value as string,
      success: columns[2].value as boolean,
    }),
    (result: UndoStateResult[]) =>
      result[0] || { success: true, appointmentID, stateCleared: stateField }
  );
}

/**
 * Get daily appointments using optimized stored procedure
 * Returns 3 result sets: all appointments, checked-in appointments, and statistics
 */
export async function getDailyAppointmentsOptimized(
  AppsDate: Date | string
): Promise<DailyAppointmentsOptimizedResult> {
  const resultSets = await executeMultipleResultSets<AppointmentRow>('GetDailyAppointmentsOptimized', [
    ['AppsDate', TYPES.Date, AppsDate],
  ]);

  // Default values
  let allAppointments: AppointmentRow[] = [];
  let checkedInAppointments: AppointmentRow[] = [];
  let stats: DailyAppointmentStats = { total: 0, checkedIn: 0, absent: 0, waiting: 0 };

  if (resultSets.length >= 3) {
    allAppointments = resultSets[0] as AppointmentRow[];
    checkedInAppointments = resultSets[1] as AppointmentRow[];
    // Third result set contains stats with different shape
    const rawStats = resultSets[2][0] as unknown as DailyAppointmentStats | undefined;
    if (rawStats) {
      stats = {
        total: rawStats.total ?? 0,
        checkedIn: rawStats.checkedIn ?? 0,
        absent: rawStats.absent ?? 0,
        waiting: rawStats.waiting ?? 0,
      };
    }
  } else if (resultSets.length === 2) {
    const firstSet = resultSets[0];
    const secondSet = resultSets[1];

    if (firstSet.length > 0 && 'appointmentID' in firstSet[0]) {
      allAppointments = firstSet as AppointmentRow[];
      if (secondSet.length > 0) {
        if ('appointmentID' in secondSet[0]) {
          checkedInAppointments = secondSet as AppointmentRow[];
        } else if ('total' in secondSet[0]) {
          const rawStats = secondSet[0] as Record<string, number>;
          stats = {
            total: rawStats.total ?? 0,
            checkedIn: rawStats.checkedIn ?? 0,
            absent: rawStats.absent ?? 0,
            waiting: rawStats.waiting ?? 0,
          };
        }
      }
    }
  } else if (resultSets.length === 1) {
    const firstSet = resultSets[0];
    if (firstSet.length > 0 && 'appointmentID' in firstSet[0]) {
      allAppointments = firstSet as AppointmentRow[];
    }
  }

  return { allAppointments, checkedInAppointments, stats };
}
