/**
 * Overlay crawl — what a route sweep cannot reach. On every top route it hovers and
 * clicks each distinct control once. Whatever opens (dialog, drawer, popover, menu,
 * listbox) is checked with axe from the inside, every button in it is measured under
 * the pointer, and each menu item is followed one level down (the Works card's ⋮ →
 * Transfer / Complete / Discontinue). A click that opens nothing is a tab, toggle or
 * accordion: the page is re-checked for contrast, since it now shows content the
 * sweep never saw.
 *
 *   node scripts/e2e/overlay-crawl.mjs [light|dark] [routeFilter]
 *   E2E_BASE=http://localhost:5273 E2E_PATIENT=7845 E2E_WORK=13015 E2E_ALIGNER_WORK=9867 node …
 *   E2E_DEBUG=1 prints every click and what it opened.
 *
 * Why it exists: `a11y-sweep.mjs` sees each screen's first paint only, and
 * `contrast-pairs.mjs` reads declared fill + ink pairs. Neither saw the payment
 * history's *Add New Payment* (white on a tint, 1.4:1), the *Discontinue* confirm
 * (white on yellow, 1.6:1), or a header that faded to 3.7:1 under the pointer — all
 * found by the first run of this, on one screen (audit FE-F25-2).
 *
 * READ-ONLY by construction, so it is safe on a dev server pointed at a live database:
 * `readOnlyContext` aborts every non-GET and every WhatsApp call in the browser, and
 * once a page has loaded this also aborts GETs whose path carries a verb (backup,
 * export, send, …). It still CLICKS everything — Delete, Save, Send — and each of those
 * requests dies in the browser; the list is printed at the end. Print, external-app
 * and sign-out controls are skipped by label. About 25 minutes per theme.
 */
import { createRequire } from 'node:module';
import { gotoSpa, E2E_BASE } from './auth.mjs';
import { readOnlyContext, ROUTES } from './contrast-sweep.mjs';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const DEBUG = Boolean(process.env.E2E_DEBUG);
const theme = process.argv[2] || 'light';
const filter = process.argv[3] || '';
const SKIP_TEXT = /log ?out|sign ?out|theme|language|العربية|english|full ?screen|print|open folder|explorer|csimaging|3shape|dolphin|webceph|whatsapp web/i;
const RISKY = new Set(['backup', 'backups', 'restore', 'restart', 'send', 'test', 'export', 'generate', 'launch', 'trigger', 'reconcile', 'import', 'logout', 'disconnect', 'callback', 'download', 'open', 'initialize', 'reload', 'run']);
const RISKY_GET = { test: (p) => /auth-url/.test(p) || p.toLowerCase().split(/[/\-_.]+/).some((t) => RISKY.has(t)) };

const { browser, context, blocked } = await readOnlyContext({ theme });
let armed = false; const blockedGets = new Set();
await context.route('**/api/**', (route) => {
  const req = route.request(); const path = new URL(req.url()).pathname;
  if (armed && req.method() === 'GET' && RISKY_GET.test(path)) { blockedGets.add(path); return route.abort(); }
  return route.fallback();
});
const page = await context.newPage();
context.on('page', (p) => { if (p !== page) p.close().catch(() => {}); });
// accept "leave page?" (a dirty full-page form must not pin the crawler to its route); dismiss the rest
page.on('dialog', (d) => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}));
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const IGNORE = new Set(['region', 'landmark-one-main', 'page-has-heading-one', 'heading-order', 'bypass', 'document-title', 'html-has-lang']);

async function load(route) {
  armed = false;
  await gotoSpa(page, `${E2E_BASE}${route}`, { settle: 3200 });
  await page.addScriptTag({ path: AXE });
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation-duration: 0s !important; }' });
  armed = true;
}

const collect = (scope) => page.evaluate((scope) => {
  for (const el of document.querySelectorAll('[data-probe]')) el.removeAttribute('data-probe');
  const els = [...document.querySelectorAll(scope)];
  const out = []; const perClass = new Map(); const seen = new Set();
  for (const el of els) {
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert]')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const text = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const cls = String(el.className?.baseVal ?? el.className).replace(/_[a-z0-9]{5}_\d+/g, '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    const sig = `${el.tagName.toLowerCase()}.${cls}|${text.replace(/[\d/:.,-]+/g, '#')}`;
    if (seen.has(sig)) continue; seen.add(sig);
    const k = `${el.tagName}.${cls}`; perClass.set(k, (perClass.get(k) || 0) + 1); if (perClass.get(k) > 3) continue;
    el.setAttribute('data-probe', String(out.length));
    out.push({ i: out.length, sig, text });
    if (out.length >= 70) break;
  }
  return out;
}, scope);

