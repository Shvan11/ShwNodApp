/**
 * Visit and wire-related database queries (PostgreSQL / Kysely).
 *
 * Phase 5: the six stored-proc-backed functions (ProVisitSum / ProlatestVisitSum / proAddVisit /
 * proGetVisitSum / proGetLatestWire) are reimplemented as typed Kysely queries — the HTML visit
 * "Summary" the procs concatenated is now built in TS (`buildVisitSummary`). The three SQL Server
 * triggers on `tblvisits` (PhotoInsert / MyTrigger / PhotoDelete) maintained the parent
 * `tblwork`'s IPhotoDate / FPhotoDate / DebondDate / Status from a visit's photo flags; PG has no
 * triggers, so that logic is folded into every visit write path here (`applyPhoto*`), each wrapped
 * in one transaction so the visit row and the work roll-up commit atomically — matching the
 * original AFTER-trigger semantics.
 */
import type { Transaction } from 'kysely';
import { getKysely, withPgTransaction, type Database } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';
import { getActiveWID } from './patient-queries.js';

// Type definitions
interface VisitSummary {
  PatientName: string;
  WorkID: number;
  ID: number;
  VisitDate: Date;
  OPG: boolean;
  IPhoto: boolean;
  FPhoto: boolean;
  PPhoto: boolean;
  ApplianceRemoved: boolean;
  Summary: string | null;
}

interface LatestVisitSummary {
  VisitDate: Date;
  Summary: string | null;
}

interface Wire {
  id: number;
  name: string;
}

interface LatestWire {
  upperWireID: number | null;
  lowerWireID: number | null;
}

interface LatestWireDetails {
  UpperWireID: number | null;
  UpperWireName: string | null;
  LowerWireID: number | null;
  LowerWireName: string | null;
}

interface VisitDetails {
  visitDate: Date;
  upperWireID: number | null;
  lowerWireID: number | null;
  others: string | null;
  next: string | null;
}

interface Visit {
  ID: number;
  WorkID: number;
  VisitDate: Date;
  BracketChange: string | null;
  WireBending: string | null;
  OPG: boolean;
  Others: string | null;
  NextVisit: string | null;
  Elastics: string | null;
  UpperWireID: number | null;
  LowerWireID: number | null;
  PPhoto: boolean;
  IPhoto: boolean;
  FPhoto: boolean;
  ApplianceRemoved: boolean;
  OperatorID: number | null;
  UpperWireName: string | null;
  LowerWireName: string | null;
  OperatorName: string | null;
}

interface VisitData {
  WorkID: number;
  VisitDate: Date;
  BracketChange?: string;
  WireBending?: string;
  OPG?: boolean;
  Others?: string;
  NextVisit?: string;
  Elastics?: string;
  UpperWireID?: number;
  LowerWireID?: number;
  PPhoto?: boolean;
  IPhoto?: boolean;
  FPhoto?: boolean;
  ApplianceRemoved?: boolean;
  OperatorID?: number;
}

// The three photo flags whose state drives tblwork's photo-date / status roll-up.
interface PhotoFlags {
  IPhoto: boolean;
  FPhoto: boolean;
  ApplianceRemoved: boolean;
}

/** SQL `REPLACE(x, CHAR(13)+CHAR(10), '<BR> ')` — newline → HTML break. */
function nl2br(s: string): string {
  return s.replace(/\r\n/g, '<BR> ');
}

/**
 * Build the HTML visit summary the old ProVisitSum / ProlatestVisitSum procs produced via a chain
 * of `ISNULL('label: ' + col + '<br> ', '')`. Each segment is emitted only when its column is
 * non-NULL (SQL `'str' + NULL = NULL` → `ISNULL` → '') — preserved here with `!= null`.
 */
function buildVisitSummary(v: {
  UpperWireName: string | null;
  LowerWireName: string | null;
  BracketChange: string | null;
  WireBending: string | null;
  Elastics: string | null;
  Others: string | null;
  NextVisit: string | null;
}): string {
  let s = '';
  if (v.UpperWireName != null) s += `Upper Wire: ${v.UpperWireName}<br> `;
  if (v.LowerWireName != null) s += `Lower Wire: ${v.LowerWireName}<br> `;
  if (v.BracketChange != null) s += `Bracket change for: ${v.BracketChange}<br> `;
  if (v.WireBending != null) s += `Wire Bending for: ${v.WireBending}<br> `;
  if (v.Elastics != null) s += `${v.Elastics}<br> `;
  if (v.Others != null) s += `${nl2br(v.Others)}<br> `;
  if (v.NextVisit != null) s += `<font color=blue>Next: ${nl2br(v.NextVisit)}</font>`;
  return s;
}

