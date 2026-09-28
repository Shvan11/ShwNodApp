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
 * The gate has no database, so these read the migration files. The real install path is
 * proven by hand (empty database → `npm run db:migrate` → `npm run db:check`); see
 * docs/db-migrations.md, "Fresh install".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PATIENT_TYPE_IDS, WORK_STATUS } from '../../shared/treatment-taxonomy.js';

const DIR = fileURLToPath(new URL('../../migrations/pg/', import.meta.url));
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
});
