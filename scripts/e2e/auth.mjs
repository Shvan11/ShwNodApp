/**
 * Reusable Playwright auth + navigation helpers for local E2E checks.
 *
 * Hard-won lessons baked in here (read before "fixing" testing again):
 *  1. The login route is rate-limited 15 min / IP (routes/auth.ts loginLimiter).
 *     Logging in on every run trips HTTP 429. So we log in ONCE, cache Playwright
 *     storageState (the session cookie), and reuse it across runs.
 *  2. In PRODUCTION (port 3000) express-session sets a `Secure` cookie and only
 *     emits Set-Cookie when the request looks HTTPS. Over plain http://localhost
 *     no cookie is set → every page redirects to /login.html. We send
 *     `X-Forwarded-Proto: https` so the cookie is issued. (Dev :5273 is secure=false,
 *     but the header is harmless there, so we always send it.)
 *  3. The SPA holds open SSE connections, so Playwright `networkidle` NEVER fires.
 *     Navigate with `domcontentloaded` + an explicit `waitForSelector`.
 *  4. The sticky universal header / patient banner intercept pointer events — click
 *     in-card buttons with `{ force: true }`.
 *  5. For CSS/layout checks do NOT combine `deviceScaleFactor` + `isMobile`; it
 *     distorts `window.innerWidth`. A plain `viewport` gives true CSS-px widths.
 *
 * Default target is the DEV server (Vite :5273) which has HMR + a non-secure cookie.
 * Override with E2E_BASE / E2E_USER / E2E_PASS env vars.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(HERE, '.auth-state.json');

export const E2E_BASE = process.env.E2E_BASE || 'http://localhost:5273';
const CREDS = {
  username: process.env.E2E_USER || 'Admin',
  password: process.env.E2E_PASS || 'Yarmok11',
};
const STATE_TTL_MS = 20 * 60 * 1000; // well under the session TTL; forces occasional refresh

function stateIsFresh() {
  try {
    return Date.now() - fs.statSync(STATE_FILE).mtimeMs < STATE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Log in once via the API and persist Playwright storageState. Reused across runs
 * so we never re-hit the rate-limited login endpoint. Pass { force: true } to refresh.
 */
export async function ensureAuthState({ base = E2E_BASE, force = false } = {}) {
  if (!force && stateIsFresh()) return STATE_FILE;
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const resp = await ctx.request.post(`${base}/api/auth/login`, {
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      data: CREDS,
    });
    if (resp.status() === 429) {
      throw new Error(
        'login HTTP 429 (rate-limited). Restart the dev server to reset the in-memory limiter, then retry.'
      );
    }
    if (resp.status() !== 200) {
      throw new Error(`login failed: HTTP ${resp.status()} ${await resp.text().catch(() => '')}`);
    }
    await ctx.storageState({ path: STATE_FILE });
    return STATE_FILE;
  } finally {
    await browser.close();
  }
}

/**
 * Launch a browser + an authenticated context, ready to navigate the SPA.
 * `mobile: true` → 412×915 (≈ Galaxy S23 Ultra portrait) with touch.
 * Returns { browser, context }; caller is responsible for `await browser.close()`.
 */
export async function authedContext({ base = E2E_BASE, mobile = false, headless = true } = {}) {
  await ensureAuthState({ base });
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    storageState: STATE_FILE,
    viewport: mobile ? { width: 412, height: 915 } : { width: 1280, height: 900 },
    hasTouch: mobile,
  });
  return { browser, context };
}

/** Navigate an SPA route safely (SSE means networkidle never settles). */
export async function gotoSpa(page, url, { waitFor, settle = 1200 } = {}) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 25000 });
  if (settle) await page.waitForTimeout(settle);
}

/** Report any element whose right edge exceeds the viewport — the usual "looks wide" cause. */
export async function findHorizontalOverflow(page, limit = 12) {
  return page.evaluate((max) => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 2 || r.width > vw + 2) {
        out.push({
          sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).slice(0, 50) : ''),
          width: Math.round(r.width),
          right: Math.round(r.right),
          text: (el.textContent || '').trim().slice(0, 40),
        });
      }
    }
    return { viewport: vw, scrollWidth: document.documentElement.scrollWidth, offenders: out.sort((a, b) => b.right - a.right).slice(0, max) };
  }, limit);
}
