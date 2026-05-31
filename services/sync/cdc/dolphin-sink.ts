/**
 * Unified CDC — Dolphin sink (TEMPORARY).
 *
 * Third sink on the unified change feed. Replicates the app's native timepoint/image rows
 * (tblTimePoints / tblTimePointImages, written by the photo editor) into the legacy Dolphin
 * Imaging SQL Server DB (DolphinPlatform.dbo.Patients / TimePoints / TimePointImages) so Dolphin
 * Imaging "sees" photos the app cropped. DB ROWS ONLY — the physical JPEGs already land in the
 * shared working/ dir under Dolphin's exact {personId}0{tpCode}.I{NN} naming. Meant to be DELETED
 * (this file + its migration + the index.ts entry) once the native pipeline is trusted.
 *
 * Reuses the surviving mssql pool (services/database/pool.ts, connected to ShwanNew); Dolphin is
 * reached via three-part names DolphinPlatform.dbo.*, exactly as the retired stored procs did. This
 * is an intentional, documented reintroduction of a runtime mssql dependency for a temporary
 * feature (CLAUDE.md otherwise calls pool.ts script-only).
 *
 * The delete problem & the mapping table — change_log carries only (sink, tbl, pk); on a delete the
 * source PG row is already gone (no payload to read), and PG integer PKs don't match Dolphin's
 * uniqueidentifier PKs anyway. So the sink owns an UN-triggered table, dolphin_sync_map(local_table,
 * local_pk) → dolphin_id, that survives the source deletion. Un-triggered ⇒ no capture feedback
 * loop, so (unlike PortalSink) this sink needs no cdc_origin guard.
 *
 * Scope: going-forward only (no backfill). Timepoint delete = CASCADE (drops the whole Dolphin
 * timepoint incl. any Dolphin-owned x-rays/ceph/scans sharing it).
 */
import sql from 'mssql';
import type { ConnectionPool } from 'mssql';
import { getPool } from '../../database/pool.js';
import { getKysely, getPgPool } from '../../database/kysely.js';
import { log } from '../../../utils/logger.js';
import type { SyncSink } from './types.js';

const TP = 'tblTimePoints';
const TPI = 'tblTimePointImages';

/**
 * Parse a PG `date`/`timestamp` value (arrives as a 'YYYY-MM-DD…' string per kysely.ts parsers) to
 * a LOCAL-midnight Date for binding as sql.DateTime — the pool runs useUTC:false, so a local Date
 * stores its wall-clock value with no UTC shift. Mirrors photo-editor.routes.ts#parseLocalDate.
 */
