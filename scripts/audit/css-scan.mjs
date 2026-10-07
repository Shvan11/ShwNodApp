#!/usr/bin/env node
/**
 * CSS scan — the mechanical half of the F24 pass in `docs/frontend-audit-tracker.md`,
 * re-runnable by any later session (same role as `frontend-dead-scan.mjs`).
 *
 *   node scripts/audit/css-scan.mjs [--tokens] [--fallbacks] [--traps] [--colors]
 *                                   [--dead] [--keyframes] [--important] [--zindex]
 *
 * With no flag it runs everything:
 *   tokens     — custom properties used but never defined (a typo'd token makes the
 *                whole declaration invalid), and defined but never read.
 *   fallbacks  — `var(--x, fallback)`. House rule: none. A fallback on a DEFINED token
 *                is dead weight that drifts from the token; on an UNDEFINED one it is
 *                load-bearing, so fix the token name rather than stripping it.
 *   traps      — the three pairings the dark theme breaks (see the header of
 *                `public/css/base/theme-dark.css`): a pale or dark-end ramp step as a
 *                FILL under white text, a low gray as TEXT, flipping ink on a yellow fill.
 *   colors     — hard-coded colours outside the token sheets, print blocks and the
 *                pinned-light surfaces (scrims and translucent glints are skipped).
 *   dead       — classes in a `*.module.css` that no importer references.
 *   keyframes  — unused or duplicated `@keyframes`.
 *   important  — every `!important`, with its enclosing at-rule (print / a11y are fine).
 *   zindex     — z-index literals above the 0–3 local range (the scale is `--z-index-*`).
 *
 * A lead generator, not a verdict. `dead` in particular matches `styles.name` textually:
 * a class reached through a dynamic index (`styles[status]`), a `styles={styles}` prop
 * or `:global(...)` shows up, so confirm every hit by reading before deleting. Names
 * printed with a trailing `?` are referenced on SOME other styles object.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const want = (n) => args.length === 0 || args.includes(`--${n}`);

function walk(dir, test, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p);
const PUB = join(ROOT, 'public');
const read = (f) => readFileSync(f, 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const lineOf = (s, i) => s.slice(0, i).split('\n').length;

const css = new Map(walk(PUB, (n) => n.endsWith('.css')).map((f) => [f, read(f)]));
const ts = new Map(walk(join(PUB, 'js'), (n) => /\.(ts|tsx)$/.test(n) && !n.endsWith('.d.ts')).map((f) => [f, read(f)]));
const html = new Map(walk(PUB, (n) => n.endsWith('.html')).map((f) => [f, read(f)]));

// Token sheets and the surfaces that are deliberately not theme-aware.
const TOKEN_SHEET = /tokens-primitive\.css$|tokens-semantic\.css$|theme-dark\.css$|fonts\.css$/;
const PINNED = /\/portal\/|ChairDisplay\.module\.css$/;
const themed = [...css].filter(([f]) => !TOKEN_SHEET.test(f) && !PINNED.test(f));

/** Every `selector { body }` leaf rule, with the at-rule stack that encloses it. */
function rulesOf(s) {
  const out = [];
  const stack = [];
  let head = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') {
      const sel = s.slice(head, i).trim().replace(/\s+/g, ' ');
      const close = s.indexOf('}', i);
      const nextOpen = s.indexOf('{', i + 1);
      if (nextOpen === -1 || close < nextOpen) {
        out.push({ sel, body: s.slice(i + 1, close), line: lineOf(s, i), at: [...stack] });
        i = close;
      } else stack.push(sel);
      head = i + 1;
    } else if (s[i] === '}') {
      stack.pop();
      head = i + 1;
    }
  }
  return out;
}
const decl = (body, re) => (body.match(new RegExp(`(?:^|;|\\s)${re}\\s*:\\s*([^;]+)`)) || [])[1]?.trim();

