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

import { sql } from 'kysely';
import { getKysely } from '../database/kysely.js';
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
  /** Extract the patient context id (for navigation chip in the bell), if available. */
  getPersonId?: (payload: Record<string, unknown>) => number | undefined;
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

async function getUpdatedAt(table: string, pk: string, id: number): Promise<string | null> {
  const db = getKysely();
  const res = await sql<{ updated_at: Date | null }>`
    SELECT updated_at FROM ${sql.table(table)} WHERE ${sql.ref(pk)} = ${id} LIMIT 1
  `.execute(db);
  const row = res.rows[0];
  if (!row) return null;
  if (!row.updated_at) return null;
  return row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const APPROVAL_ACTIONS: Record<ApprovalActionType, ApprovalActionDef> = {
  'work.update': {
    targetTable: 'works',
    pkColumn: 'work_id',
    getTargetId: (p) => Number(p.workId),
    getPersonId: (p) => (p.person_id != null ? Number(p.person_id) : undefined),
    getVersion: (id) => getUpdatedAt('works', 'work_id', id),
    summarize: (p) => `Edit work #${p.workId}`,
    apply: async (p) => {
      const { workId, ...workData } = p;
      await validateAndUpdateWork({ workId: Number(workId), userRole: 'admin', workData });
    },
  },

  'work.discount': {
    targetTable: 'works',
    pkColumn: 'work_id',
    getTargetId: (p) => Number(p.workId),
    getPersonId: (p) => (p.person_id != null ? Number(p.person_id) : undefined),
    getVersion: (id) => getUpdatedAt('works', 'work_id', id),
    summarize: (p) => `Apply discount on work #${p.workId}`,
    apply: async (p) => {
      const { workId, ...workData } = p;
      await validateAndUpdateWork({ workId: Number(workId), userRole: 'admin', workData });
    },
  },

  'work.delete': {
    targetTable: 'works',
    pkColumn: 'work_id',
    getTargetId: (p) => Number(p.workId),
    getPersonId: (p) => (p.person_id != null ? Number(p.person_id) : undefined),
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
    getPersonId: () => undefined,
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
    getPersonId: () => undefined,
    getVersion: (id) => getUpdatedAt('expenses', 'id', id),
    summarize: (p) => `Edit expense #${p.id}`,
    apply: async (p) => {
      await updateExpense(Number(p.id), {
        expense_date: String(p.expense_date),
        amount: Number(p.amount),
        currency: p.currency != null ? String(p.currency) : 'IQD',
        note: p.note != null ? String(p.note) : undefined,
        categoryId: p.categoryId != null ? Number(p.categoryId) : undefined,
        subcategoryId: p.subcategoryId != null ? Number(p.subcategoryId) : undefined,
      });
    },
  },

  'expense.delete': {
    targetTable: 'expenses',
    pkColumn: 'id',
    getTargetId: (p) => Number(p.id),
    getPersonId: () => undefined,
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
    getPersonId: (p) => Number(p.personId),
    getVersion: (id) => getUpdatedAt('patients', 'person_id', id),
    summarize: (p) => `Delete patient #${p.personId}`,
    apply: async (p) => {
      await deletePatientCascade(Number(p.personId));
    },
  },
};