/**
 * Set the work's FPhotoDate + mark it finished (Status=2). Folds in trigPTypeandFinished:
 * when FPhotoDate transitions from NULL to a value, also delete the patient's carried wires and,
 * for orthodontic work (Typeofwork=1), set the patient type to 2 (finished ortho).
 */
async function markWorkFinished(trx: Transaction<Database>, workId: number, visitDate: string): Promise<void> {
  const w = await trx
    .selectFrom('tblwork')
    .select(['FPhotoDate', 'PersonID', 'Typeofwork'])
    .where('workid', '=', workId)
    .executeTakeFirst();
  const wasNull = !w?.FPhotoDate;
  await trx.updateTable('tblwork').set({ FPhotoDate: visitDate, Status: 2 }).where('workid', '=', workId).execute();
  if (wasNull && w) {
    await trx.deleteFrom('tblCarriedWires').where('PersonID', '=', w.PersonID).execute();
    if (w.Typeofwork === 1) {
      await trx.updateTable('tblpatients').set({ PatientTypeID: 2 }).where('PersonID', '=', w.PersonID).execute();
    }
  }
}

// ── tblwork photo roll-up (replaces the PhotoInsert / MyTrigger / PhotoDelete triggers) ──

/** AFTER INSERT (PhotoInsert): a newly-set flag stamps the parent work's matching date. */
async function applyPhotoInsert(
  trx: Transaction<Database>,
  workId: number,
  visitDate: string,
  f: PhotoFlags
): Promise<void> {
  if (f.IPhoto) await trx.updateTable('tblwork').set({ IPhotoDate: visitDate }).where('workid', '=', workId).execute();
  if (f.FPhoto) await markWorkFinished(trx, workId, visitDate);
  if (f.ApplianceRemoved) await trx.updateTable('tblwork').set({ DebondDate: visitDate }).where('workid', '=', workId).execute();
}

/** AFTER UPDATE (MyTrigger): only a *changed* flag adjusts the work; set→date, clear→NULL. */
async function applyPhotoUpdate(
  trx: Transaction<Database>,
  workId: number,
  visitDate: string,
  oldF: PhotoFlags,
  newF: PhotoFlags
): Promise<void> {
  if (!oldF.IPhoto && newF.IPhoto) {
    await trx.updateTable('tblwork').set({ IPhotoDate: visitDate }).where('workid', '=', workId).execute();
  } else if (oldF.IPhoto && !newF.IPhoto) {
    await trx.updateTable('tblwork').set({ IPhotoDate: null }).where('workid', '=', workId).execute();
  }
  if (!oldF.FPhoto && newF.FPhoto) {
    await markWorkFinished(trx, workId, visitDate);
  } else if (oldF.FPhoto && !newF.FPhoto) {
    await trx.updateTable('tblwork').set({ FPhotoDate: null, Status: 1 }).where('workid', '=', workId).execute();
  }
  if (!oldF.ApplianceRemoved && newF.ApplianceRemoved) {
    await trx.updateTable('tblwork').set({ DebondDate: visitDate }).where('workid', '=', workId).execute();
  } else if (oldF.ApplianceRemoved && !newF.ApplianceRemoved) {
    await trx.updateTable('tblwork').set({ DebondDate: null }).where('workid', '=', workId).execute();
  }
}

/** AFTER DELETE (PhotoDelete): a flag that was set on the removed visit clears the work's date. */
async function applyPhotoDelete(
  trx: Transaction<Database>,
  workId: number,
  f: PhotoFlags
): Promise<void> {
  if (f.IPhoto) await trx.updateTable('tblwork').set({ IPhotoDate: null }).where('workid', '=', workId).execute();
  if (f.FPhoto) await trx.updateTable('tblwork').set({ FPhotoDate: null, Status: 1 }).where('workid', '=', workId).execute();
  if (f.ApplianceRemoved) await trx.updateTable('tblwork').set({ DebondDate: null }).where('workid', '=', workId).execute();
}

/**
 * Resolve which work a patient-level visit summary should display. Prefer the active
 * treatment (Status=1); when the patient has none (finished/discontinued), fall back to
 * their most recent work so visit history stays visible. The original ProVisitSum took
 * an explicit WorkID and was never active-only — scoping strictly to getActiveWID hid
 * the entire history of every patient whose treatment was already complete.
 */
