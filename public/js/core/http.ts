/**
 * HTTP utility functions for making API requests.
 *
 * The single funnel for every staff-app fetch (audit H1). Responsibilities are
 * layered here so call sites stay declarative:
 *  - unwrap the backend success envelope (H4) — callers get the inner payload;
 *  - attach the CSRF double-submit token on mutations (H2);
 *  - abort a request that hangs past a timeout, with opt-in GET retry (M8);
 *  - optionally validate the (unwrapped) response against a Zod schema (H11);
 *  - throw a rich `HttpError` on non-2xx so callers branch on status/data.
 *
 * The patient portal is a deliberate exception (its own Zod boundary + its own
 * CSRF token) and does NOT route through here — see public/js/portal/*.
 */
/**
 * Minimal structural shape of a Zod schema (its `safeParse`). Typing the
 * `schema` option this way — rather than importing `ZodType` — keeps the http
 * layer free of a Zod type dependency and sidesteps Zod's generic-variance
 * friction (a concrete `ZodObject` not cleanly assigning to `ZodType<unknown>`).
 * Every Zod schema satisfies it structurally.
 */
export interface ResponseSchema<T = unknown> {
  safeParse(
    data: unknown
  ): { success: true; data: T } | { success: false; error: { issues: unknown } };
}

export interface HttpError extends Error {
  status?: number;
  response?: Response;
  data?: unknown;
  url?: string;
  options?: RequestInit;
  /** Present when the error is an H11 response-validation failure (Zod issues). */
  validation?: unknown;
}

export interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
  /** Abort the request after this many ms (default 30s; matches the server's
   *  30s requestTimeout). Pass 0 to disable. (audit M8) */
  timeoutMs?: number;
  /** Retry an idempotent GET this many times on network error / timeout / 5xx,
   *  with exponential backoff. Default 0 — mutations are never retried, and
   *  React Query supplies retry for the queries it manages. (audit M8) */
  retries?: number;
  /** Validate the unwrapped response body; throws on mismatch (fail-loud). (audit H11) */
  schema?: ResponseSchema;
}

/** Default request timeout — aligned with the server's 30s requestTimeout. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Default fetch options
 */
const defaultOptions: FetchOptions = {
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'same-origin',
};

