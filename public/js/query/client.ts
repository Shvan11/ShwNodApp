/**
 * The single shared TanStack Query client.
 *
 * Extracted out of App.tsx so it can be imported by code that runs **outside**
 * React — specifically the route loaders (router/loaders.ts), which prefetch into
 * this same cache via `loaderQuery`/`ensureQueryData` before a screen renders.
 * App.tsx feeds it to `<QueryClientProvider>`; everything else imports it here.
 *
 * Defaults (carried over verbatim from the original inline client, audit M7/M8):
 *  - staleTime 30s — clinic data changes by the minute, not the second.
 *  - gcTime 5m.
 *  - retry — up to 2 transient failures (network / timeout / 5xx). A 4xx and a
 *    fail-loud contract-drift throw are both deterministic, so they are NOT
 *    retried; see `isTransientQueryError` below.
 *  - refetchOnWindowFocus off — refetch is driven by SSE + explicit triggers.
 */
import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import type { HttpError } from '../core/http';
import {
  reportClientError,
  isReportableHttpError,
  describeHttpError,
  stringifyKey,
} from '../core/error-reporter';

// Global error sinks — every query/mutation error flows through here in addition to
// the per-call handling. We forward only the high-value failures (5xx + fail-loud
// contract drift) to prod error reporting; isReportableHttpError filters the rest
// (4xx is expected/handled inline; transient network/abort is retried). The report
// is a raw POST, not a React Query call, so it can't re-enter these caches.
const queryCache = new QueryCache({
  onError: (error, query) => {
    if (!isReportableHttpError(error)) return;
    reportClientError({
      source: 'query',
      message: (error as Error)?.message ?? 'Query error',
      queryKey: stringifyKey(query.queryKey),
      ...describeHttpError(error),
    });
  },
});

const mutationCache = new MutationCache({
  onError: (error) => {
    if (!isReportableHttpError(error)) return;
    reportClientError({
      source: 'mutation',
      message: (error as Error)?.message ?? 'Mutation error',
      ...describeHttpError(error),
    });
  },
});

/**
 * Is this failure worth another round-trip?
 *
 * A bare numeric `retry` retries *everything* — a 404 on a deleted lab case cost
 * three requests and ~3s of spinner before the screen could say "not found", and
 * a contract-drift throw (the fail-loud guard) was replayed twice against a
 * server that would produce the identical mismatch. Both are deterministic.
 *
 * What is left — network failure, our own 30s timeout, 5xx — is transient and
 * worth retrying. This is the same policy `core/http.ts#isRetriableError`
 * implements for its own opt-in GET retry layer; the two do not stack, because
 * `fetchJSON` defaults `retries` to 0 and no factory overrides it.
 */
export function isTransientQueryError(error: unknown): boolean {
  const e = error as HttpError | undefined;
  if (!e) return false;
  if (e.name === 'AbortError') return false; // caller navigated away
  if (e.validation !== undefined) return false; // H11 contract drift — deterministic
  const status = e.status;
  if (typeof status === 'number') return status >= 500;
  return true; // no status = network failure / timeout
}

export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => failureCount < 2 && isTransientQueryError(error),
      refetchOnWindowFocus: false,
    },
  },
});