async function resolveSummaryWID(PID: number): Promise<number | null> {
  const active = await getActiveWID(PID);
  if (active != null) return active;
  const row = await getKysely()
    .selectFrom('tblwork')
    .select('workid')
    .where('PersonID', '=', PID)
    // workid is identity (monotonic with creation) → highest = most recent work.
    .orderBy('workid', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.workid ?? null;
}

/**
 * Retrieves visit summaries for a given patient ID. (was: ProVisitSum)
 */
export async function getVisitsSummary(PID: number): Promise<VisitSummary[]> {
  const WID = await resolveSummaryWID(PID);
  if (WID == null) return [];
  const rows = await getKysely()
    .selectFrom('tblvisits as v')
    .innerJoin('tblwork as w', 'w.workid', 'v.WorkID')
    .innerJoin('tblpatients as p', 'p.PersonID', 'w.PersonID')
    .leftJoin('tblWires as uw', 'uw.Wire_ID', 'v.UpperWireID')
    .leftJoin('tblWires as lw', 'lw.Wire_ID', 'v.LowerWireID')
    .where('v.WorkID', '=', WID)
    .orderBy('v.VisitDate')
    .select([
      'p.PatientName', 'v.WorkID', 'v.ID', 'v.VisitDate', 'v.OPG', 'v.IPhoto', 'v.FPhoto',
      'v.PPhoto', 'v.ApplianceRemoved', 'v.BracketChange', 'v.WireBending', 'v.Elastics',
      'v.Others', 'v.NextVisit', 'uw.Wire as UpperWireName', 'lw.Wire as LowerWireName',
    ])
    .execute();

  return rows.map((r) => ({
    PatientName: r.PatientName,
    WorkID: r.WorkID,
    ID: r.ID,
    VisitDate: r.VisitDate as unknown as Date, // PG `date` → 'YYYY-MM-DD' string at runtime
    OPG: r.OPG ?? false,
    IPhoto: r.IPhoto ?? false,
    FPhoto: r.FPhoto ?? false,
    PPhoto: r.PPhoto ?? false,
    ApplianceRemoved: r.ApplianceRemoved ?? false,
    Summary: buildVisitSummary(r),
  }));
}

/**
 * Retrieves the latest visit summary for a given patient ID. (was: ProlatestVisitSum)
 */
export async function getLatestVisitsSum(PID: number): Promise<LatestVisitSummary | undefined> {
  const WID = await getActiveWID(PID);
  if (WID == null) return undefined;
  const row = await getKysely()
    .selectFrom('tblvisits as v')
    .leftJoin('tblWires as uw', 'uw.Wire_ID', 'v.UpperWireID')
    .leftJoin('tblWires as lw', 'lw.Wire_ID', 'v.LowerWireID')
    .where('v.WorkID', '=', WID)
    .orderBy('v.VisitDate', 'desc')
    .select([
      'v.VisitDate', 'v.BracketChange', 'v.WireBending', 'v.Elastics', 'v.Others', 'v.NextVisit',
      'uw.Wire as UpperWireName', 'lw.Wire as LowerWireName',
    ])
    .limit(1)
    .executeTakeFirst();

  if (!row) return undefined;
  return { VisitDate: row.VisitDate as unknown as Date, Summary: buildVisitSummary(row) };
}

/**
 * Adds a new visit for a given patient ID. (was: proAddVisit — inserts no photo flags, so no
 * tblwork roll-up is needed.)
 */
export async function addVisit(
  PID: number,
  visitDate: Date,
  upperWireID: number,
  lowerWireID: number,
  others: string,
  next: string
): Promise<boolean> {
  const WID = await getActiveWID(PID);
  if (WID == null) throw new Error('addVisit: patient has no active work');
  await getKysely()
    .insertInto('tblvisits')
    .values({
      WorkID: WID,
      VisitDate: toDateOnly(visitDate),
      UpperWireID: upperWireID,
      LowerWireID: lowerWireID,
      Others: others,
      NextVisit: next,
    })
    .execute();
  return true;
}

/**
 * Retrieves visit details by visit ID. (was: proGetVisitSum)
 */
export async function getVisitDetailsByID(VID: number): Promise<VisitDetails | undefined> {
  const row = await getKysely()
    .selectFrom('tblvisits')
    .where('ID', '=', VID)
    .select(['VisitDate', 'UpperWireID', 'LowerWireID', 'Others', 'NextVisit'])
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    visitDate: row.VisitDate as unknown as Date,
    upperWireID: row.UpperWireID,
    lowerWireID: row.LowerWireID,
    others: row.Others,
    next: row.NextVisit,
  };
}

/**
 * Updates a visit by visit ID. (does not touch photo flags → no tblwork roll-up, matching the
 * old MyTrigger which fired only on a flag change.)
 */
