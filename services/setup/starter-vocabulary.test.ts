/**
 * @vitest-environment node
 *
 * The starter vocabularies `npm run db:setup` puts into an empty install. DB-free: the CI gate has
 * no database, so this checks the data itself and its agreement with the code constants that sit
 * next to it in the same tables.
 */
import { describe, expect, it } from 'vitest';
import { EMPLOYEE_EXPENSE_CATEGORY, LAB_EXPENSE_CATEGORY } from '../../shared/expense-categories.js';
import {
  DOCTOR_POSITION,
  SEEDED_EXPENSE_CATEGORY_IDS,
  STARTER_ALERT_TYPES,
  STARTER_APPOINTMENT_TYPES,
  STARTER_EXPENSE_CATEGORIES,
  STARTER_POSITIONS,
  STARTER_TIME_SLOTS,
  STARTER_WAIT_REASONS,
  STARTER_WIRES,
} from './starter-vocabulary.js';

const noDuplicates = (xs: readonly string[]) => expect(new Set(xs.map((x) => x.toLowerCase())).size).toBe(xs.length);

describe('starter vocabularies', () => {
  it('time slots are valid HH:MM, ascending, on the half hour', () => {
    expect(STARTER_TIME_SLOTS.length).toBeGreaterThan(0);
    for (const t of STARTER_TIME_SLOTS) expect(t).toMatch(/^([01]\d|2[0-3]):(00|30)$/);
    expect([...STARTER_TIME_SLOTS].sort()).toEqual(STARTER_TIME_SLOTS);
    noDuplicates(STARTER_TIME_SLOTS);
  });

  it('every list is non-empty and free of duplicates (citext columns compare case-insensitively)', () => {
    for (const list of [STARTER_APPOINTMENT_TYPES, STARTER_ALERT_TYPES, STARTER_WIRES, STARTER_WAIT_REASONS, STARTER_POSITIONS]) {
      expect(list.length).toBeGreaterThan(0);
      noDuplicates(list);
    }
    noDuplicates(STARTER_EXPENSE_CATEGORIES.map((c) => c.name));
  });

  it('every expense category has an Arabic name (the expenses screen is translated)', () => {
    for (const c of STARTER_EXPENSE_CATEGORIES) expect(c.nameAr.trim(), c.name).not.toBe('');
  });

  it("leaves the migration's code-constant rows to the migration", () => {
    // Setup adds these lists only while the table holds nothing but the migration's rows, so the
    // ids it treats as "the migration's" must be the ones the expense form actually keys on.
    expect([...SEEDED_EXPENSE_CATEGORY_IDS].sort()).toEqual([EMPLOYEE_EXPENSE_CATEGORY, LAB_EXPENSE_CATEGORY].sort());
    const names = STARTER_EXPENSE_CATEGORIES.map((c) => c.name.toLowerCase());
    expect(names).not.toContain('employees');
    expect(names).not.toContain('lab');
    expect(STARTER_POSITIONS.map((p) => p.toLowerCase())).not.toContain(DOCTOR_POSITION.toLowerCase());
  });
});
