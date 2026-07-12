/**
 * Client helpers for the header "Portal activity" bell (portal-originated
 * aligner flags — `aligner_activity_flags` WHERE source='portal').
 *
 * The READ lives in the React Query layer (`portalActivityQuery` in
 * query/queries.ts); this module keeps the mark-read mutations + the cross-app
 * change signal, mirroring services/tasks.ts. After any mutation, call
 * `notifyPortalActivityChanged()` so an open bell refetches immediately.
 */
import { patchJSON } from '@/core/http';
import type { PortalActivityRow } from '@shared/contracts/portal-activity.contract';

export type { PortalActivityRow };

export const PORTAL_ACTIVITY_CHANGED_EVENT = 'portal-activity:changed';

/** Bell poll cadence (mirrors the TasksBell REFRESH_MS). */
export const PORTAL_ACTIVITY_REFRESH_MS = 5 * 60 * 1000;

/** Tell every listener (the bell) that portal-activity data changed. */
export function notifyPortalActivityChanged(): void {
  window.dispatchEvent(new CustomEvent(PORTAL_ACTIVITY_CHANGED_EVENT));
}

/** Mark a group of feed rows read (the bell sends a whole day-group's ids). */
export function markPortalActivityRead(activityIds: number[]): Promise<unknown> {
  return patchJSON('/api/portal-activity/read', { activityIds });
}

/** Mark every unread portal row read. */
export function markAllPortalActivityRead(): Promise<unknown> {
  return patchJSON('/api/portal-activity/read-all', {});
}