// ── custom properties: defined vs used ─────────────────────────────────────
if (want('tokens')) {
  const defined = new Map();
  const addDef = (name, where) => { if (!defined.has(name)) defined.set(name, where); };
  for (const [f, raw] of css) {
    const s = stripComments(raw);
    for (const m of s.matchAll(/(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g)) addDef(m[1], rel(f));
    for (const m of s.matchAll(/@property\s+(--[A-Za-z0-9_-]+)/g)) addDef(m[1], rel(f));
  }
  for (const [f, s] of [...ts, ...html]) {
    for (const m of s.matchAll(/['"`](--[A-Za-z0-9_-]+)['"`]\s*(?:[:,\]])/g)) addDef(m[1], `${rel(f)} (js)`);
    for (const m of s.matchAll(/setProperty\(\s*['"`](--[A-Za-z0-9_-]+)/g)) addDef(m[1], `${rel(f)} (js)`);
    for (const m of s.matchAll(/(?:^|[;{\s"'])(--[A-Za-z0-9_-]+)\s*:/g)) addDef(m[1], `${rel(f)} (inline)`);
  }
  const used = new Map();
  const scanUse = (f, s) => {
    for (const m of s.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], []);
      used.get(m[1]).push(`${rel(f)}:${lineOf(s, m.index)}`);
    }
    for (const m of s.matchAll(/getPropertyValue\(\s*['"`](--[A-Za-z0-9_-]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], []);
      used.get(m[1]).push(`${rel(f)}:${lineOf(s, m.index)} (js read)`);
    }
  };
  for (const [f, raw] of css) scanUse(f, stripComments(raw));
  for (const [f, s] of [...ts, ...html]) scanUse(f, s);

  console.log(`\n── custom properties: ${defined.size} defined, ${used.size} distinct used ──`);
  const undef = [...used].filter(([n]) => !defined.has(n)).sort();
  console.log(`used but UNDEFINED (${undef.length})  — \`--pswp-*\` is PhotoSwipe's own sheet`);
  for (const [n, sites] of undef) console.log(`  ${n}  ×${sites.length}\n      ${sites.slice(0, 6).join('\n      ')}`);
  const unused = [...defined].filter(([n]) => !used.has(n));
  console.log(`\ndefined but never read (${unused.length})  — scale members (spacing, radius, breakpoints) are kept on purpose`);
  const byFile = new Map();
  for (const [n, f] of unused) { if (!byFile.has(f)) byFile.set(f, []); byFile.get(f).push(n); }
  for (const [f, ns] of [...byFile].sort()) console.log(`  ${f}: ${ns.join(' ')}`);
}

// ── var() fallbacks ────────────────────────────────────────────────────────
if (want('fallbacks')) {
  console.log('\n── var(--x, fallback) ──');
  let n = 0;
  for (const [f, raw] of css) {
    const s = stripComments(raw);
    for (const m of s.matchAll(/var\(\s*--[A-Za-z0-9_-]+\s*,/g)) {
      n++;
      const ln = lineOf(s, m.index);
      console.log(`  ${rel(f)}:${ln}  ${raw.split('\n')[ln - 1].trim().slice(0, 140)}`);
    }
  }
  console.log(`  total ${n}`);
}

// ── the three pairings the dark theme breaks ───────────────────────────────
if (want('traps')) {
  const WHITE = /color-white|#fff\b|#ffffff\b|(?<![-\w])white(?![-\w])/i;
  // Dark in light, PALE in dark — never a fill under white text.
  const DARK_END = /var\(--(?:blue-(?:700|800)|indigo-(?:600|700)|success-(?:700|800)|error-700|warning-(?:700|800|900)|info-(?:700|800)|amber-800|primary-700|primary-blue-dark|success-dark|success-darker|error-dark|warning-dark|info-dark|success-green-dark|text-primary|text-secondary|text-heading|gray-(?:600|700|800|900)|neutral-gray-dark)\)/;
  // Pale in BOTH themes' light end — white text on it is unreadable everywhere.
  const PALE = /var\(--(?:blue|indigo|success|error|warning|info|amber|primary)-(?:50|100|200|300)\)|var\(--(?:primary-light|primary-blue-light)\)/;
  const LOW_GRAY = /var\(--gray-(?:300|400|500)\)/;
  const YELLOW = /var\(--(?:warning-color|color-yellow)\)/;
  const hits = { fill: [], gray: [], yellow: [] };
  for (const [f, raw] of themed) {
    const rules = rulesOf(stripComments(raw)).filter((r) => !r.at.some((h) => /@media[^{]*print|@keyframes/.test(h)));
    for (const r of rules) {
      const bg = decl(r.body, 'background(?:-color)?');
      let col = decl(r.body, 'color');
      const where = `${rel(f)}:${r.line}  ${r.sel.slice(-58)}`;
      if (bg && (DARK_END.test(bg) || PALE.test(bg))) {
        let from = '';
        if (!col) {
          // a :hover/.active rule inherits its ink from the base rule
          const base = r.sel.replace(/:hover|:focus-visible|:focus|:active|:not\([^)]*\)/g, '').trim();
          const b = rules.find((x) => x.sel === base && decl(x.body, 'color'));
          if (b) { col = decl(b.body, 'color'); from = ' (ink from base rule)'; }
        }
        if (col && WHITE.test(col)) hits.fill.push(`${where}  bg ${bg.slice(0, 76)}${from}`);
      }
      if (col && LOW_GRAY.test(col)) hits.gray.push(`${where}  color ${col}`);
      if (bg && YELLOW.test(bg) && col && /text-primary|text-secondary|gray-[6789]00|color-white/.test(col) && !/palette-/.test(col)) hits.yellow.push(`${where}  color ${col}`);
    }
  }
  console.log(`\n── theme traps ──`);
  console.log(`pale / dark-end ramp step as a FILL under white text (${hits.fill.length})  — hover rules on a brightened dark fill are F25's contrast call`);
  hits.fill.forEach((x) => console.log(`  ${x}`));
  console.log(`low gray (300/400/500) as TEXT (${hits.gray.length})`);
  hits.gray.forEach((x) => console.log(`  ${x}`));
  console.log(`flipping or white ink on a yellow fill (${hits.yellow.length})`);
  hits.yellow.forEach((x) => console.log(`  ${x}`));
}

// ── hard-coded colours ─────────────────────────────────────────────────────
if (want('colors')) {
  const NAMED = 'white|black|red|green|blue|yellow|orange|purple|gray|grey|pink|silver|navy|teal|gold|crimson|tomato|maroon|olive|lime|aqua|fuchsia|brown|coral|salmon|khaki|indigo|violet|beige|ivory|whitesmoke|gainsboro|lightgray|lightgrey|darkgray|darkgrey|dimgray|lightblue|darkblue|darkred|darkgreen';
  const COLOR_RE = new RegExp(`#[0-9a-fA-F]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla|oklch)\\([^)]*\\)|(?<![-\\w.])(?:${NAMED})(?![-\\w(])`, 'g');
  const PROP_RE = /^(color|background|background-color|background-image|border(?:-(?:top|right|bottom|left|inline-start|inline-end|block-start|block-end))?(?:-color)?|fill|stroke|outline|outline-color|caret-color|accent-color)$/;
  const isScrim = (lit) => {
    const m = lit.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
    if (!m) return false;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    const a = m[4] === undefined ? 1 : Number(m[4]);
    return (r === 0 && g === 0 && b === 0 && a < 1) || (r === 255 && g === 255 && b === 255 && a < 0.6);
  };
  let total = 0;
  console.log('\n── hard-coded colours (theme-relevant properties) ──');
  for (const [f, raw] of themed) {
    const lines = [];
    for (const r of rulesOf(stripComments(raw))) {
      if (r.at.some((h) => /@media[^{]*print|prefers-contrast|forced-colors/.test(h))) continue;
      for (const d of r.body.split(';')) {
        const k = d.indexOf(':');
        if (k < 0) continue;
        const prop = d.slice(0, k).trim().toLowerCase();
        if (!PROP_RE.test(prop)) continue;
        const lits = (d.slice(k + 1).match(COLOR_RE) || []).filter((l) => !isScrim(l));
        if (lits.length) lines.push(`  ${String(r.line).padStart(5)}  ${r.sel.slice(-56)}  {  ${prop}: ${d.slice(k + 1).trim().slice(0, 90)}  }`);
      }
    }
    if (lines.length) { total += lines.length; console.log(`${rel(f)}  (${lines.length})`); if (args.includes('--list')) lines.forEach((l) => console.log(l)); }
  }
  console.log(`  total ${total}  (add --list for every hit)`);
}

// ── dead classes in *.module.css ───────────────────────────────────────────
if (want('dead')) {
  console.log('\n── module classes no importer references ──');
  const allTs = [...ts.values()].join('\n');
  const importers = new Map();
  for (const [f, s] of ts) {
    for (const m of s.matchAll(/import\s+(?:(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+\.module\.css)['"]/g)) {
      const spec = m[3];
      let target;
      if (spec.startsWith('.')) target = resolve(dirname(f), spec);
      else if (spec.startsWith('@/')) target = join(PUB, 'js', spec.slice(2));
      else if (spec.startsWith('@components/')) target = join(PUB, 'js/components', spec.slice(12));
      else continue;
      if (!importers.has(target)) importers.set(target, []);
      importers.get(target).push({ file: f, ident: m[1] || m[2] });
    }
  }
  const escRe = (x) => x.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  let hard = 0;
  for (const [f, raw] of css) {
    if (!f.endsWith('.module.css')) continue;
    const s = stripComments(raw);
    const classes = new Set();
    for (const r of rulesOf(s)) for (const m of r.sel.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) classes.add(m[1]);
    const composed = new Set();
    for (const m of s.matchAll(/composes\s*:\s*([^;]+);/g)) for (const t of m[1].replace(/from\s+.*/, '').trim().split(/\s+/)) composed.add(t);
    const globals = new Set([...s.matchAll(/:global\(\s*\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
    const imps = importers.get(f) || [];
    const dyn = imps.some(({ file, ident }) => new RegExp(`\\b${ident}\\[(?!['"])`).test(ts.get(file)));
    const drilled = imps.some(({ file, ident }) => new RegExp(`(?:styles|classes|css)=\\{${ident}\\}`).test(ts.get(file)));
    const dead = [];
    for (const c of classes) {
      if (composed.has(c) || globals.has(c)) continue;
      const names = [c, c.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase())];
      const direct = imps.some(({ file, ident }) => names.some((nm) => new RegExp(`\\b${ident}\\.${escRe(nm)}\\b|\\b${ident}\\[['"\`]${escRe(nm)}['"\`]\\]`).test(ts.get(file))));
      if (direct) continue;
      const elsewhere = names.some((nm) => new RegExp(`\\b\\w*[sS]tyles?\\.${escRe(nm)}\\b`).test(allTs));
      dead.push(elsewhere ? `${c}?` : c);
    }
    if (!dead.length && imps.length) continue;
    hard += dead.filter((d) => !d.endsWith('?')).length;
    console.log(`  ${rel(f)}  [${classes.size} classes · ${imps.length} importer(s)${dyn ? ' · DYNAMIC-INDEX' : ''}${drilled ? ' · passed-as-prop' : ''}]\n      ${dead.join(' ') || '(no importer at all)'}`);
  }
  console.log(`  ${hard} with no reference anywhere`);
}

// ── keyframes ──────────────────────────────────────────────────────────────
if (want('keyframes')) {
  console.log('\n── @keyframes ──');
  let n = 0;
  for (const [f, raw] of css) {
    const s = stripComments(raw);
    const names = [...s.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    for (const name of new Set(names)) {
      const count = names.filter((x) => x === name).length;
      if (count > 1) { n++; console.log(`  DUPLICATE ${name} ×${count} in ${rel(f)}`); }
      const usedHere = new RegExp(`animation(?:-name)?\\s*:[^;}]*\\b${name}\\b`).test(s);
      // a module's keyframes are scoped to it; a global sheet's can be used from anywhere
      const usedAnywhere = usedHere || (!f.endsWith('.module.css') && [...css.values(), ...ts.values()].some((x) => new RegExp(`\\b${name}\\b`).test(x.replace(new RegExp(`@keyframes\\s+${name}\\b`, 'g'), ''))));
      if (!usedAnywhere) { n++; console.log(`  UNUSED ${name} in ${rel(f)}`); }
    }
  }
  console.log(`  ${n} lead(s)`);
}

// ── !important ─────────────────────────────────────────────────────────────
if (want('important')) {
  console.log('\n── !important ──');
  let n = 0;
  for (const [f, raw] of css) {
    for (const r of rulesOf(stripComments(raw))) {
      const c = (r.body.match(/!important/g) || []).length;
      if (!c) continue;
      n += c;
      console.log(`  ${rel(f)}:${r.line}  ×${c}  ${r.sel.slice(0, 50)}   ⟵ ${r.at.map((h) => h.slice(0, 60)).join(' ▸ ') || '(no at-rule)'}`);
    }
  }
  console.log(`  total ${n}`);
}

// ── z-index literals ───────────────────────────────────────────────────────
if (want('zindex')) {
  console.log('\n── z-index literals above the local 0–3 range ──');
  let n = 0;
  for (const [f, raw] of css) {
    const s = stripComments(raw);
    for (const m of s.matchAll(/z-index\s*:\s*([^;}]+)/g)) {
      const v = m[1].trim();
      if (/var\(/.test(v) || v === 'auto' || v === 'inherit' || /^-?[0-3]$/.test(v)) continue;
      n++;
      console.log(`  ${rel(f)}:${lineOf(s, m.index)}  z-index: ${v}`);
    }
  }
  console.log(`  total ${n}`);
}
