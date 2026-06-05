#!/usr/bin/env node
/**
 * Shared-contract rollout — Definition-of-Done measurement.
 *
 * Tracks the three open tiers of the `shared/contracts/*` rollout (see
 * `docs/shared-contract-progress.md`):
 *   D1 — hand-written request interfaces (`*Body|*Params|*Query|*Filters`) in routes/   (target 0)
 *   D2 — loose response markers (`z.unknown()` / `anyArray` / `z.array(z.unknown`) in   (target: allowlist only)
 *        shared/contracts/
 *   D3 — staff-app reads lacking a client `{ schema }` guard                            (heuristic; authoritative
 *        check is the `require-schema-on-reads` ESLint rule added in Phase 5)
 *
 * REPORT-ONLY by default (always exits 0). Phase 5 flips enforcement on by setting
 * `STRICT=1` (env) or passing `--strict`: the script then exits non-zero when D1/D2
 * regress past the BASELINE thresholds below. As each phase drives a tier toward its
 * target, lower the matching BASELINE entry so the gate ratchets and can't slip back.
 *
 * `scripts/**` is eslint-ignored (see eslint.config.js), so this file is not linted.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.env.STRICT === '1' || process.argv.includes('--strict');

// Phase-0 baselines (captured 2026-06-05). In STRICT mode the run fails if a count
// EXCEEDS its threshold — i.e. a regression. Lower these toward the target (0 /
// allowlist length) as each tier completes. D3 has no hard threshold (ESLint owns it).
const BASELINE = { D1: 33, D2: 41 };

/** Recursively collect files under `dir` whose name ends with one of `exts`. */
function walk(dir, exts, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walk(full, exts, acc);
    else if (exts.some((e) => ent.name.endsWith(e))) acc.push(full);
  }
  return acc;
}

const rel = (f) => relative(ROOT, f);

// ── D1: hand-written request interfaces in routes/ ─────────────────────────────
// Interface whose NAME ends with Body|Params|Query|Filter(s) — mirrors the ESLint
// selector `TSInterfaceDeclaration[id.name=/(Body|Params|Query|Filters?)$/]`.
// (`SessionData` & friends in `declare module 'express-session'` don't match.)
function measureD1() {
  const hits = [];
  const nameRe = /\binterface\s+([A-Za-z0-9_]+)/g;
  const suffixRe = /(Body|Params|Query|Filters?)$/;
  for (const file of walk(join(ROOT, 'routes'), ['.ts'])) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      let m;
      nameRe.lastIndex = 0;
      while ((m = nameRe.exec(line))) {
        if (suffixRe.test(m[1])) hits.push({ file: rel(file), line: i + 1, name: m[1] });
      }
    });
  }
  return hits;
}

// ── D2: loose response markers in shared/contracts/ ────────────────────────────
// One hit per LINE carrying a marker (matches the DoD grep `grep -rE … shared/contracts/`,
// which counts lines). A line is one loose slot — `z.array(z.unknown())` contains two
// sub-patterns but is a single marker, so line-granularity avoids double-counting it.
function measureD2() {
  const hits = [];
  const re = /z\.unknown\(\)|anyArray|z\.array\(z\.unknown/;
  for (const file of walk(join(ROOT, 'shared', 'contracts'), ['.ts'])) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push({ file: rel(file), line: i + 1, count: 1 });
    });
  }
  return hits;
}

// ── D3: client read-guard coverage (heuristic) ─────────────────────────────────
// Counts fetchJSON/apiLoader CALL SITES vs `schema:` usages across public/js. This
// is a rough proxy — `schema:` also appears on mutation calls, and multi-line calls
// aren't matched to their options precisely. The authoritative D3 check is the
// `require-schema-on-reads` ESLint rule (Phase 5).
function measureD3() {
  const callRe = /\b(?:fetchJSON|apiLoader)\s*[<(]/g;
  const schemaRe = /\bschema:/g;
  let calls = 0;
  let schemas = 0;
  for (const file of walk(join(ROOT, 'public', 'js'), ['.ts', '.tsx'])) {
    const src = readFileSync(file, 'utf8');
    calls += (src.match(callRe) || []).length;
    schemas += (src.match(schemaRe) || []).length;
  }
  return { calls, schemas, approxUnguarded: Math.max(0, calls - schemas) };
}

// ── Report ─────────────────────────────────────────────────────────────────────
function bar(label, n, threshold) {
  const flag = STRICT && threshold != null && n > threshold ? ' ✗ REGRESSION' : '';
  const tgt = threshold != null ? `  (baseline ${threshold})` : '';
  return `${label.padEnd(4)} ${String(n).padStart(4)}${tgt}${flag}`;
}

const d1 = measureD1();
const d2 = measureD2();
const d2Total = d2.reduce((s, h) => s + h.count, 0);
const d3 = measureD3();

console.log('\n── Shared-contract rollout — DoD measurement ──' + (STRICT ? '  [STRICT]' : '  [report-only]'));
console.log(bar('D1', d1.length, BASELINE.D1) + '  hand-written request interfaces in routes/  (target 0)');
console.log(bar('D2', d2Total, BASELINE.D2) + '  loose response markers in shared/contracts/  (target: allowlist only)');
console.log(
  `D3   ${String(d3.calls).padStart(4)}  read call sites · ${d3.schemas} schema usages · ~${d3.approxUnguarded} unguarded` +
    '  (heuristic — ESLint owns D3)'
);

if (process.argv.includes('--verbose') || process.argv.includes('-v')) {
  console.log('\nD1 detail:');
  for (const h of d1) console.log(`  ${h.file}:${h.line}  interface ${h.name}`);
  console.log('\nD2 by file:');
  const byFile = {};
  for (const h of d2) byFile[h.file] = (byFile[h.file] || 0) + h.count;
  for (const [f, c] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(3)}  ${f}`);
}

if (STRICT) {
  const fail = d1.length > BASELINE.D1 || d2Total > BASELINE.D2;
  if (fail) {
    console.error('\n✗ contracts:check FAILED — a tracked metric regressed past its baseline.\n');
    process.exit(1);
  }
  console.log('\n✓ contracts:check passed (no regression past baseline).\n');
}

process.exit(0);
