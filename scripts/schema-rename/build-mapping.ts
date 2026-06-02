/**
 * Phase 1 — Build the rename mapping.
 *
 * Introspects the shwan_test sandbox DB and emits a draft mapping.json that covers:
 *   - table renames (old → new)
 *   - column renames per table (mechanical snake_case, no prefix stripping)
 *   - sequence renames
 *   - index renames
 *   - FK / unique / check constraint renames
 *   - CDC trigger PK-column updates (trigger re-creation needed after column rename)
 *   - dolphin_sync_map data rows to update (stored old table names)
 *   - human-review flags (collisions, reserved words)
 *   - prefix-strip suggestions (per table, for manual review/application)
 *
 * Run:
 *   $env:PG_HOST='localhost'; $env:PG_PORT='5432'; $env:PG_DATABASE='shwan_test';
 *   $env:PG_USER='shwan_app'; $env:PG_PASSWORD='<pw>';
 *   npx tsx scripts/schema-rename/build-mapping.ts
 *
 * Output: scripts/schema-rename/mapping.json  (DRAFT — human review required before emit-migration)
 *
 * After review, run emit-migration.ts to produce the SQL migration.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── PG reserved keywords (type A: cannot be unquoted column/table identifiers) ──────────────────
// Source: https://www.postgresql.org/docs/current/sql-keywords-appendix.html
const PG_RESERVED = new Set([
  'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'asymmetric',
  'authorization', 'binary', 'both', 'case', 'cast', 'check', 'collate', 'collation',
  'column', 'concurrently', 'constraint', 'create', 'cross', 'current_catalog',
  'current_date', 'current_role', 'current_schema', 'current_time', 'current_timestamp',
  'current_user', 'default', 'deferrable', 'desc', 'distinct', 'do', 'else', 'end',
  'except', 'false', 'fetch', 'for', 'foreign', 'freeze', 'from', 'full', 'grant',
  'group', 'having', 'ilike', 'in', 'initially', 'inner', 'intersect', 'into', 'is',
  'isnull', 'join', 'lateral', 'leading', 'left', 'like', 'limit', 'localtime',
  'localtimestamp', 'not', 'notnull', 'null', 'offset', 'on', 'only', 'or', 'order',
  'outer', 'overlaps', 'placing', 'primary', 'references', 'returning', 'right',
  'select', 'session_user', 'similar', 'some', 'symmetric', 'table', 'tablesample',
  'then', 'to', 'trailing', 'true', 'union', 'unique', 'user', 'using', 'variadic',
  'verbose', 'when', 'where', 'window', 'with',
]);

// ── Manual overrides: well-known typo/clarity fixes ──────────────────────────────────────────────
// Keys are the NEW names we want (after the mechanical tbl-strip + snake_case).
// Format: { [mechanicalNewName]: finalNewName }
const TABLE_OVERRIDES: Record<string, string> = {
  // Typo / clarity fixes
  calender: 'calendar',              // tblCalender — typo fix (calender ≠ calendar)
  vid_cat: 'video_categories',       // tblVidCat — abbreviation expansion
  key_word: 'keywords',              // tblKeyWord — two words smashed, should be one

  // Singular → plural (convention: keep plural table names)
  work: 'works',                     // tblwork
  address: 'addresses',              // tblAddress
  detail: 'details',                 // tblDetail
  diagnosis: 'diagnoses',            // tblDiagnosis
  gender: 'genders',                 // tblGender
  implant: 'implants',               // tblImplant
  implant_manufacturer: 'implant_manufacturers', // tblImplantManufacturer
  invoice: 'invoices',               // tblInvoice
  patient_type: 'patient_types',     // tblPatientType
  tooth_number: 'tooth_numbers',     // tblToothNumber
  wait_reason: 'wait_reasons',       // tblWaitReason
  work_status: 'work_statuses',      // tblWorkStatus
  work_type: 'work_types',           // tblWorkType
};

// ── snake_case transform ──────────────────────────────────────────────────────────────────────────
// Handles: PascalCase, camelCase, consecutive-uppercase acronyms (SMSStatus→sms_status, PersonID→person_id).
function toSnakeCase(s: string): string {
  return s
    // ABC_Def → AB_cDef style: multiple uppercase before uppercase+lowercase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // lowercase/digit before uppercase
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
    // normalise any existing multi-underscores (e.g. Wire_ID → wire__id → wire_id)
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '');
}

// Strip tbl/tb prefix (case-insensitive) from the start of a table name.
function stripTblPrefix(name: string): string {
  if (/^tbl/i.test(name)) return name.slice(3);
  if (/^tb(?=[A-Z])/i.test(name)) return name.slice(2); // tbCities but not "tb" alone
  return name;
}

function tableNewName(oldName: string): string {
  if (TABLE_HARD_OVERRIDES[oldName]) return TABLE_HARD_OVERRIDES[oldName];
  const stripped = stripTblPrefix(oldName);
  const snake = toSnakeCase(stripped);
  return TABLE_OVERRIDES[snake] ?? snake;
}

// ── Hard overrides for specific original table names (applied BEFORE mechanical transform) ────────
// Use when the table name itself is unusual and the mechanical strip+snake_case gives the wrong result,
// or when two source tables collide and we must resolve the final names here.
const TABLE_HARD_OVERRIDES: Record<string, string> = {
  // 'Patients' is the Dolphin-side mirror table (patID PK, patFirstName columns).
  // 'tblpatients' is the main app patients table → should be 'patients'.
  // Resolve the collision: Dolphin table gets the qualified name.
  'Patients': 'patients_dolphin',
  'tblpatients': 'patients',
};

// ── Column-level hard overrides (per-table, applied after mechanical snake_case) ─────────────────
// Keys: original_table_name → { original_column_name: final_new_name }
// Needed when the mechanical transform can't infer word boundaries (all-lowercase compound words,
// inconsistent original casing, or domain-specific abbreviation splits).
const COLUMN_HARD_OVERRIDES: Record<string, Record<string, string>> = {
  // workid is all-lowercase so the algorithm can't split it to work_id
  tblwork: {
    workid: 'work_id',
    Typeofwork: 'type_of_work',  // lower-case "of" word hidden in pascal
    KeyWordID1: 'keyword_id_1',  // inconsistent original caps + numeric suffix
    KeyWordID2: 'keyword_id_2',
    KeywordID3: 'keyword_id_3',
    KeywordID4: 'keyword_id_4',
    KeywordID5: 'keyword_id_5',
  },
  tblpatients: {
    DateofBirth: 'date_of_birth',  // "of" hidden
  },
  tblInvoice: {
    workid: 'work_id',             // FK to tblwork.workid
    Amountpaid: 'amount_paid',     // all-lower compound
    Dateofpayment: 'date_of_payment', // all-lower compound
  },
  tblholidays: {
    Holidaydate: 'holiday_date',   // all-lower compound after first char
  },
  tblsms: {
    SMSID: 'sms_id',               // all-caps compound
    emailsent: 'email_sent',       // all-lower compound
    smssent: 'sms_sent',           // all-lower compound
  },
  tblnumbers: {
    Mynumber: 'my_number',         // all-lower compound after first char
  },
};

// ── Already-correct names: skip table-level rename but still process columns ─────────────────────
const ALREADY_SNAKE_TABLES = new Set([
  'cdc_sink_control', 'change_log', 'dolphin_sync_map', 'pgmigrations',
  'portal_sessions', 'staff_sessions',
]);

// ── Connect ───────────────────────────────────────────────────────────────────────────────────────
const pool = new pg.Pool({
  host:     process.env.PG_HOST     ?? 'localhost',
  port:     Number(process.env.PG_PORT ?? 5432),
  database: process.env.PG_DATABASE ?? 'shwan_test',
  user:     process.env.PG_USER     ?? 'shwan_app',
  password: process.env.PG_PASSWORD,
});

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const dbName = process.env.PG_DATABASE ?? 'shwan_test';
  console.log(`Connecting to ${dbName}…`);
  await pool.query('SELECT 1'); // fail fast if connection is bad
  console.log('Connected.\n');

  // 1. Tables
  const tables = await query<{ table_name: string }>(
    `SELECT tablename AS table_name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  const tableNames = tables.map(r => r.table_name);

  // 2. Columns per table
  const colRows = await query<{ table_name: string; column_name: string; ordinal_position: number }>(
    `SELECT table_name, column_name, ordinal_position
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );
  const colsByTable: Record<string, string[]> = {};
  for (const r of colRows) {
    if (!colsByTable[r.table_name]) colsByTable[r.table_name] = [];
    colsByTable[r.table_name].push(r.column_name);
  }

  // 3. Primary keys
  const pkRows = await query<{ table_name: string; column_name: string }>(
    `SELECT tc.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema = 'public'`
  );
  const pkByTable: Record<string, string[]> = {};
  for (const r of pkRows) {
    if (!pkByTable[r.table_name]) pkByTable[r.table_name] = [];
    pkByTable[r.table_name].push(r.column_name);
  }

  // 4. Sequences with owning table+column (via pg_depend).
  // pg_sequences alone omits identity sequences in PG 18; pg_depend gives us the exact owner so we can
  // reliably derive the new name without parsing the sequence name string.
  const seqRows = await query<{ sequence_name: string; owner_table: string | null; owner_col: string | null }>(
    `SELECT
       s.sequencename AS sequence_name,
       c.relname      AS owner_table,
       a.attname      AS owner_col
     FROM pg_sequences s
     JOIN pg_class     sc ON sc.relname = s.sequencename
                          AND sc.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
     LEFT JOIN pg_depend  d  ON d.objid = sc.oid
                             AND d.classid = 'pg_class'::regclass
                             AND d.deptype = 'i'   -- 'i' for IDENTITY cols (not 'a' for SERIAL/OWNED BY)
     LEFT JOIN pg_class   c  ON c.oid = d.refobjid
     LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
     WHERE s.schemaname = 'public'
     ORDER BY s.sequencename`
  );

  // 5. Indexes (all, including those backing constraints — we'll filter in the migration)
  const idxRows = await query<{ indexname: string; tablename: string }>(
    `SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`
  );

  // 6. Named constraints (FK, UNIQUE, CHECK — not PK, handled separately; not unnamed CHECK)
  const constraintRows = await query<{
    constraint_name: string; table_name: string; constraint_type: string;
  }>(
    `SELECT constraint_name, table_name, constraint_type
     FROM information_schema.table_constraints
     WHERE table_schema = 'public'
       AND constraint_type IN ('FOREIGN KEY', 'UNIQUE', 'CHECK')
     ORDER BY table_name, constraint_name`
  );

  // 7. CDC triggers
  const trigRows = await query<{ table_name: string; trigger_def: string }>(
    `SELECT c.relname AS table_name, pg_get_triggerdef(t.oid) AS trigger_def
     FROM pg_trigger t
     JOIN pg_class c ON t.tgrelid = c.oid
     JOIN pg_proc p ON t.tgfoid = p.oid
     JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE p.proname = 'cdc_capture'
       AND NOT t.tgisinternal
       AND n.nspname = 'public'
     ORDER BY c.relname`
  );

  console.log(`Found ${tableNames.length} tables, ${colRows.length} columns, ${trigRows.length} CDC triggers.`);

  // ── Build table mapping ───────────────────────────────────────────────────────────────────────
  const flags: object[] = [];
  // new_name → [old_names that map to it]
  const newNameCount: Record<string, string[]> = {};

  const tableMappingRaw: Record<string, string> = {};
  for (const t of tableNames) {
    const n = ALREADY_SNAKE_TABLES.has(t) ? t : tableNewName(t);
    tableMappingRaw[t] = n;
    if (!newNameCount[n]) newNameCount[n] = [];
    newNameCount[n].push(t);
  }

  // Flag collisions
  for (const [newName, oldNames] of Object.entries(newNameCount)) {
    if (oldNames.length > 1) {
      flags.push({
        type: 'TABLE_COLLISION',
        proposed_new_name: newName,
        old_names: oldNames,
        message: `Multiple tables map to '${newName}'. Resolve manually — give each a distinct name in the 'tables' section.`,
        action_needed: true,
      });
      // Mark the duplicates with a placeholder suffix so the JSON is still diff-able
      for (let i = 1; i < oldNames.length; i++) {
        tableMappingRaw[oldNames[i]] = `${newName}_COLLISION_${i}`;
      }
    }
  }

  // Build tables section with flagging
  const tableSection: Record<string, { new: string; flagged: boolean; flag_reason?: string }> = {};
  for (const [old, newName] of Object.entries(tableMappingRaw)) {
    const isCollision = newName.includes('_COLLISION_');
    const isReserved = PG_RESERVED.has(newName);
    tableSection[old] = {
      new: newName,
      flagged: isCollision || isReserved,
      ...(isCollision ? { flag_reason: 'COLLISION — resolve manually' } : {}),
      ...(isReserved ? { flag_reason: `RESERVED WORD '${newName}' — pick an alternative` } : {}),
    };
  }

  // ── Build column mapping ──────────────────────────────────────────────────────────────────────
  const columnSection: Record<string, Record<string, { new: string; flagged: boolean; flag_reason?: string }>> = {};
  const prefixSuggestions: Record<string, object> = {};

  for (const tableName of tableNames) {
    const cols = colsByTable[tableName] ?? [];
    if (cols.length === 0) continue;

    columnSection[tableName] = {};

    const colMap: Record<string, { new: string; flagged: boolean; flag_reason?: string }> = {};
    const newColNames: Record<string, string[]> = {};

    for (const col of cols) {
      const newCol = COLUMN_HARD_OVERRIDES[tableName]?.[col] ?? toSnakeCase(col);
      if (!newColNames[newCol]) newColNames[newCol] = [];
      newColNames[newCol].push(col);

      const isReserved = PG_RESERVED.has(newCol);
      colMap[col] = {
        new: newCol,
        flagged: isReserved,
        ...(isReserved ? { flag_reason: `RESERVED WORD '${newCol}' — pick an alternative` } : {}),
      };
    }

    // Flag column collisions within the same table
    for (const [newCol, oldCols] of Object.entries(newColNames)) {
      if (oldCols.length > 1) {
        for (let i = 1; i < oldCols.length; i++) {
          colMap[oldCols[i]].new = `${newCol}_COLLISION_${i}`;
          colMap[oldCols[i]].flagged = true;
          colMap[oldCols[i]].flag_reason = `COLUMN COLLISION: '${oldCols.join("', '")}' all map to '${newCol}' in table '${tableName}' → resolve manually`;
        }
        flags.push({
          type: 'COLUMN_COLLISION',
          table: tableName,
          proposed_new_name: newCol,
          old_names: oldCols,
          message: `Multiple columns in '${tableName}' map to '${newCol}'. Resolve manually.`,
          action_needed: true,
        });
      }
    }

    columnSection[tableName] = colMap;

    // Prefix-strip suggestion: detect if ≥ half the columns share a common camelCase prefix
    // Strategy: look for the most common leading word (before first uppercase after start)
    const prefixCandidates = cols
      .map(c => {
        const m = c.match(/^([a-z]{2,}|[A-Z][a-z]+)/);
        return m ? m[1].toLowerCase() : null;
      })
      .filter(Boolean) as string[];

    if (prefixCandidates.length > 0) {
      const freq: Record<string, number> = {};
      for (const p of prefixCandidates) freq[p] = (freq[p] ?? 0) + 1;
      const [topPrefix, topCount] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
      const tablePart = (tableSection[tableName]?.new ?? tableName).replace(/_/g, '');

      if (
        topCount >= 3 &&
        topCount / cols.length >= 0.4 &&
        topPrefix !== 'id' &&
        topPrefix.length >= 2 &&
        tablePart.startsWith(topPrefix.toLowerCase().replace(/_/g, '').slice(0, 4))
      ) {
        const affectedCols = cols.filter(c =>
          c.toLowerCase().startsWith(topPrefix.toLowerCase())
        );
        prefixSuggestions[tableName] = {
          detected_prefix: topPrefix,
          columns_with_prefix: affectedCols,
          stripped_examples: affectedCols.slice(0, 5).map(c => ({
            original: c,
            mechanical: colMap[c]?.new,
            stripped: toSnakeCase(c.slice(topPrefix.length) || c),
          })),
          note: `Review: strip '${topPrefix}' column prefix? Edit the 'columns.${tableName}' section to apply.`,
        };
      }
    }
  }

  // ── Sequence mapping ──────────────────────────────────────────────────────────────────────────
  // Each sequence is owned by a specific table.column (from pg_depend). Use the owner to derive
  // the new name, rather than parsing the sequence name string (which breaks for columns like Bend_ID).
  const sequenceSection: Record<string, { new: string; owner_table: string | null; owner_col: string | null; flagged: boolean }> = {};
  for (const { sequence_name, owner_table, owner_col } of seqRows) {
    if (!owner_table || !owner_col) {
      // Orphan sequence (no column owner) — keep as-is, flag for review
      sequenceSection[sequence_name] = { new: sequence_name, owner_table: null, owner_col: null, flagged: true };
      continue;
    }
    const newTable = tableSection[owner_table]?.new ?? toSnakeCase(owner_table);
    const newCol = columnSection[owner_table]?.[owner_col]?.new ?? toSnakeCase(owner_col);
    const newSeqName = `${newTable}_${newCol}_seq`;
    sequenceSection[sequence_name] = {
      new: newSeqName,
      owner_table,
      owner_col,
      flagged: false,
    };
  }

  // ── Index mapping ─────────────────────────────────────────────────────────────────────────────
  // Indexes are named by PG automatically (e.g. tblpatients_pkey) or manually.
  // We rename them to match new table names where possible.
  const indexSection: Record<string, { new: string; table: string; flagged: boolean }> = {};
  for (const { indexname, tablename } of idxRows) {
    const newTableName = tableSection[tablename]?.new ?? tablename;
    let newIndexName = indexname;
    // Replace old table name at start of index name
    if (indexname.startsWith(tablename)) {
      newIndexName = newTableName + indexname.slice(tablename.length);
    } else if (indexname.toLowerCase().startsWith(tablename.toLowerCase())) {
      newIndexName = newTableName + indexname.slice(tablename.length);
    }
    // snake_case the suffix too
    newIndexName = newIndexName.toLowerCase().replace(/__+/g, '_');
    indexSection[indexname] = {
      new: newIndexName,
      table: tablename,
      flagged: newIndexName === indexname,
    };
  }

  // ── Constraint mapping ────────────────────────────────────────────────────────────────────────
  const constraintSection: Record<string, { new: string; table: string; type: string; flagged: boolean }> = {};
  for (const { constraint_name, table_name, constraint_type } of constraintRows) {
    const newTableName = tableSection[table_name]?.new ?? table_name;
    let newName = constraint_name;
    if (constraint_name.toLowerCase().startsWith(table_name.toLowerCase())) {
      newName = newTableName + constraint_name.slice(table_name.length);
    } else if (constraint_name.includes(table_name)) {
      newName = constraint_name.replace(table_name, newTableName);
    }
    newName = newName.toLowerCase().replace(/__+/g, '_');
    constraintSection[constraint_name] = {
      new: newName,
      table: table_name,
      type: constraint_type,
      flagged: false,
    };
  }

  // ── CDC trigger mapping ───────────────────────────────────────────────────────────────────────
  // Parse trigger defs to extract PK column and sinks.
  const triggerSection: Record<string, {
    new_table: string;
    pk_old: string;
    pk_new: string;
    sinks: string[];
    trigger_def: string;
  }> = {};

  for (const { table_name, trigger_def } of trigRows) {
    // Extract args from: EXECUTE FUNCTION "cdc_capture"('PKcol', 'sink1'[, 'sink2'])
    const argsMatch = trigger_def.match(/cdc_capture\(([^)]+)\)/);
    if (!argsMatch) continue;
    const args = argsMatch[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) ?? [];
    if (args.length < 2) continue;

    const [pkOld, ...sinks] = args;
    const newTable = tableSection[table_name]?.new ?? table_name;
    // Find the new column name for this PK
    const colEntry = columnSection[table_name]?.[pkOld];
    const pkNew = colEntry?.new ?? toSnakeCase(pkOld);

    triggerSection[table_name] = {
      new_table: newTable,
      pk_old: pkOld,
      pk_new: pkNew,
      sinks,
      trigger_def,
    };
  }

  // ── dolphin_sync_map data updates ────────────────────────────────────────────────────────────
  // The dolphin_sync_map.local_table column stores raw table names as strings.
  // These need a SQL UPDATE after the rename.
  const dolphinSyncMapUpdates: Array<{ old_table: string; new_table: string }> = [];
  for (const [old, entry] of Object.entries(tableSection)) {
    if (entry.new !== old && !entry.flagged) {
      dolphinSyncMapUpdates.push({ old_table: old, new_table: entry.new });
    }
  }

  // ── Summary stats ─────────────────────────────────────────────────────────────────────────────
  const flaggedTables = Object.values(tableSection).filter(e => e.flagged).length;
  const flaggedCols = Object.values(columnSection)
    .flatMap(t => Object.values(t))
    .filter(e => e.flagged).length;

  // ── Output ────────────────────────────────────────────────────────────────────────────────────
  const mapping = {
    _meta: {
      source_db: dbName,
      generated_at: new Date().toISOString(),
      review_status: 'DRAFT — human review required before running emit-migration.ts',
      instructions: [
        '1. Resolve every item with flagged:true (TABLE_COLLISION, COLUMN_COLLISION, RESERVED_WORD).',
        '2. Review prefix_strip_suggestions and manually apply desired strips to the columns section.',
        '3. Check every table new-name for domain correctness (typos, clarity).',
        '4. Check every trigger entry: pk_new must match the column rename above.',
        '5. Set review_status to "REVIEWED" when done.',
      ],
      stats: {
        tables: tableNames.length,
        flagged_tables: flaggedTables,
        flagged_columns: flaggedCols,
        cdc_triggers: trigRows.length,
        sequences: seqRows.length,
        indexes: idxRows.length,
        constraints: constraintRows.length,
      },
    },
    flags,
    tables: tableSection,
    columns: columnSection,
    sequences: sequenceSection,
    indexes: indexSection,
    constraints: constraintSection,
    triggers: triggerSection,
    dolphin_sync_map_updates: dolphinSyncMapUpdates,
    prefix_strip_suggestions: prefixSuggestions,
  };

  const outPath = path.join(__dirname, 'mapping.json');
  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2), 'utf8');

  console.log(`\n✅ Wrote ${outPath}`);
  console.log(`   Tables:          ${tableNames.length} (${flaggedTables} flagged)`);
  console.log(`   Columns:         ${colRows.length} (${flaggedCols} flagged)`);
  console.log(`   CDC triggers:    ${trigRows.length}`);
  console.log(`   Sequences:       ${seqRows.length}`);
  console.log(`   Indexes:         ${idxRows.length}`);
  console.log(`   Constraints:     ${constraintRows.length}`);
  if (flags.length > 0) {
    console.log(`\n⚠️  ${flags.length} flag(s) require manual resolution before proceeding.`);
    for (const f of flags) {
      console.log(`   → ${JSON.stringify(f)}`);
    }
  }
}

main()
  .catch(err => { console.error('❌', err.message); process.exit(1); })
  .finally(() => pool.end());
