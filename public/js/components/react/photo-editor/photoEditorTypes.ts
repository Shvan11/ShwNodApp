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

export interface OutputDims {
  width: number;
  height: number;
}

/**
 * Fixed per-view output size at a ~1500px long edge. Aspect ratios are matched to
 * real Dolphin-rendered outputs sampled from \\CLINIC\Working (40 files/view):
 *   facial (Profile/Rest/Smile)        AR ≈ 0.866  (13:15, portrait)
 *   intra-oral lateral + frontal       AR ≈ 1.856  (13:7,  wide landscape)
 *   occlusal (Upper/Lower)             AR ≈ 1.444  (13:9,  landscape)
 * The existing grid adapts to whatever aspect we emit (via getImageSizes).
 */
export const VIEW_OUTPUT: Record<PhotoViewCode, OutputDims> = {
  i10: { width: 1300, height: 1500 },
  i12: { width: 1300, height: 1500 },
  i13: { width: 1300, height: 1500 },
  i20: { width: 1500, height: 808 },
  i21: { width: 1500, height: 808 },
  i22: { width: 1500, height: 808 },
  i23: { width: 1500, height: 1038 },
  i24: { width: 1500, height: 1038 },
};

export function aspectForView(view: PhotoViewCode): number {
  const d = VIEW_OUTPUT[view];
  return d.width / d.height;
}

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
}

export type SlotMap = Record<PhotoViewCode, SlotState>;

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
  };
}

export function makeInitialSlots(): SlotMap {
  const map = {} as SlotMap;
  for (const v of VIEW_CODES) map[v] = makeInitialSlot(v);
  return map;
}
