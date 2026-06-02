/**
 * Native timepoint queries — WRITE to the LOCAL clone tables
 * (`tblTimePoints` / `tblTimePointImages`).
 *
 * These are the app's authoritative timepoint tables: both reads (timepoint tabs,
 * portal, chair display — via `timepoint-queries.ts`) and writes (the photo editor)
 * go here, so a timepoint created by the editor shows as a grid tab immediately and
 * its images light up by tpCode via the shared `working/` directory.
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). The old facade-bypasser
 * `new sql.Request(tx)` + T-SQL `WITH (UPDLOCK, HOLDLOCK)` / `IF @@ROWCOUNT=0` became
 * a `withPgTransaction` with `SELECT … FOR UPDATE` on the existing-row lookup, and the
 * Phase-2 unique constraints as the race backstops:
 *   - `UX_tblTimePoints_Person_tpCode` (person_id, tpCode)  — find-or-create allocator
 *   - `UQ_tblTimePointImages_TP_Type`  (time_point_id, image_type) — image upsert key
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';
import { log } from '../../../utils/logger.js';

export interface NativeTimePoint {
  tp_code: number;
  timePointId: number;
}

/**
 * Find an existing native timepoint by (person_id, tpDescription, tpDateTime), or
 * create one with the next per-patient `tpCode` (MAX+1). The existing-row lookup takes
 * `FOR UPDATE` inside the transaction so a concurrent identical prepare waits; the
 * unique `(person_id, tpCode)` index backstops the new-allocation race (a losing
 * concurrent allocator surfaces a unique-violation, which the caller can retry).
 *
 * @param tpDate local-midnight Date; bound as a 'YYYY-MM-DD' string via toDateOnly so
 *   the `date` column isn't shifted by a UTC conversion (see CLAUDE.md date gotcha).
 */
export async function findOrCreateNativeTimePoint(
  personId: number,
  tpName: string,
  tpDate: Date
): Promise<NativeTimePoint> {
  const dateStr = toDateOnly(tpDate);
  return withPgTransaction(async (trx) => {
    const existing = await trx
      .selectFrom('time_points')
      .where('person_id', '=', personId)
      .where('tp_description', '=', tpName)
      .where('tp_date_time', '=', sql<Date>`${dateStr}`)
      .orderBy('tp_code')
      .select(['time_point_id', 'tp_code'])
      .limit(1)
      .forUpdate()
      .executeTakeFirst();
    if (existing) {
      return { tp_code: existing.tp_code, timePointId: existing.time_point_id };
    }

    const maxRow = await trx
      .selectFrom('time_points')
      .where('person_id', '=', personId)
      .select((eb) => eb.fn.max('tp_code').as('maxCode'))
      .executeTakeFirst();
    const next = (maxRow?.maxCode ?? -1) + 1;

    const inserted = await trx
      .insertInto('time_points')
      .values({ person_id: personId, tp_code: next, tp_description: tpName, tp_date_time: sql<Date>`${dateStr}` })
      .returning(['time_point_id', 'tp_code'])
      .executeTakeFirstOrThrow();
    log.info('Created native timepoint', { personId, tp_code: inserted.tp_code, tpName });
    return { tp_code: inserted.tp_code, timePointId: inserted.time_point_id };
  });
}

/**
 * Upsert one view-image row keyed on (time_point_id, image_type) via the Phase-2
 * unique constraint — re-saving a slot updates in place instead of duplicating.
 *
 * @param imageType 2-digit view code, e.g. '10'  (the view minus the leading 'i')
 * @param imageFile  stored image-file form, e.g. '652401.I10' (uppercase I)
 */
export async function upsertNativeTimePointImage(
  timePointId: number,
  personId: number,
  imageType: string,
  imageFile: string,
  imageDate: Date,
  title: string | null = null
): Promise<void> {
  const dateStr = toDateOnly(imageDate);
  await getKysely()
    .insertInto('time_point_images')
    .values({
      time_point_id: timePointId,
      person_id: personId,
      image_type: imageType,
      image_file: imageFile,
      image_date: sql<Date>`${dateStr}`,
      title: title,
    })
    .onConflict((oc) =>
      oc.columns(['time_point_id', 'image_type']).doUpdateSet({
        image_file: imageFile,
        image_date: sql<Date>`${dateStr}`,
        title: title,
        person_id: personId,
      })
    )
    .execute();
}

