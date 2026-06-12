/**
 * Bridge between React Router loaders and the TanStack Query cache.
 *
 * `loaderQuery(options)` prefetches a query into the shared client (so the screen
 * paints instantly from cache once it mounts and calls the matching `useQuery`),
 * while preserving the error→Response contract route loaders rely on. The error
 * mapping is lifted verbatim from the old `apiLoader` (router/loaders.ts):
 *  - AbortError (navigation cancelled) and an already-mapped Response rethrow;
 *  - 401 → clear the cache + redirect to /login.html + throw Response(401);
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

    // 401 → session over: drop cached data so the next user can't see it, redirect.
    if (httpErr.status === 401) {
      console.warn('[loaderQuery] 401 Unauthorized - redirecting to login');
      queryClient.clear();
      window.location.href = '/login.html';
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
