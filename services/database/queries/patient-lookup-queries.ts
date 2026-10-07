/**
 * Patient typeahead — the `GET /patients/lookup` query.
 *
 * The suggestions under every patient search box (Patient Management, the Transfer
 * dialog, the till's patient link, the message-recipient pickers, the task form).
 * Until 2026-10-06 those screens downloaded the whole patient list
 * (`/patients/phones`) and filtered it in the browser: 61 bytes a patient, so 9 MB
 * at the 150,000 patients a large centre reaches, re-sent to every desk whenever
 * anyone registered a patient.
 *
 * A name or a phone number is matched "starts with" first, then "contains"; an ID
 * from its first digit. Each is read off an index, so the cost does not follow the
 * number of patients. Timed through this module at 150,000 patients (PostgreSQL 18):
 *
 *   name   starts with  `ix_patients_name_prefix`: a range in name order that stops
 *                       at the limit. 0.5 ms whether 9 names match or 6,000.
 *                       (The trigram index answers this too, but unordered: 6,000
 *                       rows fetched and sorted for the commonest name, 20 ms.)
 *          contains     `ix_patients_patient_name_trgm`: 1–3 ms for eight rows, 10 ms
 *                       for twenty-five. It runs only when fewer names START with
 *                       the text than were asked for.
 *   ID     starts with  primary-key ranges (`idPrefixRanges`), 0.5 ms.
 *   phone  both halves  `ix_patients_phone_trgm` / `_phone2_trgm`, 0.5–2.5 ms.
 *
 * Two inputs still read the table, both typing errors more than searches:
 *  - Two letters that fewer than eight names start with. A trigram index needs
 *    three characters, so the "contains" half reads every name: 110 ms at 150,000
 *    patients (16 ms at this clinic's 6,859), once, on the second keystroke.
 *  - Letters in the phone/ID box: 24 ms.
 *
 * The second half is a separate statement, run only when the first came back short,
 * so the common case is one index read. It leaves out the first half's rows by id:
 * the first half was short, so those ids are ALL the starts-with matches.
 *
 * Matching is literal (`escapeLike`) and, for names, case-insensitive — as the
 * browser-side filter was — and follows the results table's rule (`searchPatients`):
 * a name anywhere unless `nameStartsWith`, a phone number in either column.
 * The browser repeats these rules for the moment between a keystroke and its
 * answer (public/js/utils/patientSearch.ts#matchesLookup): change them together.
 */
import { sql, type RawBuilder } from 'kysely';
import { getKysely } from '../kysely.js';
import { escapeLike } from '../../../utils/like-pattern.js';
import {
  PATIENT_LOOKUP,
  type PatientLookupBy,
  type PatientLookupGroup,
} from '../../../shared/patient-lookup.js';
import { idPrefixRanges } from './patient-lookup-id-ranges.js';

// `type` (not interface) — feeds `sendData`. See CLAUDE.md.
export type PatientLookupMatch = {
  id: number;
  name: string;
  /**
   * For a `phone` row, the number that matched (the second phone when that is the
   * one). Otherwise the number the patient is reached on: the first phone, else
   * the second. Never '' — a patient without a number has `null`.
   */
  phone: string | null;
  group: PatientLookupGroup;
};

export type PatientLookupOptions = {
  q: string;
  by: PatientLookupBy;
  /** Names that START with the text only (the results table's checkbox). */
  nameStartsWith?: boolean;
  /** Only patients with a phone number — a message recipient needs one. */
  requirePhone?: boolean;
  /** Leave this patient out (the Transfer dialog's own patient). */
  exclude?: number;
  /** Rows per group; defaults to `PATIENT_LOOKUP.nameLimit` / `.groupLimit`. */
  limit?: number;
};

type Row = Omit<PatientLookupMatch, 'group'>;

/** The number a patient is reached on. '' is "no number" (8 legacy rows hold it). */
const REACHED_ON = sql<string | null>`COALESCE(NULLIF(p."phone"::text, ''), NULLIF(p."phone2"::text, ''))`;

/** The case-folded name — the expression `ix_patients_name_prefix` is built on; keep them identical. */
const NAME_KEY = sql<string>`lower(p."patient_name"::text)`;

/**
 * Name order, read straight off `ix_patients_name_prefix`. `USING ~<~` is that
 * index's own (byte-wise) order: a plain ORDER BY would sort by the database
 * collation, which the index cannot supply, and every match would be read and
 * sorted before the first eight could be returned.
 */
const NAME_ORDER = sql`ORDER BY ${NAME_KEY} USING ~<~, p."person_id"`;

/** `AND …` for the filters every statement shares, or nothing. */
function scopeOf(o: PatientLookupOptions, skipIds: number[] = []): RawBuilder<unknown> {
  const conditions: RawBuilder<unknown>[] = [];
  if (o.exclude !== undefined) conditions.push(sql`p."person_id" <> ${o.exclude}`);
  if (o.requirePhone) conditions.push(sql`${REACHED_ON} IS NOT NULL`);
  if (skipIds.length > 0) conditions.push(sql`p."person_id" NOT IN (${sql.join(skipIds)})`);
  return conditions.length > 0 ? sql`AND ${sql.join(conditions, sql` AND `)}` : sql``;
}