function parseLocalDate(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export class DolphinSink implements SyncSink {
  readonly name = 'dolphin';
  private pool: ConnectionPool | null = null;
  /** PersonID → Dolphin patID GUID. Reset on init. Bounded by distinct patients with photo edits. */
  private patIdByPerson = new Map<number, string>();
  /** ImageTypeCode → Dolphin itypID GUID. Reset on init. Bounded by the 34 image types. */
  private itypByCode = new Map<string, string>();

  async init(): Promise<void> {
    this.pool = await getPool(); // ShwanNew; Dolphin reached via DolphinPlatform.dbo.* three-part names
    this.patIdByPerson.clear();
    this.itypByCode.clear();
  }

  async close(): Promise<void> {
    // The mssql pool is owned by ResourceManager (closed on graceful shutdown). Just drop caches.
    this.pool = null;
    this.patIdByPerson.clear();
    this.itypByCode.clear();
  }

  async upsert(localTable: string, pk: string): Promise<void> {
    if (localTable === TP) return this.upsertTimePoint(pk);
    if (localTable === TPI) return this.upsertImage(pk);
    // Only the two timepoint tables feed this sink; anything else is a no-op.
  }

  async remove(localTable: string, pk: string): Promise<void> {
    if (localTable === TP) return this.removeTimePoint(pk);
    if (localTable === TPI) return this.removeImage(pk);
  }

  // ───────────────────────────── dolphin_sync_map (raw pg — table is not in the kysely schema) ────

  private async mapGet(localTable: string, localPk: string | number): Promise<string | undefined> {
    const { rows } = await getPgPool().query<{ dolphin_id: string }>(
      'SELECT dolphin_id::text AS dolphin_id FROM dolphin_sync_map WHERE local_table = $1 AND local_pk = $2',
      [localTable, String(localPk)]
    );
    return rows[0]?.dolphin_id;
  }

  private async mapSet(localTable: string, localPk: string | number, dolphinId: string): Promise<void> {
    await getPgPool().query(
      `INSERT INTO dolphin_sync_map (local_table, local_pk, dolphin_id) VALUES ($1, $2, $3)
         ON CONFLICT (local_table, local_pk) DO UPDATE SET dolphin_id = EXCLUDED.dolphin_id`,
      [localTable, String(localPk), dolphinId]
    );
  }

  private async mapDelete(localTable: string, localPk: string | number): Promise<void> {
    await getPgPool().query('DELETE FROM dolphin_sync_map WHERE local_table = $1 AND local_pk = $2', [
      localTable,
      String(localPk),
    ]);
  }

  // ───────────────────────────── resolvers (Dolphin patient / image-type GUIDs) ───────────────────

  /** Resolve the Dolphin patID for our PersonID; create the Dolphin patient from tblpatients if absent. */
  private async resolvePatId(personId: number): Promise<string> {
    const cached = this.patIdByPerson.get(personId);
    if (cached) return cached;
    const pool = this.pool!;

    // patOtherID holds our PersonID (verified: stored as the plain integer as text).
    const found = await pool
      .request()
      .input('oid', sql.VarChar, String(personId))
      .query<{ patID: string }>('SELECT patID FROM DolphinPlatform.dbo.Patients WHERE patOtherID = @oid');
    if (found.recordset.length > 0) {
      const id = found.recordset[0].patID;
      this.patIdByPerson.set(personId, id);
      return id;
    }

    const p = await getKysely()
      .selectFrom('tblpatients')
      .select((eb) => [
        'FirstName',
        'LastName',
        'PatientName',
        'Gender',
        eb.ref('DateofBirth').$castTo<string | null>().as('DateofBirth'),
      ])
      .where('PersonID', '=', personId)
      .executeTakeFirst();
    if (!p) throw new Error(`[cdc:dolphin] PersonID ${personId} not found in tblpatients`);

    const gender = p.Gender === 1 ? 'M' : p.Gender === 2 ? 'F' : 'U'; // tblGender: 1=Male, 2=Female
    const ins = await pool
      .request()
      .input('oid', sql.VarChar, String(personId))
      .input('fn', sql.VarChar, p.FirstName ?? null)
      .input('ln', sql.VarChar, p.LastName ?? null)
      .input('nm', sql.VarChar, p.PatientName ?? null)
      .input('g', sql.Char, gender)
      .input('bd', sql.DateTime, parseLocalDate(p.DateofBirth))
      .query<{ patID: string }>(
        `INSERT INTO DolphinPlatform.dbo.Patients
           (patOtherID, patFirstName, patLastName, patName, patGender, patBirthdate, patStatus)
         OUTPUT inserted.patID
         VALUES (@oid, @fn, @ln, @nm, @g, @bd, 1)`
      );
    const id = ins.recordset[0].patID;
    this.patIdByPerson.set(personId, id);
    log.info('[cdc:dolphin] created Dolphin patient', { personId, patID: id });
    return id;
  }

  /** Resolve the Dolphin itypID for a 2-digit ImageType code via the local tblImageTypes.DolphinItypID. */
  private async resolveItyp(imageType: string | null): Promise<string | null> {
    if (!imageType) return null;
    const cached = this.itypByCode.get(imageType);
    if (cached) return cached;
    const row = await getKysely()
      .selectFrom('tblImageTypes')
      .select('DolphinItypID')
      .where('ImageTypeCode', '=', imageType)
      .executeTakeFirst();
    const id = row?.DolphinItypID ?? null;
    if (id) this.itypByCode.set(imageType, id);
    return id;
  }

  // ───────────────────────────── tblTimePoints ────────────────────────────────────────────────────

  private async upsertTimePoint(pk: string): Promise<void> {
    const tp = await getKysely()
      .selectFrom('tblTimePoints')
      .select((eb) => [
        'PersonID',
        'tpDescription',
        eb.ref('tpDateTime').$castTo<string | null>().as('tpDateTime'),
      ])
      .where('TimePointID', '=', Number(pk))
      .executeTakeFirst();
    if (!tp) {
      await this.removeTimePoint(pk);
      return;
    }

    const patId = await this.resolvePatId(tp.PersonID);
    const tpId = await this.resolveTpId(pk, patId, tp.tpDescription, tp.tpDateTime);

    // Always normalise name/date (covers in-app edits of the timepoint's description/date).
    await this.pool!.request()
      .input('tpid', sql.UniqueIdentifier, tpId)
      .input('desc', sql.VarChar, tp.tpDescription ?? null)
      .input('dt', sql.DateTime, parseLocalDate(tp.tpDateTime))
      .query('UPDATE DolphinPlatform.dbo.TimePoints SET tpDescription = @desc, tpDateTime = @dt WHERE tpID = @tpid');
  }

  /**
   * Resolve the Dolphin tpID for a local timepoint: mapped → adopt an existing Dolphin row by
   * natural key (patID, tpDescription, date) → else INSERT a new one with the next per-patient
   * tpCode. Persists the result in dolphin_sync_map.
   */
  private async resolveTpId(
    localPk: string,
    patId: string,
    tpDescription: string | null,
    tpDateTime: string | null
  ): Promise<string> {
    const mapped = await this.mapGet(TP, localPk);
    if (mapped) return mapped;

    const pool = this.pool!;
    const date = parseLocalDate(tpDateTime);

    // Adopt an existing Dolphin timepoint by natural key (don't duplicate the ~3.4k already there).
    const found = await pool
      .request()
      .input('pat', sql.UniqueIdentifier, patId)
      .input('desc', sql.VarChar, tpDescription ?? null)
      .input('dt', sql.DateTime, date)
      .query<{ tpID: string }>(
        `SELECT TOP 1 tpID FROM DolphinPlatform.dbo.TimePoints
          WHERE patID = @pat AND tpDescription = @desc AND CAST(tpDateTime AS date) = CAST(@dt AS date)
          ORDER BY tpCreatedDate`
      );
    if (found.recordset.length > 0) {
      const id = found.recordset[0].tpID;
      await this.mapSet(TP, localPk, id);
      return id;
    }

    // Else INSERT. Dolphin tpCode is a per-patient varchar sequence (independent of our PG tpCode);
    // TRY_CAST so a non-numeric legacy tpCode can't throw (treated as no max → starts the run at 1).
    const ins = await pool
      .request()
      .input('pat', sql.UniqueIdentifier, patId)
      .input('desc', sql.VarChar, tpDescription ?? null)
      .input('dt', sql.DateTime, date)
      .query<{ tpID: string }>(
        `DECLARE @code int =
           COALESCE((SELECT MAX(TRY_CAST(tpCode AS int)) FROM DolphinPlatform.dbo.TimePoints WHERE patID = @pat), 0) + 1;
         INSERT INTO DolphinPlatform.dbo.TimePoints (patID, tpCode, tpDescription, tpDateTime)
         OUTPUT inserted.tpID
         VALUES (@pat, CAST(@code AS varchar(12)), @desc, @dt);`
      );
    const id = ins.recordset[0].tpID;
    await this.mapSet(TP, localPk, id);
    log.info('[cdc:dolphin] created Dolphin timepoint', { localTimePointId: localPk, tpID: id });
    return id;
  }

  private async removeTimePoint(pk: string): Promise<void> {
    const tpId = await this.mapGet(TP, pk);
    if (!tpId) return; // unmapped — nothing to do (idempotent)
    const pool = this.pool!;

    // CASCADE policy: drop the whole Dolphin timepoint and ALL its images (incl. any Dolphin-owned
    // x-rays/ceph/scans sharing this tpID). Capture the deleted image GUIDs to clear their map rows.
    const del = await pool
      .request()
      .input('tp', sql.UniqueIdentifier, tpId)
      .query<{ tpiID: string }>(
        'DELETE FROM DolphinPlatform.dbo.TimePointImages OUTPUT deleted.tpiID WHERE tpID = @tp'
      );
    await pool
      .request()
      .input('tp', sql.UniqueIdentifier, tpId)
      .query('DELETE FROM DolphinPlatform.dbo.TimePoints WHERE tpID = @tp');

    await this.mapDelete(TP, pk);
    // Clear image map rows that pointed at the cascaded images. (The local FK-cascade also emits a
    // 'D' per image → removeImage would clear these too, but doing it here is self-contained.)
    const guids = del.recordset.map((r) => r.tpiID);
    if (guids.length > 0) {
      await getPgPool().query('DELETE FROM dolphin_sync_map WHERE local_table = $1 AND dolphin_id = ANY($2::uuid[])', [
        TPI,
        guids,
      ]);
    }
    log.info('[cdc:dolphin] deleted Dolphin timepoint (cascade)', { localTimePointId: pk, tpID: tpId, images: guids.length });
  }

  // ───────────────────────────── tblTimePointImages ───────────────────────────────────────────────

  private async upsertImage(pk: string): Promise<void> {
    const img = await getKysely()
      .selectFrom('tblTimePointImages')
      .select((eb) => [
        'TimePointID',
        'PersonID',
        'ImageType',
        'ImageFile',
        'Title',
        eb.ref('ImageDate').$castTo<string | null>().as('ImageDate'),
      ])
      .where('TimePointImageID', '=', Number(pk))
      .executeTakeFirst();
    if (!img) {
      await this.removeImage(pk);
      return;
    }

    const patId = await this.resolvePatId(img.PersonID);

    // Ensure the parent timepoint exists in Dolphin (the image's 'I' event may drain before its
    // parent's). Bootstrap it via upsertTimePoint, mirroring PortalSink.ensureRelatedRecordsExist.
    let tpId = await this.mapGet(TP, img.TimePointID);
    if (!tpId) {
      await this.upsertTimePoint(String(img.TimePointID));
      tpId = await this.mapGet(TP, img.TimePointID);
    }
    if (!tpId) throw new Error(`[cdc:dolphin] could not resolve parent timepoint ${img.TimePointID} for image ${pk}`);

    const itypId = await this.resolveItyp(img.ImageType); // may be null — Dolphin allows NULL itypID
    const imageDate = parseLocalDate(img.ImageDate);
    const tpiId = await this.resolveTpiId(pk, patId, tpId, img.ImageType, img.ImageFile, imageDate, itypId);

    // Always normalise to current values (covers re-crop of the same slot, and adopted Dolphin rows).
    await this.pool!.request()
      .input('tpiid', sql.UniqueIdentifier, tpiId)
      .input('file', sql.VarChar, img.ImageFile ?? null)
      .input('dt', sql.DateTime, imageDate)
      .input('title', sql.VarChar, img.Title ?? null)
      .input('ityp', sql.UniqueIdentifier, itypId)
      .query(
        `UPDATE DolphinPlatform.dbo.TimePointImages
            SET tpiImageFile = @file, tpiImageDate = @dt, tpiTitle = @title, itypID = @ityp
          WHERE tpiID = @tpiid`
      );
  }

  /**
   * Resolve the Dolphin tpiID for a local image row: mapped → adopt an existing Dolphin image by
   * (tpID, tpiImageType) → else INSERT. Persists the result in dolphin_sync_map. The caller's
   * follow-up UPDATE normalises file/date/title/itypID, so this only has to guarantee the row exists.
   */
  private async resolveTpiId(
    localPk: string,
    patId: string,
    tpId: string,
    imageType: string | null,
    imageFile: string | null,
    imageDate: Date | null,
    itypId: string | null
  ): Promise<string> {
    const mapped = await this.mapGet(TPI, localPk);
    if (mapped) return mapped;

    const pool = this.pool!;
    // Adopt an existing Dolphin image for this view (don't duplicate an existing slot).
    const found = await pool
      .request()
      .input('tp', sql.UniqueIdentifier, tpId)
      .input('typ', sql.Char, imageType ?? null)
      .query<{ tpiID: string }>(
        `SELECT TOP 1 tpiID FROM DolphinPlatform.dbo.TimePointImages
          WHERE tpID = @tp AND tpiImageType = @typ
          ORDER BY tpiImageDate`
      );
    if (found.recordset.length > 0) {
      const id = found.recordset[0].tpiID;
      await this.mapSet(TPI, localPk, id);
      return id;
    }

    const ins = await pool
      .request()
      .input('pat', sql.UniqueIdentifier, patId)
      .input('tp', sql.UniqueIdentifier, tpId)
      .input('ityp', sql.UniqueIdentifier, itypId)
      .input('file', sql.VarChar, imageFile ?? null)
      .input('typ', sql.Char, imageType ?? null)
      .input('dt', sql.DateTime, imageDate)
      .query<{ tpiID: string }>(
        `INSERT INTO DolphinPlatform.dbo.TimePointImages
           (patID, tpID, itypID, tpiImageFile, tpiImageType, tpiImageDate)
         OUTPUT inserted.tpiID
         VALUES (@pat, @tp, @ityp, @file, @typ, @dt)`
      );
    const id = ins.recordset[0].tpiID;
    await this.mapSet(TPI, localPk, id);
    return id;
  }

  private async removeImage(pk: string): Promise<void> {
    const tpiId = await this.mapGet(TPI, pk);
    if (!tpiId) return; // unmapped (or already cascaded by a parent timepoint delete) — no-op
    await this.pool!.request()
      .input('id', sql.UniqueIdentifier, tpiId)
      .query('DELETE FROM DolphinPlatform.dbo.TimePointImages WHERE tpiID = @id');
    await this.mapDelete(TPI, pk);
  }
}
