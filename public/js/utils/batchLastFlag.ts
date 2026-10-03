/**
 * When saving an aligner batch should stop and ask about its "Last Batch" flag.
 *
 * Two questions, never both on one save:
 *  - `offer`   — the save leaves no aligner unbatched and the box is unticked:
 *                offer to mark this batch as the last one.
 *  - `confirm` — the box is ticked but aligners remain unbatched: make sure.
 *                Asked when the flag is NEW on this batch, or when the edit
 *                frees aligners from a batch that was already last — the
 *                second is how a set's batch 1 stayed "last" after being cut
 *                down and followed by batch 2 (sets 307/315, 2026-10). A batch
 *                deliberately left last with aligners remaining (final batch
 *                before a new scan) is not asked again on an edit that frees
 *                nothing.
 *
 * Counts are the set's `remaining_*` (not-yet-batched) aligners, before the
 * save (`current*`) and after it (`next*`).
 */

export type LastFlagPrompt = 'offer' | 'confirm' | null;

export interface LastFlagInput {
    /** The form's "Last Batch" checkbox. */
    isLast: boolean;
    /** The stored flag of the batch being edited; `false` when adding. */
    wasLast: boolean;
    currentRemainingUpper: number;
    currentRemainingLower: number;
    nextRemainingUpper: number;
    nextRemainingLower: number;
}

export function lastFlagPrompt(input: LastFlagInput): LastFlagPrompt {
    const { isLast, wasLast, currentRemainingUpper, currentRemainingLower, nextRemainingUpper, nextRemainingLower } = input;
    const nothingLeft = nextRemainingUpper <= 0 && nextRemainingLower <= 0;

    if (!isLast) return nothingLeft ? 'offer' : null;
    if (nothingLeft) return null;

    const freesAligners = nextRemainingUpper > currentRemainingUpper || nextRemainingLower > currentRemainingLower;
    return !wasLast || freesAligners ? 'confirm' : null;
}

/** "6 upper aligners", "1 lower aligner", "6 upper and 2 lower aligners". */
export function describeRemainingAligners(upper: number, lower: number): string {
    const parts = [upper > 0 ? `${upper} upper` : '', lower > 0 ? `${lower} lower` : ''].filter(Boolean);
    const total = Math.max(upper, 0) + Math.max(lower, 0);
    return `${parts.join(' and ')} aligner${total === 1 ? '' : 's'}`;
}
