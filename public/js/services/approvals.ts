/**
 * Client helpers for the maker-checker approval/notice queue.
 *
 * Reads live in the React Query layer (`query/queries.ts`).
 * Mutations are here + the cross-app change signal.
 */
import { postJSON } from '@/core/http';
import type {
    ApprovalRow,
    ApproveAllResult,
    AcknowledgeAllResult,
} from '@shared/contracts/approvals.contract';

export type { ApprovalRow };

export const APPROVALS_CHANGED_EVENT = 'approvals:changed';
export const REFRESH_MS = 5 * 60 * 1000;

/** Tell the ApprovalsBell (and any other listener) that approval data changed. */
export function notifyApprovalsChanged(): void {
  window.dispatchEvent(new CustomEvent(APPROVALS_CHANGED_EVENT));
}

export function approveRequest(id: number): Promise<ApprovalRow> {
  return postJSON<ApprovalRow>(`/api/approvals/${id}/approve`, {});
}

export function rejectRequest(id: number, note?: string): Promise<ApprovalRow> {
  return postJSON<ApprovalRow>(`/api/approvals/${id}/reject`, { note });
}

export function acknowledgeRequest(id: number): Promise<ApprovalRow> {
  return postJSON<ApprovalRow>(`/api/approvals/${id}/acknowledge`, {});
}

/** Admin: approve every pending hold at once. */
export function approveAllRequests(): Promise<ApproveAllResult> {
  return postJSON<ApproveAllResult>('/api/approvals/approve-all', {});
}

/** Admin: acknowledge (clear) every pending notice at once. */
export function acknowledgeAllNotices(): Promise<AcknowledgeAllResult> {
  return postJSON<AcknowledgeAllResult>('/api/approvals/acknowledge-all', {});
}