export async function updateVisit(
  VID: number,
  visitDate: Date,
  upperWireID: number,
  lowerWireID: number,
  others: string,
  next: string
): Promise<{ success: boolean }> {
  await getKysely()
    .updateTable('tblvisits')
    .set({
      VisitDate: toDateOnly(visitDate),
      UpperWireID: upperWireID,
      LowerWireID: lowerWireID,
      Others: others,
      NextVisit: next,
    })
    .where('ID', '=', VID)
    .execute();
  return { success: true };
}

/**
 * Deletes a visit by visit ID (+ PhotoDelete roll-up).
 */
export async function deleteVisit(VID: number): Promise<{ success: boolean }> {
  await withPgTransaction(async (trx) => {
    const existing = await trx
      .selectFrom('tblvisits')
      .where('ID', '=', VID)
      .select(['WorkID', 'IPhoto', 'FPhoto', 'ApplianceRemoved'])
      .executeTakeFirst();
    await trx.deleteFrom('tblvisits').where('ID', '=', VID).execute();
    if (existing) {
      await applyPhotoDelete(trx, existing.WorkID, {
        IPhoto: existing.IPhoto ?? false,
        FPhoto: existing.FPhoto ?? false,
        ApplianceRemoved: existing.ApplianceRemoved ?? false,
      });
    }
  });
  return { success: true };
}

/**
 * Retrieves available wires.
 */
export function getWires(): Promise<Wire[]> {
  return getKysely()
    .selectFrom('tblWires')
    .select(['Wire_ID as id', 'Wire as name'])
    .orderBy('Wire')
    .execute() as Promise<Wire[]>;
}

/**
 * Retrieves the latest wire IDs for a given patient ID. (was: proGetLatestWire)
 */
export async function getLatestWire(PID: number): Promise<LatestWire | null> {
  const WID = await getActiveWID(PID);
  if (WID == null) return null;
  const row = await getKysely()
    .selectFrom('tblvisits')
    .where('WorkID', '=', WID)
    .orderBy('VisitDate', 'desc')
    .select(['UpperWireID', 'LowerWireID'])
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  return { upperWireID: row.UpperWireID, lowerWireID: row.LowerWireID };
}

/**
 * Retrieves the latest wire details (ID and name) for a given work ID.
 */
export async function getLatestWiresByWorkId(workId: number): Promise<LatestWireDetails> {
  // qryLastUwire/qryLastLwire both hang off V_lastvisit (the work's MAX(VisitDate)),
  // so for one work this collapses to: the wire IDs/names on its most recent visit.
  const row = await getKysely()
    .selectFrom('tblvisits as v')
    .leftJoin('tblWires as uw', 'uw.Wire_ID', 'v.UpperWireID')
    .leftJoin('tblWires as lw', 'lw.Wire_ID', 'v.LowerWireID')
    .where('v.WorkID', '=', workId)
    .orderBy('v.VisitDate', 'desc')
    .select([
      'v.UpperWireID as UpperWireID',
      'uw.Wire as UpperWireName',
      'v.LowerWireID as LowerWireID',
      'lw.Wire as LowerWireName',
    ])
    .limit(1)
    .executeTakeFirst();

  return row ?? { UpperWireID: null, UpperWireName: null, LowerWireID: null, LowerWireName: null };
}

/**
 * Retrieves all visits for a specific work ID (not dependent on active work).
 */
export async function getVisitsByWorkId(workId: number): Promise<Visit[]> {
  return getKysely()
    .selectFrom('tblvisits as v')
    .leftJoin('tblWires as uw', 'uw.Wire_ID', 'v.UpperWireID')
    .leftJoin('tblWires as lw', 'lw.Wire_ID', 'v.LowerWireID')
    .leftJoin('tblEmployees as e', 'e.ID', 'v.OperatorID')
    .where('v.WorkID', '=', workId)
    .orderBy('v.VisitDate')
    .select([
      'v.ID', 'v.WorkID', 'v.VisitDate', 'v.BracketChange', 'v.WireBending', 'v.OPG',
      'v.Others', 'v.NextVisit', 'v.Elastics', 'v.UpperWireID', 'v.LowerWireID', 'v.PPhoto',
      'v.IPhoto', 'v.FPhoto', 'v.ApplianceRemoved', 'v.OperatorID',
      'uw.Wire as UpperWireName', 'lw.Wire as LowerWireName', 'e.employeeName as OperatorName',
    ])
    .execute() as Promise<Visit[]>;
}

/**
 * Retrieves a single visit by visit ID.
 */
