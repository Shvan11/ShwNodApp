/**
 * Phase 1 — Emit the SQL rename migration from the reviewed mapping.json.
 *
 * Run AFTER human review of mapping.json is complete
 * (review_status must be "REVIEWED" — enforced below).
 *
 * Run:
 *   npx tsx scripts/schema-rename/emit-migration.ts
 *
 * Output: migrations/pg/<timestamp>_rename-schema-to-snake-case.sql
 *
 * The migration is wrapped by node-pg-migrate in a transaction → all-or-nothing.
 * It deliberately OMITS the tables / columns / sequences that don't need renaming
 * (already snake_case), so it only emits ALTER TABLE statements for rows where
 * mapping.new !== mapping.old.
 *
 * Up block order (safe with PG OID-based FK/trigger tracking):
 *   1. Rename tables          (FKs, indexes, triggers follow automatically by OID)
 *   2. Rename columns         (FK refs + index column refs follow automatically by OID)
 *   3. Rename sequences       (cosmetic; IDENTITY ownership follows column by OID)
 *   4. Rename indexes         (cosmetic; backed by OID, so only the name changes)
 *   5. Rename FK / UNIQUE / CHECK constraints (cosmetic)
 *   6. Drop + re-create CDC triggers  (CRITICAL: TG_ARGV[0] is a string PK name,
 *      NOT OID-tracked, so it must be explicitly updated)
 *   7. UPDATE dolphin_sync_map  (local_table column stores raw table-name strings)
 *
 * Down block reverses every step.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAPPING_PATH = path.join(__dirname, 'mapping.json');

// ── Load & validate mapping ───────────────────────────────────────────────────────────────────────
const raw = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));

// Enforce review gate — emit is blocked on unreviewed or flagged mappings.
// To bypass during development, set env ALLOW_DRAFT=1.
if (
  raw._meta?.review_status !== 'REVIEWED' &&
  process.env.ALLOW_DRAFT !== '1'
) {
  console.error('❌  mapping.json is not marked as REVIEWED.');
  console.error('   Set _meta.review_status = "REVIEWED" after human review, or');
  console.error('   set env ALLOW_DRAFT=1 to force-emit anyway (for iterative testing).');
  process.exit(1);
}

const anyFlagged = (
  Object.values(raw.tables as Record<string, { flagged: boolean }>).some(e => e.flagged) ||
  Object.values(raw.columns as Record<string, Record<string, { flagged: boolean }>>)
    .flatMap(t => Object.values(t)).some(e => e.flagged)
);
if (anyFlagged && process.env.ALLOW_DRAFT !== '1') {
  console.error('❌  mapping.json has unresolved flagged entries. Resolve them before emitting.');
  process.exit(1);
}

type TableEntry   = { new: string; flagged: boolean };
type ColEntry     = { new: string; flagged: boolean };
type SeqEntry     = { new: string; owner_table: string | null; owner_col: string | null; flagged: boolean };
type IdxEntry     = { new: string; table: string; flagged: boolean };
type ConstrEntry  = { new: string; table: string; type: string; flagged: boolean };
type TrigEntry    = { new_table: string; pk_old: string; pk_new: string; sinks: string[]; trigger_def: string };
type DsmUpdate    = { old_table: string; new_table: string };

const tables:     Record<string, TableEntry>   = raw.tables;
const columns:    Record<string, Record<string, ColEntry>> = raw.columns;
const sequences:  Record<string, SeqEntry>     = raw.sequences;
const indexes:    Record<string, IdxEntry>     = raw.indexes;
const constraints: Record<string, ConstrEntry> = raw.constraints;
const triggers:   Record<string, TrigEntry>    = raw.triggers;
const dsmUpdates: DsmUpdate[]                  = raw.dolphin_sync_map_updates ?? [];

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────
const q  = (name: string) => `"${name}"`;  // always quote identifiers to preserve case
const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;  // SQL string literal

function changed(old: string, n: string) { return old !== n; }

// ── Build up/down blocks ──────────────────────────────────────────────────────────────────────────
const up: string[]   = [];
const down: string[] = [];

// 1. Rename tables
const renamedTables: Array<{ old: string; n: string }> = [];
for (const [old, entry] of Object.entries(tables)) {
  if (!changed(old, entry.new)) continue;
  up.push(`ALTER TABLE ${q(old)} RENAME TO ${q(entry.new)};`);
  down.push(`ALTER TABLE ${q(entry.new)} RENAME TO ${q(old)};`);
  renamedTables.push({ old, n: entry.new });
}

// 2. Rename columns (use the NEW table name in the ALTER — table was renamed in step 1)
for (const [tableName, cols] of Object.entries(columns)) {
  const newTableName = tables[tableName]?.new ?? tableName;
  for (const [colOld, colEntry] of Object.entries(cols)) {
    if (!changed(colOld, colEntry.new)) continue;
    up.push(`ALTER TABLE ${q(newTableName)} RENAME COLUMN ${q(colOld)} TO ${q(colEntry.new)};`);
    down.push(`ALTER TABLE ${q(newTableName)} RENAME COLUMN ${q(colEntry.new)} TO ${q(colOld)};`);
  }
}

// 3. Rename sequences (cosmetic; IDENTITY ownership follows by OID)
for (const [old, entry] of Object.entries(sequences)) {
  if (!changed(old, entry.new)) continue;
  up.push(`ALTER SEQUENCE ${q(old)} RENAME TO ${q(entry.new)};`);
  down.push(`ALTER SEQUENCE ${q(entry.new)} RENAME TO ${q(old)};`);
}

// 4. Rename indexes (cosmetic; PK indexes are named <table>_pkey etc.)
// Skip: we only rename non-pk indexes to avoid conflicting with automatic pkey renames.
// PK constraint / index names follow the table rename automatically? Actually NO — PG does NOT
// auto-rename the index name when you rename a table. We need to rename them explicitly.
// HOWEVER: ALTER TABLE ... RENAME does NOT rename associated constraint names (pkey, etc.),
// only the table itself. The _pkey index name stays as the old name until we rename it.
// Note: ALTER INDEX can be used directly on index names.
const skippedIndexes = new Set<string>(); // track PK backing indexes (renamed via constraint)
for (const [old, entry] of Object.entries(indexes)) {
  if (!changed(old, entry.new)) continue;
  // PK backing indexes have the same name as the PK constraint (ending _pkey).
  // Renaming the constraint (step 5) implicitly renames the backing index in PG.
  // So skip here if there's a constraint with the same name.
  if (constraints[old]) {
    skippedIndexes.add(old);
    continue;
  }
  up.push(`ALTER INDEX ${q(old)} RENAME TO ${q(entry.new)};`);
  down.push(`ALTER INDEX ${q(entry.new)} RENAME TO ${q(old)};`);
}

// 5. Rename constraints (FK, UNIQUE, CHECK — and implicit PK renamed via ALTER TABLE RENAME CONSTRAINT)
for (const [old, entry] of Object.entries(constraints)) {
  if (!changed(old, entry.new)) continue;
  const tblNew = tables[entry.table]?.new ?? entry.table;
  up.push(`ALTER TABLE ${q(tblNew)} RENAME CONSTRAINT ${q(old)} TO ${q(entry.new)};`);
  down.push(`ALTER TABLE ${q(tblNew)} RENAME CONSTRAINT ${q(entry.new)} TO ${q(old)};`);
}

// 6. Drop + re-create CDC triggers (critical: TG_ARGV[0] is a string PK name, not OID-tracked)
// Emit only for tables where pk_old !== pk_new OR the table was renamed (both need a re-create).
for (const [oldTable, trig] of Object.entries(triggers)) {
  const tableRenamed = changed(oldTable, trig.new_table);
  const pkRenamed    = changed(trig.pk_old, trig.pk_new);
  if (!tableRenamed && !pkRenamed) continue;

  const sinksArgs = [sq(trig.pk_new), ...trig.sinks.map(s => sq(s))].join(', ');
  const sinksArgsOld = [sq(trig.pk_old), ...trig.sinks.map(s => sq(s))].join(', ');

  // The trigger name is always "trg_cdc_capture" (single trigger per table, enforced by migration).
  up.push(`DROP TRIGGER IF EXISTS "trg_cdc_capture" ON ${q(trig.new_table)};`);
  up.push(
    `CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON ${q(trig.new_table)}` +
    `  FOR EACH ROW EXECUTE FUNCTION "cdc_capture"(${sinksArgs});`
  );

  down.push(`DROP TRIGGER IF EXISTS "trg_cdc_capture" ON ${q(trig.new_table)};`);
  down.push(
    `CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON ${q(trig.new_table)}` +
    `  FOR EACH ROW EXECUTE FUNCTION "cdc_capture"(${sinksArgsOld});`
  );
}

// 7. dolphin_sync_map data updates (local_table column stores raw table-name strings)
for (const { old_table, new_table } of dsmUpdates) {
  if (!changed(old_table, new_table)) continue;
  up.push(
    `UPDATE "dolphin_sync_map" SET "local_table" = ${sq(new_table)} WHERE "local_table" = ${sq(old_table)};`
  );
  down.push(
    `UPDATE "dolphin_sync_map" SET "local_table" = ${sq(old_table)} WHERE "local_table" = ${sq(new_table)};`
  );
}

// ── Format & write ────────────────────────────────────────────────────────────────────────────────
const timestamp = Date.now();
const outName = `${timestamp}_rename-schema-to-snake-case.sql`;
const outPath = path.join(__dirname, '..', '..', 'migrations', 'pg', outName);

const tableCount   = renamedTables.length;
const colCount     = Object.entries(columns).flatMap(([t, c]) =>
  Object.entries(c).filter(([old, e]) => changed(old, e.new))).length;
const seqCount     = Object.entries(sequences).filter(([o, e]) => changed(o, e.new)).length;
const idxCount     = Object.entries(indexes).filter(([o, e]) => changed(o, e.new) && !constraints[o]).length;
const constrCount  = Object.entries(constraints).filter(([o, e]) => changed(o, e.new)).length;
const trigCount    = Object.entries(triggers).filter(([t, e]) => changed(t, e.new_table) || changed(e.pk_old, e.pk_new)).length;
const dsmCount     = dsmUpdates.filter(({ old_table, new_table }) => changed(old_table, new_table)).length;

const header = `-- Up Migration
--
-- Big-bang schema rename: strip Hungarian tbl/tb prefix, adopt snake_case for all tables
-- and columns.  Generated from scripts/schema-rename/mapping.json by emit-migration.ts.
-- Do NOT edit manually — re-run emit-migration.ts if the mapping changes.
--
-- Stats: ${tableCount} table renames, ${colCount} column renames, ${seqCount} sequence renames,
--        ${idxCount} index renames, ${constrCount} constraint renames,
--        ${trigCount} CDC trigger re-creates (TG_ARGV[0] PK name must be updated),
--        ${dsmCount} dolphin_sync_map row updates.
--
-- The migration is wrapped by node-pg-migrate in a transaction → all-or-nothing.
-- See docs in scripts/schema-rename/emit-migration.ts and the grand-plan document.
`;

const separator = (label: string) => `\n-- ── ${label} ${'─'.repeat(Math.max(0, 72 - label.length))}`;

const upSections = [
  `${separator('1. Rename tables')}`,
  ...renamedTables.map(({ old, n }) => `ALTER TABLE ${q(old)} RENAME TO ${q(n)};`),

  `${separator('2. Rename columns')}`,
  ...Object.entries(columns).flatMap(([tableName, cols]) => {
    const newTableName = tables[tableName]?.new ?? tableName;
    return Object.entries(cols)
      .filter(([old, e]) => changed(old, e.new))
      .map(([old, e]) => `ALTER TABLE ${q(newTableName)} RENAME COLUMN ${q(old)} TO ${q(e.new)};`);
  }),

  `${separator('3. Rename sequences')}`,
  ...Object.entries(sequences)
    .filter(([o, e]) => changed(o, e.new))
    .map(([o, e]) => `ALTER SEQUENCE ${q(o)} RENAME TO ${q(e.new)};`),

  `${separator('4. Rename indexes')}`,
  ...Object.entries(indexes)
    .filter(([o, e]) => changed(o, e.new) && !constraints[o])
    .map(([o, e]) => `ALTER INDEX ${q(o)} RENAME TO ${q(e.new)};`),

  `${separator('5. Rename constraints (FK / UNIQUE / CHECK / PK)')}`,
  ...Object.entries(constraints)
    .filter(([o, e]) => changed(o, e.new))
    .map(([o, e]) => {
      const tblNew = tables[e.table]?.new ?? e.table;
      return `ALTER TABLE ${q(tblNew)} RENAME CONSTRAINT ${q(o)} TO ${q(e.new)};`;
    }),

  `${separator('6. Re-create CDC triggers with updated PK column names')}`,
  ...Object.entries(triggers)
    .filter(([t, e]) => changed(t, e.new_table) || changed(e.pk_old, e.pk_new))
    .flatMap(([, trig]) => {
      const sinksArgs = [sq(trig.pk_new), ...trig.sinks.map(s => sq(s))].join(', ');
      return [
        `DROP TRIGGER IF EXISTS "trg_cdc_capture" ON ${q(trig.new_table)};`,
        `CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON ${q(trig.new_table)}` +
          `  FOR EACH ROW EXECUTE FUNCTION "cdc_capture"(${sinksArgs});`,
      ];
    }),

  `${separator('7. dolphin_sync_map data rows (local_table = raw table name string)')}`,
  ...dsmUpdates
    .filter(({ old_table, new_table }) => changed(old_table, new_table))
    .map(({ old_table, new_table }) =>
      `UPDATE "dolphin_sync_map" SET "local_table" = ${sq(new_table)} WHERE "local_table" = ${sq(old_table)};`
    ),
];

// Down block — NOTE the critical ordering difference from up:
//   Columns must be restored BEFORE CDC triggers are re-created (trigger args are string PK names
//   that must match the live column name when the trigger fires — not OID-tracked).
//   Table renames come LAST so all prior ALTERs can reference the new (current) table name.
const downSections = [
  `\n-- Down Migration\n`,

  `${separator('7. Restore dolphin_sync_map')}`,
  ...dsmUpdates
    .filter(({ old_table, new_table }) => changed(old_table, new_table))
    .map(({ old_table, new_table }) =>
      `UPDATE "dolphin_sync_map" SET "local_table" = ${sq(old_table)} WHERE "local_table" = ${sq(new_table)};`
    ),

  `${separator('5. Restore constraints')}`,
  ...Object.entries(constraints)
    .filter(([o, e]) => changed(o, e.new))
    .map(([o, e]) => {
      const tblNew = tables[e.table]?.new ?? e.table;
      return `ALTER TABLE ${q(tblNew)} RENAME CONSTRAINT ${q(e.new)} TO ${q(o)};`;
    }),

  `${separator('4. Restore indexes')}`,
  ...Object.entries(indexes)
    .filter(([o, e]) => changed(o, e.new) && !constraints[o])
    .map(([o, e]) => `ALTER INDEX ${q(e.new)} RENAME TO ${q(o)};`),

  `${separator('3. Restore sequences')}`,
  ...Object.entries(sequences)
    .filter(([o, e]) => changed(o, e.new))
    .map(([o, e]) => `ALTER SEQUENCE ${q(e.new)} RENAME TO ${q(o)};`),

  `${separator('2. Restore columns (MUST be before trigger re-create)')}`,
  ...Object.entries(columns).flatMap(([tableName, cols]) => {
    const newTableName = tables[tableName]?.new ?? tableName;
    return Object.entries(cols)
      .filter(([old, e]) => changed(old, e.new))
      .map(([old, e]) => `ALTER TABLE ${q(newTableName)} RENAME COLUMN ${q(e.new)} TO ${q(old)};`);
  }),

  `${separator('6. Restore CDC triggers with original PK column names (columns already restored)')}`,
  ...Object.entries(triggers)
    .filter(([t, e]) => changed(t, e.new_table) || changed(e.pk_old, e.pk_new))
    .flatMap(([, trig]) => {
      const sinksArgsOld = [sq(trig.pk_old), ...trig.sinks.map(s => sq(s))].join(', ');
      return [
        `DROP TRIGGER IF EXISTS "trg_cdc_capture" ON ${q(trig.new_table)};`,
        `CREATE TRIGGER "trg_cdc_capture" AFTER INSERT OR UPDATE OR DELETE ON ${q(trig.new_table)}` +
          `  FOR EACH ROW EXECUTE FUNCTION "cdc_capture"(${sinksArgsOld});`,
      ];
    }),

  `${separator('1. Restore tables (last — triggers/constraints reference table by new name)')}`,
  ...renamedTables.map(({ old, n }) => `ALTER TABLE ${q(n)} RENAME TO ${q(old)};`),
];

const sql = [
  header,
  upSections.join('\n'),
  downSections.join('\n'),
].join('\n');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, sql, 'utf8');

console.log(`\n✅ Wrote ${outPath}`);
console.log(`   Table renames:      ${tableCount}`);
console.log(`   Column renames:     ${colCount}`);
console.log(`   Sequence renames:   ${seqCount}`);
console.log(`   Index renames:      ${idxCount}`);
console.log(`   Constraint renames: ${constrCount}`);
console.log(`   CDC trigger re-creates: ${trigCount}`);
console.log(`   dolphin_sync_map updates: ${dsmCount}`);
console.log(`\nNext: review the SQL, then run: npm run db:migrate (against shwan_test first)`);
