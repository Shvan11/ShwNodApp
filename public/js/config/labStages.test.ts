import { describe, expect, it } from 'vitest';
import { labelForStage } from './labStages';
import { MATERIAL_OPTIONS } from './workTypeConfig';

describe('labelForStage — framework try-in label by material (FE-F2-11)', () => {
  it('names the zirconia and metal try-ins by material', () => {
    expect(labelForStage('framework_tryin', 'Zirconia')).toBe('Zirconia Core Try-In');
    expect(labelForStage('framework_tryin', 'PFM (Porcelain Fused to Metal)')).toBe('Metal Try-In');
    expect(labelForStage('framework_tryin', 'Full Metal')).toBe('Metal Try-In');
  });

  it('falls back to the generic label for any other or missing material', () => {
    expect(labelForStage('framework_tryin', 'E-Max')).toBe('Framework Try-In');
    expect(labelForStage('framework_tryin', null)).toBe('Framework Try-In');
    expect(labelForStage('framework_tryin', 'Not a material')).toBe('Framework Try-In');
  });

  it('keys on names, not positions — every material keeps its label in any order', () => {
    const special = new Set(['Zirconia', 'PFM (Porcelain Fused to Metal)', 'Full Metal']);
    for (const m of [...MATERIAL_OPTIONS].reverse()) {
      expect(labelForStage('framework_tryin', m) === 'Framework Try-In').toBe(!special.has(m));
    }
  });

  it('leaves every other stage alone', () => {
    expect(labelForStage('glaze', 'Zirconia')).toBe('Glaze / Finish');
  });
});
