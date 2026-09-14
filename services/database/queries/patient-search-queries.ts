/**
 * Patient search — the `GET /patients/search` query builder.
 *
 * Lives in its own module rather than in `patient-queries.ts`: this is one large
 * composable `sql` builder (~14 optional predicates over 6 tables) with a dense
 * body of index/semantics rationale, and it dwarfs the row-at-a-time CRUD that
 * module holds. It was extracted from `routes/api/patient.routes.ts`, where it
 * was 34 of that file's 38 raw `sql` statements.
 *
 * Filters arrive already parsed (CSV → `number[]`, `'true'` → `boolean`): request
 * shape is the route's business, this module takes typed values.
 */
import { sql, type RawBuilder } from 'kysely';
import { getKysely } from '../kysely.js';

/** Hard ceiling on a single page, enforced here so every caller inherits it. */
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;

// `type` (not interface) — feeds the tightened looseObject `patientSearch`
// response via `sendData`; an interface isn't assignable to the inferred string
// index signature (TS2345). See CLAUDE.md.
export type PatientSearchResult = {
  person_id: number;
  patient_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  date_of_birth: Date | null;
  gender: number | null;
  address_id: number | null;
  referral_source_id: number | null;
  patient_type_id: number | null;
  tag_id: number | null;
  notes: string | null;
  language: string | null;
  country_code: string | null;
  estimated_cost: number | null;
  currency: string | null;
  date_added: string | null;
  last_visit: string | null;
  GenderName: string | null;
  AddressName: string | null;
  ReferralSource: string | null;
  PatientTypeName: string | null;
  TagName: string | null;
  ActiveWorkTypes: string | null;
};

