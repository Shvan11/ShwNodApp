/**
 * Accessibility sweep over every top route — the runtime half of the F25 pass in
 * `docs/frontend-audit-tracker.md`, re-runnable by any later session.
 *
 *   node scripts/e2e/a11y-sweep.mjs axe      [light|dark] [routeFilter]
 *   node scripts/e2e/a11y-sweep.mjs overflow [width=360]  [routeFilter]
 *   node scripts/e2e/a11y-sweep.mjs focus    [light|dark] [routeFilter]
 *   node scripts/e2e/a11y-sweep.mjs gradients [light|dark] [routeFilter]
 *   E2E_BASE=http://localhost:5273 E2E_PATIENT=7845 E2E_WORK=13015 E2E_ALIGNER_WORK=9867 E2E_SETTLE=3000 node …
 *
 * READ-ONLY by construction (see `readOnlyContext` in contrast-sweep.mjs): every
 * non-GET is aborted in the browser, so it is safe on a dev server pointed at a
 * live database.
 *
 *   axe       axe-core's WCAG 2.0–2.2 A/AA + best-practice rules, grouped by rule.
 *             The product commits to AA (CLAUDE.md, CSS section), so `color-contrast`
 *             should be empty; what the linter cannot see (names, landmarks, nesting)
 *             shows here.
 *   overflow  page-level horizontal scroll at a phone width. Run 360 (the common
 *             Android width — NOT only the harness's 412) and 320 (WCAG reflow, which
 *             is also a 1280px window at 400% zoom).
 *   focus     a real Tab walk: every stop's focus indicator and name. Transitions are
 *             switched off first — a style read in the same tick as the focus is
 *             mid-transition and looks unchanged.
 *   gradients text on a gradient. axe does NOT judge these: it files every one as
 *             "incomplete" (418 nodes on 55 routes when this was written — the app
 *             header, every summary card), so a clean `axe` run says nothing about
 *             them. This measures the text against EVERY colour stop of the gradient
 *             (the worst case, wherever the layout puts it), with translucent chips
 *             and `opacity` applied, and ends with a census of axe's incompletes.
 *
 * Not reached by a route sweep: dialogs, drawers, menus, hover states and whatever a
 * tab or toggle reveals. `scripts/e2e/overlay-crawl.mjs` opens those;
 * `scripts/e2e/contrast-pairs.mjs` covers their colours statically.
 */
import { createRequire } from 'node:module';
import { gotoSpa, E2E_BASE } from './auth.mjs';
import { readOnlyContext, ROUTES } from './contrast-sweep.mjs';

const mode = process.argv[2] || 'axe';
const arg = process.argv[3] || '';
const filter = process.argv[4] || '';
const routes = ROUTES.filter((r) => r.includes(filter));
// How long a route gets to paint its data. 1800 ms reported the Works page clean
// while its cards were still loading; raise it (E2E_SETTLE) on a slow database.
const SETTLE = +(process.env.E2E_SETTLE || 3000);

