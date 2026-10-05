/**
 * Lookup Table Admin Queries
 *
 * Generic CRUD operations for lookup tables with whitelist validation.
 * Only whitelisted tables can be accessed to prevent SQL injection.
 *
 * These functions build dynamic SQL over a *whitelisted* set of tables/columns (the
 * static Kysely builder can't express fully-dynamic table+column names), so the bodies
 * use the `sql` template tag with `sql.id()`-quoted identifiers — drawn ONLY from
 * LOOKUP_TABLE_CONFIG, resolved via `resolveConfig` (own properties only) — and bound
 * parameters for every value. No caller-supplied string ever reaches the SQL text.
 *
 * NB the config KEYS (`tblHolidays`, `tblWorkType`, …) are the public admin-endpoint
 * table keys the client calls (`GET /api/admin/lookups/:tableKey`), NOT PG table names;
 * `pgTableName()` maps a key to its real table. Renaming a key is an API break.
 *
 * type notes:
 *  - `bit` columns are PG `boolean`, so values are coerced to JS `true`/`false`.
 *  - referential-integrity violations surface as PG SQLSTATE `23503`
 *    (foreign_key_violation) → `ReferentialError`.
 */
import { sql, type RawBuilder } from 'kysely';
import { getKysely, withPgTransaction } from '../kysely.js';
import { isForeignKeyViolation } from '../../../utils/pg-errors.js';
import { WORK_TYPE_IDS, XRAY_WORK_TYPE_IDS } from '../../../shared/treatment-taxonomy.js';
import { EMPLOYEE_EXPENSE_CATEGORY, LAB_EXPENSE_CATEGORY } from '../../../shared/expense-categories.js';
import { RECEIPT_DOCUMENT_TYPE_ID } from '../../templates/template-files.js';

// type definitions
interface ReferenceConfig {
  // The *whitelist KEY* of the referenced lookup table (e.g. `tblExpenseCategories`),
  // NOT its raw PG table name. The client uses this as the admin-endpoint key to fetch
  // dropdown options (`GET /api/admin/lookups/:table`); the server JOIN resolves it to
  // the actual PG table via LOOKUP_TABLE_CONFIG (see getLookupItems).
  table: string;
  idColumn: string;
  displayColumn: string;
}

interface ColumnConfig {
  name: string;
  label: string;
  type: 'int' | 'varchar' | 'nvarchar' | 'bit' | 'uniqueidentifier' | 'date' | 'reference';
  maxLength?: number;
  required?: boolean;
  reference?: ReferenceConfig;
}

export class ReferentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferentialError';
  }
}

/** The delete named a row that doesn't exist (it used to answer "deleted"). */
export class LookupItemNotFoundError extends Error {
  constructor() {
    super('Item not found');
    this.name = 'LookupItemNotFoundError';
  }
}

/**
 * Rows the CODE names by id: deleting one breaks a feature even while nothing uses it
 * yet (a fresh install). Renaming stays allowed — every reader keys on the id.
 */
interface ProtectedRows {
  ids: readonly number[];
  /** Completes "Cannot delete: …" for the 409. */
  reason: string;
}

/**
 * A column elsewhere that stores this table's id WITHOUT a foreign key, so the delete's
 * FK-violation catch can't see it. `works.type_of_work` is the one that mattered: one
 * confirm deleted a work type 2,442 live works carried (audit FE-F21-2).
 */
interface SoftReference {
  table: string;
  column: string;
  /** Plural noun for the 409: "2,442 works use this item". */
  noun: string;
}

interface LookupTableConfig {
  tableName: string;
  idColumn: string;
  displayColumn: string;
  displayName: string;
  icon: string;
  idType: 'int' | 'uniqueidentifier';
  columns: ColumnConfig[];
  protectedRows?: ProtectedRows;
  softReferences?: readonly SoftReference[];
}

interface LookupTableInfo {
  key: string;
  displayName: string;
  icon: string;
  idColumn: string;
  columns: ColumnConfig[];
  /** Ids the editor offers no Delete for (the server refuses them anyway). */
  protectedIds: number[];
}

type LookupItem = Record<string, unknown>;

/**
 * Configuration for all allowed lookup tables.
 * This whitelist ensures only specific tables can be modified.
 */
