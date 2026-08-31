/**
 * Approval-action registry — maps each `action_type` string stored in
 * `approval_requests` to the metadata and replay function needed at approve time.
 *
 * `apply()` is called ONLY by `approval-service.ts#approve()` when an admin approves
 * a pending hold. It must re-execute the original write with admin-level authority,
 * calling the same service/query used by the live route (single SSoT, no copy-paste).
 *
 * `getVersion()` queries the target row's `updated_at` so the enqueue caller can
 * capture a version stamp for stale-detection at approve time. Tables without
 * `updated_at` (invoices) return null — stale detection is skipped for them.
 */

import { sql, type Kysely, type Transaction } from 'kysely';
import { getKysely, type Database } from '../database/kysely.js';
import { validateAndUpdateWork, validateAndDeleteWork } from '../business/WorkService.js';
import { deletePatientCascade } from '../business/PatientService.js';
import { updateExpense, deleteExpense } from '../database/queries/expense-queries.js';
import { deleteInvoiceById } from '../database/queries/payment-queries.js';
import type { ApprovalActionType } from '../../shared/contracts/approvals.contract.js';

// ---------------------------------------------------------------------------
// Action definition interface
// ---------------------------------------------------------------------------

export interface ApprovalActionDef {
  /** DB table whose row is being acted upon (PK declared in `pkColumn`). */
  targetTable: string;
  /** Primary key column name on `targetTable` (used for existence checks). */
  pkColumn: string;
  /** Extract the target row's integer PK from the stored validated payload. */
  getTargetId: (payload: Record<string, unknown>) => number;
  /**
   * Resolve the patient (`person_id`) this action relates to by querying the
   * target row — powers the patient name + navigation chip in the bell. Runs at
   * enqueue/notice time; for holds the target row still exists so the lookup
   * succeeds. Returns `null` for non-patient-linked actions (expenses). Because
   * a delete-notice fires AFTER the row is gone, those routes resolve the id
   * BEFORE deleting and pass it in the payload, which the service prefers over
   * this lookup.
   */
  resolvePersonId?: (targetId: number) => Promise<number | null>;
  /**
   * Fetch the target row's current `updated_at` value (ISO string) as a version
   * stamp captured at enqueue time. Returns `null` for tables without `updated_at`
   * (version / stale check is skipped at approve time).
   */
  getVersion: (targetId: number) => Promise<string | null>;
  /** One-line human summary shown in the approval bell. */
  summarize: (payload: Record<string, unknown>) => string;
  /**
   * Re-execute the write as admin. Called only when the row still exists and
   * (if applicable) the version hasn't changed.
   * Throws if the underlying service rejects (conflict, dependency, etc.).
   */
  apply: (payload: Record<string, unknown>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a target row's `updated_at` as an ISO version stamp for stale-detection.
 *
 * Takes the executor so ONE implementation serves both the enqueue-time capture
 * here and the approve-time re-read inside approval-service's claim transaction.
 * These were two byte-identical queries in two files. Lives here (not in
 * approval-service) because approval-service already imports this module — the
 * reverse direction would close an import cycle.
 * Returns `null` for a missing row or a table without `updated_at`.
 */
export async function readTargetVersion(
  executor: Kysely<Database> | Transaction<Database>,
  targetTable: string,
  pkColumn: string,
  targetId: number
): Promise<string | null> {
  const res = await sql<{ updated_at: Date | null }>`
    SELECT updated_at FROM ${sql.table(targetTable)} WHERE ${sql.ref(pkColumn)} = ${targetId} LIMIT 1
  `.execute(executor);
  const row = res.rows[0];
  if (!row?.updated_at) return null;
  return row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);
}

/** Enqueue-time version capture on the pool. */
const getUpdatedAt = (table: string, pk: string, id: number): Promise<string | null> =>
  readTargetVersion(getKysely(), table, pk, id);

/** person_id owning a work row (works.person_id is NOT NULL). */
async function personIdFromWork(workId: number): Promise<number | null> {
  const res = await sql<{ person_id: number }>`
    SELECT person_id FROM works WHERE work_id = ${workId} LIMIT 1
  `.execute(getKysely());
  return res.rows[0]?.person_id ?? null;
}

/** person_id owning an invoice, via its parent work (invoices.work_id → works.person_id). */
async function personIdFromInvoice(invoiceId: number): Promise<number | null> {
  const res = await sql<{ person_id: number }>`
    SELECT w.person_id
    FROM invoices i
    JOIN works w ON w.work_id = i.work_id
    WHERE i.invoice_id = ${invoiceId}
    LIMIT 1
  `.execute(getKysely());
  return res.rows[0]?.person_id ?? null;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Everything an edit-a-work hold needs except its human summary. */
const workUpdateAction: ApprovalActionDef = {
  targetTable: 'works',
  pkColumn: 'work_id',
  getTargetId: (p) => Number(p.workId),
  resolvePersonId: (id) => personIdFromWork(id),
  getVersion: (id) => getUpdatedAt('works', 'work_id', id),
  summarize: (p) => `Edit work #${p.workId}`,
  apply: async (p) => {
    const { workId, ...workData } = p;
    await validateAndUpdateWork({ workId: Number(workId), userRole: 'admin', workData });
  },
};

export const APPROVAL_ACTIONS: Record<ApprovalActionType, ApprovalActionDef> = {
  // 'work.update' and 'work.discount' are the SAME write (a validated work update)
  // differing only in how the bell describes it — so they share one definition and
  // can't drift apart the way two copy-pasted blocks would.
  'work.update': {
    ...workUpdateAction,
    summarize: (p) => `Edit work #${p.workId}`,
  },

  'work.discount': {
    ...workUpdateAction,
    summarize: (p) =>
      p.discount != null && Number(p.discount) > 0
        ? `Apply discount on work #${p.workId}`
        : `Remove discount on work #${p.workId}`,
  },

  'work.delete': {
    targetTable: 'works',
    pkColumn: 'work_id',
    getTargetId: (p) => Number(p.workId),
    resolvePersonId: (id) => personIdFromWork(id),
    getVersion: (id) => getUpdatedAt('works', 'work_id', id),
    summarize: (p) => `Delete work #${p.workId}`,
    apply: async (p) => {
      await validateAndDeleteWork(Number(p.workId));
    },
  },

  'invoice.delete': {
    targetTable: 'invoices',
    pkColumn: 'invoice_id',
    getTargetId: (p) => Number(p.invoiceId),
    resolvePersonId: (id) => personIdFromInvoice(id),
    // invoices has no updated_at — skip stale-detection
    getVersion: async () => null,
    summarize: (p) => `Delete invoice #${p.invoiceId}`,
    apply: async (p) => {
      await deleteInvoiceById(Number(p.invoiceId));
    },
  },

  'expense.update': {
    targetTable: 'expenses',
    pkColumn: 'id',
    getTargetId: (p) => Number(p.id),
    // expenses aren't patient-linked — no person_id (no resolvePersonId).
    getVersion: (id) => getUpdatedAt('expenses', 'id', id),
    summarize: (p) => `Edit expense #${p.id}`,
    // updateExpense is a FULL-ROW replace (every unset field is written as
    // null/false), so every field the route accepts must be forwarded here.
    // `isMonthly` was missing: approving a held edit silently cleared the
    // monthly flag that the direct (admin) path preserved.
    apply: async (p) => {
      await updateExpense(Number(p.id), {
        expense_date: String(p.expense_date),
        amount: Number(p.amount),
        currency: p.currency != null ? String(p.currency) : 'IQD',
        note: p.note != null ? String(p.note) : undefined,
        categoryId: p.categoryId != null ? Number(p.categoryId) : undefined,
        subcategoryId: p.subcategoryId != null ? Number(p.subcategoryId) : undefined,
        labId: p.labId != null ? Number(p.labId) : undefined,
        employeeId: p.employeeId != null ? Number(p.employeeId) : undefined,
        isMonthly: p.isMonthly === true,
      });
    },
  },

  'expense.delete': {
    targetTable: 'expenses',
    pkColumn: 'id',
    getTargetId: (p) => Number(p.id),
    // expenses aren't patient-linked — no person_id (no resolvePersonId).
    getVersion: (id) => getUpdatedAt('expenses', 'id', id),
    summarize: (p) => `Delete expense #${p.id}`,
    apply: async (p) => {
      await deleteExpense(Number(p.id));
    },
  },

  'patient.delete': {
    targetTable: 'patients',
    pkColumn: 'person_id',
    getTargetId: (p) => Number(p.personId),
    resolvePersonId: async (id) => id,
    getVersion: (id) => getUpdatedAt('patients', 'person_id', id),
    summarize: (p) => `Delete patient #${p.personId}`,
    apply: async (p) => {
      await deletePatientCascade(Number(p.personId));
    },
  },
};
