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
 *  - retry 2 — transient network/5xx retry for idempotent reads.
 *  - refetchOnWindowFocus off — refetch is driven by SSE + explicit triggers.
 */
import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
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

export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
