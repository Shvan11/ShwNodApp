/**
 * Contrast sweep — every text element on every top route, measured against the
 * background it actually sits on, in one theme. Written for the F24 CSS pass and
 * left here for F25 (accessibility), whose contrast item starts from these numbers.
 *
 *   node scripts/e2e/contrast-sweep.mjs [dark|light] [en|ar] [routeFilter]
 *   E2E_PATIENT=7845 E2E_WORK=13015 E2E_ALIGNER_WORK=9867 node scripts/e2e/contrast-sweep.mjs dark
 *
 * READ-ONLY by construction, so it is safe against a dev server on the live database:
 * every non-GET request is aborted in the browser, and so are the WhatsApp stream and
 * every /api/wa/* call (the stream registers a QR viewer, which can start a client).
 *
 * What it reports: signatures (element + class + colours) under 3:1, lowest first.
 * 3:1 is the WCAG floor for large text and UI components; body text wants 4.5:1.
 * `[img]` marks an element over a gradient or image — the ratio there is against the
 * gradient's FIRST colour stop, an estimate. Dialogs, drawers and hover states are not
 * reached by a route sweep: open them in a probe and call CONTRAST_SWEEP yourself.
 */
import { authedContext, gotoSpa, E2E_BASE } from './auth.mjs';

const theme = process.argv[2] || 'dark';
const lang = process.argv[3] || 'en';
const filter = process.argv[4] || '';
const P = process.env.E2E_PATIENT || '1';
const W = process.env.E2E_WORK || '1';
const AW = process.env.E2E_ALIGNER_WORK || '1';

const SETTINGS = ['general', 'database', 'databaseBackup', 'protocolHandlers', 'alignerDoctors', 'email', 'employees', 'exchangeRates', 'lookups', 'calendarTimes', 'supabaseStatus', 'dolphinStatus', 'tvDisplay', 'integrations', 'security', 'users'];
export const ROUTES = [
  '/dashboard', '/appointments', '/calendar', '/patient-management', '/expenses', '/statistics', '/videos', '/lab-tracking',
  '/tasks/history', '/approvals/history', '/templates', '/send', '/send-message',
  `/patient/${P}/works`, `/patient/${P}/patient-info`, `/patient/${P}/edit-patient`, `/patient/${P}/appointments`, `/patient/${P}/new-appointment`,
  `/patient/${P}/visits`, `/patient/${P}/new-visit`, `/patient/${P}/photos/tp0`, `/patient/${P}/compare`, `/patient/${P}/files`, `/patient/${P}/xrays`,
  `/patient/${P}/slideshow`, `/patient/${P}/new-work`, `/patient/${P}/work/${W}/diagnosis`, '/patient/new/add',
  '/aligner', '/aligner/all-sets', '/aligner/search', `/aligner/patient/${AW}`, '/aligner/archform-match', '/aligner/announcements',
  '/stand', '/stand/inventory', '/stand/pos', '/stand/sales', '/stand/reports',
  ...SETTINGS.map((t) => `/settings/${t}`),
].filter((r) => r.includes(filter));

