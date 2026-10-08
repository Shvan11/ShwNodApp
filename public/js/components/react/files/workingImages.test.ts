import { describe, expect, it } from 'vitest';
import type { WorkingFileEntry } from '@shared/contracts/file-explorer.contract';
import { compareSlots, extrasBySession, summarizeExtras } from './workingImages';

const entry = (tpCode: number, view: string): WorkingFileEntry => ({
  name: `27${String(tpCode).padStart(2, '0')}.${view.toUpperCase()}`,
  relPath: `27${String(tpCode).padStart(2, '0')}.${view.toUpperCase()}`,
  type: 'file',
  ext: `.${view}`,
  category: 'image',
  tpCode,
  view,
});

describe('working images by session', () => {
  it('keeps only what the grid has no place for, per session', () => {
    const map = extrasBySession([entry(0, 'i12'), entry(0, 'i51'), entry(0, 'i02'), entry(2, 'i50'), entry(3, 'i10')]);
    expect([...map.keys()]).toEqual(['0', '2']);
    expect(map.get('0')?.map((e) => e.view)).toEqual(['i02', 'i51']);
  });

  it('names the X-rays and counts the rest', () => {
    expect(summarizeExtras([entry(0, 'i51')])).toBe('OPG');
    expect(summarizeExtras([entry(0, 'i51'), entry(0, 'i50'), entry(0, 'i01')])).toBe('OPG · Ceph');
    expect(summarizeExtras([entry(0, 'i51'), entry(0, 'i02'), entry(0, 'i40')])).toBe('OPG · 2 images');
    expect(summarizeExtras([entry(0, 'i02')])).toBe('1 image');
  });

  it('orders the grid views as the grid does, then the other slots', () => {
    expect(['i51', 'i21', 'i02', 'i10', 'i12'].sort(compareSlots)).toEqual(['i10', 'i12', 'i21', 'i02', 'i51']);
  });
});
