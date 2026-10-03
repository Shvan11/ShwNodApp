import { describe, expect, it } from 'vitest';
import { groupByPatient } from './PrintQueueContext';

describe('groupByPatient (FE-F3-14)', () => {
  it('groups by patient in first-seen order, keeping queue order inside a group', () => {
    const items = [
      { id: 'a', personId: 2, patientName: 'B' },
      { id: 'b', personId: 1, patientName: 'A' },
      { id: 'c', personId: 2, patientName: 'B' },
    ];
    expect(groupByPatient(items)).toEqual([
      { personId: 2, patientName: 'B', batches: [items[0], items[2]] },
      { personId: 1, patientName: 'A', batches: [items[1]] },
    ]);
  });

  it('keeps the caller’s item type (the modal groups its edited copies)', () => {
    const edited = [{ personId: 1, patientName: 'A', originalLabels: ['U1'] }];
    expect(groupByPatient(edited)[0].batches[0].originalLabels).toEqual(['U1']);
  });

  it('returns no groups for an empty queue', () => {
    expect(groupByPatient([])).toEqual([]);
  });
});