async function axe() {
  const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
  const { browser, context, blocked } = await readOnlyContext({ theme: arg || 'light' });
  const page = await context.newPage();
  const byRule = new Map();
  for (const r of routes) {
    await gotoSpa(page, `${E2E_BASE}${r}`, { settle: SETTLE });
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => {
      const out = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] });
      return out.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ html: n.html.slice(0, 140), msg: (n.any[0]?.message || n.all[0]?.message || '').slice(0, 150) })) }));
    });
    for (const v of violations) {
      if (!byRule.has(v.id)) byRule.set(v.id, { ...v, nodes: 0, routes: new Set(), samples: [] });
      const e = byRule.get(v.id);
      e.nodes += v.nodes.length;
      e.routes.add(r);
      for (const n of v.nodes) if (e.samples.length < 400) e.samples.push({ route: r, ...n });
    }
  }
  for (const e of [...byRule.values()].sort((a, b) => b.nodes - a.nodes)) {
    console.log(`\n## ${e.id} [${e.impact}] ${e.help} — ${e.nodes} node(s) on ${e.routes.size} route(s)`);
    const seen = new Set();
    for (const s of e.samples) {
      // contrast: one line per colour pair; everything else: one line per distinct element
      const pair = s.msg.match(/contrast of ([\d.]+) \(foreground color: (#\w+), background color: (#\w+)/);
      const key = pair ? `${pair[2]} on ${pair[3]}` : s.html.replace(/\d+/g, '#').slice(0, 70);
      if (seen.has(key) || seen.size >= 25) continue;
      seen.add(key);
      console.log(`   ${s.route}  ${pair ? `${key}  ${pair[1]}:1  ` : ''}${s.html.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  console.log(`\n${routes.length} routes · ${byRule.size} rule(s) violated · writes blocked: ${[...new Set(blocked)].join(', ') || 'none'}`);
  await browser.close();
}

async function overflow() {
  const width = +(arg || 360);
  const { browser, context } = await readOnlyContext({ theme: 'light', mobile: true });
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 915 });
  let bad = 0;
  for (const r of routes) {
    await gotoSpa(page, `${E2E_BASE}${r}`, { settle: SETTLE });
    const res = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const clipped = (el) => { for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(n).overflowX)) return true; return false; };
      const offenders = [];
      for (const el of document.body.querySelectorAll('*')) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.right > vw + 2 && !clipped(el)) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/)[0]} right=${Math.round(b.right)} w=${Math.round(b.width)}`);
      }
      return { over: document.documentElement.scrollWidth - vw, offenders: offenders.slice(0, 5) };
    });
    if (res.over > 2) { bad++; console.log(`${r}  overflows by ${res.over}px`); for (const o of res.offenders) console.log(`   ${o}`); }
  }
  console.log(`\n${width}px: ${bad} of ${routes.length} routes scroll sideways`);
  await browser.close();
}

async function focus() {
  const { browser, context } = await readOnlyContext({ theme: arg || 'light' });
  const page = await context.newPage();
  const rows = [];
  for (const r of routes) {
    await gotoSpa(page, `${E2E_BASE}${r}`, { settle: SETTLE });
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
    await page.evaluate(() => {
      const snap = (el) => { const s = getComputedStyle(el); return [s.boxShadow, s.borderTopColor, s.borderBottomColor, s.backgroundColor, s.color, s.textDecorationLine].join('|'); };
      window.__snap = snap;
      window.__pre = new Map();
      // an autofocused field (the POS barcode box) would be snapshotted already focused
      document.activeElement?.blur?.();
      // the control AND its wrappers: a search box or a react-select shows focus on a
      // non-focusable ancestor, which has no "before" unless it is recorded here
      for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [tabindex]')) {
        for (let n = el, d = 0; n && n !== document.body && d < 5; n = n.parentElement, d++) if (!window.__pre.has(n)) window.__pre.set(n, snap(n));
      }
    });
    const seen = new Set();
    let bodyHits = 0;
    for (let i = 0; i < 160; i++) {
      await page.keyboard.press('Tab');
      const s = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { body: true };
        el.__fid ??= Math.random().toString(36).slice(2);
        const cs = getComputedStyle(el);
        const ring = (n) => { const c = getComputedStyle(n); return c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0; };
        let within = false;
        for (let n = el.parentElement, d = 0; n && n !== document.body && d < 4; n = n.parentElement, d++) within ||= ring(n) || (window.__pre.has(n) && window.__pre.get(n) !== window.__snap(n));
        const pre = window.__pre.get(el);
        const name = (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || el.querySelector('img')?.alt || '').replace(/\s+/g, ' ').trim();
        return { fid: el.__fid, type: el.type || '', sig: `<${el.tagName.toLowerCase()}> .${String(el.className).split(/\s+/)[0]}`, name: name.slice(0, 32), shown: ring(el) || within || (pre !== undefined && pre !== window.__snap(el)), opacity: +cs.opacity };
      });
      if (s.body) { if (bodyHits++ > 1) break; continue; }
      if (seen.has(s.fid)) { if (/date|time|month/.test(s.type)) continue; break; }
      seen.add(s.fid);
      if (!s.shown) rows.push(`no focus indicator  ${r}  ${s.sig}  "${s.name}"`);
      if (!s.name) rows.push(`no accessible name  ${r}  ${s.sig}`);
    }
  }
  console.log(rows.join('\n') || 'every Tab stop shows focus and has a name');
  console.log(`\n${routes.length} routes walked · ${rows.length} finding(s)`);
  await browser.close();
}

