/**
 * Production error reporting — ships browser-side failures to POST /api/client-error
 * (Winston-logged server-side) so prod issues surface in the logs instead of dying
 * in a user's console. Three feeds:
 *   1. the React error boundary  → render/commit crashes (ErrorBoundary.componentDidCatch);
 *   2. the React Query caches     → 5xx + fail-loud contract-drift throws (query/client.ts);
 *   3. window error/rejection     → everything React boundaries can't catch (event
 *      handlers, async callbacks) — installed once via installGlobalErrorReporting().
 *
 * Hard rules — this code runs when the app is ALREADY broken:
 *  - never throw: a reporter that throws turns one bug into a crash loop;
 *  - never recurse: the report POST is a `postJSON` (a raw fetch, NOT a React Query
 *    call), so it can't re-trigger the query/mutation error caches that feed it;
 *  - throttle + dedupe + hard-cap: a render loop must not flood the log or network.
 */
import { postJSON } from './http';
import type { HttpError } from './http';
import type { ReportClientErrorBody } from '@shared/contracts/monitoring.contract';

/** What a feed supplies — the transport fills in url/userAgent/at. */
type ReportInput = Omit<ReportClientErrorBody, 'url' | 'userAgent' | 'at'>;

// Flood guards: collapse identical signatures within a short window, and hard-cap
// the total per page load so no loop/storm can hammer the endpoint.
const SEEN_TTL_MS = 30_000;
const MAX_REPORTS_PER_LOAD = 50;
const recent = new Map<string, number>();
let sent = 0;

/** Chunk-load failures self-heal via a one-time reload (see App.tsx) — never a bug. */
const CHUNK_ERROR_RE =
  /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically imported module/i;

function safeStringify(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value)?.slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

function isThrottled(signature: string, now: number): boolean {
  for (const [sig, ts] of recent) if (now - ts > SEEN_TTL_MS) recent.delete(sig);
  if (recent.has(signature)) return true;
  recent.set(signature, now);
  return false;
}

/**
 * High-value HTTP failures only: server bugs (5xx) and fail-loud contract drift
 * (the silent gap — a schema mismatch surfaces as `err.validation`). Deliberately
 * skips 4xx (expected/handled inline: 401 redirect, 404 empty-state, 400 validation,
 * 409 conflict) and transient network/abort noise React Query already retries —
 * reporting those would bury the real signal.
 */
export function isReportableHttpError(err: unknown): boolean {
  const e = err as HttpError | undefined;
  if (!e) return false;
  if (e.validation !== undefined) return true;
  return typeof e.status === 'number' && e.status >= 500;
}

/** Pull the HttpError fields worth logging (status + Zod validation issues). */
export function describeHttpError(err: unknown): Pick<ReportInput, 'status' | 'validation'> {
  const e = err as HttpError | undefined;
  return {
    status: typeof e?.status === 'number' ? e.status : undefined,
    validation: safeStringify(e?.validation, 16000),
  };
}

/** JSON-stringify a query key for the report (bounded). */
export function stringifyKey(key: unknown): string | undefined {
  return safeStringify(key, 2000);
}

/** Report one client-side failure. Fire-and-forget; never throws. */
export function reportClientError(input: ReportInput): void {
  try {
    if (sent >= MAX_REPORTS_PER_LOAD) return;
    const now = Date.now();
    const signature = `${input.source}|${input.message}|${input.status ?? ''}`.slice(0, 300);
    if (isThrottled(signature, now)) return;
    sent += 1;

    const body: ReportClientErrorBody = {
      ...input,
      message: String(input.message ?? 'Unknown error').slice(0, 4000) || 'Unknown error',
      stack: input.stack?.slice(0, 16000),
      componentStack: input.componentStack?.slice(0, 16000),
      url: typeof location !== 'undefined' ? location.href.slice(0, 2000) : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 1000) : undefined,
      at: new Date().toISOString(),
    };

    // Fire-and-forget through the funnel (CSRF auto-attached). Swallow everything —
    // a failed report must never surface to the user or re-enter this path.
    void postJSON('/api/client-error', body).catch(() => {});
  } catch {
    /* reporting must never throw */
  }
}

let installed = false;

/**
 * Install window-level handlers for the errors React can't catch — uncaught sync
 * throws (event handlers, timers) and unhandled promise rejections (async paths).
 * Idempotent; call once at boot. The chunk-load reload guard in App.tsx keeps its
 * own listeners — here we only *report*, and skip the chunk errors it self-heals.
 */
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    // Resource-load failures (img/script 404) fire here with no `error` and an
    // empty message — ignore; we only want real JS exceptions.
    if (!event.error && !event.message) return;
    const message = event.message || String((event.error as Error | undefined)?.message ?? 'Uncaught error');
    if (CHUNK_ERROR_RE.test(message)) return;
    reportClientError({
      source: 'window-error',
      message,
      stack: (event.error as Error | undefined)?.stack,
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason as (Error & HttpError) | undefined;
    const message = String(reason?.message ?? reason ?? 'Unhandled rejection');
    // Self-healing chunk-load rejections are handled in App.tsx — not bugs.
    if (CHUNK_ERROR_RE.test(message)) return;
    // An HttpError React Query already surfaced inline isn't worth double-reporting
    // unless it's a high-value one (5xx / contract drift).
    if (reason && typeof reason === 'object' && 'status' in reason && !isReportableHttpError(reason)) return;
    reportClientError({
      source: 'unhandledrejection',
      message,
      stack: reason?.stack,
      ...describeHttpError(reason),
    });
  });
}
