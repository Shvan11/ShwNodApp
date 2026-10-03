/**
 * Lab case tracker — UI-only stage labels + the framework-try-in material label
 * override. Stage ORDER and LOCATION are NOT duplicated here — they live in the
 * contract's `LAB_STAGE_META` (the backend needs `location` too, for the
 * remake-default walk-back rule), so this file only maps a stage key to display
 * text.
 */
import { LAB_STAGE_META, type LabStage } from '@shared/contracts/lab-case.contract';
import type { Material } from './workTypeConfig';

export const LAB_STAGE_LABELS: Record<LabStage, string> = {
  sent_to_lab: 'Sent to Lab',
  wax_up_tryin: 'Wax-Up Try-In',
  pattern_fab: 'Pattern Fabrication',
  plastic_check: 'Plastic Pattern Check',
  framework_fab: 'Framework Fabrication',
  framework_tryin: 'Framework Try-In',
  ceramic_buildup: 'Ceramic Build-Up',
  bisque_tryin: 'Bisque Try-In',
  glaze: 'Glaze / Finish',
  ready: 'Ready to Cement',
  delivered: 'Delivered',
};

/**
 * `framework_tryin` reads differently depending on what the framework is made
 * of — a zirconia core check isn't the same appointment as a metal try-in.
 * Keyed BY NAME on the `MATERIAL_OPTIONS` literals (workTypeConfig.ts), so renaming
 * a material is a compile error here and inserting one relabels nothing. (It was
 * read by array index — `MATERIAL_OPTIONS[0]/[1]/[3]` — audit FE-F2-11.)
 */
const FRAMEWORK_TRYIN_LABELS: Partial<Record<Material, string>> = {
  'Zirconia': 'Zirconia Core Try-In',
  'PFM (Porcelain Fused to Metal)': 'Metal Try-In',
  'Full Metal': 'Metal Try-In',
};

function labelForFrameworkTryin(material?: string | null): string {
  return (material && FRAMEWORK_TRYIN_LABELS[material as Material]) || 'Framework Try-In';
}

/** The display label for a stage — pass the case's `material` for the one stage whose label depends on it. */
export function labelForStage(stage: LabStage, material?: string | null): string {
  if (stage === 'framework_tryin') return labelForFrameworkTryin(material);
  return LAB_STAGE_LABELS[stage];
}

/**
 * Walk backward from `fromStatus` to the nearest earlier `location==='lab'`
 * stage — mirrors the backend's remake-default rule (lab-case-service.ts), so
 * the client can pre-select a sensible "Send back" target without a round trip.
 * The server re-derives the same default when `returnToStatus` is omitted, so
 * this is purely a UI convenience, never the source of truth.
 */
export function defaultRemakeTarget(fromStatus: LabStage): LabStage | null {
  const idx = LAB_STAGE_META.findIndex((m) => m.key === fromStatus);
  for (let i = idx - 1; i >= 0; i--) {
    if (LAB_STAGE_META[i]!.location === 'lab') return LAB_STAGE_META[i]!.key;
  }
  return null;
}
