/**
 * @vitest-environment node
 *
 * A brand-new deployment must install with plain `npm run db:migrate` — DB-free checks.
 *
 * Two defects stopped that until 2026-09-28 (F9 frontend audit, "found along the way"):
 *  - the baseline created `pgmigrations`, the table node-pg-migrate creates before running
 *    the first file, so every empty database failed with `relation "pgmigrations" already
 *    exists`;
 *  - `work_statuses` and `patient_types`, whose ids are code constants and FK targets, were
 *    never seeded, so the first work insert and the first patient reclassification failed.
 *
 * A third pass (2026-09-29, building `npm run db:setup`) found the rest of what the code names
 * but no migration seeded: the work types, the tooth vocabulary the chart SVGs are named after,
 * the receipt document type + its default template (no on-disk fallback), the 'Doctor' position
 * every doctor list filters on, the 'Clinic' intake pseudo-doctor, and the calendar's tally table.
 *
 * The gate has no database, so these read the migration files. The real install path is
 * proven by hand (empty database → `npm run db:migrate` → `npm run db:check`); see
 * docs/db-migrations.md, "Fresh install".
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PATIENT_TYPE_IDS, WORK_STATUS, WORK_TYPE_IDS } from '../../shared/treatment-taxonomy.js';
import { EMPLOYEE_EXPENSE_CATEGORY, LAB_EXPENSE_CATEGORY } from '../../shared/expense-categories.js';
import { DEFAULT_TIME_POINT_NAMES } from '../../shared/time-point-names.js';
import { CODE_NAMED_TEMPLATE_NAMES } from '../templates/template-files.js';

const DIR = fileURLToPath(new URL('../../migrations/pg/', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/** A migration's Up section with comment lines removed — the SQL that actually runs. */
const upSql = (file: string): string => {
  const full = readFileSync(`${DIR}${file}`, 'utf8');
  const start = full.indexOf('-- Up Migration');
  const end = full.indexOf('-- Down Migration');
  const up = full.slice(start < 0 ? 0 : start, end < 0 ? undefined : end);
  return up
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
};

