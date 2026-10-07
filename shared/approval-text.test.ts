import { describe, expect, it } from 'vitest';
import {
  APPROVAL_SYSTEM_NOTES,
  approvalApplyErrorNote,
  approvalSummary,
  approvalSummaryKind,
  parseApprovalNote,
  type ApprovalSummaryKind,
} from './approval-text.js';
import { APPROVAL_ACTION_TYPES } from './contracts/approvals.contract.js';
import en from '../public/js/locales/en/approvals.json';
import ar from '../public/js/locales/ar/approvals.json';

describe('approval summaries', () => {
  it('keeps the stored English wording (old rows and the audit trail carry it)', () => {
    expect(approvalSummary('workUpdate', 12)).toBe('Edit work #12');
    expect(approvalSummary('discountApply', 12)).toBe('Apply discount on work #12');
    expect(approvalSummary('discountRemove', 12)).toBe('Remove discount on work #12');
    expect(approvalSummary('invoiceDelete', 7)).toBe('Delete invoice #7');
    expect(approvalSummary('patientDelete', 3)).toBe('Delete patient #3');
  });

  it('recognises every action type the contract lists', () => {
    for (const action of APPROVAL_ACTION_TYPES) {
      expect(approvalSummaryKind(action, ''), action).not.toBeNull();
    }
    expect(approvalSummaryKind('something.new', 'Whatever')).toBeNull();
  });

  it('tells an applied discount from a removed one by the stored text', () => {
    expect(approvalSummaryKind('work.discount', approvalSummary('discountApply', 5))).toBe('discountApply');
    expect(approvalSummaryKind('work.discount', approvalSummary('discountRemove', 5))).toBe('discountRemove');
  });

  it('round-trips: what the server stores is what the client recognises', () => {
    const kinds: Record<ApprovalSummaryKind, string> = {
      workUpdate: 'work.update',
      discountApply: 'work.discount',
      discountRemove: 'work.discount',
      workDelete: 'work.delete',
      invoiceDelete: 'invoice.delete',
      expenseUpdate: 'expense.update',
      expenseDelete: 'expense.delete',
      patientDelete: 'patient.delete',
    };
    for (const [kind, action] of Object.entries(kinds) as [ApprovalSummaryKind, string][]) {
      expect(approvalSummaryKind(action, approvalSummary(kind, 9))).toBe(kind);
    }
  });

  it('prints the English catalog exactly as stored, and has an Arabic line for each', () => {
    for (const kind of Object.keys(en.summary) as ApprovalSummaryKind[]) {
      expect(en.summary[kind].replace('{{id}}', '9')).toBe(approvalSummary(kind, 9));
      expect(ar.summary[kind]).toContain('{{id}}');
    }
  });
});

describe('approval notes', () => {
  it('recognises each note the queue writes', () => {
    for (const kind of Object.keys(APPROVAL_SYSTEM_NOTES) as (keyof typeof APPROVAL_SYSTEM_NOTES)[]) {
      expect(parseApprovalNote(APPROVAL_SYSTEM_NOTES[kind])).toEqual({ kind });
      expect(en.note[kind]).toBe(APPROVAL_SYSTEM_NOTES[kind]);
      expect(ar.note[kind]).toBeTruthy();
    }
  });

  it('splits a replay failure into its prefix and the reason', () => {
    const note = approvalApplyErrorNote('Total required (10) cannot be less than the amount already paid (20).');
    expect(parseApprovalNote(note)).toEqual({
      kind: 'applyError',
      reason: 'Total required (10) cannot be less than the amount already paid (20).',
    });
    expect(en.note.applyError.replace('{{reason}}', 'x')).toBe(approvalApplyErrorNote('x'));
  });

  it("leaves an admin's own words alone", () => {
    expect(parseApprovalNote('Wrong patient, ask Dr. Ali')).toBeNull();
    expect(parseApprovalNote('سعر خاطئ')).toBeNull();
  });
});
