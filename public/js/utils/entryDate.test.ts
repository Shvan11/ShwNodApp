import { describe, expect, it } from 'vitest';
import { unusualEntryDate } from './entryDate';

describe('unusualEntryDate', () => {
    const today = '2026-09-29';

    it('accepts today and anything within the last year', () => {
        expect(unusualEntryDate(today, today)).toBeNull();
        expect(unusualEntryDate('2026-01-15', today)).toBeNull();
        expect(unusualEntryDate('2025-09-29', today)).toBeNull();
    });

    it('flags a future date (a slipped year digit)', () => {
        expect(unusualEntryDate('2026-09-30', today)).toBe('future');
        expect(unusualEntryDate('2062-09-29', today)).toBe('future');
    });

    it('flags a date more than a year back (a half-typed year)', () => {
        expect(unusualEntryDate('2025-09-28', today)).toBe('old');
        expect(unusualEntryDate('0202-09-29', today)).toBe('old');
    });

    it('ignores a value that is not a full date', () => {
        expect(unusualEntryDate('', today)).toBeNull();
        expect(unusualEntryDate('2026-9-1', today)).toBeNull();
    });
});
