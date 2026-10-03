/**
 * API Client for WhatsApp send page with validation and retry.
 *
 * Retry policy matches `core/http.ts`: only an idempotent GET is retried, and
 * only on a transient failure (network error, timeout, 5xx). It used to retry
 * EVERY request three times — POSTs included — so one failed-but-delivered
 * "Send email" (a 502 from the tunnel, a restart mid-send) mailed the whole
 * staff list two or three times (audit FE-F1-4).
 */
import { CONFIG } from './whatsapp-send-constants';
import { validateApiResponse } from './whatsapp-validation';
import { prefetchCsrfToken } from '../core/http';

/**
 * Retry options for the retry manager
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Request options for the API client
 */
export interface RequestOptions extends RequestInit {
  cancelPrevious?: string;
  expectedFields?: string[];
  /** Per-attempt timeout; defaults to `CONFIG.OPERATION_TIMEOUT_MS` (30 s, the server's own request timeout). */
  timeoutMs?: number;
}

/** A non-2xx response, carrying the server's own message when it sent one. */
export class APIHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'APIHttpError';
  }
}

/** Worth another attempt: a network failure, our timeout, or a 5xx — never a 4xx or a cancel. */
function isTransient(error: Error): boolean {
  if (error.name === 'AbortError') return false; // cancelled by the caller
  if (error instanceof APIHttpError) return error.status >= 500;
  return true; // network failure / TimeoutError / unparseable body
}

/**
 * Retry Manager with Exponential Backoff
 */
export class RetryManager {
  static async withRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions & { shouldRetry?: (error: Error) => boolean } = {}
  ): Promise<T> {
    const {
      maxAttempts = CONFIG.RETRY_MAX_ATTEMPTS,
      baseDelay = CONFIG.RETRY_BASE_DELAY_MS,
      maxDelay = CONFIG.RETRY_MAX_DELAY_MS,
      onRetry = null,
      shouldRetry = () => true,
    } = options;

    let lastError: Error = new Error('Unknown error');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === maxAttempts || !shouldRetry(lastError)) {
          break;
        }

        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

        if (onRetry) {
          onRetry(lastError, attempt, delay);
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}

/**
 * API Client with Validation and Retry
 */
export class APIClient {
  private abortControllers: Map<string, AbortController>;

  constructor() {
    this.abortControllers = new Map();
  }

  async request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const requestId = `${Date.now()}-${Math.random()}`;

    // Cancel previous request with same ID if needed
    if (options.cancelPrevious && this.abortControllers.has(options.cancelPrevious)) {
      this.abortControllers.get(options.cancelPrevious)!.abort();
    }

    // Create abort controller
    const abortController = new AbortController();
    const requestKey = options.cancelPrevious || requestId;
    this.abortControllers.set(requestKey, abortController);

    // Extract custom options before passing to fetch
    const { cancelPrevious: _cancelPrevious, expectedFields, timeoutMs = CONFIG.OPERATION_TIMEOUT_MS, ...fetchOptions } = options;
    const method = (fetchOptions.method || 'GET').toUpperCase();
    const isMutation = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';

    try {
      return await RetryManager.withRetry<T>(
        async () => {
          // One signal per attempt: aborted by the caller's controller OR by the
          // timeout. There was no timeout at all, so a stuck request left the
          // page's button disabled forever.
          const attempt = new AbortController();
          const cancel = () => attempt.abort(abortController.signal.reason);
          if (abortController.signal.aborted) cancel();
          abortController.signal.addEventListener('abort', cancel, { once: true });
          const timer = setTimeout(
            () => attempt.abort(new DOMException(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, 'TimeoutError')),
            timeoutMs
          );

          try {
            // Attach the CSRF double-submit token on mutations (audit H2): the
            // unconditional staffCsrfProtection gate 403s tokenless /api mutations.
            // Mirrors core/http.ts — this bespoke client bypasses that funnel.
            const headers = {
              'Content-Type': 'application/json',
              ...fetchOptions.headers,
              ...(isMutation ? { 'x-csrf-token': await prefetchCsrfToken() } : {}),
            };

            // eslint-disable-next-line no-restricted-syntax -- bespoke WhatsApp-send API client (parallel to core/http.ts): adds GET retry w/ exponential backoff (RetryManager), per-request AbortController cancellation, and validateApiResponse. Its consumers read top-level fields of un-enveloped responses.
            const response = await fetch(url, {
              credentials: 'same-origin', // Include session cookies for authentication
              ...fetchOptions,
              signal: attempt.signal,
              headers,
            });

            if (!response.ok) {
              // Surface the server's own message (a 409 "already being sent", a
              // 400's reason) rather than a bare "HTTP 409: Conflict".
              const body = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
              const serverMessage = typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : null;
              throw new APIHttpError(serverMessage ?? `HTTP ${response.status}: ${response.statusText}`, response.status);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType?.includes('application/json')) {
              const text = await response.text();
              console.error('[API Client] Expected JSON but got:', contentType, text);
              throw new Error(`Expected JSON but got ${contentType}`);
            }

            const data = await response.json();
            return validateApiResponse<T>(data, expectedFields || []);
          } catch (error) {
            // fetch rejects with the signal's reason; name a timeout plainly.
            if (attempt.signal.reason instanceof DOMException && attempt.signal.reason.name === 'TimeoutError') {
              throw attempt.signal.reason;
            }
            throw error;
          } finally {
            clearTimeout(timer);
            abortController.signal.removeEventListener('abort', cancel);
          }
        },
        {
          // A mutation is never replayed: the server may already have acted.
          maxAttempts: isMutation || url.includes('/messaging/status/') ? 1 : CONFIG.RETRY_MAX_ATTEMPTS,
          shouldRetry: isTransient,
          onRetry: (error, attemptNo) => {
            // Only log retries for important requests
            if (!url.includes('/messaging/status/') && !url.includes('/messaging/count/')) {
              console.warn(`Retry ${attemptNo}: ${error.message}`);
            }
          },
        }
      );
    } finally {
      // Delete by IDENTITY: when a later request reused this `cancelPrevious`
      // key, the map now holds ITS controller, and deleting by key here made a
      // later `cancelRequest(key)` silently do nothing.
      if (this.abortControllers.get(requestKey) === abortController) {
        this.abortControllers.delete(requestKey);
      }
    }
  }

  async get<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(url, { method: 'GET', ...options });
  }

  async post<T = unknown>(
    url: string,
    data: unknown = null,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.request<T>(url, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    });
  }

  cancelRequest(requestKey: string): void {
    if (this.abortControllers.has(requestKey)) {
      this.abortControllers.get(requestKey)!.abort();
      this.abortControllers.delete(requestKey);
    }
  }

  cancelAllRequests(): void {
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();
  }
}
