import { describe, expect, it } from 'vitest';
import { dolphinImageFileName, workingFileName, workingFileNameVariants } from './working-file-names.js';

describe("working-file names (Dolphin's {personId}{tpCode as two digits} rule)", () => {
  it('pads sessions 0–9 to two digits, which is the long-standing name', () => {
    expect(workingFileName(888, 2, 'i21')).toBe('88802.i21');
    expect(workingFileName('688', '0', 'i12')).toBe('68800.i12');
  });

  it("uses the session number as is from 10 on, as Dolphin does (patient 634's files)", () => {
    expect(workingFileName(634, 12, 'i10')).toBe('63412.i10');
    expect(dolphinImageFileName(634, 11, 'i22')).toBe('63411.I22');
    // the old `{personId}0{tpCode}` name is patient 6340's session 12 by Dolphin's rule
    expect(workingFileName(634, 12, 'i10')).not.toBe('634012.i10');
  });

  it('gives the stored image_file form an uppercase extension', () => {
    expect(dolphinImageFileName(304, 10, 'i24')).toBe('30410.I24');
  });

  it('lists the canonical lowercase name first, then the Dolphin-era uppercase one', () => {
    expect(workingFileNameVariants(634, 12, 'i10')).toEqual(['63412.i10', '63412.I10']);
    expect(workingFileNameVariants(634, 12, 'I10')).toEqual(['63412.I10']);
  });
});