const overlays = () => page.evaluate(() => [...document.querySelectorAll('[role=dialog]:not(.pswp), [role=alertdialog], [role=menu], [role=listbox]')]
  .filter((o) => { const r = o.getBoundingClientRect(); return r.width > 4 && r.height > 4 && !o.closest('[inert]'); })
  .map((o, n) => { o.setAttribute('data-probe-ov', String(n)); return { n, role: o.getAttribute('role'), name: (document.getElementById(o.getAttribute('aria-labelledby') || '')?.textContent || o.getAttribute('aria-label') || o.querySelector('h1,h2,h3,h4')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50) }; }));

const axeOn = (selector, rules) => page.evaluate(async ([selector, rules, TAGS]) => {
  if (!document.querySelector(selector)) return [];
  const r = await window.axe.run({ include: [[selector]] }, { runOnly: rules ? { type: 'rule', values: rules } : { type: 'tag', values: TAGS }, resultTypes: ['violations'] });
  return r.violations.flatMap((v) => v.nodes.map((n) => ({ id: v.id, html: n.html.replace(/\s+/g, ' ').slice(0, 150), msg: (n.any[0]?.message || n.all[0]?.message || n.none[0]?.message || '').slice(0, 170) })));
}, [selector, rules, TAGS]);

const findings = []; const opened = []; const stats = { routes: 0, clicked: 0, hovered: 0, navigated: 0 };
const record = (route, where, v) => { for (const x of v) if (!IGNORE.has(x.id)) findings.push({ route, where, ...x }); };

async function closeAll(route) {
  for (let k = 0; k < 4; k++) { if (!(await overlays()).length) return true; await page.keyboard.press('Escape'); await page.waitForTimeout(350); }
  if ((await overlays()).length) { await load(route); return false; }
  return true;
}

async function measureOverlays(route, opener) {
  const ovs = await overlays();
  for (const o of ovs) {
    opened.push({ route, opener: opener.slice(0, 60), role: o.role, name: o.name });
    record(route, `${o.role} "${o.name}" ← ${opener.slice(0, 50)}`, await axeOn(`[data-probe-ov="${o.n}"]`));
    if (o.role === 'dialog' || o.role === 'alertdialog') {
      // hover colours inside the dialog: every distinct button, measured under the pointer
      const btns = await page.evaluate((n) => { const seen = new Set(); let k = 0; for (const b of document.querySelectorAll(`[data-probe-ov="${n}"] button, [data-probe-ov="${n}"] [role=button], [data-probe-ov="${n}"] a[href]`)) { if (b.disabled) continue; const r = b.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue; const sig = String(b.className).replace(/_[a-z0-9]{5}_\d+/g, ''); if (seen.has(sig)) continue; seen.add(sig); b.setAttribute('data-probe-hb', String(k++)); if (k >= 12) break; } return k; }, o.n);
      for (let k = 0; k < btns; k++) {
        const b = page.locator(`[data-probe-hb="${k}"]`);
        try { await b.hover({ force: true, timeout: 1000 }); await page.waitForTimeout(50); stats.hovered++; record(route, `hover in ${o.role} "${o.name}"`, await axeOn(`[data-probe-hb="${k}"]`, ['color-contrast'])); } catch { /* covered or gone */ }
      }
      await page.evaluate(() => { for (const b of document.querySelectorAll('[data-probe-hb]')) b.removeAttribute('data-probe-hb'); });
    }
  }
  return ovs;
}

