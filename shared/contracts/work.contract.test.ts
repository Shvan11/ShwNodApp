/**
 * Pins the work contract against the regressions the frontend audit found in it (F7). All three
 * came from the 2026-06-05 enumeration (`56e9690`), and none could be seen without parsing the
 * payload the form really sends — so this parses exactly that.
 */
import { describe, it, expect } from 'vitest';
import { addWork, addWorkDetail, addWorkWithInvoice, updateWork } from './work.contract.js';

describe('work item implant sizes (FE-F7-2)', () => {
  it('accepts fractional millimetres — the columns are numeric(5,2)', () => {
    const parsed = addWorkDetail.body.parse({
      work_id: '1',
      implant_diameter: '3.5',
      implant_length: '11.5',
    });
    expect(parsed.implant_diameter).toBe(3.5);
    expect(parsed.implant_length).toBe(11.5);
  });

  it('treats a blank size as absent, and refuses one the column cannot hold', () => {
    expect(addWorkDetail.body.parse({ work_id: '1', implant_diameter: '' }).implant_diameter).toBeUndefined();
    expect(addWorkDetail.body.safeParse({ work_id: '1', implant_length: '1000' }).success).toBe(false);
    expect(addWorkDetail.body.safeParse({ work_id: '1', implant_length: '-1' }).success).toBe(false);
  });
});

describe('work currency (FE-F7-5)', () => {
  it('accepts only the two currencies the ledger holds', () => {
    const base = { person_id: '1', dr_id: '1', type_of_work: '1' };
    expect(addWork.body.safeParse({ ...base, currency: 'IQD' }).success).toBe(true);
    expect(addWork.body.safeParse({ ...base, currency: 'USD' }).success).toBe(true);
    expect(addWork.body.safeParse({ ...base, currency: 'EUR' }).success).toBe(false);
    expect(
      addWorkWithInvoice.body.safeParse({ ...base, total_required: 100, currency: 'EUR' }).success
    ).toBe(false);
  });

  it('a blank currency is absent, so the server can apply the clinic default', () => {
    const parsed = addWork.body.parse({ person_id: '1', dr_id: '1', type_of_work: '1', currency: '' });
    expect(parsed.currency).toBeUndefined();
  });
});

describe('updateWork body (FE-F7-4)', () => {
  it('keeps estimated_duration — updateWork() is presence-keyed, a stripped key is a lost edit', () => {
    const parsed = updateWork.body.parse({ workId: 1, dr_id: '1', estimated_duration: '18' });
    expect(parsed.estimated_duration).toBe(18);
  });

  it('keeps a blanked estimated_duration as a PRESENT key, so the column is cleared', () => {
    const parsed = updateWork.body.parse({ workId: 1, dr_id: '1', estimated_duration: '' });
    expect(Object.prototype.hasOwnProperty.call(parsed, 'estimated_duration')).toBe(true);
    expect(parsed.estimated_duration).toBeUndefined();
  });

  it('passes discount null through as null — the "clear it" signal, not 0', () => {
    expect(updateWork.body.parse({ workId: 1, dr_id: '1', discount: null }).discount).toBeNull();
    expect(updateWork.body.parse({ workId: 1, dr_id: '1', discount: '250' }).discount).toBe(250);
  });
});
