/**
 * Visit and wire-related database queries (PostgreSQL / Kysely).
 *
 * Phase 5: the six stored-proc-backed functions (ProVisitSum / ProlatestVisitSum / proAddVisit /
 * proGetVisitSum / proGetLatestWire) are reimplemented as typed Kysely queries — the HTML visit
 * "Summary" the procs concatenated is now built in TS (`buildVisitSummary`). The three SQL Server
 * triggers on `tblvisits` (PhotoInsert / MyTrigger / PhotoDelete) maintained the parent
 * `tblwork`'s i_photo_date / f_photo_date / debond_date / status from a visit's photo flags; PG has no
 * triggers, so that logic is folded into every visit write path here (`applyPhoto*`), each wrapped
 * in one transaction so the visit row and the work roll-up commit atomically — matching the
 * original AFTER-trigger semantics.
 */
import type { Transaction } from 'kysely';
import { getKysely, withPgTransaction, type Database } from '../kysely.js';
import { toDateOnly } from '../../../utils/date.js';
import { getActiveWID } from './patient-queries.js';
import { recomputePatientType, recomputePatientTypeForWork } from './patient-type-classifier.js';

// type definitions
interface VisitSummary {
  patient_name: string;
  work_id: number;
  id: number;
  visit_date: string;
  opg: boolean;
  i_photo: boolean;
  f_photo: boolean;
  p_photo: boolean;
  appliance_removed: boolean;
  Summary: string | null;
}

interface LatestVisitSummary {
  visit_date: string;
  Summary: string | null;
}

type wire = {
  id: number;
  name: string;
};

type LatestWireDetails = {
  upper_wire_id: number | null;
  UpperWireName: string | null;
  lower_wire_id: number | null;
  LowerWireName: string | null;
};


type Visit = {
  id: number;
  work_id: number;
  visit_date: string;
  bracket_change: string | null;
  wire_bending: string | null;
  opg: boolean;
  others: string | null;
  next_visit: string | null;
  elastics: string | null;
  upper_wire_id: number | null;
  lower_wire_id: number | null;
  p_photo: boolean;
  i_photo: boolean;
  f_photo: boolean;
  appliance_removed: boolean;
  operator_id: number | null;
  UpperWireName: string | null;
  LowerWireName: string | null;
  OperatorName: string | null;
};

interface VisitData {
  work_id: number;
  visit_date: Date | string;
  bracket_change?: string;
  wire_bending?: string;
  opg?: boolean;
  others?: string;
  next_visit?: string;
  elastics?: string;
  upper_wire_id?: number;
  lower_wire_id?: number;
  p_photo?: boolean;
  i_photo?: boolean;
  f_photo?: boolean;
  appliance_removed?: boolean;
  operator_id?: number;
}

// The three photo flags whose state drives tblwork's photo-date / status roll-up.
interface PhotoFlags {
  i_photo: boolean;
  f_photo: boolean;
  appliance_removed: boolean;
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
  bracket_change: string | null;
  wire_bending: string | null;
  elastics: string | null;
  others: string | null;
  next_visit: string | null;
}): string {
  let s = '';
  if (v.UpperWireName != null) s += `Upper wire: ${v.UpperWireName}<br> `;
  if (v.LowerWireName != null) s += `Lower wire: ${v.LowerWireName}<br> `;
  if (v.bracket_change != null) s += `Bracket change for: ${v.bracket_change}<br> `;
  if (v.wire_bending != null) s += `wire Bending for: ${v.wire_bending}<br> `;
  if (v.elastics != null) s += `${v.elastics}<br> `;
  if (v.others != null) s += `${nl2br(v.others)}<br> `;
  if (v.next_visit != null) s += `<font color=blue>Next: ${nl2br(v.next_visit)}</font>`;
  return s;
}

/**
 * Set the work's f_photo_date + mark it finished (status=2). Folds in trigPTypeandFinished:
 * when f_photo_date transitions from NULL to a value, also delete the patient's carried wires.
 * The derived patient type is then recomputed centrally (classifyPatient) — the old hardcoded
 * "ortho work finished → patient_type_id=2" write is gone.
 */