/** Runs in the page. Returns one row per low-contrast element. */
export const CONTRAST_SWEEP = () => {
  const parse = (c) => {
    if (!c) return null;
    let m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?\s*\)$/);
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])];
    m = c.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]];
    return null;
  };
  // oklch() and friends: let the canvas resolve them to sRGB bytes
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const toRgb = (c) => {
    const p = parse(c);
    if (p) return p;
    try {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000';
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    } catch {
      return null;
    }
  };
  const over = (fg, bg) => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1];
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const firstStop = (img) => { const m = img.match(/(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/i); return m ? toRgb(m[1]) : null; };
  // A background can stack layers (a translucent sheen over an opaque base gradient):
  // one first stop per layer, top layer first. Reading only the top one put the Compare
  // stage's light text on "white" and reported it at 1.2:1.
  const layerStops = (img) => {
    const out = []; let depth = 0; let cur = '';
    for (const ch of img) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur);
    return out.map(firstStop).filter(Boolean);
  };
  const hidden = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return true;
    }
    return false;
  };
  const bgOf = (el) => {
    const layers = [];
    let viaImage = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        viaImage = true;
        const stops = layerStops(cs.backgroundImage);
        let opaque = false;
        for (const st of stops) { layers.push(st); if (st[3] >= 0.99) { opaque = true; break; } }
        if (opaque) break;
        if (stops.length) continue;
      }
      const c = toRgb(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; }
    }
    let acc = document.documentElement.dataset.theme === 'dark' ? [17, 21, 28, 1] : [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
    return { bg: acc, viaImage };
  };
  const row = (el, tag, text) => {
    const cs = getComputedStyle(el);
    const fg0 = toRgb(cs.color);
    if (!fg0) return null;
    const { bg, viaImage } = bgOf(el);
    const cr = ratio(over(fg0, bg), bg);
    if (cr >= 3) return null;
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return { cr: +cr.toFixed(2), tag, cls, text: text.slice(0, 40), fg: cs.color, bg: `rgb(${bg.slice(0, 3).map((v) => Math.round(v)).join(',')})`, img: viaImage };
  };
  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = walker.nextNode())) {
    const txt = t.nodeValue.replace(/\s+/g, ' ').trim();
    const el = t.parentElement;
    if (txt.length < 2 || !el || seen.has(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || hidden(el)) continue;
    seen.add(el);
    const hit = row(el, el.tagName.toLowerCase(), txt);
    if (hit) out.push(hit);
  }
  // inputs carry their text in value/placeholder, not in a text node
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]), select, textarea')) {
    const r = el.getBoundingClientRect();
    const label = (el.value || el.placeholder || '').replace(/\s+/g, ' ').trim();
    if (r.width < 2 || r.height < 2 || !label || hidden(el)) continue;
    const hit = row(el, `${el.tagName.toLowerCase()}*`, label);
    if (hit) out.push(hit);
  }
  return out;
};

export function printSweep(label, rows, limit = 40) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.tag}.${r.cls}|${r.fg}|${r.bg}`;
    if (!by.has(k)) by.set(k, { ...r, n: 0 });
    by.get(k).n++;
  }
  const list = [...by.values()].sort((a, b) => a.cr - b.cr);
  console.log(`\n### ${label} — ${list.length} signature(s) under 3:1`);
  for (const r of list.slice(0, limit)) console.log(`  ${String(r.cr).padStart(5)}  ×${String(r.n).padEnd(3)} ${r.img ? '[img] ' : ''}<${r.tag}> .${r.cls}  "${r.text}"  ${r.fg} on ${r.bg}`);
}

/** An authed, write-blocked context pinned to a theme + language. */
export async function readOnlyContext({ theme: th = 'dark', lang: lg = 'en', mobile = false } = {}) {
  const { browser, context } = await authedContext({ mobile });
  await context.addInitScript(([t, l]) => {
    try {
      localStorage.setItem('shwan_theme', t);
      localStorage.setItem('shwan_language', l);
    } catch {
      /* storage unavailable — the page falls back to its defaults */
    }
  }, [th, lg]);
  const blocked = [];
  await context.route('**/api/**', (route) => {
    const req = route.request();
    const url = req.url();
    if (/\/api\/wa\/|\/api\/sse\/whatsapp/.test(url)) return route.abort();
    if (req.method() !== 'GET') {
      // The page reporting its own crash is a finding, not a write: keep what it said.
      const said = /\/api\/client-error/.test(url) ? `  ${(req.postData() || '').replace(/\s+/g, ' ').slice(0, 300)}` : '';
      blocked.push(`${req.method()} ${new URL(url).pathname}${said}`);
      return route.abort();
    }
    return route.continue();
  });
  return { browser, context, blocked };
}

// Run only when invoked directly (probes import CONTRAST_SWEEP / readOnlyContext).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { browser, context, blocked } = await readOnlyContext({ theme, lang });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  let withHits = 0;
  for (const r of ROUTES) {
    try {
      await gotoSpa(page, `${E2E_BASE}${r}`, { settle: 1800 });
      const rows = await page.evaluate(CONTRAST_SWEEP);
      if (rows.length) { withHits++; printSweep(`${theme}/${lang} ${r}`, rows); }
    } catch (e) {
      console.log(`!! ${r}: ${String(e).slice(0, 160)}`);
    }
  }
  console.log(`\n${ROUTES.length} routes swept · ${withHits} with a signature under 3:1`);
  console.log('writes blocked:', [...new Set(blocked)].join(', ') || 'none');
  console.log('page errors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
}
