import { describe, expect, it } from 'vitest';
import type { WorkingFileEntry } from '@shared/contracts/file-explorer.contract';
import { compareSlots, entryLabel, extrasBySession, summarizeExtras } from './workingImages';

const entry = (tpCode: number, view: string, original = false, label: string | null = null): WorkingFileEntry => {
  const name = `27${String(tpCode).padStart(2, '0')}.${(original ? view.replace('i', 'v') : view).toUpperCase()}`;
  return { name, relPath: name, type: 'file', ext: `.${name.split('.')[1].toLowerCase()}`, category: 'image', tpCode, view, original, label };
};

describe('working images by session', () => {
  it('keeps only what the grid has no place for, per session', () => {
    const map = extrasBySession([entry(0, 'i12'), entry(0, 'i51'), entry(0, 'i02'), entry(2, 'i50'), entry(3, 'i10')]);
    expect([...map.keys()]).toEqual(['0', '2']);
    expect(map.get('0')?.map((e) => e.view)).toEqual(['i02', 'i51']);
  });

  it('does not count Dolphin’s originals as images of their own', () => {
    const map = extrasBySession([entry(0, 'i51'), entry(0, 'i51', true), entry(0, 'i12', true), entry(4, 'i50', true)]);
    expect([...map.keys()]).toEqual(['0']);
    expect(map.get('0')?.map((e) => e.name)).toEqual(['2700.I51']);
  });

  it('names the X-rays and counts the rest', () => {
    expect(summarizeExtras([entry(0, 'i51')])).toBe('OPG');
    expect(summarizeExtras([entry(0, 'i51'), entry(0, 'i50'), entry(0, 'i01')])).toBe('OPG · Ceph');
    expect(summarizeExtras([entry(0, 'i51'), entry(0, 'i02'), entry(0, 'i40')])).toBe('OPG · 2 images');
    expect(summarizeExtras([entry(0, 'i02')])).toBe('1 image');
  });

  it('names a slot the clinic named, and lets it rename an X-ray', () => {
    const smile = (tp: number) => entry(tp, 'i02', false, 'Smile close-up');
    expect(summarizeExtras([entry(0, 'i51'), smile(0), entry(0, 'i40')])).toBe('OPG · Smile close-up · 1 image');
    expect(summarizeExtras([smile(0), smile(0)])).toBe('Smile close-up');
    expect(summarizeExtras([entry(0, 'i51', false, 'Panoramic')])).toBe('Panoramic');
    expect(entryLabel(entry(0, 'i02'))).toBe('Image');
    expect(entryLabel(smile(0))).toBe('Smile close-up');
  });

  it('orders the grid views as the grid does, then the other slots', () => {
    expect(['i51', 'i21', 'i02', 'i10', 'i12'].sort(compareSlots)).toEqual(['i10', 'i12', 'i21', 'i02', 'i51']);
  });
});
