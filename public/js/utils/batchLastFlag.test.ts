import { describe, expect, it } from 'vitest';
import { describeRemainingAligners, lastFlagPrompt, type LastFlagInput } from './batchLastFlag';

const save = (over: Partial<LastFlagInput>): LastFlagInput => ({
    isLast: false,
    wasLast: false,
    currentRemainingUpper: 0,
    currentRemainingLower: 0,
    nextRemainingUpper: 0,
    nextRemainingLower: 0,
    ...over,
});

describe('lastFlagPrompt', () => {
    it('offers "last" when the save batches every remaining aligner', () => {
        expect(lastFlagPrompt(save({ currentRemainingUpper: 5 }))).toBe('offer');
    });

    it('offers "last" on an upper-only set once upper runs out', () => {
        expect(lastFlagPrompt(save({ currentRemainingUpper: 13, nextRemainingUpper: 0, nextRemainingLower: 0 }))).toBe('offer');
    });

    it('stays quiet while aligners remain and the box is unticked', () => {
        expect(lastFlagPrompt(save({ currentRemainingUpper: 11, nextRemainingUpper: 6 }))).toBeNull();
    });

    it('stays quiet when the box is ticked and nothing remains', () => {
        expect(lastFlagPrompt(save({ isLast: true, currentRemainingUpper: 4 }))).toBeNull();
    });

    it('confirms a newly ticked box while aligners remain', () => {
        expect(lastFlagPrompt(save({ isLast: true, currentRemainingUpper: 11, nextRemainingUpper: 6 }))).toBe('confirm');
    });

    it('confirms when an edit frees aligners from a batch that was last (set 307 / 315)', () => {
        // Batch 1 held all 13 upper and was marked last; cut down to 2, 11 come free.
        expect(
            lastFlagPrompt(save({ isLast: true, wasLast: true, currentRemainingUpper: 0, nextRemainingUpper: 11 }))
        ).toBe('confirm');
    });

    it('confirms when only the lower arch is freed', () => {
        expect(
            lastFlagPrompt(save({ isLast: true, wasLast: true, currentRemainingUpper: 2, nextRemainingUpper: 2, nextRemainingLower: 1 }))
        ).toBe('confirm');
    });

    it('does not re-ask on an edit that frees nothing from a batch deliberately left last', () => {
        expect(
            lastFlagPrompt(save({ isLast: true, wasLast: true, currentRemainingUpper: 6, nextRemainingUpper: 6 }))
        ).toBeNull();
    });
});

describe('describeRemainingAligners', () => {
    it('names only the arches that have aligners left', () => {
        expect(describeRemainingAligners(6, 0)).toBe('6 upper aligners');
        expect(describeRemainingAligners(0, 1)).toBe('1 lower aligner');
        expect(describeRemainingAligners(6, 2)).toBe('6 upper and 2 lower aligners');
    });
});
