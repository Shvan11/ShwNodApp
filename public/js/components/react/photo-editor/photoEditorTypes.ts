/**
 * Types + constants for the native photo editor (Phase 4).
 * The view-code↔label mapping is reused from the slideshow module (single source
 * of truth); the slot order matches GridComponent + services/imaging getImageSizes.
 */
import type { PhotoViewCode, SlotRenderSpec } from '@/types/api.types';
import { PHOTO_TYPE_LABELS } from '../slideshow/photoTypes';

export type { PhotoViewCode, SlotRenderSpec };

/** A grid cell is one of the 8 view slots, or the centre logo (non-editable). */
export type GridCell = PhotoViewCode | 'logo';

/** 3×3 layout, matching GridComponent + getImageSizes order (logo in the centre). */
export const GRID_CELLS: GridCell[] = [
  'i10', 'i12', 'i13',
  'i23', 'logo', 'i24',
  'i20', 'i22', 'i21',
];

/** The 8 editable view codes. */
export const VIEW_CODES: PhotoViewCode[] = ['i10', 'i12', 'i13', 'i23', 'i24', 'i20', 'i22', 'i21'];

export function labelForView(view: PhotoViewCode): string {
  return PHOTO_TYPE_LABELS[view] ?? view.toUpperCase();
}

/**
 * Client mirror of the server's `parseViewTag`
 * (`services/imaging/photo-original-tags.ts`): a timepoint original tagged for a
 * view is named `{viewCode}-{originalName}` (code prefix, hyphen, no spaces). Keep
 * this regex in sync with the server one.
 */
const VIEW_TAG_RE = /^(i10|i12|i13|i20|i21|i22|i23|i24)-(.+)$/;
export function parseOriginalViewTag(
  name: string,
): { view: PhotoViewCode; original: string } | null {
  const m = VIEW_TAG_RE.exec(name);
  return m ? { view: m[1] as PhotoViewCode, original: m[2] } : null;
}

export interface OutputDims {
  width: number;
  height: number;
}

/**
 * Per-view output spec. The ASPECT RATIOS are matched to real Dolphin-rendered
 * outputs sampled from \\CLINIC\Working (40 files/view):
 *   facial (Profile/Rest/Smile)        AR ≈ 0.866  (13:15, portrait)
 *   intra-oral lateral + frontal       AR ≈ 1.856  (13:7,  wide landscape)
 *   occlusal (Upper/Lower)             AR ≈ 1.444  (13:9,  landscape)
 * The magnitudes are only a nominal reference (~Dolphin's native working size,
 * ~12–17 MP) — they are NOT a cap. At render time the service preserves the crop's
 * NATIVE pixel resolution (no upscaling, no downscaling), so a saved view keeps the
 * original's full quality, replacing the old fixed ~1500px (~1.9 MP) downscale that
 * made saved photos a few hundred KB.
 * The existing grid adapts to whatever aspect we emit (via getImageSizes).
 */
export const VIEW_OUTPUT: Record<PhotoViewCode, OutputDims> = {
  i10: { width: 3467, height: 4000 },
  i12: { width: 3467, height: 4000 },
  i13: { width: 3467, height: 4000 },
  i20: { width: 4700, height: 2532 },
  i21: { width: 4700, height: 2532 },
  i22: { width: 4700, height: 2532 },
  i23: { width: 4900, height: 3391 },
  i24: { width: 4900, height: 3391 },
};

export function aspectForView(view: PhotoViewCode): number {
  const d = VIEW_OUTPUT[view];
  return d.width / d.height;
}

/**
 * Zoom bounds + per-notch sensitivity. Shared by the cropper (min/max/speed props)
 * and the grid-level wheel handler that owns scroll-zoom for the selected slot, so
 * both clamp and step identically. ZOOM_SPEED mirrors react-easy-crop's wheel math
 * (`zoom - pixelY * speed / 200`).
 */
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 3;
export const ZOOM_SPEED = 0.1;

/** Occlusal views (Upper/Lower) are shot through a mirror → default to a flip. */
export function defaultFlipV(view: PhotoViewCode): boolean {
  return view === 'i23' || view === 'i24';
}

/** Crop rect in source pixels (react-easy-crop's croppedAreaPixels shape). */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlotState {
  view: PhotoViewCode;
  sourceRelPath: string | null;
  sourceName: string | null;
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  croppedAreaPixels: CropArea | null;
  /** When set AND sourceRelPath is null, the slot shows this baked crop read-only. */
  savedImageUrl: string | null;
  /** True when a tagged source original still exists to reload for re-editing. */
  canReEdit: boolean;
  /** The tagged original to reload on "Restore original" (patient-root-relative path + clean name). */
  reEditRelPath: string | null;
  reEditName: string | null;
}

export type SlotMap = Record<PhotoViewCode, SlotState>;

/** The read-only display + re-edit info seeded into a slot when a timepoint is opened. */
export interface SlotHydration {
  savedImageUrl: string | null;
  canReEdit: boolean;
  reEditRelPath: string | null;
  reEditName: string | null;
}

export function makeInitialSlot(view: PhotoViewCode): SlotState {
  return {
    view,
    sourceRelPath: null,
    sourceName: null,
    crop: { x: 0, y: 0 },
    zoom: 1,
    rotation: 0,
    flipH: false,
    flipV: defaultFlipV(view),
    croppedAreaPixels: null,
    savedImageUrl: null,
    canReEdit: false,
    reEditRelPath: null,
    reEditName: null,
  };
}

export function makeInitialSlots(): SlotMap {
  const map = {} as SlotMap;
  for (const v of VIEW_CODES) map[v] = makeInitialSlot(v);
  return map;
}
