/**
 * TimePoint and image-related database queries.
 *
 * Reads from the LOCAL clone tables (`dbo.tblTimePoints` / `dbo.tblTimePointImages`),
 * keyed by `PersonID`. (These formerly proxied the Dolphin `ListDolphTimePoints` /
 * `ListTimePointImgs` stored procs into `DolphinPlatform`; that dependency is gone.)
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, TYPES } from '../index.js';

// Type definitions
interface TimePoint {
  tpCode: string;
  tpDateTime: string;
  tpDescription: string;
}

/**
 * Retrieves time points for a given patient ID, ordered by tpCode.
 *
 * tpCode is returned as a string and tpDateTime as a 'YYYY-MM-DD' string
 * (`CONVERT(..., 23)`) to preserve the existing API contract and avoid the
 * `useUTC:false` midnight shift (see CLAUDE.md date gotcha).
 */
export function getTimePoints(PID: string): Promise<TimePoint[]> {
  return executeQuery<TimePoint>(
    `SELECT CONVERT(varchar(12), tpCode) AS tpCode,
            CONVERT(varchar(10), tpDateTime, 23) AS tpDateTime,
            tpDescription
       FROM dbo.tblTimePoints
      WHERE PersonID = @id
      ORDER BY tpCode`,
    [['id', TYPES.Int, parseInt(PID, 10)]],
    (columns: ColumnValue[]) => ({
      tpCode: columns[0].value as string,
      tpDateTime: columns[1].value as string,
      tpDescription: columns[2].value as string,
    })
  );
}

/**
 * Retrieves the view-code list (2-digit codes, e.g. '10', '22') for a patient's
 * timepoint. Callers build filenames as `{pid}0{tp}.i{code}`.
 */
export function getTimePointImgs(pid: string, tp: string): Promise<string[]> {
  return executeQuery<string>(
    `SELECT RTRIM(ti.ImageType) AS ImageType
       FROM dbo.tblTimePointImages ti
       JOIN dbo.tblTimePoints t ON ti.TimePointID = t.TimePointID
      WHERE t.PersonID = @pid AND t.tpCode = @tp
      ORDER BY ti.ImageType`,
    [
      ['pid', TYPES.Int, parseInt(pid, 10)],
      ['tp', TYPES.Int, parseInt(tp, 10)],
    ],
    (columns: ColumnValue[]) => columns[0].value as string
  );
}
