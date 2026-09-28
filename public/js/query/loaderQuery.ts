/**
 * Bridge between React Router loaders and the TanStack Query cache.
 *
 * `loaderQuery(options)` prefetches a query into the shared client (so the screen
 * paints instantly from cache once it mounts and calls the matching `useQuery`),
 * while preserving the error→Response contract route loaders rely on. The error
 * mapping is lifted verbatim from the old `apiLoader` (router/loaders.ts):
 *  - AbortError (navigation cancelled) and an already-mapped Response rethrow;
 *  - 401 → clear the cache + throw Response(401); the redirect to /login.html is
 *    index.html's fetch interceptor's job (it covers the raw-fetch sites too);
 *  - any other HTTP status → throw Response(status) for the route errorElement;
 *  - anything else → Response(500).
 *
 * The only behavioural change from `apiLoader` is the cache substrate: the 5-min
 * sessionStorage cache is gone; freshness is now RQ's staleTime (30s) + explicit
 * mutation invalidation. `ensureQueryData` still returns cached data instantly
 * within staleTime, so back/forward navigation stays flash-free.
 */
import type { FetchQueryOptions, QueryKey } from '@tanstack/react-query';
import type { HttpError } from '@/core/http';
import { queryClient } from './client';

export async function loaderQuery<
  TQueryFnData,
  TError,
  TData,
  TQueryKey extends QueryKey,
>(options: FetchQueryOptions<TQueryFnData, TError, TData, TQueryKey>): Promise<TData> {
  try {
    return await queryClient.ensureQueryData(options);
  } catch (error) {
    // Navigation cancelled — let React Router handle it.
    if (error instanceof Error && error.name === 'AbortError') throw error;
    // Already mapped to a Response by a nested loader — propagate untouched.
    if (error instanceof Response) throw error;

    const httpErr = error as HttpError;

    // 401 → session over: drop cached data so the next user can't see it, and
    // throw the status so the route errorElement renders RouteError's dedicated
    // "Unauthorized" card rather than the generic one, for the moment the
    // redirect is in flight. index.html's fetch interceptor owns the actual
    // navigation to /login.html (it is the only layer that also covers the
    // sanctioned raw-fetch call sites) — this branch deliberately does not
    // re-assign location.href on top of it.
    if (httpErr.status === 401) {
      console.warn('[loaderQuery] 401 Unauthorized - session over, clearing cache');
      queryClient.clear();
      throw new Response('Unauthorized', { status: 401 });
    }

    // Other HTTP error → Response carrying the status (handled by errorElement).
    if (typeof httpErr.status === 'number') {
      throw new Response(`API Error: ${httpErr.response?.statusText || httpErr.status}`, {
        status: httpErr.status,
      });
    }

    // Network / validation / unknown.
    console.error('[loaderQuery] Error:', error);
    throw new Response(error instanceof Error ? error.message : 'Unknown error', { status: 500 });
  }
}
