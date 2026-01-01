/**
 * TimePoint and image-related database queries
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeStoredProcedure, TYPES } from '../index.js';

// Type definitions
interface TimePoint {
  tpCode: string;
  tpDateTime: Date;
  tpDescription: string;
}

/**
 * Retrieves time points for a given patient ID.
 */
export function getTimePoints(PID: string): Promise<TimePoint[]> {
  return executeStoredProcedure<TimePoint>(
    'ListDolphTimePoints',
    [['ID', TYPES.VarChar, PID]],
    undefined,
    (columns: ColumnValue[]) => ({
      tpCode: columns[0].value as string,
      tpDateTime: columns[1].value as Date,
      tpDescription: columns[2].value as string,
    }),
    undefined
  );
}

/**
 * Retrieves time point images for a given patient ID and time point code.
 */
export function getTimePointImgs(pid: string, tp: string): Promise<string[]> {
  return executeStoredProcedure<string>(
    'ListTimePointImgs',
    [
      ['ID', TYPES.VarChar, pid],
      ['tpCode', TYPES.VarChar, tp],
    ],
    undefined,
    (columns: ColumnValue[]) => columns[0].value as string,
    (result) => result
  );
}
