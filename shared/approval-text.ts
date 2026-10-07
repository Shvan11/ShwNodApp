/**
 * The fixed texts the approval queue writes into `approval_requests`: each request's
 * one-line `summary`, and the notes the SYSTEM (not an admin) leaves in `review_note`.
 *
 * They are stored in English, and the bells, the front-desk badge and the history
 * page printed the stored string, so an Arabic screen showed "Edit work #12" and
 * "Target changed since request was submitted" beside translated chrome. The stored
 * text stays what it is (old rows carry it, and it is the audit record); the client
 * now recognises it here and prints its own language's wording. One module on both
 * sides, so the server cannot start writing a text the client no longer recognises.
 *
 * Pure and import-free on purpose (it is read by the gate's tests and by the browser).
 */

/** The eight summaries. `work.discount` has two: a discount applied, or removed. */
export type ApprovalSummaryKind =
  | 'workUpdate'
  | 'discountApply'
  | 'discountRemove'
  | 'workDelete'
  | 'invoiceDelete'
  | 'expenseUpdate'
  | 'expenseDelete'
  | 'patientDelete';

const SUMMARY_EN: Record<ApprovalSummaryKind, (id: number | string) => string> = {
  workUpdate: (id) => `Edit work #${id}`,
  discountApply: (id) => `Apply discount on work #${id}`,
  discountRemove: (id) => `Remove discount on work #${id}`,
  workDelete: (id) => `Delete work #${id}`,
  invoiceDelete: (id) => `Delete invoice #${id}`,
  expenseUpdate: (id) => `Edit expense #${id}`,
  expenseDelete: (id) => `Delete expense #${id}`,
  patientDelete: (id) => `Delete patient #${id}`,
};

/** The English summary stored on a request. */
export function approvalSummary(kind: ApprovalSummaryKind, id: number | string): string {
  return SUMMARY_EN[kind](id);
}

/**
 * Which summary a stored row carries. The action type decides it, except for
 * `work.discount`, whose stored text says whether the discount was applied or removed.
 */
export function approvalSummaryKind(actionType: string, summary: string): ApprovalSummaryKind | null {
  switch (actionType) {
    case 'work.update':
      return 'workUpdate';
    case 'work.discount':
      return summary.startsWith(SUMMARY_EN.discountRemove('')) ? 'discountRemove' : 'discountApply';
    case 'work.delete':
      return 'workDelete';
    case 'invoice.delete':
      return 'invoiceDelete';
    case 'expense.update':
      return 'expenseUpdate';
    case 'expense.delete':
      return 'expenseDelete';
    case 'patient.delete':
      return 'patientDelete';
    default:
      return null;
  }
}

/** The notes the queue itself writes when a request is not applied. */
export const APPROVAL_SYSTEM_NOTES = {
  superseded: 'Superseded by a newer request',
  unknownAction: 'Unknown action_type',
  targetMissing: 'Target no longer exists',
  targetChanged: 'Target changed since request was submitted',
} as const;
export type ApprovalSystemNote = keyof typeof APPROVAL_SYSTEM_NOTES;

/** A replay that threw: the prefix, then the service's own message. */
export const APPROVAL_APPLY_ERROR_PREFIX = 'Apply error: ';

/** The note stored when an approved write fails on replay. */
export function approvalApplyErrorNote(message: string): string {
  return `${APPROVAL_APPLY_ERROR_PREFIX}${message}`;
}

/**
 * A stored `review_note` → the system note it is, or `null` for anything else
 * (the words an admin typed when rejecting, which are shown as written).
 */
export function parseApprovalNote(
  note: string
): { kind: ApprovalSystemNote } | { kind: 'applyError'; reason: string } | null {
  for (const kind of Object.keys(APPROVAL_SYSTEM_NOTES) as ApprovalSystemNote[]) {
    if (note === APPROVAL_SYSTEM_NOTES[kind]) return { kind };
  }
  if (note.startsWith(APPROVAL_APPLY_ERROR_PREFIX)) {
    return { kind: 'applyError', reason: note.slice(APPROVAL_APPLY_ERROR_PREFIX.length) };
  }
  return null;
}
