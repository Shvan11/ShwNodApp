/**
 * Client helpers for the maker-checker approval/notice queue.
 *
 * Reads live in the React Query layer (`query/queries.ts`); the mutations and the
 * two invalidations every approval write needs are here. (A window `CustomEvent`
 * bus used to signal the bells beside React Query; audit FE-F1-10 retired it.)
 */
import { postJSON } from '@/core/http';
import { queryClient } from '@/query/client';
import { qk } from '@/query/keys';
import * as approvalsContract from '@shared/contracts/approvals.contract';
import type {
  ApprovalActionType,
  ApprovalRow,
  ApproveAllResult,
  AcknowledgeAllResult,
} from '@shared/contracts/approvals.contract';
import { approvalSummaryKind, parseApprovalNote } from '@shared/approval-text';
import type { TFunction } from 'i18next';

export type { ApprovalRow };

/** i18n key (`approvals:action.*`) of each held action. */
export const ACTION_LABEL_KEY = {
  'work.update': 'workUpdate',
  'work.discount': 'workDiscount',
  'work.delete': 'workDelete',
  'invoice.delete': 'invoiceDelete',
  'expense.update': 'expenseUpdate',
  'expense.delete': 'expenseDelete',
  'patient.delete': 'patientDelete',
} as const satisfies Record<ApprovalActionType, string>;

/**
 * A request's one-line summary in the reader's language. The row stores it in
 * English ("Edit work #12"), which is what an Arabic bell used to print; an action
 * this build does not know falls back to the stored text.
 */
export function approvalSummaryText(
  row: Pick<ApprovalRow, 'action_type' | 'target_id' | 'summary'>,
  t: TFunction<'approvals'>
): string {
  const kind = approvalSummaryKind(row.action_type, row.summary);
  return kind ? t(`summary.${kind}`, { id: row.target_id }) : row.summary;
}

/**
 * A `review_note` in the reader's language: the queue's own notes are translated,
 * an admin's typed reason is shown as written.
 */
export function approvalNoteText(note: string | null | undefined, t: TFunction<'approvals'>): string {
  if (!note) return '';
  const parsed = parseApprovalNote(note);
  if (!parsed) return note;
  return parsed.kind === 'applyError'
    ? t('note.applyError', { reason: parsed.reason })
    : t(`note.${parsed.kind}`);
}

/**
 * Refresh every approval read: the admin bell, the requester badge and the history.
 * Call after anything that creates or resolves a request — a write that was held
 * for approval creates one without changing any row.
 */
export function invalidateApprovals(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: qk.approvals.all() });
}

/**
 * Refresh what an APPROVED hold just changed. Approving replays the held write,
 * so the open patient, works, payments or expenses screens must refetch exactly
 * as they would after the write itself (audit FE-F5-2). An invoice row does not
 * name its work, so a held invoice delete refreshes every work's keys.
 */
export function invalidateApprovalTarget(
  row: Pick<ApprovalRow, 'action_type' | 'target_id' | 'person_id'>
): Promise<void> {
  const patient = row.person_id != null ? [qk.patient.all(row.person_id)] : [];
  const keys: ReadonlyArray<readonly unknown[]> = (() => {
    switch (row.action_type) {
      case 'work.update':
      case 'work.discount':
      case 'work.delete':
        return [...patient, qk.work.all(row.target_id)];
      case 'invoice.delete':
        return [...patient, qk.work.root(), qk.dailyInvoicesAll()];
      case 'expense.update':
      case 'expense.delete':
        return [qk.expenses.all()];
      case 'patient.delete':
        return [...patient, qk.lookups.patientLookupAll()];
    }
  })();
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(
    () => undefined
  );
}

/**
 * Approve one hold. Resolves with the row as the server left it: `status` is
 * `approved` only when the write was replayed — `stale` and `failed` also come
 * back as HTTP 200, with the reason in `review_note` (audit FE-F5-3).
 */
export function approveRequest(id: number): Promise<ApprovalRow> {
  return postJSON<ApprovalRow>(`/api/approvals/${id}/approve`, {}, {
    schema: approvalsContract.approveRequest.response,
  });
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
