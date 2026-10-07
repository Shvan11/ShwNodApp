/**
 * TimePoint and image-related database queries.
 *
 * Reads from the `time_points` / `time_point_images` tables, keyed by `person_id`.
 * The WRITE side lives in native-timepoint-queries.ts.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

// type definitions
//
// `type`, not `interface`: this row flows through `sendData` into a `z.looseObject`
// contract, whose inferred string index signature an interface is not assignable to
// (TS2345 — see the contract-authoring rules in CLAUDE.md).
export type TimePoint = {
  tp_code: string;
  /** PG `date` → 'YYYY-MM-DD' string at runtime (see the kysely.ts pg parser). */
  tp_date_time: string;
  tp_description: string;
};

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
 * The patient's own `tp_code` set — the disambiguator for the shared flat
 * `working/` dir. A rendered view is named `{personId}{tpCode:02}.{view}`, and
 * decimal ids prefix each other, so a `{personId}…` prefix match spans patients
 * (patient 5 also matches patient 50's `5001.i12`). Callers pair these codes with
 * `VIEW_CODES` to enumerate the EXACT names this patient can own — see
 * services/files/working-files.service.ts.
 */
export function getTimePointCodes(PID: string): Promise<number[]> {
  const db = getKysely();
  return db
    .selectFrom('time_points')
    .where('person_id', '=', Number.parseInt(PID, 10))
    .select('tp_code')
    .execute()
    .then((rows) => rows.map((r) => r.tp_code));
}

/**
 * The clinic's common photo-session names (the `time_point_names` lookup, Settings →
 * Lookups), in the order they were added — what the Name select of the New / Edit Photo
 * Session dialogs offers. Suggestions only: `time_points.tp_description` is free text.
 */
export function getTimePointNames(): Promise<{ id: number; name: string }[]> {
  return getKysely().selectFrom('time_point_names').select(['id', 'name']).orderBy('id').execute();
}
