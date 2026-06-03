/**
 * Phase 2 — Apply table/column renames to all Kysely query modules and related files.
 *
 * Uses mapping.json to replace old table names and column names throughout TypeScript
 * source files. Handles all Kysely string patterns:
 *
 *   selectFrom/updateTable/deleteFrom/insertInto:
 *     'tblAlerts'             → 'alerts'
 *     'tblAlerts as al'       → 'alerts as al'
 *
 *   Qualified column refs (table/alias + column, optional SQL AS alias):
 *     'tblAlerts.AlertID'     → 'alerts.alert_id'
 *     'al.AlertID'            → 'al.alert_id'
 *     'al.AlertID as FooBar'  → 'al.alert_id as FooBar'
 *     'at.TypeName as TypeNm' → 'at.type_name as TypeNm'
 *
 *   Bare column refs:
 *     'AlertID'               → 'alert_id'
 *     'AlertID as Alias'      → 'alert_id as Alias'
 *
 *   TypeScript object keys and interface members:
 *     { PersonID: val }       → { person_id: val }
 *     PersonID: number        → person_id: number  (interface member)
 *
 *   TypeScript property accesses:
 *     alertData.PersonID      → alertData.person_id
 *
 * Run:
 *   npx tsx scripts/schema-rename/apply-codemod.ts [--dry-run]
 *
 * After running: npx tsc --noEmit  (then fix remaining manual items)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');

const mapping = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'mapping.json'), 'utf8')
);

// ── Build lookup maps ─────────────────────────────────────────────────────────────────────────────

const tableMap = new Map<string, string>();
for (const [old, entry] of Object.entries(mapping.tables as Record<string, { new: string }>)) {
  if (old !== entry.new) tableMap.set(old, entry.new);
}

// Flat col map across all tables (same old name always maps to same new name)
const colMap = new Map<string, string>();
for (const [, cols] of Object.entries(mapping.columns as Record<string, Record<string, { new: string }>>)) {
  for (const [old, entry] of Object.entries(cols)) {
    if (old !== entry.new) colMap.set(old, entry.new);
  }
}

// Sort by length desc — longest patterns replaced first to avoid partial-match bugs
const sortedTables = [...tableMap.entries()].sort((a, b) => b[0].length - a[0].length);
const sortedCols   = [...colMap.entries()].sort((a, b) => b[0].length - a[0].length);

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Transform ─────────────────────────────────────────────────────────────────────────────────────
function transform(content: string): string {
  let s = content;

  // ── Stage A: Table name renames in string literals ──────────────────────────────────────────────

  // A1. Qualified table.column (known old table name, exact match on both parts)
  //     'tblAlerts.AlertID' → 'alerts.alert_id'
  //     Run first (most specific) to avoid double-processing.
  for (const [oldTable, newTable] of sortedTables) {
    for (const [oldCol, newCol] of sortedCols) {
      s = s.replace(
        new RegExp(`(['"])${esc(oldTable)}\\.${esc(oldCol)}(['"])`, 'g'),
        (_, q1, q2) => `${q1}${newTable}.${newCol}${q2}`
      );
    }
  }

  // A2. Table with SQL alias: 'oldTable as alias'
  for (const [oldTable, newTable] of sortedTables) {
    s = s.replace(
      new RegExp(`(['"])${esc(oldTable)}(\\s+as\\s+[a-zA-Z_][a-zA-Z0-9_]*)(['"])`, 'g'),
      (_, q1, alias, q2) => `${q1}${newTable}${alias}${q2}`
    );
  }

  // A3. Bare table name in string
  for (const [oldTable, newTable] of sortedTables) {
    s = s.replace(
      new RegExp(`(['"])${esc(oldTable)}(['"])`, 'g'),
      (_, q1, q2) => `${q1}${newTable}${q2}`
    );
  }

  // ── Stage B: Column name renames in string literals ─────────────────────────────────────────────
  //
  // One comprehensive regex per column handles all 4 string patterns:
  //   'col'                    (bare, no prefix, no AS)
  //   'col as alias'           (bare with SQL AS alias)
  //   'prefix.col'             (qualified, no AS)
  //   'prefix.col as alias'    (qualified with AS)
  //
  // The 'prefix.' part can be a table alias ('al.', 'at.', 'p.') or a table name that was
  // already renamed in Stage A (unlikely to appear here since Stage A handled those).

  for (const [oldCol, newCol] of sortedCols) {
    // Group 1: opening quote
    // Group 2: optional 'prefix.' (table or alias followed by a dot)
    // Group 3: the old column name (captured but replaced with newCol)
    // Group 4: optional ' as sqlAlias'
    // Group 5: closing quote
    s = s.replace(
      new RegExp(
        `(['"])((?:[a-zA-Z_][a-zA-Z0-9_]*\\.)?)(${esc(oldCol)})((?:\\s+as\\s+[a-zA-Z_][a-zA-Z0-9_]*)?)(['"])`,
        'g'
      ),
      (_, q1, prefix, _col, asAlias, q2) => `${q1}${prefix}${newCol}${asAlias}${q2}`
    );
  }

  // ── Stage C: TypeScript (non-string) rename ─────────────────────────────────────────────────────
  //
  // Only apply to column names that have uppercase letters (PascalCase/camelCase old DB names).
  // All-lowercase old names are already handled via Stage B string replacements.
  // Risk of false positives is low in query files — PascalCase is almost exclusively column names.

  for (const [oldCol, newCol] of sortedCols) {
    if (oldCol === oldCol.toLowerCase()) continue; // already handled or all-lowercase

    // C1. Object key / interface member: OldCol followed by ':'
    //     Handles: { PersonID: val }, interface Alert { PersonID: number }
    s = s.replace(
      new RegExp(`\\b${esc(oldCol)}\\b(?=\\s*:)`, 'g'),
      newCol
    );

    // C2. Property access: .OldCol (word after dot)
    //     Handles: alertData.PersonID, row.IsActive, etc.
    s = s.replace(
      new RegExp(`(?<=\\.)\\b${esc(oldCol)}\\b`, 'g'),
      newCol
    );

    // C3. Standalone identifiers — covers:
    //   - Destructured variables: const { PersonID } = result
    //   - Shorthand properties: return { PersonID, workId }
    //   - Function arguments: log.info('x', { PersonID: x })  ← covered by C1
    //   - Any remaining standalone uses in code
    // Only apply to PascalCase names (uppercase first char) to reduce false-positive risk.
    // Names starting with lowercase are risky (could be generic JS vars) — skip those.
    if (/^[A-Z]/.test(oldCol)) {
      s = s.replace(new RegExp(`\\b${esc(oldCol)}\\b`, 'g'), newCol);
    }
  }

  return s;
}

// ── Files to transform ────────────────────────────────────────────────────────────────────────────
const REPO_ROOT = path.join(__dirname, '..', '..');

function tsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => path.join(dir, f));
}

const TARGET_FILES = [
  // Kysely query modules (direct DB access)
  ...tsFiles(path.join(REPO_ROOT, 'services/database/queries')),
  // Business services (work with DB result objects)
  ...tsFiles(path.join(REPO_ROOT, 'services/business')),
  // API routes (pass data to/from business services)
  ...tsFiles(path.join(REPO_ROOT, 'routes/api')),
  path.join(REPO_ROOT, 'routes/calendar.ts'),
  path.join(REPO_ROOT, 'routes/portal.ts'),
  ...tsFiles(path.join(REPO_ROOT, 'routes/public')),
  // Other services with DB column references
  path.join(REPO_ROOT, 'services/sync/cdc/dolphin-sink.ts'),
  path.join(REPO_ROOT, 'services/messaging/chair-payload-builder.ts'),
  path.join(REPO_ROOT, 'services/pdf/appointment-pdf-generator.ts'),
  path.join(REPO_ROOT, 'services/templates/receipt-service.ts'),
].filter(fs.existsSync);

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────
let changed = 0;
let unchanged = 0;

for (const filePath of TARGET_FILES) {
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠️  Not found: ${filePath}`);
    continue;
  }
  const original = fs.readFileSync(filePath, 'utf8');
  const transformed = transform(original);

  if (transformed === original) {
    unchanged++;
    continue;
  }

  changed++;
  const rel = path.relative(REPO_ROOT, filePath);
  if (DRY_RUN) {
    console.log(`  [DRY] Would update: ${rel}`);
  } else {
    fs.writeFileSync(filePath, transformed, 'utf8');
    console.log(`  ✓  Updated: ${rel}`);
  }
}

console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Transformed ${changed} files, ${unchanged} unchanged.`);