/** Runs in the page: every text element that sits on a gradient, against the gradient's worst colour stop. */
const GRADIENT_TEXT = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const toRgb = (c) => {
    const m = c && c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?\s*\)$/);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])];
    try { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; } catch { return null; }
  };
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  // every colour inside a gradient(), nested functions included
  const stops = (img) => { const out = []; const re = /(rgba?\([^()]*\)|oklch\([^()]*\)|oklab\([^()]*\)|color\([^()]*\)|color-mix\((?:[^()]|\([^()]*\))*\)|#[0-9a-f]{3,8}\b)/gi; let m; while ((m = re.exec(img))) { const c = toRgb(m[1]); if (c) out.push(c); } return out; };
  const page0 = document.documentElement.dataset.theme === 'dark' ? [17, 21, 28, 1] : [255, 255, 255, 1];
  const rows = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = walker.nextNode())) {
    const txt = t.nodeValue.replace(/\s+/g, ' ').trim();
    const el = t.parentElement;
    if (txt.length < 2 || !el || seen.has(el)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    let hidden = false; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) hidden = true; }
    if (hidden || el.closest('[aria-hidden="true"], :disabled, [aria-disabled="true"]')) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const fg0 = toRgb(cs.color); if (!fg0) continue;
    // From the text outward: semi-transparent tints, then the element that paints a gradient.
    // A background can stack several gradient layers (a translucent sheen over an opaque
    // base), so the layers are composited bottom-up and only the darkest and lightest
    // outcome of each step are kept.
    const tints = []; let layers = null; let base = null; let opacity = 1; let image = false;
    const split = (bi) => { const out = []; let d = 0, cur = ''; for (const ch of bi) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (!layers) opacity *= +s.opacity;
      const bi = s.backgroundImage;
      if (bi && bi !== 'none' && !layers) {
        if (/gradient\(/.test(bi)) layers = split(bi).filter((l) => /gradient\(/.test(l)).map(stops).filter((st) => st.length);
        else if (/url\(/.test(bi)) image = true;
      }
      const c = toRgb(s.backgroundColor);
      if (c && c[3] > 0) { if (layers) { base = c; if (c[3] >= 0.99) break; } else if (c[3] >= 0.99) { base = c; break; } else tints.push(c); }
      else if (layers && layers.some((st) => st.every((x) => x[3] >= 0.99))) break;
    }
    if (!layers || !layers.length) continue;   // solid backgrounds are axe's job
    let cands = [base && base[3] >= 0.99 ? base : page0];
    for (let li = layers.length - 1; li >= 0; li--) {
      const next = [];
      for (const stop of layers[li]) for (const c of cands) next.push(over(stop, c));
      next.sort((a, b) => lum(a) - lum(b));
      cands = [next[0], next[next.length - 1]];
    }
    let worst = Infinity; let worstBg = null;
    for (let bg of cands) {
      for (let i = tints.length - 1; i >= 0; i--) bg = over(tints[i], bg);
      const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * opacity], bg);
      const cr = ratio(fg, bg);
      if (cr < worst) { worst = cr; worstBg = bg; }
    }
    const size = parseFloat(cs.fontSize); const bold = +cs.fontWeight >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    if (worst >= (large ? 3 : 4.5)) continue;
    const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const cls = (typeof el.className === 'string' ? el.className : '').replace(/_[a-z0-9]{5}_\d+/g, '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    const owner = (() => { for (let n = el; n; n = n.parentElement) if (/gradient\(/.test(getComputedStyle(n).backgroundImage)) return (typeof n.className === 'string' ? n.className : '').replace(/_[a-z0-9]{5}_\d+/g, '').split(/\s+/).filter(Boolean).slice(0, 2).join('.') || n.tagName.toLowerCase(); return ''; })();
    rows.push({ cr: +worst.toFixed(2), tag: el.tagName.toLowerCase(), cls, owner, text: txt.slice(0, 32), fg: hex(over([fg0[0], fg0[1], fg0[2], fg0[3] * opacity], worstBg)), bg: hex(worstBg), size: Math.round(size), bold, opacity: +opacity.toFixed(2), image });
  }
  return rows;
};