async function markWorkFinished(trx: Transaction<Database>, workId: number, visitDate: string): Promise<void> {
  const w = await trx
    .selectFrom('works')
    .select(['f_photo_date', 'person_id'])
    .where('work_id', '=', workId)
    .executeTakeFirst();
  const wasNull = !w?.f_photo_date;
  await trx.updateTable('works').set({ f_photo_date: visitDate, status: 2 }).where('work_id', '=', workId).execute();
  if (wasNull && w) {
    await trx.deleteFrom('carried_wires').where('person_id', '=', w.person_id).execute();
  }
  // Recompute UNCONDITIONALLY: this always flips the work to status=2, and a re-tick
  // on a reactivated work has wasNull=false but still moves the classification
  // (status 1→2). No-op guard inside recomputePatientType handles unchanged cases.
  if (w) await recomputePatientType(trx, w.person_id);
}

// ── tblwork photo roll-up (replaces the PhotoInsert / MyTrigger / PhotoDelete triggers) ──

/** AFTER INSERT (PhotoInsert): a newly-set flag stamps the parent work's matching date. */
async function applyPhotoInsert(
  trx: Transaction<Database>,
  workId: number,
  visitDate: string,
  f: PhotoFlags
): Promise<void> {
  if (f.i_photo) await trx.updateTable('works').set({ i_photo_date: visitDate }).where('work_id', '=', workId).execute();
  if (f.f_photo) await markWorkFinished(trx, workId, visitDate);
  if (f.appliance_removed) await trx.updateTable('works').set({ debond_date: visitDate }).where('work_id', '=', workId).execute();
}

/** AFTER UPDATE (MyTrigger): only a *changed* flag adjusts the work; set→date, clear→NULL. */
async function applyPhotoUpdate(
  trx: Transaction<Database>,
  workId: number,
  visitDate: string,
  oldF: PhotoFlags,
  newF: PhotoFlags
): Promise<void> {
  if (!oldF.i_photo && newF.i_photo) {
    await trx.updateTable('works').set({ i_photo_date: visitDate }).where('work_id', '=', workId).execute();
  } else if (oldF.i_photo && !newF.i_photo) {
    await trx.updateTable('works').set({ i_photo_date: null }).where('work_id', '=', workId).execute();
  }
  if (!oldF.f_photo && newF.f_photo) {
    await markWorkFinished(trx, workId, visitDate);
  } else if (oldF.f_photo && !newF.f_photo) {
    await trx.updateTable('works').set({ f_photo_date: null, status: 1 }).where('work_id', '=', workId).execute();
    // Un-ticking the final photo reactivates the work (status 1) → reclassify.
    await recomputePatientTypeForWork(trx, workId);
  }
  if (!oldF.appliance_removed && newF.appliance_removed) {
    await trx.updateTable('works').set({ debond_date: visitDate }).where('work_id', '=', workId).execute();
  } else if (oldF.appliance_removed && !newF.appliance_removed) {
    await trx.updateTable('works').set({ debond_date: null }).where('work_id', '=', workId).execute();
  }
}

/** AFTER DELETE (PhotoDelete): a flag that was set on the removed visit clears the work's date. */
async function applyPhotoDelete(
  trx: Transaction<Database>,
  workId: number,
  f: PhotoFlags
): Promise<void> {
  if (f.i_photo) await trx.updateTable('works').set({ i_photo_date: null }).where('work_id', '=', workId).execute();
  if (f.f_photo) {
    await trx.updateTable('works').set({ f_photo_date: null, status: 1 }).where('work_id', '=', workId).execute();
    // Deleting a final-photo visit reactivates the work (status 1) → reclassify.
    await recomputePatientTypeForWork(trx, workId);
  }
  if (f.appliance_removed) await trx.updateTable('works').set({ debond_date: null }).where('work_id', '=', workId).execute();
}

/**
 * Resolve which work a patient-level visit summary should display. Prefer the active
 * treatment (status=1); when the patient has none (finished/discontinued), fall back to
 * their most recent work so visit history stays visible. The original ProVisitSum took
 * an explicit work_id and was never active-only — scoping strictly to getActiveWID hid
 * the entire history of every patient whose treatment was already complete.
 */