// ---------------------------------------------------------------------------
// CSRF double-submit token (audit H2)
//
// The server mints a token bound to the staff session (GET /api/csrf-token) and
// validates it (HMAC) against the cookie + session on every mutation. We cache
// the token in memory and echo it in the `x-csrf-token` header on POST/PUT/
// PATCH/DELETE. A 403 `EBADCSRFTOKEN` (e.g. after a change-password session
// regeneration, or a server restart with a rotated secret) clears the cache and
// triggers one transparent re-fetch + retry of the mutation.
// ---------------------------------------------------------------------------
let csrfToken: string | null = null;
let csrfTokenInFlight: Promise<string> | null = null;

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch('/api/csrf-token', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to fetch CSRF token (HTTP ${res.status})`);
  const body = (await res.json()) as { csrfToken?: string };
  if (!body.csrfToken) throw new Error('CSRF token endpoint returned no token');
  return body.csrfToken;
}

/** Return the cached token, single-flight fetching it if absent. */
async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfTokenInFlight) {
    csrfTokenInFlight = fetchCsrfToken()
      .then((token) => {
        csrfToken = token;
        return token;
      })
      .finally(() => {
        csrfTokenInFlight = null;
      });
  }
  return csrfTokenInFlight;
}

/** Drop the cached token so the next mutation re-fetches it (after a 403). */
function invalidateCsrfToken(): void {
  csrfToken = null;
}

/** Eagerly warm the CSRF token (optional — mutations fetch it lazily otherwise). */
export function prefetchCsrfToken(): Promise<string> {
  return ensureCsrfToken();
}

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function isMutationMethod(method: string): boolean {
  return MUTATION_METHODS.has(method.toUpperCase());
}

// ---------------------------------------------------------------------------
// Envelope unwrap (audit H4)
// ---------------------------------------------------------------------------

/**
 * Unwrap the backend success envelope.
 *
 * `sendSuccess()` (utils/error-response.ts) wraps every payload as
 * `{ success: true, data, timestamp, message? }`. We return `body.data` for
 * exactly that shape and pass every other body through untouched, so callers
 * consume the inner payload directly and a route adopting the envelope (H4)
 * stays transparent to all funneled callers.
 *
 * Deliberately conservative — we unwrap only when `success === true` AND a
 * `data` key is present. That leaves alone:
 *  - bare arrays / plain objects (no `success`);
 *  - non-enveloped `{ success: true, ... }` custom shapes that carry their
 *    payload at the top level (e.g. photo-editor `{ success, tp_code }`,
 *    `/auth/me` `{ success, user }`) — unwrapping these would drop their data.
 * Error envelopes never reach here: a non-2xx response is thrown as an
 * HttpError below, before any unwrapping.
 */
function unwrapEnvelope(body: unknown): unknown {
  if (
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    (body as { success?: unknown }).success === true &&
    'data' in body
  ) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/**
 * Validate the unwrapped body against a Zod schema (audit H11). Fail-loud:
 * throws an `HttpError` (no `status`, so loaders surface it via their 500 path
 * and components via their catch) carrying the Zod issues, so a backend contract
 * drift is caught instead of silently corrupting UI state.
 */
function validateResponse(data: unknown, schema: ResponseSchema, url: string): unknown {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const err: HttpError = new Error(`Response validation failed for ${url}`);
  err.url = url;
  err.data = data;
  err.validation = result.error.issues;
  throw err;
}

/**
 * Handle fetch response
 * @param response - Fetch response
 * @param schema - Optional Zod schema to validate the unwrapped JSON body (H11)
 * @returns Response data
 */
async function handleResponse<T>(response: Response, schema?: ResponseSchema): Promise<T> {
  // Check if response is successful
  if (!response.ok) {
    const error: HttpError = new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.response = response;

    try {
      error.data = await response.json();
    } catch {
      error.data = await response.text();
    }

    throw error;
  }

  // Check content type
  const contentType = response.headers.get('content-type');

  if (contentType?.includes('application/json')) {
    const body = await response.json();
    const unwrapped = unwrapEnvelope(body);
    return (schema ? validateResponse(unwrapped, schema, response.url) : unwrapped) as T;
  }

  return response.text() as unknown as T;
}

/**
 * Extract a human-readable message from a thrown error.
 *
 * Prefers the server's `{ error }` / `{ message }` carried on an `HttpError`'s
 * parsed body (`error.data`), then the Error's own message, then the fallback.
 * Use this in `catch` blocks of funneled callers so the backend's friendly
 * message still surfaces (a bare `err.message` would only show
 * `"HTTP Error: 400 …"`).
 */
export function httpErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string; message?: string } })?.data;
  return data?.error || data?.message || (err as Error)?.message || fallback;
}

// ---------------------------------------------------------------------------
// Timeout / retry plumbing (audit M8)
// ---------------------------------------------------------------------------

/**
 * Combine an optional caller signal (e.g. a route loader's `request.signal`)
 * with a timeout into one signal. Implemented with a plain AbortController so it
 * works without `AbortSignal.any`/`AbortSignal.timeout`. A caller abort
 * propagates its reason (so loaders still see `name === 'AbortError'`); our
 * timeout aborts with a `TimeoutError`.
 */
function withTimeout(
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError'));
        }, timeoutMs)
      : null;

  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  };

  return { signal: controller.signal, cleanup };
}

/** A transient failure worth retrying an idempotent GET on. */
function isRetriableError(err: HttpError): boolean {
  if (err?.name === 'AbortError') return false; // caller navigation/cancel — never retry
  if (err?.name === 'TimeoutError') return true; // our own timeout
  if (err instanceof TypeError) return true; // network failure ("Failed to fetch")
  const s = err?.status;
  return s === 502 || s === 503 || s === 504;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt: number): number => Math.min(1000 * 2 ** attempt, 8000);

/**
 * Make a fetch request
 * @param url - Request URL
 * @param options - Fetch options
 * @returns Response data
 */
export async function fetchData<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 0,
    schema,
    signal: callerSignal,
    headers: callerHeaders,
    ...rest
  } = options;

  const method = (rest.method || 'GET').toUpperCase();
  const mutation = isMutationMethod(method);

  // One full attempt. `csrfRetried` guards the single transparent retry after a
  // rejected CSRF token.
  const attempt = async (csrfRetried: boolean): Promise<T> => {
    const headers: Record<string, string> = {
      ...defaultOptions.headers,
      ...callerHeaders,
    };

    // A FormData body must set its own multipart boundary — forcing the default
    // application/json Content-Type makes the browser skip the boundary and the
    // server routes the binary body through express.json() (→ PayloadTooLarge).
    if (rest.body instanceof FormData) {
      delete headers['Content-Type'];
    }

    // Attach the CSRF token on mutations (audit H2).
    if (mutation) {
      headers['x-csrf-token'] = await ensureCsrfToken();
    }

    const { signal, cleanup } = withTimeout(callerSignal, timeoutMs);
    try {
      const response = await fetch(url, {
        ...defaultOptions,
        ...rest,
        headers,
        signal,
      });
      return await handleResponse<T>(response, schema);
    } catch (error) {
      const httpError = error as HttpError;

      // CSRF token rejected → refresh once and retry the mutation transparently.
      if (
        mutation &&
        !csrfRetried &&
        httpError.status === 403 &&
        (httpError.data as { code?: string } | undefined)?.code === 'EBADCSRFTOKEN'
      ) {
        invalidateCsrfToken();
        return attempt(true);
      }

      // Add request metadata to error
      httpError.url = url;
      httpError.options = { ...rest, method };
      throw httpError;
    } finally {
      cleanup();
    }
  };

  // M8 retry loop — idempotent GETs only (mutations have retries forced to 0).
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt(false);
    } catch (error) {
      lastError = error;
      const retriable =
        !mutation && !callerSignal?.aborted && isRetriableError(error as HttpError);
      if (i === retries || !retriable) throw error;
      await delay(backoffMs(i));
    }
  }
  throw lastError;
}

/**
 * Make a GET request
 * @param url - Request URL
 * @param options - Fetch options
 * @returns Response data
 */
export function fetchJSON<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  return fetchData<T>(url, {
    method: 'GET',
    ...options,
  });
}

/**
 * Make a POST request
 * @param url - Request URL
 * @param data - Request data
 * @param options - Fetch options
 * @returns Response data
 */
export function postJSON<T = unknown, D = unknown>(
  url: string,
  data: D,
  options: FetchOptions = {}
): Promise<T> {
  return fetchData<T>(url, {
    ...options,
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Make a PUT request
 * @param url - Request URL
 * @param data - Request data
 * @param options - Fetch options
 * @returns Response data
 */
export function putJSON<T = unknown, D = unknown>(
  url: string,
  data: D,
  options: FetchOptions = {}
): Promise<T> {
  return fetchData<T>(url, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * Make a PATCH request
 * @param url - Request URL
 * @param data - Request data
 * @param options - Fetch options
 * @returns Response data
 */
export function patchJSON<T = unknown, D = unknown>(
  url: string,
  data: D,
  options: FetchOptions = {}
): Promise<T> {
  return fetchData<T>(url, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Make a DELETE request
 * @param url - Request URL
 * @param options - Fetch options
 * @returns Response data
 */
export function deleteJSON<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  return fetchData<T>(url, {
    ...options,
    method: 'DELETE',
  });
}

/**
 * Make a form data POST request
 * @param url - Request URL
 * @param formData - Form data
 * @param options - Fetch options
 * @returns Response data
 */
export function postFormData<T = unknown>(
  url: string,
  formData: FormData,
  options: FetchOptions = {}
): Promise<T> {
  return fetchData<T>(url, {
    method: 'POST',
    body: formData,
    headers: {}, // Remove Content-Type so boundary is set automatically
    ...options,
  });
}

export default {
  fetchData,
  fetchJSON,
  postJSON,
  putJSON,
  patchJSON,
  deleteJSON,
  postFormData,
  httpErrorMessage,
  prefetchCsrfToken,
};
