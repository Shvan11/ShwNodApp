/**
 * Pure framing math for the photo editor: what a slot's framing IS (for the top-bar
 * readout), whether it differs from what is saved (the unsaved-changes guard and
 * Save), and the cropper geometry needed to re-apply a recorded framing.
 *
 * Geometry follows react-easy-crop (5.x): a framing is a frame rectangle in % of the
 * bounding box of the photo after its flips and its rotation (`croppedAreaPercentages`).
 * The photo is turned clockwise by `rotation` degrees (CSS `rotate()`), and the render
 * (services/imaging/photo-render.service.ts) cuts the same rectangle at native
 * resolution, filling whatever the frame covers beyond the photo with white.
 */
import { MAX_RENDER_EDGE } from '@shared/photo-views';
import type { CropArea, FramingArea, SavedFraming, SlotFraming, SlotState } from './photoEditorTypes';

interface Size {
  width: number;
  height: number;
}

/** Below this many megapixels a saved view is flagged as low resolution. */
export const LOW_RES_MEGAPIXELS = 2;

/** Two frames closer than this (in % of the photo) are the same framing: it absorbs float
 *  noise, and the proxy's rounding against the original, while staying far below a pixel
 *  anyone could see move. */
const SAME_AREA_TOLERANCE = 0.25;

/** The bounding box of a `width`×`height` photo turned by `rotation` degrees — the same
 *  expression as react-easy-crop's `rotateSize`, so the pixel maths below match it bit for bit. */
export function rotatedSize(width: number, height: number, rotation: number): Size {
  const rad = (rotation * Math.PI) / 180;
  return {
    width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height),
  };
}

/**
 * The frame in the media's natural pixels: what react-easy-crop reports as
 * `croppedAreaPixels` for these percentages (its `computeCroppedArea`, position
 * unrestricted). Applying a recorded framing needs it because the cropper re-emits the
 * rect only when the zoom changes — a restore that lands on the same zoom would leave
 * the slot holding the frame from before the restore.
 */
export function areaToPixels(area: FramingArea, natural: Size, rotation: number, aspect: number): CropArea {
  const bbox = rotatedSize(natural.width, natural.height, rotation);
  const widthPx = Math.round((area.width * bbox.width) / 100);
  const heightPx = Math.round((area.height * bbox.height) / 100);
  // react-easy-crop derives the short side from the long one and the aspect, so the
  // rect matches the aspect exactly; it picks the side by the photo's own shape.
  const size =
    bbox.width >= bbox.height * aspect
      ? { width: Math.round(heightPx * aspect), height: heightPx }
      : { width: widthPx, height: Math.round(widthPx / aspect) };
  return {
    ...size,
    x: Math.round((area.x * bbox.width) / 100),
    y: Math.round((area.y * bbox.height) / 100),
  };
}

/** A 0–359 rotation as the signed turn a person means by it: 350 → −10. */
export function signedDegrees(rotation: number): number {
  const deg = Math.round(rotation);
  const norm = ((deg % 360) + 360) % 360;
  return norm > 180 ? norm - 360 : norm;
}

/**
 * Does the frame reach past the photo? Those parts are saved white: a frame panned or
 * zoomed out beyond an edge, and — at any zoom — the corners a free rotation uncovers.
 * Exact for any rotation: the frame is inside the photo iff its four corners are, mapped
 * back through the rotation into the photo's own axes. `photo` only lends its aspect.
 */
export function frameLeavesPhoto(area: FramingArea, photo: Size, rotation: number): boolean {
  const { width: w, height: h } = photo;
  if (!(w > 0 && h > 0)) return false;
  const bbox = rotatedSize(w, h, rotation);
  const left = (area.x / 100) * bbox.width - bbox.width / 2;
  const top = (area.y / 100) * bbox.height - bbox.height / 2;
  const right = left + (area.width / 100) * bbox.width;
  const bottom = top + (area.height / 100) * bbox.height;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Half a thousandth of the photo: a frame flush with an edge is not "past" it.
  const tol = 0.0005 * Math.max(w, h);
  const corners: Array<[number, number]> = [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ];
  return corners.some(([x, y]) => {
    // Undo a clockwise turn by `rotation` (screen axes, y down).
    const px = x * cos + y * sin;
    const py = -x * sin + y * cos;
    return Math.abs(px) > w / 2 + tol || Math.abs(py) > h / 2 + tol;
  });
}

/** The pixel size a save of this frame produces: the frame's native pixels in the full
 *  original, capped like the render (MAX_RENDER_EDGE). */
export function outputSize(area: FramingArea, source: Size, rotation: number): Size {
  const bbox = rotatedSize(source.width, source.height, rotation);
  let width = (area.width / 100) * bbox.width;
  let height = (area.height / 100) * bbox.height;
  const longEdge = Math.max(width, height);
  if (longEdge > MAX_RENDER_EDGE) {
    width *= MAX_RENDER_EDGE / longEdge;
    height *= MAX_RENDER_EDGE / longEdge;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

export function megapixels(size: Size): number {
  return (size.width * size.height) / 1_000_000;
}

/** The re-applicable part of a recorded framing. */
export function framingOf(saved: SavedFraming): SlotFraming {
  return { rotation: saved.rotation, flipH: saved.flipH, flipV: saved.flipV, zoom: saved.zoom, area: saved.area };
}

/**
 * Is `saved` a framing of this view's CURRENT tagged original? Only then can "Continue
 * editing" rebuild the saved photo: the record names its source, and a re-tagged or
 * replaced original would put the old frame on a different picture. A side whose mtime
 * is unknown is matched by name alone.
 */
export function framingMatchesOriginal(
  saved: SavedFraming,
  originalName: string | null,
  originalVersion: string | null
): boolean {
  if (!originalName || saved.source.name !== originalName) return false;
  return saved.source.modified === null || originalVersion === null || saved.source.modified === originalVersion;
}

/** Two framings that render the same photo. */
export function sameFraming(a: SlotFraming, b: SlotFraming): boolean {
  const turn = (((a.rotation - b.rotation) % 360) + 360) % 360;
  return (
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    Math.min(turn, 360 - turn) < 0.01 &&
    Math.abs(a.area.x - b.area.x) <= SAME_AREA_TOLERANCE &&
    Math.abs(a.area.y - b.area.y) <= SAME_AREA_TOLERANCE &&
    Math.abs(a.area.width - b.area.width) <= SAME_AREA_TOLERANCE &&
    Math.abs(a.area.height - b.area.height) <= SAME_AREA_TOLERANCE
  );
}

/** The framing on screen now, or null before the cropper has reported one. */
export function currentFraming(slot: SlotState): SlotFraming | null {
  const area = slot.pendingFraming?.area ?? slot.croppedArea;
  if (!area) return null;
  return { rotation: slot.rotation, flipH: slot.flipH, flipV: slot.flipV, zoom: slot.zoom, area };
}

/** Would Save change this slot's saved photo? A live edit of the saved view's own
 *  original, framed as saved, would not. */
export function isSlotDirty(slot: SlotState): boolean {
  if (!slot.sourceRelPath) return false;
  if (!slot.baseline) return true;
  const now = currentFraming(slot);
  return !now || !sameFraming(now, slot.baseline);
}

export type SlotStatus = 'empty' | 'saved' | 'unsaved';

/** What Save would do for the slot: write it (`unsaved`), or nothing (`saved`/`empty`). */
export function slotStatus(slot: SlotState): SlotStatus {
  if (isSlotDirty(slot)) return 'unsaved';
  return slot.sourceRelPath || slot.savedImageUrl ? 'saved' : 'empty';
}