/** Every id that some migration's `INSERT INTO public.<table>` seeds, and whether each is idempotent. */
const seeded = (table: string) => {
  const ids = new Set<number>();
  const statements: string[] = [];
  const re = new RegExp(`INSERT INTO public\\.${table}\\b[\\s\\S]*?;`, 'g');
  for (const f of files) {
    for (const stmt of upSql(f).match(re) ?? []) {
      statements.push(stmt);
      for (const m of stmt.matchAll(/\(\s*(\d+)\s*,/g)) ids.add(Number(m[1]));
    }
  }
  return { ids, statements };
};

describe('fresh install', () => {
  it('there is exactly one baseline and it sorts first', () => {
    const baselines = files.filter((f) => /_baseline-/.test(f));
    expect(baselines).toHaveLength(1);
    expect(files[0]).toBe(baselines[0]);
  });

  it('no migration creates or alters node-pg-migrate’s ledger', () => {
    // DDL only: the baseline's guard legitimately names the ledger in its HINT text.
    const ledgerDdl = /\b(CREATE|ALTER|DROP)\s+(TABLE|SEQUENCE)\s+(IF\s+(NOT\s+)?EXISTS\s+)?(ONLY\s+)?("?public"?\.)?"?pgmigrations/i;
    for (const f of files) {
      expect(ledgerDdl.test(upSql(f)), f).toBe(false);
    }
  });

  it('nothing depends on pg_stat_statements, which a non-superuser install skips', () => {
    // The baseline creates it inside an EXCEPTION block; any unwrapped statement naming it
    // (pg_dump emits a COMMENT ON EXTENSION) fails the install when it was skipped.
    for (const f of files) {
      const outsideDoBlocks = upSql(f).replace(/\bDO\s+\$(\w*)\$[\s\S]*?\$\1\$\s*;/g, '');
      expect(outsideDoBlocks, f).not.toMatch(/pg_stat_statements/);
    }
  });

  it('every WORK_STATUS id is seeded, idempotently', () => {
    const { ids, statements } = seeded('work_statuses');
    for (const id of Object.values(WORK_STATUS)) expect(ids, `work_statuses ${id}`).toContain(id);
    for (const s of statements) expect(s).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/);
  });

  it('every PATIENT_TYPE_IDS id is seeded, idempotently', () => {
    const { ids, statements } = seeded('patient_types');
    for (const id of Object.values(PATIENT_TYPE_IDS)) expect(ids, `patient_types ${id}`).toContain(id);
    for (const s of statements) expect(s).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/);
  });

  it('every WORK_TYPE_IDS id is seeded, idempotently', () => {
    const { ids, statements } = seeded('work_types');
    for (const id of Object.values(WORK_TYPE_IDS)) expect(ids, `work_types ${id}`).toContain(id);
    for (const s of statements) expect(s).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/);
  });

  it('every chart SVG has a seeded tooth code, idempotently', () => {
    // DentalChart / TeethSelector address a tooth by `tooth_code` and load `<code>.svg`, so a
    // chart file with no seeded row is a tooth nobody can select on a new install.
    const { statements } = seeded('tooth_numbers');
    const codes = new Set(statements.flatMap((s) => [...s.matchAll(/\(\s*\d+\s*,\s*'([A-Z]{2}[1-8A-E])'/g)].map((m) => m[1])));
    const svgs = readdirSync(`${REPO}public/images/teeth/chart/`).filter((f) => f.endsWith('.svg'));
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(codes, svg).toContain(svg.replace(/\.svg$/, ''));
    for (const s of statements) expect(s).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/);
  });

  it('the default receipt is registered as document type 1, and its file ships', () => {
    // receipt-service.ts resolves the default receipt by `documentTypeId: 1` + is_default, with
    // no on-disk fallback — without this row every "print receipt" failed on a new install.
    const all = files.map(upSql).join('\n');
    expect(all).toMatch(/INSERT INTO public\.document_types[\s\S]*?\(\s*1\s*,\s*'receipt'/);
    const tpl = /INSERT INTO public\.document_templates[\s\S]*?SELECT[\s\S]*?,\s*1\s*,[\s\S]*?true,\s*true,\s*true,\s*'([^']+)'/.exec(all);
    expect(tpl, 'default receipt template row').not.toBeNull();
    expect(existsSync(`${REPO}${tpl![1]}`), tpl![1]).toBe(true);
  });

  it('every receipt layout the code finds by name is flagged a system template', () => {
    // receipt-service looks these rows up by `template_name`. Without `is_system` the
    // Templates screen offers Delete on them (the original clinic's discount receipt had it).
    const flagging = files
      .map(upSql)
      .join('\n')
      .match(/UPDATE public\.document_templates\s+SET is_system = true[\s\S]*?;/g);
    expect(flagging, 'a migration that sets is_system on the code-named templates').not.toBeNull();
    const sql = flagging!.join('\n');
    expect(CODE_NAMED_TEMPLATE_NAMES.length).toBeGreaterThan(0);
    for (const name of CODE_NAMED_TEMPLATE_NAMES) expect(sql, name).toContain(`'${name}'`);
  });

  it("the names the code matches on are seeded: the 'Doctor' position and the 'Clinic' pseudo-doctor", () => {
    const all = files.map(upSql).join('\n');
    expect(all).toMatch(/INSERT INTO public\.positions[\s\S]*?'Doctor'/);
    expect(all).toMatch(/INSERT INTO public\.employees[\s\S]*?'Clinic'/);
  });

  it('the expense categories the expense form keys on are seeded at their ids, idempotently', () => {
    const { ids, statements } = seeded('expense_categories');
    expect(ids).toContain(EMPLOYEE_EXPENSE_CATEGORY);
    expect(ids).toContain(LAB_EXPENSE_CATEGORY);
    for (const s of statements) expect(s).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/);
  });

  it('the photo-session names the product ships with are seeded, idempotently', () => {
    // 'Initial' and 'Final' are names the code matches on (the works' photo dates follow a
    // session so named), and the whole list is the Name select's fallback — the lookup a
    // new install starts with must be that same list.
    const { statements } = seeded('time_point_names');
    const sql = statements.join('\n');
    for (const name of DEFAULT_TIME_POINT_NAMES) expect(sql, name).toContain(`'${name}'`);
    for (const s of statements) expect(s).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/);
  });

  it("the calendar's tally table is seeded", () => {
    expect(files.map(upSql).join('\n')).toMatch(/INSERT INTO public\.numbers[\s\S]*?generate_series\(\s*0\s*,\s*366\s*\)/);
  });
});
