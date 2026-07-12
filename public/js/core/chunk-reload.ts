/**
 * Stale-chunk self-healing — the single home for chunk-load failure detection
 * and the guarded one-time reload (previously duplicated across App.tsx and
 * error-reporter.ts, which had already drifted).
 *
 * Route components are lazy-loaded code-split chunks (e.g. DailyAppointments-*.js).
 * A chunk fetch can fail because:
 *   1. Stale tab after a redeploy — the open page references old hashed
 *      filenames that no longer exist on disk (404).
 *   2. A transient network blip (QUIC idle-timeout / packet loss on the LAN).
 *   3. A server-side regression turning asset responses into errors — the
 *      2026-07-11 root-router authorize() outage 403'd every chunk. This case
 *      MUST stay visible: a failure that persists past the reload is an
 *      incident, so the boundaries report it (see selfHealChunkError).
 *
 * Recovery: one reload re-fetches a fresh index.html (current chunk hashes).
 * The sessionStorage cooldown makes a genuinely-missing asset show the error
 * fallback instead of reload-looping.
 *
 * Failure-path map (why three consumers wire into this module):
 *  - Vite's build-time preload helper wraps every dynamic import and dispatches
 *    cancelable `vite:preloadError` on failure. preventDefault() makes the
 *    helper SWALLOW the error and resolve the import as `undefined` — React.lazy
 *    then throws `…undefined (reading 'default')` during render. So the listener
 *    here only preventDefault()s when it is actually reloading.
 *  - A React.lazy rejection NEVER reaches `unhandledrejection` (React captures
 *    the import promise and re-throws during render), so the class error
 *    boundaries and the router errorElement are the only catch points — they
 *    call selfHealChunkError() from componentDidCatch / an effect.
 *  - Non-React dynamic imports still surface as unhandled rejections — the
 *    window fallback listener covers those.
 */

const RELOAD_FLAG = 'shwan_chunk_reload_ts';
const RELOAD_COOLDOWN_MS = 10_000;

/**
 * Failed module/CSS *fetches* — the classic post-deploy staleness signatures
 * (Chrome / Firefox / Safari import() rejections + Vite's own CSS-dep preload
 * error). Safe to skip at the window-reporting level: the self-heal owns them,
 * and persistent ones re-surface through a boundary report.
 */
const CHUNK_FETCH_RE =
  /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically imported module|Unable to preload CSS/i;

/**
 * The *manufactured* render-time signature: a preventDefault()ed
 * vite:preloadError resolves the failed import as `undefined`, and React.lazy's
 * `.default` read throws. Kept as insurance (old-bundle tabs during a deploy
 * transition still swallow unconditionally) and matched tightly to `.default`
 * so ordinary undefined-property bugs don't trigger reloads. Chrome (old + new
 * phrasing) and Safari; Firefox's "x is undefined" is too generic to match.
 * Only consulted for the reload decision — NEVER to suppress reporting.
 */
const LAZY_MODULE_UNDEFINED_RE =
  /Cannot read propert(?:y 'default' of undefined|ies of undefined \(reading 'default'\))|undefined is not an object \(evaluating [^)]*\.default/i;

/** Fetch-type chunk failure (network/staleness) — the window-level skip set. */
export function isChunkFetchMessage(message: string): boolean {
  return CHUNK_FETCH_RE.test(message);
}

/** Any chunk-load failure signature, including the manufactured render-time one. */
export function isChunkLoadError(message: string): boolean {
  return CHUNK_FETCH_RE.test(message) || LAZY_MODULE_UNDEFINED_RE.test(message);
}

// True from the moment location.reload() is called until the page actually
// tears down — the current JS task keeps running in that window, so the failed
// import still resolves/rejects and a boundary catches the render throw. The
// flag lets those late catchers stay silent instead of double-reporting.
let reloadPending = false;

/**
 * Reload once, guarded by a sessionStorage cooldown. Returns true when a reload
 * is happening (just initiated, or already pending from this task); false when
 * the reload budget is spent (or storage is unavailable — then never reload,
 * a loop is worse than the error UI).
 */
export function reloadOnce(context: string): boolean {
  if (reloadPending) return true;

  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0);
    if (now - last < RELOAD_COOLDOWN_MS) {
      console.error(
        `[chunk-reload] Module load still failing after a reload (${context}); not reloading again.`
      );
      return false;
    }
    sessionStorage.setItem(RELOAD_FLAG, String(now));
  } catch {
    return false;
  }

  reloadPending = true;
  console.warn(`[chunk-reload] Reloading once to recover from a failed module load (${context}).`);
  window.location.reload();
  return true;
}

export type ChunkSelfHealResult = 'not-chunk-error' | 'reloading' | 'reload-exhausted';

/**
 * Boundary-side entry point (ErrorBoundary.componentDidCatch, RouteError).
 *  - 'not-chunk-error'   → not ours; caller reports/renders as usual.
 *  - 'reloading'         → self-heal in progress; caller stays silent.
 *  - 'reload-exhausted'  → chunk failure that persists past the reload. The
 *    caller MUST report it: this is an incident (bad deploy, asset-route
 *    regression — it was the main client-side signal of the 2026-07-11
 *    outage), not deploy noise.
 */
export function selfHealChunkError(message: string, context: string): ChunkSelfHealResult {
  if (!isChunkLoadError(message)) return 'not-chunk-error';
  return reloadOnce(context) ? 'reloading' : 'reload-exhausted';
}

let installed = false;

/**
 * Install the window-level self-heal listeners. Idempotent; call once at boot
 * (App.tsx), before installGlobalErrorReporting so a reload wins the race.
 */
export function installChunkSelfHealing(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Vite dispatches this when its preload helper (wrapping every built dynamic
  // import) fails to fetch a chunk or a CSS dep. Cancel the rethrow ONLY when
  // actually reloading — a preventDefault() without a reload resolves the
  // import as `undefined` and manufactures a misleading TypeError downstream.
  window.addEventListener('vite:preloadError', (event: Event) => {
    const payload = (event as Event & { payload?: Error }).payload;
    if (reloadOnce(`vite:preloadError: ${payload?.message ?? 'unknown chunk'}`)) {
      event.preventDefault();
    }
  });

  // Fallback for dynamic imports outside React.lazy (their rejections stay
  // unhandled). Reload-exhausted cases are silent here by design: the visible
  // terminal states all run through a boundary, which owns the reporting.
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const message = String((event.reason as Error | undefined)?.message ?? event.reason ?? '');
    if (isChunkFetchMessage(message)) {
      reloadOnce('unhandledrejection');
    }
  });
}