export interface NativeTimePointRow {
  timePointId: number;
  tp_description: string | null;
  /** PG `date` → 'YYYY-MM-DD' string at runtime (see kysely.ts pg parser). */
  tp_date_time: string;
}

/**
 * Fetch a single timepoint by (person_id, tpCode) — its id, name and date.
 * Returns null if the patient has no timepoint with that code. Used by the
 * edit/delete routes to read the *old* name/date (to locate the originals
 * folder) and to 404 cleanly.
 */
export async function getNativeTimePoint(
  personId: number,
  tp_code: number
): Promise<NativeTimePointRow | null> {
  const row = await getKysely()
    .selectFrom('time_points')
    .where('person_id', '=', personId)
    .where('tp_code', '=', tp_code)
    .select((eb) => [
      'time_point_id as timePointId',
      'tp_description',
      eb.ref('tp_date_time').$castTo<string>().as('tp_date_time'),
    ])
    .executeTakeFirst();
  return (row as NativeTimePointRow | undefined) ?? null;
}

/**
 * List every tpCode a patient has, so the on-disk `working/` gallery files
 * (`{personId}0{tpCode}.i{view}`) can be removed when the patient is deleted.
 * Must be called BEFORE deletePatient — the `ON DELETE CASCADE` on
 * `FK_tblTimePoints_tblpatients` wipes these rows with the patient.
 */
export async function getTimePointCodesForPatient(personId: number): Promise<number[]> {
  const rows = await getKysely()
    .selectFrom('time_points')
    .where('person_id', '=', personId)
    .select('tp_code')
    .execute();
  return rows.map((r) => r.tp_code);
}

export interface UpdateTimePointResult {
  ok: boolean;
  /** true when another tpCode for this patient already holds the target (name, date). */
  conflict?: boolean;
}

/**
 * Update a timepoint's name + date. `tpDateTime` is a 'YYYY-MM-DD' string bound
 * as a `date` (no UTC shift). Inside a transaction, first reject if a *different*
 * timepoint for this patient already has the target (tpDescription, tpDateTime) —
 * that pair drives the originals-folder name, so a clash would make two timepoints
 * fight over one folder.
 */
export async function updateNativeTimePoint(
  personId: number,
  tp_code: number,
  tp_description: string,
  tp_date_time: string
): Promise<UpdateTimePointResult> {
  return withPgTransaction(async (trx) => {
    const clash = await trx
      .selectFrom('time_points')
      .where('person_id', '=', personId)
      .where('tp_code', '!=', tp_code)
      .where('tp_description', '=', tp_description)
      .where('tp_date_time', '=', sql<Date>`${tp_date_time}`)
      .select('time_point_id')
      .limit(1)
      .executeTakeFirst();
    if (clash) return { ok: false, conflict: true };

    await trx
      .updateTable('time_points')
      .set({ tp_description, tp_date_time: sql<Date>`${tp_date_time}` })
      .where('person_id', '=', personId)
      .where('tp_code', '=', tp_code)
      .execute();
    log.info('Updated native timepoint', { personId, tp_code, tp_description, tp_date_time });
    return { ok: true };
  });
}

/**
 * Delete a timepoint by (person_id, tpCode). The `tblTimePointImages` FK is
 * `ON DELETE CASCADE`, so its image rows go with it in one statement.
 */
export async function deleteNativeTimePoint(personId: number, tp_code: number): Promise<void> {
  await getKysely()
    .deleteFrom('time_points')
    .where('person_id', '=', personId)
    .where('tp_code', '=', tp_code)
    .execute();
  log.info('Deleted native timepoint', { personId, tp_code });
}

/**
 * Delete one view-image row by (time_point_id, image_type) — the per-view "Remove" in
 * the photo editor. Idempotent: deleting a non-existent row affects 0 rows.
 *
 * @param imageType 2-digit view code, e.g. '10' (the view code minus the leading 'i')
 */
export async function deleteNativeTimePointImage(timePointId: number, imageType: string): Promise<void> {
  await getKysely()
    .deleteFrom('time_point_images')
    .where('time_point_id', '=', timePointId)
    .where('image_type', '=', imageType)
    .execute();
  log.info('Deleted native timepoint image', { timePointId, imageType });
}
