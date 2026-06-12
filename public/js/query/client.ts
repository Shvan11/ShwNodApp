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
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