export async function getVisitById(visitId: number): Promise<Visit | null> {
  const row = await getKysely()
    .selectFrom('tblvisits as v')
    .leftJoin('tblWires as uw', 'uw.Wire_ID', 'v.UpperWireID')
    .leftJoin('tblWires as lw', 'lw.Wire_ID', 'v.LowerWireID')
    .leftJoin('tblEmployees as e', 'e.ID', 'v.OperatorID')
    .where('v.ID', '=', visitId)
    .select([
      'v.ID', 'v.WorkID', 'v.VisitDate', 'v.BracketChange', 'v.WireBending', 'v.OPG',
      'v.Others', 'v.NextVisit', 'v.Elastics', 'v.UpperWireID', 'v.LowerWireID', 'v.PPhoto',
      'v.IPhoto', 'v.FPhoto', 'v.ApplianceRemoved', 'v.OperatorID',
      'uw.Wire as UpperWireName', 'lw.Wire as LowerWireName', 'e.employeeName as OperatorName',
    ])
    .executeTakeFirst();
  return (row as Visit | undefined) ?? null;
}

/**
 * Adds a new visit with workId directly (+ PhotoInsert roll-up).
 */
export async function addVisitByWorkId(visitData: VisitData): Promise<{ ID: number } | null> {
  const visitDate = toDateOnly(visitData.VisitDate);
  const flags: PhotoFlags = {
    IPhoto: visitData.IPhoto ?? false,
    FPhoto: visitData.FPhoto ?? false,
    ApplianceRemoved: visitData.ApplianceRemoved ?? false,
  };
  return withPgTransaction(async (trx) => {
    const row = await trx
      .insertInto('tblvisits')
      .values({
        WorkID: visitData.WorkID,
        VisitDate: visitDate,
        BracketChange: visitData.BracketChange || null,
        WireBending: visitData.WireBending || null,
        OPG: visitData.OPG ?? false,
        Others: visitData.Others || null,
        NextVisit: visitData.NextVisit || null,
        Elastics: visitData.Elastics || null,
        UpperWireID: visitData.UpperWireID || null,
        LowerWireID: visitData.LowerWireID || null,
        PPhoto: visitData.PPhoto ?? false,
        IPhoto: flags.IPhoto,
        FPhoto: flags.FPhoto,
        ApplianceRemoved: flags.ApplianceRemoved,
        OperatorID: visitData.OperatorID || null,
      })
      .returning('ID')
      .executeTakeFirst();
    if (!row) return null;
    await applyPhotoInsert(trx, visitData.WorkID, visitDate, flags);
    return row;
  });
}

/**
 * Updates a visit by visit ID (+ MyTrigger roll-up for changed photo flags).
 */
export async function updateVisitByWorkId(
  visitId: number,
  visitData: Omit<VisitData, 'WorkID'>
): Promise<{ success: boolean }> {
  const visitDate = toDateOnly(visitData.VisitDate);
  const newF: PhotoFlags = {
    IPhoto: visitData.IPhoto ?? false,
    FPhoto: visitData.FPhoto ?? false,
    ApplianceRemoved: visitData.ApplianceRemoved ?? false,
  };
  await withPgTransaction(async (trx) => {
    const existing = await trx
      .selectFrom('tblvisits')
      .where('ID', '=', visitId)
      .select(['WorkID', 'IPhoto', 'FPhoto', 'ApplianceRemoved'])
      .executeTakeFirst();
    await trx
      .updateTable('tblvisits')
      .set({
        VisitDate: visitDate,
        BracketChange: visitData.BracketChange || null,
        WireBending: visitData.WireBending || null,
        OPG: visitData.OPG ?? false,
        Others: visitData.Others || null,
        NextVisit: visitData.NextVisit || null,
        Elastics: visitData.Elastics || null,
        UpperWireID: visitData.UpperWireID || null,
        LowerWireID: visitData.LowerWireID || null,
        PPhoto: visitData.PPhoto ?? false,
        IPhoto: newF.IPhoto,
        FPhoto: newF.FPhoto,
        ApplianceRemoved: newF.ApplianceRemoved,
        OperatorID: visitData.OperatorID || null,
      })
      .where('ID', '=', visitId)
      .execute();
    if (existing) {
      await applyPhotoUpdate(trx, existing.WorkID, visitDate, {
        IPhoto: existing.IPhoto ?? false,
        FPhoto: existing.FPhoto ?? false,
        ApplianceRemoved: existing.ApplianceRemoved ?? false,
      }, newF);
    }
  });
  return { success: true };
}

/**
 * Deletes a visit by visit ID (+ PhotoDelete roll-up).
 */
export async function deleteVisitByWorkId(visitId: number): Promise<{ success: boolean }> {
  return deleteVisit(visitId);
}