const LOOKUP_TABLE_CONFIG: Record<string, LookupTableConfig> = {
  tblWorkType: {
    tableName: 'work_types',
    idColumn: 'id',
    displayColumn: 'work_type',
    displayName: 'Work Types',
    icon: 'fas fa-briefcase',
    idType: 'int',
    columns: [
      { name: 'work_type', label: 'Work type', type: 'varchar', maxLength: 50, required: true },
    ],
    // Owner decision (RF1, 2026-10-05): a type in use can't be deleted, nor the four
    // intake creates on its own; any other unused type can.
    protectedRows: {
      ids: [...XRAY_WORK_TYPE_IDS, WORK_TYPE_IDS.CONSULT],
      reason: 'the app creates works of this type itself (X-ray / Consult intake).',
    },
    softReferences: [{ table: 'works', column: 'type_of_work', noun: 'works' }],
  },
  tblKeyWord: {
    tableName: 'keywords',
    idColumn: 'id',
    displayColumn: 'key_word',
    displayName: 'Keywords',
    icon: 'fas fa-tag',
    idType: 'int',
    columns: [
      { name: 'key_word', label: 'Keyword', type: 'nvarchar', maxLength: 255, required: false },
    ],
  },
  tblShadeVitaClassic: {
    tableName: 'shade_vita_classic',
    idColumn: 'id',
    displayColumn: 'shade',
    displayName: 'Shade — Vita Classic',
    icon: 'fas fa-palette',
    idType: 'int',
    columns: [
      { name: 'shade', label: 'Shade', type: 'varchar', maxLength: 20, required: true },
    ],
  },
  tblShade3dMaster: {
    tableName: 'shade_3d_master',
    idColumn: 'id',
    displayColumn: 'shade',
    displayName: 'Shade — 3D Master',
    icon: 'fas fa-palette',
    idType: 'int',
    columns: [
      { name: 'shade', label: 'Shade', type: 'varchar', maxLength: 20, required: true },
    ],
  },
  tblLabs: {
    tableName: 'labs',
    idColumn: 'id',
    displayColumn: 'lab_name',
    displayName: 'Labs',
    icon: 'fas fa-flask',
    idType: 'int',
    columns: [
      { name: 'lab_name', label: 'Lab name', type: 'varchar', maxLength: 100, required: true },
      // A lab in use can't be hard-deleted (work_items/expenses FK) — retire it via this flag.
      { name: 'is_active', label: 'Active', type: 'bit', required: false },
    ],
  },
  tblDetail: {
    tableName: 'details',
    idColumn: 'id',
    displayColumn: 'detail',
    displayName: 'Appointment Types',
    icon: 'fas fa-calendar-check',
    idType: 'int',
    columns: [
      {
        name: 'detail',
        label: 'Appointment type',
        type: 'nvarchar',
        maxLength: 255,
        required: false,
      },
    ],
  },
  // NB: patient_types is intentionally NOT a managed lookup — its ids are now
  // code-coupled to the works-derived classifier (shared/treatment-taxonomy.ts).
  // Staff CRUD on those rows would corrupt classifyPatient(), so the table is
  // excluded from LOOKUP_TABLE_CONFIG (and the Lookups admin UI). The read-only
  // GET /api/patient-types feed still exists for display + the search filter.
  tblTagOptions: {
    tableName: 'tag_options',
    idColumn: 'id',
    displayColumn: 'tag',
    displayName: 'tag Options',
    icon: 'fas fa-bookmark',
    idType: 'int',
    columns: [{ name: 'tag', label: 'tag', type: 'nvarchar', maxLength: 50, required: true }],
  },
  tblReferrals: {
    tableName: 'referrals',
    idColumn: 'id',
    displayColumn: 'referral',
    displayName: 'referral Sources',
    icon: 'fas fa-handshake',
    idType: 'int',
    columns: [
      {
        name: 'referral',
        label: 'referral Source',
        type: 'nvarchar',
        maxLength: 255,
        required: false,
      },
    ],
  },
  tblAddress: {
    tableName: 'addresses',
    idColumn: 'id',
    displayColumn: 'zone',
    displayName: 'Addresses/Zones',
    icon: 'fas fa-map-marker-alt',
    idType: 'int',
    columns: [
      { name: 'zone', label: 'zone/Address', type: 'nvarchar', maxLength: 255, required: false },
    ],
  },
  tblAlertTypes: {
    tableName: 'alert_types',
    idColumn: 'alert_type_id',
    displayColumn: 'type_name',
    displayName: 'Alert Types',
    icon: 'fas fa-exclamation-triangle',
    idType: 'int',
    columns: [
      { name: 'type_name', label: 'Alert type Name', type: 'nvarchar', maxLength: 100, required: true },
    ],
  },
  DocumentTypes: {
    tableName: 'document_types',
    idColumn: 'type_id',
    displayColumn: 'type_name',
    displayName: 'Document Types',
    icon: 'fas fa-file-alt',
    idType: 'int',
    columns: [
      { name: 'type_code', label: 'Code', type: 'nvarchar', maxLength: 50, required: true },
      { name: 'type_name', label: 'Name', type: 'nvarchar', maxLength: 100, required: true },
      { name: 'description', label: 'description', type: 'nvarchar', maxLength: 500, required: false },
      { name: 'icon', label: 'Icon', type: 'nvarchar', maxLength: 50, required: false },
      { name: 'default_paper_width', label: 'Paper Width (mm)', type: 'int', required: false },
      { name: 'default_paper_height', label: 'Paper Height (mm)', type: 'int', required: false },
      { name: 'default_orientation', label: 'Orientation', type: 'nvarchar', maxLength: 20, required: false },
      { name: 'is_active', label: 'Active', type: 'bit', required: false },
      { name: 'sort_order', label: 'Sort Order', type: 'int', required: false },
    ],
    protectedRows: {
      ids: [RECEIPT_DOCUMENT_TYPE_ID],
      reason: 'receipts are printed from this document type.',
    },
  },
  tblImplantManufacturer: {
    tableName: 'implant_manufacturers',
    idColumn: 'id',
    displayColumn: 'manufacturer_name',
    displayName: 'Implant Manufacturers',
    icon: 'fas fa-industry',
    idType: 'int',
    columns: [
      {
        name: 'manufacturer_name',
        label: 'Manufacturer Name',
        type: 'nvarchar',
        maxLength: 255,
        required: true,
      },
    ],
    softReferences: [{ table: 'work_items', column: 'implant_manufacturer_id', noun: 'work items' }],
  },
  tblHolidays: {
    tableName: 'tblHolidays',
    idColumn: 'id',
    displayColumn: 'holiday_name',
    displayName: 'Holidays',
    icon: 'fas fa-calendar-times',
    idType: 'int',
    columns: [
      { name: 'holiday_date', label: 'Date', type: 'date', required: true },
      { name: 'holiday_name', label: 'Holiday Name', type: 'nvarchar', maxLength: 100, required: true },
      { name: 'description', label: 'description', type: 'nvarchar', maxLength: 255, required: false },
    ],
  },
  tbltimes: {
    tableName: 'times',
    idColumn: 'time_id',
    displayColumn: 'my_time',
    displayName: 'Time Slots',
    icon: 'fas fa-clock',
    idType: 'int',
    columns: [
      { name: 'my_time', label: 'Time', type: 'varchar', maxLength: 30, required: true },
    ],
  },
  tblExpenseCategories: {
    tableName: 'expense_categories',
    idColumn: 'category_id',
    displayColumn: 'category_name',
    displayName: 'Expense Categories',
    icon: 'fas fa-folder',
    idType: 'int',
    columns: [
      { name: 'category_name', label: 'category Name', type: 'nvarchar', maxLength: 50, required: true },
      // Optional Arabic display name — falls back to category_name when blank (see
      // CLAUDE.md i18n / RTL → "DB-stored lookup values"). Generic CRUD picks it up.
      { name: 'category_name_ar', label: 'category Name (Arabic)', type: 'nvarchar', maxLength: 50, required: false },
    ],
    protectedRows: {
      ids: [EMPLOYEE_EXPENSE_CATEGORY, LAB_EXPENSE_CATEGORY],
      reason: 'the expense form picks an employee or a lab under this category.',
    },
  },
  tblExpenseSubcategories: {
    tableName: 'expense_subcategories',
    idColumn: 'subcategory_id',
    displayColumn: 'subcategory_name',
    displayName: 'Expense Subcategories',
    icon: 'fas fa-folder-open',
    idType: 'int',
    columns: [
      { name: 'subcategory_name', label: 'Name', type: 'nvarchar', maxLength: 100, required: true },
      // Optional Arabic display name — falls back to subcategory_name when blank.
      // NOTE: the "Lab" (7) and "Employees" (5) categories no longer use subcategories —
      // their expenses reference labs / employees directly via expenses.lab_id /
      // employee_id (see the labs-normalization migration). Don't re-add rows there.
      { name: 'subcategory_name_ar', label: 'Name (Arabic)', type: 'nvarchar', maxLength: 100, required: false },
      {
        name: 'category_id',
        label: 'category',
        type: 'reference',
        required: true,
        reference: { table: 'tblExpenseCategories', idColumn: 'category_id', displayColumn: 'category_name' },
      },
    ],
  },
};

