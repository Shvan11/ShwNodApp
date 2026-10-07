/**
 * Navigation waterfall: for each route, what an in-app navigation downloads and
 * in how many sequential steps (audit FE-F26-3/-4).
 *
 *   node scripts/e2e/nav-waterfall.mjs              # every route, 60 ms latency
 *   node scripts/e2e/nav-waterfall.mjs /patient     # only routes containing this
 *   LAT=0 node scripts/e2e/nav-waterfall.mjs        # no latency: shows CPU-side gaps
 *
 * Point E2E_BASE at the EXPRESS port (it serves the built ./dist — run
 * `npm run build:client` first), not at Vite: the dev server ships hundreds of
 * unbundled modules and its timings say nothing about production.
 *
 * Read it like this. A "step" is a group of the page's API reads that start
 * together; each step after the first could only start once something before it
 * had finished, so at LAT ms of latency it costs at least LAT ms. What to look for:
 *   • a step that starts ~300 ms after the one before it with nothing downloading
 *     in between: a Suspense fallback was shown and React is holding the reveal
 *     (FALLBACK_THROTTLE_MS). The chunk was not awaited by the route's loader;
 *   • the page's main read starting only after the chunks are in: it is missing
 *     from the loader (`PAGE_READS` in router/loaders.ts);
 *   • "TWICE": the loader prefetched under a different key than the page reads,
 *     or the page always refetches on mount. Either way, drop it from the loader.
 * 2026-10-06, after the fix: every patient page is 1–2 steps (it was 3–4, with a
 * 300 ms hole before the last) and no read is fetched twice.
 *
 * The STEPS are the result; the milliseconds are only good for comparing one run
 * of this script with another. The write-blocking interception turns the browser's
 * HTTP cache off, so every chunk is downloaded again on every navigation and the
 * times read about 200 ms high (Works: 533 ms here, 316 ms in a browser with its
 * cache on, measured through a GET-only proxy in the audit).
 *
 * Read-only: every non-GET is aborted in the browser (see readOnlyContext).
 * E2E_PATIENT / E2E_WORK / E2E_ALIGNER_WORK pick the records, as in the sweeps.
 */
import { gotoSpa, E2E_BASE } from './auth.mjs';
import { readOnlyContext, ROUTES } from './contrast-sweep.mjs';

const LAT = Number(process.env.LAT ?? 60);
const filter = process.argv[2] || '';
const routes = ROUTES.filter((r) => r !== '/dashboard' && r.includes(filter));
// the header's own polling and the media a page then loads are not the page's data
const SHELL = /\/api\/(tasks|portal-activity|approvals|wa\/|auth\/me|branding|csrf|client-error|sse)/;
const MEDIA = /working-files\/content|\/thumb|xray\/preview|\/logo/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { browser, context, blocked } = await readOnlyContext({ theme: 'light' });
const rows = [];
for (const route of routes) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await gotoSpa(page, `${E2E_BASE}/dashboard`, { settle: 2000 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: LAT, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 });
  await page.evaluate((r) => {
    window.__nav = performance.now();
    history.pushState({}, '', r);
    dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await sleep(4000);
  const entries = await page.evaluate(() =>
    performance.getEntriesByType('resource').filter((e) => e.startTime >= window.__nav).map((e) => {
      const u = new URL(e.name);
      return { u: u.pathname + u.search, s: Math.round(e.startTime - window.__nav), e: Math.round(e.responseEnd - window.__nav) };
    }));
  const chunks = entries.filter((x) => /\/assets\/.*\.(js|css)$/.test(x.u));
  const api = entries.filter((x) => x.u.startsWith('/api/') && !SHELL.test(x.u) && !MEDIA.test(x.u)).sort((a, b) => a.s - b.s);
  const chunkEnd = chunks.length ? Math.max(...chunks.map((x) => x.e)) : 0;
  const steps = [];
  for (const a of api) {
    const last = steps[steps.length - 1];
    if (!last || a.s - last.s > Math.max(20, LAT * 0.7)) steps.push({ s: a.s, items: [a] });
    else last.items.push(a);
  }
  const count = new Map();
  for (const a of api) count.set(a.u, (count.get(a.u) || 0) + 1);
  const twice = [...count].filter(([, n]) => n > 1).map(([u]) => u);
  const done = api.length ? Math.max(...api.map((x) => x.e)) : chunkEnd;
  rows.push({ route, steps: steps.length, done, twice });
  console.log(`\n${route}\n   chunks: ${chunks.length} files, in by ${chunkEnd} ms`);
  steps.forEach((st, i) => console.log(`   step ${i + 1} @${String(st.s).padStart(4)} ms  ${st.items.map((x) => x.u.replace('/api/', '').slice(0, 42)).join(' · ')}`.slice(0, 300)));
  await page.close();
}
console.log(`\n=== in-app navigation, ${LAT} ms latency`);
for (const r of rows) console.log(`${r.route.padEnd(38)} steps ${r.steps}  data complete ${String(r.done).padStart(5)} ms${r.twice.length ? `   TWICE: ${r.twice.join(', ')}` : ''}`);
if (blocked.length) console.log(`\n${blocked.length} non-GET request(s) aborted:\n  ${[...new Set(blocked)].join('\n  ')}`);
await browser.close();
