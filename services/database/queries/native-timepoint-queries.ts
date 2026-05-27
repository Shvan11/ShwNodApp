/**
 * Native timepoint queries — WRITE to the LOCAL clone tables
 * (`dbo.tblTimePoints` / `dbo.tblTimePointImages`), NOT `DolphinPlatform`.
 *
 * First native write path for the cloned tables (Phase 4 of the Dolphin-native
 * migration). Gated at the route layer by the native-photo-editor flag. The main
 * app still READS timepoint tabs from Dolphin until a later read-cutover, so a
 * timepoint created here won't appear as a grid tab yet — its images still light
 * up by tpCode via the shared `working/` directory.
 */
import { executeQuery, withTransaction, sql, TYPES } from '../index.js';
import { log } from '../../../utils/logger.js';

export interface NativeTimePoint {
  tpCode: number;
  timePointId: number;
}

/**
 * Find an existing native timepoint by (PersonID, tpDescription, tpDateTime), or
 * create one with the next per-patient `tpCode` (MAX+1). The SELECTs take
 * `UPDLOCK, HOLDLOCK` inside a transaction so two concurrent prepares for the same
 * patient can't allocate the same tpCode (the unique `(PersonID, tpCode)` index
 * would otherwise reject the loser).
 *
 * @param tpDate local-midnight Date (the pool runs useUTC:false; see CLAUDE.md)
 */
export async function findOrCreateNativeTimePoint(
  personId: number,
  tpName: string,
  tpDate: Date
): Promise<NativeTimePoint> {
  return withTransaction(async (tx) => {
    const existing = await new sql.Request(tx)
      .input('pid', TYPES.Int, personId)
      .input('desc', TYPES.VarChar(50), tpName)
      .input('d', TYPES.Date, tpDate)
      .query<{ TimePointID: number; tpCode: number }>(
        `SELECT TOP 1 TimePointID, tpCode
           FROM dbo.tblTimePoints WITH (UPDLOCK, HOLDLOCK)
          WHERE PersonID = @pid AND tpDescription = @desc AND tpDateTime = @d
          ORDER BY tpCode;`
      );
    if (existing.recordset.length > 0) {
      const row = existing.recordset[0];
      return { tpCode: row.tpCode, timePointId: row.TimePointID };
    }

    const inserted = await new sql.Request(tx)
      .input('pid', TYPES.Int, personId)
      .input('desc', TYPES.VarChar(50), tpName)
      .input('d', TYPES.Date, tpDate)
      .query<{ TimePointID: number; tpCode: number }>(
        `DECLARE @next int =
           (SELECT ISNULL(MAX(tpCode), -1) + 1
              FROM dbo.tblTimePoints WITH (UPDLOCK, HOLDLOCK)
             WHERE PersonID = @pid);
         INSERT INTO dbo.tblTimePoints (PersonID, tpCode, tpDescription, tpDateTime)
         OUTPUT INSERTED.TimePointID, INSERTED.tpCode
         VALUES (@pid, @next, @desc, @d);`
      );
    const row = inserted.recordset[0];
    log.info('Created native timepoint', { personId, tpCode: row.tpCode, tpName });
    return { tpCode: row.tpCode, timePointId: row.TimePointID };
  });
}

/**
 * Upsert one view-image row keyed on (TimePointID, ImageType). The clone has no
 * unique constraint on that pair, so use UPDATE-then-conditional-INSERT in a single
 * batch — re-saving a slot updates in place instead of duplicating.
 *
 * @param imageType 2-digit view code, e.g. '10'  (the view minus the leading 'i')
 * @param imageFile  Dolphin form, e.g. '652401.I10' (uppercase I)
 */
export async function upsertNativeTimePointImage(
  timePointId: number,
  personId: number,
  imageType: string,
  imageFile: string,
  imageDate: Date,
  title: string | null = null
): Promise<void> {
  await executeQuery(
    `UPDATE dbo.tblTimePointImages
        SET ImageFile = @file, ImageDate = @date, Title = @title, PersonID = @pid
      WHERE TimePointID = @tpid AND ImageType = @type;
     IF @@ROWCOUNT = 0
        INSERT INTO dbo.tblTimePointImages
               (TimePointID, PersonID, ImageType, ImageFile, ImageDate, Title)
        VALUES (@tpid, @pid, @type, @file, @date, @title);`,
    [
      ['tpid', TYPES.Int, timePointId],
      ['pid', TYPES.Int, personId],
      ['type', TYPES.Char(2), imageType],
      ['file', TYPES.VarChar(50), imageFile],
      ['date', TYPES.Date, imageDate],
      ['title', TYPES.VarChar(50), title],
    ]
  );
}