/**
 * Resolve a whitelisted config table name to its actual PostgreSQL table identifier.
 * Every config table name matches its PG identifier 1:1 except `tblHolidays`, which
 * was created lowercase (`tblholidays`) in the Phase-2 PG schema.
 */
function pgTableName(configTableName: string): string {
  return configTableName === 'tblHolidays' ? 'holidays' : configTableName;
}

/**
 * Coerce an incoming form value to the JS type expected by the PG column.
 *  - bit  → boolean (PG boolean column)
 *  - int / reference → integer (or null on blank/NaN)
 * Other types pass through (string/date).
 */
function coerceValue(col: ColumnConfig, raw: unknown): unknown {
  if (col.type === 'bit') {
    return raw === true || raw === 'true' || raw === 1;
  }
  if (
    (col.type === 'int' || col.type === 'reference') &&
    raw !== null &&
    raw !== undefined &&
    raw !== ''
  ) {
    const n = parseInt(raw as string, 10);
    return Number.isNaN(n) ? null : n;
  }
  return raw ?? null;
}

/**
 * Resolve a table key against the whitelist, OWN PROPERTIES ONLY.
 *
 * `LOOKUP_TABLE_CONFIG` is an object literal, so a plain `config[key]` / `key in config`
 * also reaches `Object.prototype` — `?tableName=constructor` (or `toString`, `valueOf`…)
 * yields a truthy non-config and sails past a `!config` guard, then dies on
 * `config.columns.map` as a 500 instead of a clean 400. `Object.hasOwn` closes that.
 * Every lookup in this module goes through here.
 */