export type PatientSearchFilters = {
  /** Free-text: phone (either column) or, when all-digits, an exact person_id. */
  q?: string;
  patientName?: string;
  firstName?: string;
  lastName?: string;
  /** Prefix match instead of substring, for the name fields and `q`. */
  nameStartsWith?: boolean;
  workTypeIds?: number[];
  keywordIds?: number[];
  tagIds?: number[];
  patientTypeIds?: number[];
  /** "last appointment more than N ago" preset. */
  lastAppointment?: '1month' | '3months' | '6months' | '1year';
  /** Custom last-appointment range, each bound optional ('YYYY-MM-DD'). */
  lastAppointmentFrom?: string;
  lastAppointmentTo?: string;
  finalPhotos?: 'has' | 'none';
  progressPhotos?: 'has' | 'none';
  hasDebt?: boolean;
  sortBy?: 'name' | 'date' | 'lastVisit' | 'id';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export type PatientSearchPage = {
  patients: PatientSearchResult[];
  totalCount: number;
  hasMore: boolean;
};

/**
 * Build the WHERE fragment list. Each fragment carries its own inline bindings,
 * so there is no separate parameter tuple to keep in step (PG binds positionally
 * via the sql tag).
 */
function buildWhereConditions(f: PatientSearchFilters): RawBuilder<unknown>[] {
  const conditions: RawBuilder<unknown>[] = [];

  const patientName = (f.patientName ?? '').trim();
  const firstName = (f.firstName ?? '').trim();
  const lastName = (f.lastName ?? '').trim();
  const searchQuery = (f.q ?? '').trim();

  // Search by individual name fields
  // Use 'starts with' pattern if nameStartsWith is true, otherwise 'contains'
  const namePrefix = f.nameStartsWith ? '' : '%';

  // `col::text ILIKE` (not citext LIKE): same case-insensitive semantics, but it matches the
  // gin_trgm_ops expression indexes ix_patients_*_trgm — citext's own LIKE operator can't use
  // them and would seq-scan. Keep cast + operator in lockstep with the index expressions.
  if (patientName) {
    conditions.push(sql`p."patient_name"::text ILIKE ${`${namePrefix}${patientName}%`}`);
  }

  if (firstName) {
    conditions.push(sql`p."first_name"::text ILIKE ${`${namePrefix}${firstName}%`}`);
  }

  if (lastName) {
    conditions.push(sql`p."last_name"::text ILIKE ${`${namePrefix}${lastName}%`}`);
  }

  // General search (phone or id). Honours the same nameStartsWith flag as
  // the name fields: prefix match (index-seekable) when set, substring
  // otherwise — substring stays the default so "last 4 digits" search works.
  // An all-digit query also matches person_id exactly: the client's
  // "Phone/ID" combobox offers ID jumps, so the built list must honour IDs too.
  if (searchQuery) {
    const searchPattern = `${namePrefix}${searchQuery}%`;
    const phoneMatch = sql`(p."phone"::text ILIKE ${searchPattern} OR p."phone2"::text ILIKE ${searchPattern})`;
    conditions.push(
      /^\d+$/.test(searchQuery) && Number.isSafeInteger(Number(searchQuery))
        ? sql`(${phoneMatch} OR p."person_id" = ${Number(searchQuery)})`
        : phoneMatch
    );
  }

  // Filter by work types (ANY work, past or current)
  if (f.workTypeIds?.length) {
    conditions.push(sql`EXISTS (
                SELECT 1 FROM "works" w
                WHERE w."person_id" = p."person_id"
                AND w."type_of_work" IN (${sql.join(f.workTypeIds)})
            )`);
  }

  // Filter by keywords (check all 5 keyword columns)
  if (f.keywordIds?.length) {
    const keywordList = sql.join(f.keywordIds);
    conditions.push(sql`EXISTS (
                SELECT 1 FROM "works" w
                WHERE w."person_id" = p."person_id"
                AND (
                    w."keyword_id_1" IN (${keywordList})
                    OR w."keyword_id_2" IN (${keywordList})
                    OR w."keyword_id_3" IN (${keywordList})
                    OR w."keyword_id_4" IN (${keywordList})
                    OR w."keyword_id_5" IN (${keywordList})
                )
            )`);
  }

  // Filter by patient tags
  if (f.tagIds?.length) {
    conditions.push(sql`p."tag_id" IN (${sql.join(f.tagIds)})`);
  }

  // Filter by patient types
  if (f.patientTypeIds?.length) {
    conditions.push(sql`p."patient_type_id" IN (${sql.join(f.patientTypeIds)})`);
  }

  // Filter by last appointment. The correlated MAX is an index-only probe on
  // ix_pid_all (person_id, app_date); a NULL max (patient with no
  // appointments) fails every comparison, so such patients are excluded —
  // same semantics as the old EXISTS-over-GROUP-BY, without scanning the
  // whole appointments table per condition.
  const latestAppointment = sql`(
        SELECT MAX(a."app_date") FROM "appointments" a
        WHERE a."person_id" = p."person_id"
      )`;

  // Presets: "more than N ago".
  if (f.lastAppointment) {
    const presetIntervals: Record<string, RawBuilder<unknown>> = {
      '1month': sql`interval '1 month'`,
      '3months': sql`interval '3 months'`,
      '6months': sql`interval '6 months'`,
      '1year': sql`interval '1 year'`,
    };
    conditions.push(
      sql`${latestAppointment} < (LOCALTIMESTAMP - ${presetIntervals[f.lastAppointment]})`
    );
  }

  // Custom range: last appointment on/after From and/or on/before To (each
  // bound optional). app_date is a timestamp, so "on/before To" means
  // strictly before the following midnight.
  if (f.lastAppointmentFrom) {
    conditions.push(sql`${latestAppointment} >= ${f.lastAppointmentFrom}::date`);
  }
  if (f.lastAppointmentTo) {
    conditions.push(sql`${latestAppointment} < (${f.lastAppointmentTo}::date + 1)`);
  }

  // Filter by final-photo presence (tri-state: absent | 'has' | 'none').
  // A patient "has final photos" when EITHER marker is set: a 'Final' time
  // point (Dolphin imaging) or a work's f_photo_date (the Works form field).
  // The two overlap ~98% in practice but each catches rows the other misses.
  if (f.finalPhotos) {
    const hasFinalPhotosCondition = sql`(EXISTS (
                SELECT 1 FROM "time_points" tp
                WHERE tp."person_id" = p."person_id"
                AND tp."tp_description" LIKE '%Final%'
            ) OR EXISTS (
                SELECT 1 FROM "works" wf
                WHERE wf."person_id" = p."person_id"
                AND wf."f_photo_date" IS NOT NULL
            ))`;
    conditions.push(
      f.finalPhotos === 'has' ? hasFinalPhotosCondition : sql`NOT ${hasFinalPhotosCondition}`
    );
  }

  // Filter by progress-photo presence (tri-state: absent | 'has' | 'none').
  // Same two-marker shape as final photos, but works has no p_photo_date
  // column (a case can have many progress sessions), so the second marker is
  // the visit's own p_photo flag — the field the Visits form ticks.
  if (f.progressPhotos) {
    const hasProgressPhotosCondition = sql`(EXISTS (
                SELECT 1 FROM "time_points" tp
                WHERE tp."person_id" = p."person_id"
                AND tp."tp_description" LIKE '%Progress%'
            ) OR EXISTS (
                SELECT 1 FROM "visits" v
                JOIN "works" wp ON wp."work_id" = v."work_id"
                WHERE wp."person_id" = p."person_id"
                AND v."p_photo"
            ))`;
    conditions.push(
      f.progressPhotos === 'has'
        ? hasProgressPhotosCondition
        : sql`NOT ${hasProgressPhotosCondition}`
    );
  }

  // Filter by outstanding balance on any work: total_required − discount −
  // Σ invoices.amount_paid > 0 — the same remaining-balance formula
  // PaymentService enforces on payment creation. Per-work, so the dual
  // currencies never mix; ix_works_personid + ix_wid_date_sum (work_id
  // INCLUDE amount_paid) keep both probes index-only.
  if (f.hasDebt) {
    conditions.push(sql`EXISTS (
                SELECT 1 FROM "works" wd
                WHERE wd."person_id" = p."person_id"
                AND wd."total_required" - COALESCE(wd."discount", 0) > COALESCE(
                    (SELECT SUM(i."amount_paid") FROM "invoices" i WHERE i."work_id" = wd."work_id"), 0)
            )`);
  }

  return conditions;
}

/** Map sortBy/order onto an ORDER BY fragment. */
function buildOrderBy(
  sortBy: PatientSearchFilters['sortBy'],
  order: PatientSearchFilters['order']
): RawBuilder<unknown> {
  const desc = order === 'desc';
  switch (sortBy) {
    case 'date':
      // References the to_char(...)'d select-list alias — a 'YYYY-MM-DD'
      // string, which sorts correctly by day.
      return desc
        ? sql`ORDER BY "date_added" DESC NULLS LAST`
        : sql`ORDER BY "date_added" ASC NULLS LAST`;
    case 'lastVisit':
      // Same alias-reference as date_added: the last_visit subquery is
      // exposed only as its select-list alias, a 'YYYY-MM-DD' string that
      // sorts correctly by day. Patients with no appointments sort last.
      return desc
        ? sql`ORDER BY "last_visit" DESC NULLS LAST`
        : sql`ORDER BY "last_visit" ASC NULLS LAST`;
    case 'id':
      return desc ? sql`ORDER BY p."person_id" DESC` : sql`ORDER BY p."person_id" ASC`;
    default:
      return desc ? sql`ORDER BY p."patient_name" DESC` : sql`ORDER BY p."patient_name" ASC`;
  }
}

/**
 * Run a patient search: one COUNT over the filter set, then the matching page.
 */
export async function searchPatients(
  filters: PatientSearchFilters
): Promise<PatientSearchPage> {
  const db = getKysely();

  const limit = Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = filters.offset ?? 0;

  const whereConditions = buildWhereConditions(filters);
  const whereClause = whereConditions.length
    ? sql`WHERE ${sql.join(whereConditions, sql` AND `)}`
    : sql``;
  const orderByClause = buildOrderBy(filters.sortBy, filters.order);

  // First, get the total count of matching patients.
  // No JOINs here: every filter references p.* directly or via EXISTS /
  // correlated subqueries, so the lookup-table joins add nothing to the count.
  const countResult = await sql<{ totalCount: number | string }>`
            SELECT COUNT(*) as "totalCount"
            FROM "patients" p
            ${whereClause}
        `.execute(db);

  const totalCount = Number(countResult.rows[0]?.totalCount ?? 0);

  // Now get the paginated results. No DISTINCT: patients is keyed by
  // person_id and every join below is on the target table's PK (at most one
  // row each), so rows can't multiply — DISTINCT only forced the planner to
  // dedupe over the whole select list (subselects included) for nothing.
  const { rows: patients } = await sql<PatientSearchResult>`
            SELECT
                    p."person_id", p."patient_name", p."first_name", p."last_name",
                    p."phone", p."phone2", p."email", p."date_of_birth", p."gender",
                    p."address_id", p."referral_source_id", p."patient_type_id", p."tag_id",
                    p."notes", p."language", p."country_code",
                    p."estimated_cost", p."currency", to_char(p."date_added", 'YYYY-MM-DD') as "date_added",
                    (
                        SELECT to_char(MAX(la."app_date"), 'YYYY-MM-DD')
                        FROM "appointments" la
                        WHERE la."person_id" = p."person_id"
                    ) as "last_visit",
                    CASE p."gender" WHEN 1 THEN 'Male' WHEN 2 THEN 'Female' END as "GenderName", a."zone" as "AddressName",
                    r."referral" as "ReferralSource", pt."patient_type" as "PatientTypeName",
                    tag."tag" as "TagName",
                    (
                        SELECT STRING_AGG(wt."work_type", ', ')
                        FROM (
                            SELECT DISTINCT wt2."work_type"
                            FROM "works" w2
                            INNER JOIN "work_types" wt2 ON w2."type_of_work" = wt2."id"
                            WHERE w2."person_id" = p."person_id" AND w2."status" = 1
                        ) wt
                    ) as "ActiveWorkTypes"
            FROM "patients" p
            LEFT JOIN "addresses" a ON p."address_id" = a."id"
            LEFT JOIN "referrals" r ON p."referral_source_id" = r."id"
            LEFT JOIN "patient_types" pt ON p."patient_type_id" = pt."id"
            LEFT JOIN "tag_options" tag ON p."tag_id" = tag."id"
            ${whereClause}
            ${orderByClause}
            LIMIT ${limit} OFFSET ${offset}
        `.execute(db);

  return {
    patients,
    totalCount,
    hasMore: offset + patients.length < totalCount,
  };
}
