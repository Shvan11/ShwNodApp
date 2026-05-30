/**
 * Lookup Table Admin Queries
 *
 * Generic CRUD operations for lookup tables with whitelist validation.
 * Only whitelisted tables can be accessed to prevent SQL injection.
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). These functions build
 * dynamic SQL over a *whitelisted* set of tables/columns (the static Kysely builder
 * can't express fully-dynamic table+column names), so the bodies use the `sql`
 * template tag with `sql.id()`-quoted identifiers (drawn only from the validated
 * LOOKUP_TABLE_CONFIG) and bound parameters for all values — identical injection
 * posture to the old `@p`-param T-SQL. The positional `ColumnValue` mappers are gone;
 * rows come back as plain objects from `result.rows`.
 *
 * Type mapping vs. the old mssql path:
 *  - `bit` columns are now PG `boolean`, so values are coerced to JS `true`/`false`
 *    (was `1`/`0`).
 *  - referential-integrity violations surface as PG SQLSTATE `23503`
 *    (foreign_key_violation) instead of mssql error 547.
 */
import { sql, type RawBuilder } from 'kysely';
import { getKysely } from '../kysely.js';

// Type definitions
interface ReferenceConfig {
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

interface LookupTableConfig {
  tableName: string;
  idColumn: string;
  displayColumn: string;
  displayName: string;
  icon: string;
  idType: 'int' | 'uniqueidentifier';
  columns: ColumnConfig[];
}

interface LookupTableInfo {
  key: string;
  displayName: string;
  icon: string;
  idColumn: string;
  columns: ColumnConfig[];
}

type LookupItem = Record<string, unknown>;

/**
 * Configuration for all allowed lookup tables.
 * This whitelist ensures only specific tables can be modified.
 */
const LOOKUP_TABLE_CONFIG: Record<string, LookupTableConfig> = {
  tblWorkType: {
    tableName: 'tblWorkType',
    idColumn: 'ID',
    displayColumn: 'WorkType',
    displayName: 'Work Types',
    icon: 'fas fa-briefcase',
    idType: 'int',
    columns: [
      { name: 'WorkType', label: 'Work Type', type: 'varchar', maxLength: 50, required: true },
    ],
  },
  tblKeyWord: {
    tableName: 'tblKeyWord',
    idColumn: 'ID',
    displayColumn: 'KeyWord',
    displayName: 'Keywords',
    icon: 'fas fa-tag',
    idType: 'int',
    columns: [
      { name: 'KeyWord', label: 'Keyword', type: 'nvarchar', maxLength: 255, required: false },
    ],
  },
  tblDetail: {
    tableName: 'tblDetail',
    idColumn: 'ID',
    displayColumn: 'Detail',
    displayName: 'Appointment Types',
    icon: 'fas fa-calendar-check',
    idType: 'int',
    columns: [
      {
        name: 'Detail',
        label: 'Appointment Type',
        type: 'nvarchar',
        maxLength: 255,
        required: false,
      },
    ],
  },
  tblPatientType: {
    tableName: 'tblPatientType',
    idColumn: 'ID',
    displayColumn: 'PatientType',
    displayName: 'Patient Types',
    icon: 'fas fa-user-tag',
    idType: 'int',
    columns: [
      { name: 'PatientType', label: 'Patient Type', type: 'varchar', maxLength: 50, required: false },
    ],
  },
  tblTagOptions: {
    tableName: 'tblTagOptions',
    idColumn: 'ID',
    displayColumn: 'Tag',
    displayName: 'Tag Options',
    icon: 'fas fa-bookmark',
    idType: 'int',
    columns: [{ name: 'Tag', label: 'Tag', type: 'nvarchar', maxLength: 50, required: true }],
  },
  tblReferrals: {
    tableName: 'tblReferrals',
    idColumn: 'ID',
    displayColumn: 'Referral',
    displayName: 'Referral Sources',
    icon: 'fas fa-handshake',
    idType: 'int',
    columns: [
      {
        name: 'Referral',
        label: 'Referral Source',
        type: 'nvarchar',
        maxLength: 255,
        required: false,
      },
    ],
  },
  tblAddress: {
    tableName: 'tblAddress',
    idColumn: 'ID',
    displayColumn: 'Zone',
    displayName: 'Addresses/Zones',
    icon: 'fas fa-map-marker-alt',
    idType: 'int',
    columns: [
      { name: 'Zone', label: 'Zone/Address', type: 'nvarchar', maxLength: 255, required: false },
    ],
  },
  tblAlertTypes: {
    tableName: 'tblAlertTypes',
    idColumn: 'AlertTypeID',
    displayColumn: 'TypeName',
    displayName: 'Alert Types',
    icon: 'fas fa-exclamation-triangle',
    idType: 'int',
    columns: [
      { name: 'TypeName', label: 'Alert Type Name', type: 'nvarchar', maxLength: 100, required: true },
    ],
  },
  DocumentTypes: {
    tableName: 'DocumentTypes',
    idColumn: 'type_id',
    displayColumn: 'type_name',
    displayName: 'Document Types',
    icon: 'fas fa-file-alt',
    idType: 'int',
    columns: [
      { name: 'type_code', label: 'Code', type: 'nvarchar', maxLength: 50, required: true },
      { name: 'type_name', label: 'Name', type: 'nvarchar', maxLength: 100, required: true },
      { name: 'description', label: 'Description', type: 'nvarchar', maxLength: 500, required: false },
      { name: 'icon', label: 'Icon', type: 'nvarchar', maxLength: 50, required: false },
      { name: 'default_paper_width', label: 'Paper Width (mm)', type: 'int', required: false },
      { name: 'default_paper_height', label: 'Paper Height (mm)', type: 'int', required: false },
      { name: 'default_orientation', label: 'Orientation', type: 'nvarchar', maxLength: 20, required: false },
      { name: 'is_active', label: 'Active', type: 'bit', required: false },
      { name: 'sort_order', label: 'Sort Order', type: 'int', required: false },
    ],
  },
  tblImplantManufacturer: {
    tableName: 'tblImplantManufacturer',
    idColumn: 'ID',
    displayColumn: 'ManufacturerName',
    displayName: 'Implant Manufacturers',
    icon: 'fas fa-industry',
    idType: 'int',
    columns: [
      {
        name: 'ManufacturerName',
        label: 'Manufacturer Name',
        type: 'nvarchar',
        maxLength: 255,
        required: true,
      },
    ],
  },
  tblHolidays: {
    tableName: 'tblHolidays',
    idColumn: 'ID',
    displayColumn: 'HolidayName',
    displayName: 'Holidays',
    icon: 'fas fa-calendar-times',
    idType: 'int',
    columns: [
      { name: 'Holidaydate', label: 'Date', type: 'date', required: true },
      { name: 'HolidayName', label: 'Holiday Name', type: 'nvarchar', maxLength: 100, required: true },
      { name: 'Description', label: 'Description', type: 'nvarchar', maxLength: 255, required: false },
    ],
  },
  tbltimes: {
    tableName: 'tbltimes',
    idColumn: 'TimeID',
    displayColumn: 'MyTime',
    displayName: 'Time Slots',
    icon: 'fas fa-clock',
    idType: 'int',
    columns: [
      { name: 'MyTime', label: 'Time', type: 'varchar', maxLength: 30, required: true },
    ],
  },
  tblExpenseCategories: {
    tableName: 'tblExpenseCategories',
    idColumn: 'CategoryID',
    displayColumn: 'CategoryName',
    displayName: 'Expense Categories',
    icon: 'fas fa-folder',
    idType: 'int',
    columns: [
      { name: 'CategoryName', label: 'Category Name', type: 'nvarchar', maxLength: 50, required: true },
    ],
  },
  tblExpenseSubcategories: {
    tableName: 'tblExpenseSubcategories',
    idColumn: 'SubcategoryID',
    displayColumn: 'SubcategoryName',
    displayName: 'Expense Subcategories',
    icon: 'fas fa-folder-open',
    idType: 'int',
    columns: [
      { name: 'SubcategoryName', label: 'Name', type: 'nvarchar', maxLength: 100, required: true },
      {
        name: 'CategoryID',
        label: 'Category',
        type: 'reference',
        required: true,
        reference: { table: 'tblExpenseCategories', idColumn: 'CategoryID', displayColumn: 'CategoryName' },
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
  return configTableName === 'tblHolidays' ? 'tblholidays' : configTableName;
}

/**
 * Coerce an incoming form value to the JS type expected by the PG column.
 *  - bit  → boolean (PG boolean column)
 *  - int / reference → integer (or null on blank/NaN)
 * Other types pass through (string/date). Mirrors the old mssql conversion rules.
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
 * Get configuration for a specific table
 */
export function getTableConfig(tableKey: string): LookupTableConfig | null {
  return LOOKUP_TABLE_CONFIG[tableKey] || null;
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
  }));
}

/**
 * Get all items from a lookup table
 */
export async function getLookupItems(tableKey: string): Promise<LookupItem[]> {
  const config = LOOKUP_TABLE_CONFIG[tableKey];
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
      joinParts.push(
        sql`LEFT JOIN ${sql.id(pgTableName(col.reference!.table))} AS ${joinAlias} ON ${joinAlias}.${sql.id(col.reference!.idColumn)} = ${baseAlias}.${sql.id(col.name)}`
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
  const config = LOOKUP_TABLE_CONFIG[tableKey];
  if (!config) {
    throw new Error(`Invalid lookup table: ${tableKey}`);
  }

  const db = getKysely();
  const colIds = config.columns.map((c) => sql.id(c.name));
  const values = config.columns.map((c) => sql`${coerceValue(c, data[c.name])}`);

  let query;
  if (config.idType === 'uniqueidentifier') {
    // PG generates the uuid via gen_random_uuid() (was T-SQL NEWID()).
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
 * Update an existing lookup item
 */
export async function updateLookupItem(
  tableKey: string,
  id: string | number,
  data: Record<string, unknown>
): Promise<void> {
  const config = LOOKUP_TABLE_CONFIG[tableKey];
  if (!config) {
    throw new Error(`Invalid lookup table: ${tableKey}`);
  }

  const db = getKysely();
  const setParts = config.columns.map(
    (c) => sql`${sql.id(c.name)} = ${coerceValue(c, data[c.name])}`
  );

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
  const config = LOOKUP_TABLE_CONFIG[tableKey];
  if (!config) {
    throw new Error(`Invalid lookup table: ${tableKey}`);
  }

  const db = getKysely();
  const query = sql`
    DELETE FROM ${sql.id(pgTableName(config.tableName))}
    WHERE ${sql.id(config.idColumn)} = ${id}
  `;

  try {
    await query.execute(db);
  } catch (err) {
    // PG foreign_key_violation (was mssql error 547).
    const sqlState = (err as { code?: string }).code;
    if (sqlState === '23503') {
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
  return tableKey in LOOKUP_TABLE_CONFIG;
}
