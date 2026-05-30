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
 *   - `UX_tblTimePoints_Person_tpCode` (PersonID, tpCode)  — find-or-create allocator
 *   - `UQ_tblTimePointImages_TP_Type`  (TimePointID, ImageType) — image upsert key
 */
import { sql } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';
import { log } from '../../../utils/logger.js';

export interface NativeTimePoint {
  tpCode: number;
  timePointId: number;
}

/**
 * Find an existing native timepoint by (PersonID, tpDescription, tpDateTime), or
 * create one with the next per-patient `tpCode` (MAX+1). The existing-row lookup takes
 * `FOR UPDATE` inside the transaction so a concurrent identical prepare waits; the
 * unique `(PersonID, tpCode)` index backstops the new-allocation race (a losing
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
      .selectFrom('tblTimePoints')
      .where('PersonID', '=', personId)
      .where('tpDescription', '=', tpName)
      .where('tpDateTime', '=', sql<Date>`${dateStr}`)
      .orderBy('tpCode')
      .select(['TimePointID', 'tpCode'])
      .limit(1)
      .forUpdate()
      .executeTakeFirst();
    if (existing) {
      return { tpCode: existing.tpCode, timePointId: existing.TimePointID };
    }

    const maxRow = await trx
      .selectFrom('tblTimePoints')
      .where('PersonID', '=', personId)
      .select((eb) => eb.fn.max('tpCode').as('maxCode'))
      .executeTakeFirst();
    const next = (maxRow?.maxCode ?? -1) + 1;

    const inserted = await trx
      .insertInto('tblTimePoints')
      .values({ PersonID: personId, tpCode: next, tpDescription: tpName, tpDateTime: sql<Date>`${dateStr}` })
      .returning(['TimePointID', 'tpCode'])
      .executeTakeFirstOrThrow();
    log.info('Created native timepoint', { personId, tpCode: inserted.tpCode, tpName });
    return { tpCode: inserted.tpCode, timePointId: inserted.TimePointID };
  });
}

/**
 * Upsert one view-image row keyed on (TimePointID, ImageType) via the Phase-2
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
    .insertInto('tblTimePointImages')
    .values({
      TimePointID: timePointId,
      PersonID: personId,
      ImageType: imageType,
      ImageFile: imageFile,
      ImageDate: sql<Date>`${dateStr}`,
      Title: title,
    })
    .onConflict((oc) =>
      oc.columns(['TimePointID', 'ImageType']).doUpdateSet({
        ImageFile: imageFile,
        ImageDate: sql<Date>`${dateStr}`,
        Title: title,
        PersonID: personId,
      })
    )
    .execute();
}