function resolveConfig(tableKey: string): LookupTableConfig | null {
  return Object.hasOwn(LOOKUP_TABLE_CONFIG, tableKey) ? LOOKUP_TABLE_CONFIG[tableKey] : null;
}

/**
 * Get configuration for a specific table
 */
export function getTableConfig(tableKey: string): LookupTableConfig | null {
  return resolveConfig(tableKey);
}

/**
 * Get all available lookup table configurations
 */
export function getLookupTableConfigs(): LookupTableInfo[] {
  return Object.entries(LOOKUP_TABLE_CONFIG).map(([key, config]) => ({
    key,
    displayName: config.displayName,
    icon: config.icon,
    idColumn: config.idColumn,
    columns: config.columns,
    protectedIds: [...(config.protectedRows?.ids ?? [])],
  }));
}

/**
 * Get all items from a lookup table
 */
export async function getLookupItems(tableKey: string): Promise<LookupItem[]> {
  const config = resolveConfig(tableKey);
  if (!config) {
    throw new Error(`Invalid lookup table: ${tableKey}`);
  }

  const db = getKysely();
  const baseAlias = sql.id('t');

  // Build the SELECT list (base id + columns, plus a *_display join column per reference).
  const selectParts: RawBuilder<unknown>[] = [
    sql`${baseAlias}.${sql.id(config.idColumn)}`,
    ...config.columns.map((c) => sql`${baseAlias}.${sql.id(c.name)}`),
  ];
  const joinParts: RawBuilder<unknown>[] = [];

  config.columns.forEach((col, idx) => {
    if (col.type === 'reference' && col.reference) {
      const joinAlias = sql.id(`r${idx}`);
      // `reference.table` is the referenced table's whitelist KEY — resolve it to the
      // actual PG table name via the config (falls back to treating it as a raw name).
      const refConfig = resolveConfig(col.reference.table);
      const refPgTable = pgTableName(refConfig ? refConfig.tableName : col.reference.table);
      joinParts.push(
        sql`LEFT JOIN ${sql.id(refPgTable)} AS ${joinAlias} ON ${joinAlias}.${sql.id(col.reference!.idColumn)} = ${baseAlias}.${sql.id(col.name)}`
      );
      selectParts.push(
        sql`${joinAlias}.${sql.id(col.reference.displayColumn)} AS ${sql.id(`${col.name}_display`)}`
      );
    }
  });

  const joinClause = joinParts.length ? sql.join(joinParts, sql` `) : sql``;

  const query = sql<LookupItem>`
    SELECT ${sql.join(selectParts, sql`, `)}
    FROM ${sql.id(pgTableName(config.tableName))} AS ${baseAlias}
    ${joinClause}
    ORDER BY ${baseAlias}.${sql.id(config.displayColumn)}
  `;

  const result = await query.execute(db);
  return result.rows;
}

/**
 * Create a new lookup item
 */
