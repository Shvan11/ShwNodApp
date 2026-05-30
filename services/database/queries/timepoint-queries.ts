/**
 * TimePoint and image-related database queries.
 *
 * Reads from the LOCAL clone tables (`tblTimePoints` / `tblTimePointImages`),
 * keyed by `PersonID`. (These formerly proxied the Dolphin `ListDolphTimePoints` /
 * `ListTimePointImgs` stored procs into `DolphinPlatform`; that dependency is gone.)
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). Runs against the pg
 * pool regardless of DB_DRIVER — the positional `ColumnValue[]` mappers are gone.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

// Type definitions
interface TimePoint {
  tpCode: string;
  tpDateTime: string;
  tpDescription: string;
}

/**
 * Retrieves time points for a given patient ID, ordered chronologically by date.
 *
 * Ordered by `tpDateTime` (then `tpCode` as a tiebreaker) so the photo timepoint tabs
 * render left-to-right in date order. (Historically this ordered by `tpCode`, which only
 * *looked* chronological because codes are usually assigned in date order — but a backdated
 * timepoint, e.g. patient 5518's tp3, would then appear out of date order.) Display order
 * only; `tpCode` is still the identifier the callers use to fetch a timepoint's images.
 *
 * `tpCode` is an int column returned as a string (was T-SQL `CONVERT(varchar)`) to
 * preserve the existing API contract; `tpDateTime` is a PG `date`, so the centralized
 * pg parser (see kysely.ts) already yields a 'YYYY-MM-DD' string — no UTC midnight shift.
 */
export function getTimePoints(PID: string): Promise<TimePoint[]> {
  const db = getKysely();
  return db
    .selectFrom('tblTimePoints')
    .where('PersonID', '=', Number.parseInt(PID, 10))
    .select((eb) => [
      sql<string>`cast(${eb.ref('tpCode')} as varchar)`.as('tpCode'),
      eb.ref('tpDateTime').$castTo<string>().as('tpDateTime'),
      'tpDescription',
    ])
    .orderBy('tpDateTime')
    .orderBy('tpCode')
    .execute() as Promise<TimePoint[]>;
}

/**
 * Retrieves the view-code list (2-digit codes, e.g. '10', '22') for a patient's
 * timepoint. Callers build filenames as `{pid}0{tp}.i{code}`.
 */
export function getTimePointImgs(pid: string, tp: string): Promise<string[]> {
  const db = getKysely();
  return db
    .selectFrom('tblTimePointImages as ti')
    .innerJoin('tblTimePoints as t', 't.TimePointID', 'ti.TimePointID')
    .where('t.PersonID', '=', Number.parseInt(pid, 10))
    .where('t.tpCode', '=', Number.parseInt(tp, 10))
    .orderBy('ti.ImageType')
    .select((eb) => sql<string>`rtrim(${eb.ref('ti.ImageType')})`.as('ImageType'))
    .execute()
    .then((rows) => rows.map((r) => r.ImageType));
}
