/**
 * Tooth-number notation conversion.
 *
 * The app's own notation is Palmer-style quadrant + tooth (`UR6`, `LLA`) —
 * DentalChart, TeethSelector and the `tooth_numbers` vocabulary all use it.
 * 3Shape reports teeth in the Universal Numbering System (UNN, 1–32), which a
 * Palmer- or FDI-trained reader cannot tell apart from FDI: UNN 14 is UL6, while
 * FDI 14 is UR4, on the other side of the mouth (audit FE-F9-6).
 */

/**
 * UNN permanent tooth 1–32 → Palmer code: 1–8 → UR8…UR1, 9–16 → UL1…UL8,
 * 17–24 → LL8…LL1, 25–32 → LR1…LR8. Anything else (primary-tooth letters never
 * arrive here — 3Shape's indication fields are integers) → `null`.
 */
export function unnToPalmer(unn: number): string | null {
    if (!Number.isInteger(unn) || unn < 1 || unn > 32) return null;
    if (unn <= 8) return `UR${9 - unn}`;
    if (unn <= 16) return `UL${unn - 8}`;
    if (unn <= 24) return `LL${25 - unn}`;
    return `LR${unn - 24}`;
}