export async function createLookupItem(
  tableKey: string,
  data: Record<string, unknown>
): Promise<string | number | null> {
  const config = resolveConfig(tableKey);
  if (!config) {
    throw new Error(`Invalid lookup table: ${tableKey}`);
  }

  const db = getKysely();
  const colIds = config.columns.map((c) => sql.id(c.name));
  const values = config.columns.map((c) => sql`${coerceValue(c, data[c.name])}`);

  let query;
  if (config.idType === 'uniqueidentifier') {
    // PG generates the uuid via gen_random_uuid().
    query = sql<Record<string, string | number>>`
      INSERT INTO ${sql.id(pgTableName(config.tableName))} (${sql.id(config.idColumn)}, ${sql.join(colIds, sql`, `)})
      VALUES (gen_random_uuid(), ${sql.join(values, sql`, `)})
      RETURNING ${sql.id(config.idColumn)} AS id
    `;
  } else {
    query = sql<Record<string, string | number>>`
      INSERT INTO ${sql.id(pgTableName(config.tableName))} (${sql.join(colIds, sql`, `)})
      VALUES (${sql.join(values, sql`, `)})
      RETURNING ${sql.id(config.idColumn)} AS id
    `;
  }

  const result = await query.execute(db);
  return (result.rows[0]?.id as string | number) ?? null;
}

/**
 * Update an existing lookup item — a PARTIAL update over the supplied columns.
 *
 * Only columns actually present in `data` are written. Previously every whitelisted
 * column was SET unconditionally, and `coerceValue` maps a missing key to `null` (or
 * `false` for a `bit`), so a caller that posted a subset of the row silently BLANKED
 * every column it left out. The request body is `z.looseObject({})` (columns vary per
 * table), so nothing upstream forces a complete row — the guarantee has to live here.
 */
export async function updateLookupItem(
  tableKey: string,
  id: string | number,
  data: Record<string, unknown>
): Promise<void> {
  const config = resolveConfig(tableKey);
  if (!config) {
    throw new Error(`Invalid lookup table: ${tableKey}`);
  }

  const setParts = config.columns
    .filter((c) => Object.hasOwn(data, c.name))
    .map((c) => sql`${sql.id(c.name)} = ${coerceValue(c, data[c.name])}`);

  // Nothing to change — an empty SET list is a SQL syntax error, so bail out.
  if (setParts.length === 0) return;

  const db = getKysely();
  const query = sql`
    UPDATE ${sql.id(pgTableName(config.tableName))}
    SET ${sql.join(setParts, sql`, `)}
    WHERE ${sql.id(config.idColumn)} = ${id}
  `;

  await query.execute(db);
}

/**
 * Delete a lookup item
 */
export async function deleteLookupItem(tableKey: string, id: string | number): Promise<void> {
  const config = resolveConfig(tableKey);
  if (!config) {
    throw new Error(`Invalid lookup table: ${tableKey}`);
  }

  const { protectedRows, softReferences = [] } = config;
  if (protectedRows && protectedRows.ids.includes(Number(id))) {
    throw new ReferentialError(`Cannot delete: ${protectedRows.reason}`);
  }

  const table = sql.id(pgTableName(config.tableName));
  const idCol = sql.id(config.idColumn);

  try {
    await withPgTransaction(async (trx) => {
      // Lock the row first, so a reference counted below can't be the last one
      // checked before a concurrent write adds another. (Columns with no FK can't
      // be fully closed against that race without one; this narrows it to the
      // instant between a write's own read and its insert.)
      const locked = await sql`SELECT 1 FROM ${table} WHERE ${idCol} = ${id} FOR UPDATE`.execute(trx);
      if (locked.rows.length === 0) throw new LookupItemNotFoundError();

      for (const ref of softReferences) {
        const { rows } = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM ${sql.id(ref.table)} WHERE ${sql.id(ref.column)} = ${id}
        `.execute(trx);
        const n = rows[0]?.n ?? 0;
        if (n > 0) {
          const one = n === 1;
          throw new ReferentialError(
            `Cannot delete: ${n.toLocaleString('en-US')} ${one ? ref.noun.replace(/s$/, '') : ref.noun} ${one ? 'uses' : 'use'} this item.`
          );
        }
      }

      await sql`DELETE FROM ${table} WHERE ${idCol} = ${id}`.execute(trx);
    });
  } catch (err) {
    // PG foreign_key_violation (SQLSTATE 23503).
    if (isForeignKeyViolation(err)) {
      throw new ReferentialError(
        'Cannot delete: this item is still referenced elsewhere.'
      );
    }
    throw err;
  }
}

/**
 * Check if a table key is valid
 */
export function isValidTableKey(tableKey: string): boolean {
  // `in` walks the prototype chain ('constructor' in {} === true) — own properties only.
  return Object.hasOwn(LOOKUP_TABLE_CONFIG, tableKey);
}
