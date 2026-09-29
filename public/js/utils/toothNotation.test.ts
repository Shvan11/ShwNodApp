import { describe, expect, it } from 'vitest';
import { unnToPalmer } from './toothNotation';

describe('unnToPalmer', () => {
    it('maps each quadrant boundary', () => {
        expect(unnToPalmer(1)).toBe('UR8');
        expect(unnToPalmer(8)).toBe('UR1');
        expect(unnToPalmer(9)).toBe('UL1');
        expect(unnToPalmer(16)).toBe('UL8');
        expect(unnToPalmer(17)).toBe('LL8');
        expect(unnToPalmer(24)).toBe('LL1');
        expect(unnToPalmer(25)).toBe('LR1');
        expect(unnToPalmer(32)).toBe('LR8');
    });

    it('puts the first molars where UNN does (the FDI look-alikes are elsewhere)', () => {
        expect(unnToPalmer(3)).toBe('UR6');
        expect(unnToPalmer(14)).toBe('UL6'); // FDI 14 would be UR4
        expect(unnToPalmer(19)).toBe('LL6');
        expect(unnToPalmer(30)).toBe('LR6');
    });

    it('rejects anything that is not a permanent UNN tooth', () => {
        expect(unnToPalmer(0)).toBeNull();
        expect(unnToPalmer(33)).toBeNull();
        expect(unnToPalmer(1.5)).toBeNull();
    });
});
