/**
 * TimePoint and image-related database queries.
 *
 * Reads from the `time_points` / `time_point_images` tables, keyed by `person_id`.
 * The WRITE side lives in native-timepoint-queries.ts.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

// type definitions
interface TimePoint {
  tp_code: string;
  /** PG `date` → 'YYYY-MM-DD' string at runtime (see the kysely.ts pg parser). */
  tp_date_time: string;
  tp_description: string;
}

/**
 * Retrieves time points for a given patient id, ordered chronologically by date.
 *
 * Ordered by `tpDateTime` (then `tpCode` as a tiebreaker) so the photo timepoint tabs
 * render left-to-right in date order. (Historically this ordered by `tpCode`, which only
 * *looked* chronological because codes are usually assigned in date order — but a backdated
 * timepoint, e.g. patient 5518's tp3, would then appear out of date order.) Display order
 * only; `tpCode` is still the identifier the callers use to fetch a timepoint's images.
 *
 * `tpCode` is an int column returned as a string to preserve the existing API contract;
 * `tpDateTime` is a PG `date`, so the centralized pg parser (see kysely.ts) already
 * yields a 'YYYY-MM-DD' string — no UTC midnight shift.
 *
 * `tp_date_time` / `tp_description` are `NOT NULL` as of migrations/pg/1785700253568, so
 * the strings the wire contract (`patient.contract.ts#timepointRow`) and every consumer
 * require are a DB guarantee — selected raw. They previously carried a `coalesce(…, '')`
 * for the nullable era, but `''` is not a date: it papered over a violation that then
 * surfaced downstream as `Invalid Date` in the UI, a 400 from the photo-editor render
 * endpoint (its `tpDate` must match YYYY-MM-DD), and a silently-skipped originals-folder
 * delete. A NULL is now impossible; if one ever appeared it SHOULD throw at the contract.
 */
export function getTimePoints(PID: string): Promise<TimePoint[]> {
  const db = getKysely();
  return db
    .selectFrom('time_points')
    .where('person_id', '=', Number.parseInt(PID, 10))
    .select((eb) => [
      sql<string>`cast(${eb.ref('tp_code')} as varchar)`.as('tp_code'),
      // PG `date` → the oid-1082 parser yields ISO 'YYYY-MM-DD' (see kysely.ts).
      'tp_date_time',
      'tp_description',
    ])
    .orderBy('tp_date_time')
    .orderBy('tp_code')
    .execute();
}

/**
 * Retrieves the view-code list (2-digit codes, e.g. '10', '22') for a patient's
 * timepoint. Callers build filenames as `{pid}0{tp}.i{code}`.
 */
export function getTimePointImgs(pid: string, tp: string): Promise<string[]> {
  const db = getKysely();
  return db
    .selectFrom('time_point_images as ti')
    .innerJoin('time_points as t', 't.time_point_id', 'ti.time_point_id')
    .where('t.person_id', '=', Number.parseInt(pid, 10))
    .where('t.tp_code', '=', Number.parseInt(tp, 10))
    .orderBy('ti.image_type')
    .select((eb) => sql<string>`rtrim(${eb.ref('ti.image_type')})`.as('image_type'))
    .execute()
    .then((rows) => rows.map((r) => r.image_type));
}
