/**
 * Aligner label building — the single source of truth for turning a batch's
 * upper/lower sequence ranges into printable label texts.
 *
 * Labels are keyed by the ACTUAL sequence number, so upper/lower ranges with
 * different starts pair correctly (never `U0/L1`), and a template batch's
 * sequence 0 is preserved: 0 is a valid start (`has_*_template` numbering
 * begins at the template), only null/undefined means "this arch has no
 * aligners in the batch".
 *
 * Used by LabelPreviewModal (single-batch preview) and PrintQueueContext
 * (default labels when a batch is added to the queue).
 */

export interface AlignerLabel {
    id: string;
    text: string;
    type: 'U' | 'L' | 'UL' | 'custom';
}

/**
 * Build default labels from batch upper/lower ranges
 */
export function buildLabelsFromRanges(
    upperStart: number | null | undefined,
    upperEnd: number | null | undefined,
    lowerStart: number | null | undefined,
    lowerEnd: number | null | undefined
): AlignerLabel[] {
    const labelMap = new Map<number, 'U' | 'L' | 'UL'>();

    if (upperStart != null && upperEnd != null && upperStart >= 0) {
        for (let i = upperStart; i <= upperEnd; i++) {
            labelMap.set(i, 'U');
        }
    }

    if (lowerStart != null && lowerEnd != null && lowerStart >= 0) {
        for (let i = lowerStart; i <= lowerEnd; i++) {
            labelMap.set(i, labelMap.has(i) ? 'UL' : 'L');
        }
    }

    const labels: AlignerLabel[] = [];
    const sortedKeys = Array.from(labelMap.keys()).sort((a, b) => a - b);

    for (const seq of sortedKeys) {
        const type = labelMap.get(seq)!;
        let text: string;
        if (type === 'U') text = `U${seq}`;
        else if (type === 'L') text = `L${seq}`;
        else text = `U${seq}/L${seq}`;

        labels.push({ id: `${type}-${seq}`, text, type });
    }

    return labels;
}