async function lookupByName(q: string, o: PatientLookupOptions, limit: number): Promise<Row[]> {
  const db = getKysely();
  const literal = escapeLike(q);

  // `lower()` on the pattern too, in SQL, so both sides fold case the same way.
  // It is folded to a constant when the statement is planned, which is what lets
  // the planner turn the LIKE into a range on the index.
  const { rows: starting } = await sql<Row>`
    SELECT p."person_id" AS "id", p."patient_name"::text AS "name", ${REACHED_ON} AS "phone"
    FROM "patients" p
    WHERE ${NAME_KEY} LIKE lower(${`${literal}%`}::text)
      ${scopeOf(o)}
    ${NAME_ORDER}
    LIMIT ${limit}
  `.execute(db);
  if (o.nameStartsWith || starting.length >= limit) return starting;

  // `::text ILIKE` — the form the trigram index matches (see patient-search-queries.ts).
  const { rows: containing } = await sql<Row>`
    SELECT p."person_id" AS "id", p."patient_name"::text AS "name", ${REACHED_ON} AS "phone"
    FROM "patients" p
    WHERE p."patient_name"::text ILIKE ${`%${literal}%`}
      ${scopeOf(o, starting.map((r) => r.id))}
    ${NAME_ORDER}
    LIMIT ${limit - starting.length}
  `.execute(db);
  return [...starting, ...containing];
}

/**
 * IDs that START with the digits: 45 offers 45, then 450–459, then 4500–4599.
 *
 * The browser-side filter this replaced matched the digits ANYWHERE in the ID, so
 * someone typing towards 4521 was offered 145 and 245 at "45". Nobody looks a
 * patient up by the middle of their file number, and it could only be answered by
 * reading every ID — on each keystroke of a phone number too, which arrives in
 * this same box. So an ID is matched from its first digit, off the primary key.
 */
async function lookupById(q: string, o: PatientLookupOptions, limit: number): Promise<Row[]> {
  const ranges = idPrefixRanges(q);
  if (ranges.length === 0) return [];

  // One short index range per extra digit. The ranges ascend, so (range, id)
  // order is plain ID order: the exact ID, then the shortest IDs that extend it.
  const { rows } = await sql<Row>`
    SELECT m."id", m."name", m."phone"
    FROM unnest(${ranges.map(([lo]) => lo)}::int[], ${ranges.map(([, hi]) => hi)}::int[])
         WITH ORDINALITY AS r(lo, hi, ord)
    CROSS JOIN LATERAL (
      SELECT p."person_id" AS "id", p."patient_name"::text AS "name", ${REACHED_ON} AS "phone"
      FROM "patients" p
      WHERE p."person_id" BETWEEN r.lo AND r.hi
        ${scopeOf(o)}
      ORDER BY p."person_id"
      LIMIT ${limit}
    ) m
    ORDER BY r.ord, m."id"
    LIMIT ${limit}
  `.execute(getKysely());
  return rows;
}

async function lookupByPhone(q: string, o: PatientLookupOptions, limit: number): Promise<Row[]> {
  if (q.length < PATIENT_LOOKUP.phoneMinChars) return [];
  const db = getKysely();
  const literal = escapeLike(q);

  // LIKE, not ILIKE: a phone number has no letter case, both match the trigram
  // indexes, and LIKE is several times cheaper on the 2-digit read.
  const matching = (pattern: string, skipIds: number[], take: number) => sql<Row>`
    SELECT p."person_id" AS "id", p."patient_name"::text AS "name",
           CASE WHEN p."phone"::text LIKE ${pattern} THEN p."phone"::text ELSE p."phone2"::text END AS "phone"
    FROM "patients" p
    WHERE (p."phone"::text LIKE ${pattern} OR p."phone2"::text LIKE ${pattern})
      ${scopeOf(o, skipIds)}
    ORDER BY p."person_id"
    LIMIT ${take}
  `.execute(db);

  const { rows: starting } = await matching(`${literal}%`, [], limit);
  if (starting.length >= limit) return starting;
  const { rows: containing } = await matching(
    `%${literal}%`,
    starting.map((r) => r.id),
    limit - starting.length
  );
  return [...starting, ...containing];
}

/**
 * The typeahead's rows, best match first. A name search returns `name` rows; a
 * phone/ID search returns its `id` rows, then its `phone` rows (a patient whose ID
 * and phone both match is in both). Text below the minimum length returns nothing.
 */
export async function lookupPatients(o: PatientLookupOptions): Promise<PatientLookupMatch[]> {
  const q = o.q.trim();
  const limitOr = (fallback: number): number =>
    Math.min(Math.max(o.limit ?? fallback, 1), PATIENT_LOOKUP.maxLimit);
  const as = (group: PatientLookupGroup) => (row: Row): PatientLookupMatch => ({ ...row, group });

  if (o.by === 'name') {
    if (q.length < PATIENT_LOOKUP.nameMinChars) return [];
    return (await lookupByName(q, o, limitOr(PATIENT_LOOKUP.nameLimit))).map(as('name'));
  }

  if (q.length < PATIENT_LOOKUP.idMinChars) return [];
  const limit = limitOr(PATIENT_LOOKUP.groupLimit);
  const [ids, phones] = await Promise.all([lookupById(q, o, limit), lookupByPhone(q, o, limit)]);
  return [...ids.map(as('id')), ...phones.map(as('phone'))];
}
