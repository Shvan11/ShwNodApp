/**
 * Client helpers for the header "Portal activity" bell (portal-originated
 * aligner flags — `aligner_activity_flags` WHERE source='portal').
 *
 * The READ lives in the React Query layer (`portalActivityQuery` in
 * query/queries.ts); this module keeps the mark-read mutations. After any of
 * them, call `invalidatePortalActivity()`.
 */
import { patchJSON } from '@/core/http';
import { queryClient } from '@/query/client';
import { qk } from '@/query/keys';
import type { PortalActivityRow } from '@shared/contracts/portal-activity.contract';

export type { PortalActivityRow };

/** Refresh the portal-activity feed after a mark-read. */
export function invalidatePortalActivity(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: qk.portalActivity.all() });
}

/** Mark a group of feed rows read (the bell sends a whole day-group's ids). */
export function markPortalActivityRead(activityIds: number[]): Promise<unknown> {
  return patchJSON('/api/portal-activity/read', { activityIds });
}

/** Mark every unread portal row read. */
export function markAllPortalActivityRead(): Promise<unknown> {
  return patchJSON('/api/portal-activity/read-all', {});
}