async function gradients() {
  const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
  const { browser, context, blocked } = await readOnlyContext({ theme: arg || 'light' });
  const page = await context.newPage();
  const sig = new Map();
  const incomplete = new Map();
  // /auth is safe here: the read-only context aborts every /api/wa/* call and the
  // WhatsApp stream in the browser, so its DEV-only initialize never reaches the server.
  for (const r of [...ROUTES, '/auth'].filter((x) => x.includes(filter))) {
    await gotoSpa(page, `${E2E_BASE}${r}`, { settle: SETTLE });
    await page.addScriptTag({ path: axePath });
    for (const row of await page.evaluate(GRADIENT_TEXT)) {
      const k = `${row.tag}.${row.cls}@${row.owner}|${row.fg}|${row.bg}`;
      if (!sig.has(k)) sig.set(k, { ...row, n: 0, routes: new Set() });
      const e = sig.get(k);
      e.n++;
      e.routes.add(r);
    }
    const inc = await page.evaluate(async () => {
      const out = await window.axe.run(document, { runOnly: ['color-contrast'], resultTypes: ['incomplete'] });
      return out.incomplete.flatMap((v) => v.nodes.map((n) => ({ key: n.any[0]?.data?.messageKey || 'other', html: n.html.replace(/\s+/g, ' ').slice(0, 90) })));
    });
    for (const i of inc) {
      if (!incomplete.has(i.key)) incomplete.set(i.key, { n: 0, routes: new Set(), sample: `${r} ${i.html}` });
      const e = incomplete.get(i.key);
      e.n++;
      e.routes.add(r);
    }
  }
  console.log(`# ${arg || 'light'}: text on a gradient under AA at its worst colour stop — ${sig.size} signature(s)`);
  for (const e of [...sig.values()].sort((a, b) => a.cr - b.cr)) {
    console.log(`${String(e.cr).padStart(5)}  ×${String(e.n).padEnd(3)} ${e.routes.size} route(s)  <${e.tag}> .${e.cls} on .${e.owner}  "${e.text}"  ${e.fg} on ${e.bg}  ${e.size}px${e.bold ? ' bold' : ''}${e.opacity < 1 ? ` opacity ${e.opacity}` : ''}  e.g. ${[...e.routes][0]}`);
  }
  console.log('\n# what axe left unjudged (color-contrast "incomplete"), by reason');
  for (const [k, e] of [...incomplete.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`${k}  ×${e.n} on ${e.routes.size} route(s)  e.g. ${e.sample}`);
  console.log(`\nwrites blocked: ${[...new Set(blocked)].join(', ') || 'none'}`);
  await browser.close();
}

const run = { axe, overflow, focus, gradients }[mode];
if (run) await run();
else console.log('usage: a11y-sweep.mjs axe|overflow|focus|gradients …');
