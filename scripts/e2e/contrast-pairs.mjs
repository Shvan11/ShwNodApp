/**
 * Contrast of every (fill, ink) pair the stylesheets DECLARE, in both themes — the
 * static half of the F25 contrast work (`docs/frontend-audit-tracker.md`). It reaches
 * what a route sweep cannot: dialogs, drawers, menus and hover states.
 *
 *   node scripts/e2e/contrast-pairs.mjs [--min 4.5] [--fills]
 *
 * The product commits to WCAG AA (CLAUDE.md, CSS section), so the expected output is
 * no pair under 4.5:1.
 *
 * How: token values are read from the RUNNING app (a dev server; read-only), because
 * the sheets use `oklch()` and `color-mix()` that only a browser resolves. Then every
 * rule that sets a background is paired with its ink — its own `color`, else the
 * `color` of its base rule (`.btn-x:hover` → `.btn-x`) — and measured per theme.
 *
 *   --fills  also list chromatic fills that carry NO ink in the same rule or its
 *            base: their text colour arrives from another class (`.badge` + `.sev3`),
 *            so the pair check cannot see them. Each should be a `--*-fill` token
 *            unless it is a decoration (a dot, a progress bar, a switch track).
 *
 * Blind spots: text on an INHERITED background (use `a11y-sweep.mjs axe` for that),
 * `color-mix()` backgrounds, and disabled states (exempt under WCAG, skipped).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import postcss from 'postcss';
import { gotoSpa, E2E_BASE } from './auth.mjs';
import { readOnlyContext } from './contrast-sweep.mjs';

const ROOT = process.cwd();
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const MIN = +opt('min', 4.5);
const BASE = join(ROOT, 'public', 'css', 'base');
const TOKEN_SHEETS = ['tokens-primitive.css', 'tokens-semantic.css', 'theme-dark.css'];
// Not theme-aware on purpose: the portal and the kiosk are pinned light.
const SKIP = /tokens-primitive|tokens-semantic|theme-dark|fonts\.css|[\\/]portal[\\/]|ChairDisplay\.module/;

/** Every colour token, resolved to sRGB by the browser, per theme. */
async function readTokens() {
  const names = new Set();
  for (const f of TOKEN_SHEETS) for (const m of readFileSync(join(BASE, f), 'utf8').matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) names.add(m[1]);
  const out = {};
  for (const theme of ['light', 'dark']) {
    const { browser, context } = await readOnlyContext({ theme });
    const page = await context.newPage();
    await gotoSpa(page, `${E2E_BASE}/dashboard`, { settle: 1500 });
    out[theme] = await page.evaluate((list) => {
      // A non-colour token leaves `color` at the inherited sentinel.
      const host = document.createElement('div'); host.style.color = 'rgb(1, 2, 3)'; document.body.appendChild(host);
      const el = document.createElement('span'); host.appendChild(el);
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      const res = {};
      for (const n of list) {
        el.style.color = ''; el.style.color = `var(${n})`;
        const c = getComputedStyle(el).color;
        if (c === 'rgb(1, 2, 3)') continue;
        cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        res[n] = [d[0], d[1], d[2], +(d[3] / 255).toFixed(3)];
      }
      host.remove();
      return res;
    }, [...names]);
    await browser.close();
  }
  return out;
}

const hex = (h) => { h = h.slice(1); if (h.length === 3) h = [...h].map((c) => c + c).join(''); const n = parseInt(h.slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1]; };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const baseOf = (sel) => sel.replace(/::?(hover|focus|focus-visible|focus-within|active|disabled|checked|not\([^)]*\)|before|after)/g, '').replace(/\s+/g, ' ').trim();
const isBackground = (n) => n.type === 'decl' && /^background(-color|-image)?$/.test(n.prop);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.css') && !SKIP.test(p)) out.push(p);
  }
  return out;
}

