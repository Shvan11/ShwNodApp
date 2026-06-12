/**
 * Thin wrapper over `useMutation` that bakes in the project's write→refresh
 * convention: run a `core/http` mutation, then invalidate the affected query
 * keys. This replaces the hand-rolled, forgettable `invalidate*Cache()` calls —
 * invalidation now lives *next to* the mutation that needs it and runs
 * automatically on success.
 *
 * Usage:
 *   const save = useApiMutation({
 *     mutationFn: (body: UpdateBody) => putJSON(`/api/patients/${id}`, body),
 *     invalidate: () => [qk.patient.all(id)],   // hierarchical key → refetches info/works/timepoints
 *   });
 *   await save.mutateAsync(formData);
 *
 * Read the friendly server message off a failure with `httpErrorMessage(save.error, '…')`.
 */
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { HttpError } from '@/core/http';

export interface UseApiMutationOptions<TData, TVars, TContext>
  extends Omit<UseMutationOptions<TData, Error, TVars, TContext>, 'mutationFn'> {
  /** The write itself — call a core/http verb (postJSON/putJSON/…). */
  mutationFn: (vars: TVars) => Promise<TData>;
  /**
   * Query keys to invalidate after the write succeeds. Either a static list or a
   * function of the result + variables (e.g. invalidate the patient the server
   * just told us about). Invalidations run before the caller's own `onSuccess`.
   */
  invalidate?: QueryKey[] | ((data: TData, vars: TVars) => QueryKey[]);
}

export function useApiMutation<TData = unknown, TVars = void, TContext = unknown>(
  options: UseApiMutationOptions<TData, TVars, TContext>
): UseMutationResult<TData, Error, TVars, TContext> {
  const queryClient = useQueryClient();
  const { mutationFn, invalidate, onSuccess, ...rest } = options;

  return useMutation<TData, Error, TVars, TContext>({
    ...rest,
    mutationFn,
    // Variadic forward so we stay agnostic to TanStack's callback arity (v5 added
    // a context arg). args[0]/args[1] are always (data, variables).
    onSuccess: async (...args) => {
      const [data, vars] = args;
      const keys = typeof invalidate === 'function' ? invalidate(data, vars) : invalidate;
      if (keys && keys.length > 0) {
        await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      }
      await onSuccess?.(...args);
    },
  });
}

/**
 * True when an error is the server's "your view is stale" signal — a 400 whose
 * `details.code` is `INVALID_STATE_TRANSITION` (e.g. a missed appointments SSE
 * tick). Callers recover by silently reloading the truth rather than surfacing it
 * (generalised from the appointments conflict-recovery path).
 */
export function isInvalidStateTransition(err: unknown): boolean {
  const httpErr = err as HttpError | undefined;
  if (httpErr?.status !== 400) return false;
  const data = httpErr.data as { details?: { code?: string } } | undefined;
  return data?.details?.code === 'INVALID_STATE_TRANSITION';
}
