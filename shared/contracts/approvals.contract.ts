/**
 * API contract — maker-checker approval/notice queue (`approval_requests`, LOCAL-ONLY
 * table; see `migrations/pg/1782100000000_approval-requests.sql`).
 *
 * Imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias).
 *
 * `withPendingOutcome` is the shared response shape for every route that can divert
 * a write into a hold: the handler either applies the change immediately
 * (`outcome:'applied'`, carrying the route's normal payload) or enqueues it
 * (`outcome:'pending'`, carrying the new `approval_requests.request_id`). Routes that
 * use it: `work.contract.ts` (`updateWork`, `deleteWork`), `payment.contract.ts`
 * (`deleteInvoice`), `expense.contract.ts` (`updateExpense`, `deleteExpense`),
 * `patient.contract.ts` (`deletePatient`).
 */
import { z } from 'zod';
import { idParams, timestampString } from '../validation.js';

export const APPROVAL_ACTION_TYPES = [
  'work.update',
  'work.discount',
  'work.delete',
  'invoice.delete',
  'expense.update',
  'expense.delete',
  'patient.delete',
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'acknowledged',
  'failed',
  'stale',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * Shared "applied now or held for admin approval" response shape. `appliedShape` is
 * the route's normal success payload's shape (e.g. `{ rowsAffected: z.number() }`)
 * — spread directly into the `applied` branch so the client's existing success path
 * keeps reading the same fields, just behind an `outcome==='applied'` guard.
 */
export function withPendingOutcome<T extends z.ZodRawShape>(appliedShape: T) {
  return z.discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('applied'), ...appliedShape }),
    z.object({
      outcome: z.literal('pending'),
      requestId: z.number(),
      message: z.string(),
    }),
  ]);
}

// A row as read back by the admin bell / requester badge. Loose (z.looseObject) since
// it's a read-only display surface, not a contracted write body.
export const approvalRow = z.looseObject({
  request_id: z.number(),
  kind: z.enum(['approval', 'notice']),
  action_type: z.enum(APPROVAL_ACTION_TYPES),
  target_table: z.string(),
  target_id: z.number(),
  person_id: z.number().nullable(),
  summary: z.string(),
  requested_by: z.string(),
  requested_at: timestampString,
  status: z.enum(APPROVAL_STATUSES),
  reviewed_by: z.string().nullable(),
  reviewed_at: timestampString.nullable(),
  review_note: z.string().nullable(),
});
export type ApprovalRow = z.infer<typeof approvalRow>;

// GET /api/approvals?status=pending — admin-only. Defaults to pending when omitted.
export const listApprovals = {
  query: z.object({ status: z.enum(APPROVAL_STATUSES).optional() }),
  response: z.array(approvalRow),
} as const;

// GET /api/approvals/history — admin-only, all non-pending rows newest first.
export const approvalsHistory = { response: z.array(approvalRow) } as const;

// GET /api/approvals/mine — any authenticated role, filtered to the caller's username.
export const myApprovals = { response: z.array(approvalRow) } as const;

// POST /api/approvals/:id/approve — admin-only.
export const approveRequest = {
  params: idParams('id'),
  response: approvalRow,
} as const;

// POST /api/approvals/:id/reject — admin-only.
export const rejectRequest = {
  params: idParams('id'),
  body: z.object({ note: z.string().optional() }),
  response: approvalRow,
} as const;
export type RejectRequestBody = z.infer<typeof rejectRequest.body>;

// POST /api/approvals/:id/acknowledge — admin-only (clears a notice from the bell).
export const acknowledgeRequest = {
  params: idParams('id'),
  response: approvalRow,
} as const;