async function resolveSummaryWID(PID: number): Promise<number | null> {
  const active = await getActiveWID(PID);
  if (active != null) return active;
  const row = await getKysely()
    .selectFrom('works')
    .select('work_id')
    .where('person_id', '=', PID)
    // workid is identity (monotonic with creation) → highest = most recent work.
    .orderBy('work_id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.work_id ?? null;
}

/**
 * Retrieves visit summaries for a given patient id. (was: ProVisitSum)
 */
export async function getVisitsSummary(PID: number): Promise<VisitSummary[]> {
  const WID = await resolveSummaryWID(PID);
  if (WID == null) return [];
  const rows = await getKysely()
    .selectFrom('visits as v')
    .innerJoin('works as w', 'w.work_id', 'v.work_id')
    .innerJoin('patients as p', 'p.person_id', 'w.person_id')
    .leftJoin('wires as uw', 'uw.wire_id', 'v.upper_wire_id')
    .leftJoin('wires as lw', 'lw.wire_id', 'v.lower_wire_id')
    .where('v.work_id', '=', WID)
    .orderBy('v.visit_date')
    .select([
      'p.patient_name', 'v.work_id', 'v.id', 'v.visit_date', 'v.opg', 'v.i_photo', 'v.f_photo',
      'v.p_photo', 'v.appliance_removed', 'v.bracket_change', 'v.wire_bending', 'v.elastics',
      'v.others', 'v.next_visit', 'uw.wire as UpperWireName', 'lw.wire as LowerWireName',
    ])
    .execute();

  return rows.map((r) => ({
    patient_name: r.patient_name,
    work_id: r.work_id,
    id: r.id,
    visit_date: r.visit_date, // PG `date` → 'YYYY-MM-DD' string
    opg: r.opg ?? false,
    i_photo: r.i_photo ?? false,
    f_photo: r.f_photo ?? false,
    p_photo: r.p_photo ?? false,
    appliance_removed: r.appliance_removed ?? false,
    Summary: buildVisitSummary(r),
  }));
}

/**
 * Retrieves the latest visit summary for a given patient id. (was: ProlatestVisitSum)
 */
export async function getLatestVisitsSum(PID: number): Promise<LatestVisitSummary | undefined> {
  const WID = await getActiveWID(PID);
  if (WID == null) return undefined;
  const row = await getKysely()
    .selectFrom('visits as v')
    .leftJoin('wires as uw', 'uw.wire_id', 'v.upper_wire_id')
    .leftJoin('wires as lw', 'lw.wire_id', 'v.lower_wire_id')
    .where('v.work_id', '=', WID)
    .orderBy('v.visit_date', 'desc')
    .select([
      'v.visit_date', 'v.bracket_change', 'v.wire_bending', 'v.elastics', 'v.others', 'v.next_visit',
      'uw.wire as UpperWireName', 'lw.wire as LowerWireName',
    ])
    .limit(1)
    .executeTakeFirst();

  if (!row) return undefined;
  return { visit_date: row.visit_date, Summary: buildVisitSummary(row) };
}

/**
 * Adds a new visit for a given patient id. (was: proAddVisit — inserts no photo flags, so no
 * tblwork roll-up is needed.)
 */
export async function addVisit(
  PID: number,
  visitDate: Date | string,
  upperWireID: number,
  lowerWireID: number,
  others: string,
  next: string
): Promise<boolean> {
  const WID = await getActiveWID(PID);
  if (WID == null) throw new Error('addVisit: patient has no active work');
  await getKysely()
    .insertInto('visits')
    .values({
      work_id: WID,
      visit_date: toDateOnly(visitDate),
      upper_wire_id: upperWireID,
      lower_wire_id: lowerWireID,
      others: others,
      next_visit: next,
    })
    .execute();
  return true;
}

/**
 * Updates a visit by visit id. (does not touch photo flags → no tblwork roll-up, matching the
 * old MyTrigger which fired only on a flag change.)
 */
export async function updateVisit(
  VID: number,
  visitDate: Date | string,
  upperWireID: number,
  lowerWireID: number,
  others: string,
  next: string
): Promise<{ success: boolean }> {
  await getKysely()
    .updateTable('visits')
    .set({
      visit_date: toDateOnly(visitDate),
      upper_wire_id: upperWireID,
      lower_wire_id: lowerWireID,
      others: others,
      next_visit: next,
    })
    .where('id', '=', VID)
    .execute();
  return { success: true };
}

/**
 * Deletes a visit by visit id (+ PhotoDelete roll-up).
 */
export async function deleteVisit(VID: number): Promise<{ success: boolean }> {
  await withPgTransaction(async (trx) => {
    const existing = await trx
      .selectFrom('visits')
      .where('id', '=', VID)
      .select(['work_id', 'i_photo', 'f_photo', 'appliance_removed'])
      .executeTakeFirst();
    await trx.deleteFrom('visits').where('id', '=', VID).execute();
    if (existing) {
      await applyPhotoDelete(trx, existing.work_id, {
        i_photo: existing.i_photo ?? false,
        f_photo: existing.f_photo ?? false,
        appliance_removed: existing.appliance_removed ?? false,
      });
    }
  });
  return { success: true };
}

/**
 * Retrieves available wires.
 */
export function getWires(): Promise<wire[]> {
  return getKysely()
    .selectFrom('wires')
    .select(['wire_id as id', 'wire as name'])
    .orderBy('wire')
    .execute() as Promise<wire[]>;
}

/**
 * Retrieves the latest wire details (id and name) for a given work id.
 */
export async function getLatestWiresByWorkId(workId: number): Promise<LatestWireDetails> {
  // qryLastUwire/qryLastLwire both hang off V_lastvisit (the work's MAX(visit_date)),
  // so for one work this collapses to: the wire IDs/names on its most recent visit.
  const row = await getKysely()
    .selectFrom('visits as v')
    .leftJoin('wires as uw', 'uw.wire_id', 'v.upper_wire_id')
    .leftJoin('wires as lw', 'lw.wire_id', 'v.lower_wire_id')
    .where('v.work_id', '=', workId)
    .orderBy('v.visit_date', 'desc')
    .select([
      'v.upper_wire_id as upper_wire_id',
      'uw.wire as UpperWireName',
      'v.lower_wire_id as lower_wire_id',
      'lw.wire as LowerWireName',
    ])
    .limit(1)
    .executeTakeFirst();

  return row ?? { upper_wire_id: null, UpperWireName: null, lower_wire_id: null, LowerWireName: null };
}

/**
 * Retrieves all visits for a specific work id (not dependent on active work).
 */
export async function getVisitsByWorkId(workId: number): Promise<Visit[]> {
  return getKysely()
    .selectFrom('visits as v')
    .leftJoin('wires as uw', 'uw.wire_id', 'v.upper_wire_id')
    .leftJoin('wires as lw', 'lw.wire_id', 'v.lower_wire_id')
    .leftJoin('employees as e', 'e.id', 'v.operator_id')
    .where('v.work_id', '=', workId)
    .orderBy('v.visit_date')
    .select([
      'v.id', 'v.work_id', 'v.visit_date', 'v.bracket_change', 'v.wire_bending', 'v.opg',
      'v.others', 'v.next_visit', 'v.elastics', 'v.upper_wire_id', 'v.lower_wire_id', 'v.p_photo',
      'v.i_photo', 'v.f_photo', 'v.appliance_removed', 'v.operator_id',
      'uw.wire as UpperWireName', 'lw.wire as LowerWireName', 'e.employee_name as OperatorName',
    ])
    .execute() as Promise<Visit[]>;
}

/**
 * Retrieves a single visit by visit id.
 */
export async function getVisitById(visitId: number): Promise<Visit | null> {
  const row = await getKysely()
    .selectFrom('visits as v')
    .leftJoin('wires as uw', 'uw.wire_id', 'v.upper_wire_id')
    .leftJoin('wires as lw', 'lw.wire_id', 'v.lower_wire_id')
    .leftJoin('employees as e', 'e.id', 'v.operator_id')
    .where('v.id', '=', visitId)
    .select([
      'v.id', 'v.work_id', 'v.visit_date', 'v.bracket_change', 'v.wire_bending', 'v.opg',
      'v.others', 'v.next_visit', 'v.elastics', 'v.upper_wire_id', 'v.lower_wire_id', 'v.p_photo',
      'v.i_photo', 'v.f_photo', 'v.appliance_removed', 'v.operator_id',
      'uw.wire as UpperWireName', 'lw.wire as LowerWireName', 'e.employee_name as OperatorName',
    ])
    .executeTakeFirst();
  return (row as Visit | undefined) ?? null;
}

/**
 * Adds a new visit with workId directly (+ PhotoInsert roll-up).
 */
export async function addVisitByWorkId(visitData: VisitData): Promise<{ id: number } | null> {
  const visitDate = toDateOnly(visitData.visit_date);
  const flags: PhotoFlags = {
    i_photo: visitData.i_photo ?? false,
    f_photo: visitData.f_photo ?? false,
    appliance_removed: visitData.appliance_removed ?? false,
  };
  return withPgTransaction(async (trx) => {
    const row = await trx
      .insertInto('visits')
      .values({
        work_id: visitData.work_id,
        visit_date: visitDate,
        bracket_change: visitData.bracket_change || null,
        wire_bending: visitData.wire_bending || null,
        opg: visitData.opg ?? false,
        others: visitData.others || null,
        next_visit: visitData.next_visit || null,
        elastics: visitData.elastics || null,
        upper_wire_id: visitData.upper_wire_id || null,
        lower_wire_id: visitData.lower_wire_id || null,
        p_photo: visitData.p_photo ?? false,
        i_photo: flags.i_photo,
        f_photo: flags.f_photo,
        appliance_removed: flags.appliance_removed,
        operator_id: visitData.operator_id || null,
      })
      .returning('id')
      .executeTakeFirst();
    if (!row) return null;
    await applyPhotoInsert(trx, visitData.work_id, visitDate, flags);
    return row;
  });
}

/**
 * Updates a visit by visit id (+ MyTrigger roll-up for changed photo flags).
 */
export async function updateVisitByWorkId(
  visitId: number,
  visitData: Omit<VisitData, 'work_id'>
): Promise<{ success: boolean }> {
  const visitDate = toDateOnly(visitData.visit_date);
  const newF: PhotoFlags = {
    i_photo: visitData.i_photo ?? false,
    f_photo: visitData.f_photo ?? false,
    appliance_removed: visitData.appliance_removed ?? false,
  };
  await withPgTransaction(async (trx) => {
    const existing = await trx
      .selectFrom('visits')
      .where('id', '=', visitId)
      .select(['work_id', 'i_photo', 'f_photo', 'appliance_removed'])
      .executeTakeFirst();
    await trx
      .updateTable('visits')
      .set({
        visit_date: visitDate,
        bracket_change: visitData.bracket_change || null,
        wire_bending: visitData.wire_bending || null,
        opg: visitData.opg ?? false,
        others: visitData.others || null,
        next_visit: visitData.next_visit || null,
        elastics: visitData.elastics || null,
        upper_wire_id: visitData.upper_wire_id || null,
        lower_wire_id: visitData.lower_wire_id || null,
        p_photo: visitData.p_photo ?? false,
        i_photo: newF.i_photo,
        f_photo: newF.f_photo,
        appliance_removed: newF.appliance_removed,
        operator_id: visitData.operator_id || null,
      })
      .where('id', '=', visitId)
      .execute();
    if (existing) {
      await applyPhotoUpdate(trx, existing.work_id, visitDate, {
        i_photo: existing.i_photo ?? false,
        f_photo: existing.f_photo ?? false,
        appliance_removed: existing.appliance_removed ?? false,
      }, newF);
    }
  });
  return { success: true };
}

/**
 * Deletes a visit by visit id (+ PhotoDelete roll-up).
 */
export async function deleteVisitByWorkId(visitId: number): Promise<{ success: boolean }> {
  return deleteVisit(visitId);
}
