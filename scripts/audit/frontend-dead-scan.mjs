#!/usr/bin/env node
/**
 * Frontend dead-code scan — the mechanical half of the F0 sweep in
 * `docs/frontend-audit-tracker.md`, re-runnable by any later session (F24's
 * orphan pass, every remediation session's "did we add to the pile?" check).
 *
 *   node scripts/audit/frontend-dead-scan.mjs [--exports] [--css] [--files]
 *
 * With no flag it runs all three scans:
 *   files   — *.ts/*.tsx under public/js that nothing imports (entry points and
 *             *.test.* excluded). Resolves relative specifiers plus the frontend
 *             tsconfig aliases (@/, @components/, @services/, @hooks/,
 *             @contexts/, @utils/, @types/); bare packages and @shared are
 *             deliberately ignored (they are not frontend files).
 *   exports — exported names no OTHER file under public/js references. Names
 *             flagged `(used locally)` are only the `export` keyword being
 *             unnecessary; the ones without that tag are the real leads.
 *   css     — *.module.css with no importer, and public/css/** not reached from
 *             an entry HTML, a TS import or an @import.
 *
 * Deliberately a lead generator, not a verdict: it matches identifiers textually,
 * so a name re-exported through a barrel, reached only from server code, or
 * referenced from a string (dynamic `import()`, the ContentRenderer preloader
 * map) can show up. Confirm every hit with a repo-wide grep before deleting —
 * that confirmation step is what the owning audit session is for.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';

const ROOT = process.cwd();
const BASE = join(ROOT, 'public/js');
const CSS_GLOBAL = join(ROOT, 'public/css');

const args = process.argv.slice(2);
const runAll = args.length === 0;
const want = (name) => runAll || args.includes(`--${name}`);

function walk(dir, test, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}

const isSource = (n) => /\.(ts|tsx)$/.test(n) && !n.endsWith('.d.ts');
const files = walk(BASE, isSource);
const src = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

const ALIASES = {
  '@/': BASE,
  '@components/': join(BASE, 'components'),
  '@services/': join(BASE, 'services'),
  '@hooks/': join(BASE, 'hooks'),
  '@contexts/': join(BASE, 'contexts'),
  '@utils/': join(BASE, 'utils'),
  '@types/': join(BASE, 'types'),
};

function resolveSpec(fromFile, spec) {
  let p = null;
  for (const [alias, dir] of Object.entries(ALIASES)) {
    if (spec.startsWith(alias)) { p = join(dir, spec.slice(alias.length)); break; }
  }
  if (!p && spec.startsWith('.')) p = resolve(dirname(fromFile), spec);
  if (!p) return null;
  const stripped = p.replace(/\.jsx?$/, '');
  for (const c of [p, stripped]) {
    for (const cand of [c, `${c}.ts`, `${c}.tsx`, join(c, 'index.ts'), join(c, 'index.tsx')]) {
      try { if (statSync(cand).isFile() && /\.(ts|tsx)$/.test(cand)) return cand; } catch { /* not this one */ }
    }
  }
  return null;
}

// ── files ────────────────────────────────────────────────────────────────────
if (want('files')) {
  const imported = new Set();
  const specRe = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const [f, text] of src) {
    specRe.lastIndex = 0;
    let m;
    while ((m = specRe.exec(text))) {
      const r = resolveSpec(f, m[1]);
      if (r) imported.add(r);
    }
  }
  const entries = new Set(['public/js/App.tsx']);
  for (const html of ['public/index.html', 'public/login.html', 'public/portal.html']) {
    let t = '';
    try { t = readFileSync(join(ROOT, html), 'utf8'); } catch { continue; }
    // HTML srcs are site-root paths ("/js/portal/main.tsx") → repo paths under public/
    for (const m of t.matchAll(/src=["']\/?([^"']+\.tsx?)["']/g)) {
      entries.add(m[1].startsWith('public/') ? m[1] : join('public', m[1]));
    }
  }
  const orphans = files
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .filter((f) => !entries.has(relative(ROOT, f)))
    .filter((f) => !imported.has(f))
    .map((f) => ({ rel: relative(ROOT, f), loc: src.get(f).split('\n').length }))
    .sort((a, b) => b.loc - a.loc);
  console.log(`\n── unimported files (${orphans.length} of ${files.length} scanned) ──`);
  for (const o of orphans) console.log(`  ${String(o.loc).padStart(5)}  ${o.rel}`);
}

// ── exports ──────────────────────────────────────────────────────────────────
if (want('exports')) {
  const declRes = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm,
    /^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm,
    /^export\s+class\s+([A-Za-z0-9_$]+)/gm,
    /^export\s+(?:type|interface|enum)\s+([A-Za-z0-9_$]+)/gm,
  ];
  const listRe = /^export\s*\{([^}]*)\}/gm;
  const dead = new Map();
  for (const [f, text] of src) {
    const names = new Set();
    for (const re of declRes) { re.lastIndex = 0; let m; while ((m = re.exec(text))) names.add(m[1]); }
    listRe.lastIndex = 0;
    let m;
    while ((m = listRe.exec(text))) {
      for (const raw of m[1].split(',')) {
        const part = raw.trim().replace(/^type\s+/, '');
        if (!part) continue;
        const as = part.split(/\s+as\s+/);
        names.add((as[1] || as[0]).trim());
      }
    }
    for (const n of names) {
      if (!n || n === 'default') continue;
      const word = new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`);
      let usedElsewhere = false;
      for (const [g, t] of src) {
        if (g !== f && word.test(t)) { usedElsewhere = true; break; }
      }
      if (usedElsewhere) continue;
      const selfUses = (text.match(new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`, 'g')) || []).length;
      const rel = relative(ROOT, f);
      if (!dead.has(rel)) dead.set(rel, []);
      dead.get(rel).push(selfUses > 1 ? `${n} (used locally)` : n);
    }
  }
  const total = [...dead.values()].reduce((s, a) => s + a.length, 0);
  console.log(`\n── exports nothing else in public/js references (${total}) ──`);
  for (const [f, names] of [...dead].sort()) console.log(`  ${f}\n      ${names.join(', ')}`);
}

// ── css ──────────────────────────────────────────────────────────────────────
if (want('css')) {
  const all = [...src.values()].join('\n');
  const modules = walk(BASE, (n) => n.endsWith('.module.css'));
  const orphanModules = modules.filter((f) => !all.includes(basename(f)));
  console.log(`\n── orphan *.module.css (${orphanModules.length} of ${modules.length}) ──`);
  for (const f of orphanModules) console.log(`  ${relative(ROOT, f)}`);

  const globals = walk(CSS_GLOBAL, (n) => n.endsWith('.css'));
  const haystack = [
    all,
    ...walk(join(ROOT, 'public'), (n) => n.endsWith('.html')).map((f) => readFileSync(f, 'utf8')),
    ...globals.map((f) => readFileSync(f, 'utf8')),
  ].join('\n');
  const unreached = globals.filter((f) => {
    // count references outside the file's own text
    const own = readFileSync(f, 'utf8');
    const hits = haystack.split(basename(f)).length - 1;
    const selfHits = own.split(basename(f)).length - 1;
    return hits - selfHits === 0;
  });
  console.log(`\n── public/css files nothing imports (${unreached.length} of ${globals.length}) ──`);
  for (const f of unreached) console.log(`  ${relative(ROOT, f)}`);
}
