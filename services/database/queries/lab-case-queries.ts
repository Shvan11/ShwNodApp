/**
 * Lab case tracker — reads + simple CRUD on `lab_cases` (raw `sql<LabCaseRow>`
 * tagged templates typed directly to the contract row type, mirroring
 * slideshow-config-queries.ts). The assembled board/detail view is a Kysely
 * builder join (patient, work type, teeth, lab name) with a GROUP BY, mirroring
 * `getWorkDetailsList` (work-queries.ts). Transactional stage transitions
 * (create/advance/remake/hold/resume/cancel) live in
 * `services/lab-cases/lab-case-service.ts`, not here.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';
import type {
  LabCaseRow,
  LabCaseBoardRow,
  LabCaseEventRow,
  ListLabCasesQuery,
  UpdateLabCaseBody,
} from '../../../shared/contracts/lab-case.contract.js';

export const COLS = sql`id, work_item_id, person_id, lab_id, material, status, is_on_hold, is_rush,
  due_date, sent_at, delivered_at, remake_count, status_changed_at, note, created_at, created_by, delivered_by`;

export async function getLabCaseById(id: number): Promise<LabCaseRow | null> {
  const db = getKysely();
  const res = await sql<LabCaseRow>`SELECT ${COLS} FROM lab_cases WHERE id = ${id}`.execute(db);
  return res.rows[0] ?? null;
}

/** Data pulled from the work item (+ its work) to prefill Start Lab Flow. */
export type WorkItemPrefill = {
  work_id: number;
  person_id: number;
  lab_id: number | null;
  material: string | null;
};

export async function getWorkItemPrefill(workItemId: number): Promise<WorkItemPrefill | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('work_items as wi')
    .innerJoin('works as w', 'w.work_id', 'wi.work_id')
    .where('wi.id', '=', workItemId)
    .select(['w.work_id', 'w.person_id', 'wi.lab_id', 'wi.material'])
    .executeTakeFirst();
  return row ?? null;
}

/** The shared assembled join behind both the board list and the single-case read. */
function boardQuery() {
  const db = getKysely();
  return db
    .selectFrom('lab_cases as lc')
    .innerJoin('work_items as wi', 'wi.id', 'lc.work_item_id')
    .innerJoin('works as w', 'w.work_id', 'wi.work_id')
    .innerJoin('work_types as wt', 'wt.id', 'w.type_of_work')
    .innerJoin('patients as p', 'p.person_id', 'lc.person_id')
    .leftJoin('labs as l', 'l.id', 'lc.lab_id')
    .leftJoin('work_item_teeth as wit', 'wit.work_item_id', 'wi.id')
    .leftJoin('tooth_numbers as tn', 'tn.id', 'wit.tooth_id')
    .select((eb) => [
      'lc.id',
      'w.work_id',
      'lc.work_item_id',
      'lc.person_id',
      'p.patient_name',
      'wt.work_type as restoration',
      sql<string | null>`string_agg(${eb.ref('tn.tooth_code')}, ', ')`.as('teeth'),
      'lc.lab_id',
      'l.lab_name',
      'lc.material',
      'wi.shade_system',
      'wi.shade',
      'lc.status',
      'lc.is_on_hold',
      'lc.is_rush',
      'lc.due_date',
      'lc.sent_at',
      'lc.delivered_at',
      'lc.remake_count',
      'lc.status_changed_at',
      'lc.note',
      'lc.created_at',
      'lc.created_by',
      'lc.delivered_by',
    ])
    .groupBy([
      'lc.id',
      'w.work_id',
      'lc.work_item_id',
      'lc.person_id',
      'p.patient_name',
      'wt.work_type',
      'lc.lab_id',
      'l.lab_name',
      'lc.material',
      'wi.shade_system',
      'wi.shade',
      'lc.status',
      'lc.is_on_hold',
      'lc.is_rush',
      'lc.due_date',
      'lc.sent_at',
      'lc.delivered_at',
      'lc.remake_count',
      'lc.status_changed_at',
      'lc.note',
      'lc.created_at',
      'lc.created_by',
      'lc.delivered_by',
    ]);
}

export async function getLabCaseBoardRow(id: number): Promise<LabCaseBoardRow | null> {
  const row = await boardQuery().where('lc.id', '=', id).executeTakeFirst();
  return (row as LabCaseBoardRow | undefined) ?? null;
}

export async function listLabCases(filters: ListLabCasesQuery): Promise<LabCaseBoardRow[]> {
  let q = boardQuery();

  if (filters.status) q = q.where('lc.status', '=', filters.status);
  if (filters.labId) q = q.where('lc.lab_id', '=', filters.labId);
  if (filters.overdue === 'true') {
    q = q
      .where('lc.due_date', 'is not', null)
      .where('lc.due_date', '<', sql<string>`CURRENT_DATE`)
      .where('lc.status', 'not in', ['delivered', 'cancelled']);
  }
  if (filters.from) q = q.where('lc.sent_at', '>=', sql<Date>`${filters.from}::timestamp`);
  if (filters.to) q = q.where('lc.sent_at', '<=', sql<Date>`${filters.to}::timestamp`);
  if (filters.q) {
    // `::text ILIKE` (not citext LIKE) — matches the patients trigram GIN index.
    const like = `%${filters.q}%`;
    q = q.where((eb) => eb(sql<string>`${eb.ref('p.patient_name')}::text`, 'ilike', like));
  }

  const rows = await q.orderBy('lc.due_date', sql`asc nulls last`).orderBy('lc.status_changed_at', 'asc').execute();
  return rows as unknown as LabCaseBoardRow[];
}

export async function listLabCaseEvents(labCaseId: number): Promise<LabCaseEventRow[]> {
  const db = getKysely();
  const res = await sql<LabCaseEventRow>`
    SELECT id, lab_case_id, event_type, from_status, to_status, occurred_at, note, created_by, created_at
    FROM lab_case_events
    WHERE lab_case_id = ${labCaseId}
    ORDER BY occurred_at ASC, id ASC
  `.execute(db);
  return res.rows;
}

/** Edit metadata only (lab/due date/rush/note) — no status change, no event. */
export async function updateLabCaseMeta(id: number, input: UpdateLabCaseBody): Promise<LabCaseRow | null> {
  const sets = [];
  if (input.labId !== undefined) sets.push(sql`lab_id = ${input.labId === '' ? null : input.labId}`);
  if (input.dueDate !== undefined) sets.push(sql`due_date = ${input.dueDate === '' ? null : input.dueDate}`);
  if (input.isRush !== undefined) sets.push(sql`is_rush = ${input.isRush}`);
  if (input.note !== undefined) sets.push(sql`note = ${input.note}`);
  if (sets.length === 0) return getLabCaseById(id);

  const db = getKysely();
  const res = await sql<LabCaseRow>`
    UPDATE lab_cases
    SET ${sql.join(sets, sql`, `)}
    WHERE id = ${id}
    RETURNING ${COLS}
  `.execute(db);
  return res.rows[0] ?? null;
}

export async function deleteLabCase(id: number): Promise<{ id: number } | null> {
  const db = getKysely();
  const res = await sql<{ id: number }>`DELETE FROM lab_cases WHERE id = ${id} RETURNING id`.execute(db);
  return res.rows[0] ?? null;
}