const TOK = await readTokens();
const colorsIn = (value, theme) => {
  const out = [];
  for (const m of value.matchAll(/var\((--[a-zA-Z0-9-]+)\)|(#[0-9a-fA-F]{3,8})\b|rgba?\(([^)]+)\)|\b(white|black)\b/g)) {
    if (m[1]) { if (TOK[theme][m[1]]) out.push({ c: TOK[theme][m[1]], src: m[1] }); }
    else if (m[2]) out.push({ c: hex(m[2]), src: m[2] });
    else if (m[3]) { const p = m[3].split(/[,\s/]+/).filter(Boolean).map(parseFloat); if (p.length >= 3) out.push({ c: [p[0], p[1], p[2], p[3] ?? 1], src: `rgb(${m[3]})` }); }
    else out.push({ c: m[4] === 'white' ? [255, 255, 255, 1] : [0, 0, 0, 1], src: m[4] });
  }
  return out;
};

const rows = [];
const orphans = [];
// Tokens that are bright in dark: fine as text or a dot, wrong under white text.
const NOT_A_FILL = /var\(--(primary-color|primary-blue|primary-hover|success-color|success-[456]00|success-green|info-color|info-[456]00|secondary-color|error-color|danger-color|error-[456]00|error-red|warning-orange|warning-[456]00|blue-[456]00|indigo-[45]00|purple-500|accent-color|neutral-gray)\)/;
for (const f of walk(join(ROOT, 'public'))) {
  const root = postcss.parse(readFileSync(f, 'utf8'), { from: f });
  const inkByBase = new Map();
  root.walkRules((r) => { const c = r.nodes.find((n) => n.type === 'decl' && n.prop === 'color'); if (c) for (const s of r.selectors) if (s.trim() === baseOf(s)) inkByBase.set(baseOf(s), c.value); });
  root.walkRules((r) => {
    if (r.parent?.type === 'atrule' && /keyframes|print/.test(r.parent.name + (r.parent.params || ''))) return;
    if (r.selectors.every((s) => /:disabled|\[disabled\]|\.disabled/.test(s))) return;
    const pseudo = r.selectors.every((s) => /::?(before|after)\s*$/.test(s.trim()));
    if (pseudo && !r.nodes.some((n) => n.prop === 'content' && /[a-zA-Z0-9\\]/.test(n.value.replace(/['"]/g, '')))) return;
    const bg = [...r.nodes].reverse().find(isBackground);
    if (!bg || /^(none|transparent|inherit|unset)$/.test(bg.value.trim()) || /color-mix\(/.test(bg.value)) return;
    const own = r.nodes.find((n) => n.type === 'decl' && n.prop === 'color');
    let inkVal = own?.value;
    if (!inkVal) for (const s of r.selectors) { const b = inkByBase.get(baseOf(s)); if (b) { inkVal = b; break; } }
    const where = `${relative(ROOT, f)}:${bg.source.start.line}  ${r.selector.replace(/\s+/g, ' ').slice(0, 56)}`;
    if (!inkVal) { if (NOT_A_FILL.test(bg.value)) orphans.push(`${where}  { ${bg.prop}: ${bg.value.slice(0, 48)} }`); return; }
    for (const theme of ['light', 'dark']) {
      const page = theme === 'dark' ? TOK.dark['--surface'] : [255, 255, 255, 1];
      const ink = colorsIn(inkVal, theme)[0];
      if (!ink) continue;
      let worst = null;
      for (const fill of colorsIn(bg.value, theme)) {
        if (fill.c[3] < 0.5) continue;
        const under = over(fill.c, page);
        const cr = ratio(over(ink.c, under), under);
        if (!worst || cr < worst.cr) worst = { cr, fill: fill.src };
      }
      if (worst && worst.cr < MIN) rows.push({ where, key: `${theme}  ${ink.src} on ${worst.fill}`, cr: worst.cr });
    }
  });
}

const by = new Map();
for (const r of rows) { if (!by.has(r.key)) by.set(r.key, []); by.get(r.key).push(r); }
console.log(`declared fill + ink pairs under ${MIN}:1 → ${rows.length} (${by.size} distinct)`);
for (const [k, list] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${list[0].cr.toFixed(2).padStart(5)}  ×${list.length}  ${k}`);
  for (const r of list.slice(0, 30)) console.log(`        ${r.where}`);
}
if (process.argv.includes('--fills')) {
  console.log(`\nchromatic fills with no ink of their own (${orphans.length}) — a --*-fill token unless a decoration:`);
  for (const o of orphans) console.log(`  ${o}`);
}