async function crawl(route, scope) {
  await load(route);
  const path0 = new URL(page.url()).pathname;
  const done = new Set(); let reloads = 0; let actions = 0;
  const left = async () => !(await page.evaluate(() => !!window.axe).catch(() => false)) || new URL(page.url()).pathname !== path0;
  while (actions < 90) {
    let cands = (await collect(scope)).filter((c) => !done.has(c.sig));
    if (!cands.length) {
      // a toggle (accordion, tab) may have hidden controls: one clean reload, then look again
      if (reloads++ >= 2) break;
      await load(route);
      cands = (await collect(scope)).filter((c) => !done.has(c.sig));
      if (!cands.length) break;
    }
    const c = cands[0]; done.add(c.sig); actions++;
    if (SKIP_TEXT.test(c.text)) continue;
    const sel = `[data-probe="${c.i}"]`;
    const loc = page.locator(sel);
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
      await loc.hover({ force: true, timeout: 1500 }); stats.hovered++;
      await page.waitForTimeout(60);
      record(route, `hover: ${c.sig.slice(0, 70)}`, await axeOn(sel, ['color-contrast']));
      await loc.click({ force: true, timeout: 1500 }); stats.clicked++;
    } catch (e) { if (DEBUG) console.log('  skip', c.sig, String(e).slice(0, 80)); continue; }
    await page.waitForTimeout(550);
    if (await left()) { stats.navigated++; if (DEBUG) console.log('  nav', c.sig); await load(route); continue; }
    const ovs = await measureOverlays(route, c.sig);
    if (DEBUG) console.log('  clicked', c.sig, ovs.map((o) => o.role + ':' + o.name));
    // no overlay: a tab, toggle or accordion. Whatever it revealed is page content the route sweep never saw.
    if (!ovs.length) { record(route, `after: ${c.sig.slice(0, 70)}`, await axeOn('#app-container', ['color-contrast'])); continue; }
    const menu = ovs.find((o) => o.role === 'menu');
    if (menu) {
      const n = await page.locator(`[data-probe-ov="${menu.n}"] [role^=menuitem]`).count();
      for (let m = 0; m < Math.min(n, 10); m++) {
        if (!(await overlays()).some((o) => o.role === 'menu')) {
          const again = (await collect(scope)).find((x) => x.sig === c.sig);
          if (!again) break;
          try { await page.locator(`[data-probe="${again.i}"]`).click({ force: true, timeout: 1500 }); await page.waitForTimeout(350); } catch { break; }
        }
        const item = page.locator('[role=menu] [role^=menuitem]').nth(m);
        if (!(await item.count())) break;
        const label = ((await item.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (SKIP_TEXT.test(label)) continue;
        try {
          await item.hover({ force: true, timeout: 1200 }); await page.waitForTimeout(60);
          await item.evaluate((el) => el.setAttribute('data-probe-item', '1'));
          record(route, `hover menuitem "${label}"`, await axeOn('[data-probe-item="1"]', ['color-contrast']));
          await item.evaluate((el) => el.removeAttribute('data-probe-item'));
          await item.click({ force: true, timeout: 1200 });
        } catch { continue; }
        await page.waitForTimeout(650);
        if (await left()) { stats.navigated++; if (DEBUG) console.log('    item nav', label); await load(route); continue; }
        const sub = await measureOverlays(route, `${c.sig.slice(0, 30)} › ${label}`);
        if (DEBUG) console.log('    item', label, sub.map((o) => o.role + ':' + o.name));
        await closeAll(route);
      }
    }
    await closeAll(route);
  }
}

const routes = ROUTES.filter((r) => r.includes(filter));
const t0 = Date.now();
if (!filter || 'HEADER'.includes(filter)) { await crawl('/dashboard', 'header.universal-header [aria-haspopup], header.universal-header [aria-expanded]').catch((e) => console.log('!! header', String(e).slice(0, 200))); }
for (const r of routes) {
  try { await crawl(r, 'main button, main [role=button], main [aria-haspopup], main summary'); stats.routes++; }
  catch (e) { console.log(`!! ${r}: ${String(e).slice(0, 200)}`); }
}

// ── summary ──
const by = new Map();
for (const f of findings) {
  const pair = f.msg.match(/contrast of ([\d.]+) \(foreground color: (#\w+), background color: (#\w+)/);
  const key = pair ? `${f.id}|${pair[2]} on ${pair[3]}|${f.html.replace(/_[a-z0-9]{5}_\d+/g, '').slice(0, 60)}` : `${f.id}|${f.html.replace(/\d+/g, '#').slice(0, 80)}`;
  if (!by.has(key)) by.set(key, { ...f, n: 0, ratio: pair?.[1], pair: pair ? `${pair[2]} on ${pair[3]}` : '' });
  by.get(key).n++;
}
console.log(`\n# ${theme}: ${stats.routes} routes · ${stats.hovered} controls hovered · ${stats.clicked} clicked · ${opened.length} overlays opened (${new Set(opened.map((o) => `${o.role}:${o.name}`)).size} distinct) · ${Math.round((Date.now() - t0) / 1000)} s`);
for (const f of [...by.values()].sort((a, b) => (a.id + (a.ratio || '')).localeCompare(b.id + (b.ratio || '')))) console.log(`${f.id}  ×${f.n}  ${f.pair ? `${f.pair} ${f.ratio}:1  ` : ''}${f.route}  [${f.where.slice(0, 70)}]  ${f.html.slice(0, 110)}${f.pair ? '' : `  — ${f.msg.slice(0, 90)}`}`);
console.log('\ndistinct overlays:', [...new Set(opened.map((o) => `${o.role}:${o.name}`))].join(' | '));
console.log('writes blocked:', [...new Set(blocked)].join(', ') || 'none');
console.log('risky GETs blocked:', [...blockedGets].join(', ') || 'none');
console.log('page errors:', pageErrors.length ? [...new Set(pageErrors)].slice(0, 6) : 'none');
await browser.close();
