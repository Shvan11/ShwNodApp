import { describe, expect, it } from 'vitest';
import {
  areaToPixels,
  frameLeavesPhoto,
  framingMatchesOriginal,
  isSlotDirty,
  outputSize,
  rotatedSize,
  sameFraming,
  signedDegrees,
  slotStatus,
} from './framing';
import { makeInitialSlot, type SavedFraming, type SlotFraming } from './photoEditorTypes';

const PHOTO = { width: 4000, height: 3000 };
const FACIAL_ASPECT = 3467 / 4000; // VIEW_OUTPUT.i12

/** A frame of `w`×`h` bbox pixels centred at (cx, cy) bbox pixels from the bbox centre, in %. */
function frameAt(rotation: number, cx: number, cy: number, w: number, h: number) {
  const bbox = rotatedSize(PHOTO.width, PHOTO.height, rotation);
  return {
    x: ((bbox.width / 2 + cx - w / 2) / bbox.width) * 100,
    y: ((bbox.height / 2 + cy - h / 2) / bbox.height) * 100,
    width: (w / bbox.width) * 100,
    height: (h / bbox.height) * 100,
  };
}

describe('rotatedSize', () => {
  it('is the photo itself upright and its transpose on a quarter turn', () => {
    expect(rotatedSize(4000, 3000, 0)).toEqual({ width: 4000, height: 3000 });
    const q = rotatedSize(4000, 3000, 90);
    expect(q.width).toBeCloseTo(3000, 6);
    expect(q.height).toBeCloseTo(4000, 6);
  });
});

describe('areaToPixels', () => {
  it("matches react-easy-crop's pixel rect: the long side from %, the short one from the aspect", () => {
    // bbox 4000×3000; the photo is wider than the 0.867 frame, so height leads.
    const px = areaToPixels({ x: 10, y: 5, width: 50, height: 200 / 3 }, PHOTO, 0, FACIAL_ASPECT);
    expect(px).toEqual({ x: 400, y: 150, width: Math.round(2000 * FACIAL_ASPECT), height: 2000 });
  });

  it('keeps negative offsets of a frame panned past the edge', () => {
    const px = areaToPixels({ x: -5, y: -2, width: 50, height: 200 / 3 }, PHOTO, 0, FACIAL_ASPECT);
    expect(px.x).toBe(-200);
    expect(px.y).toBe(-60);
  });
});

describe('signedDegrees', () => {
  it('reads a stored 0–359 turn as the signed one a person means', () => {
    expect(signedDegrees(0)).toBe(0);
    expect(signedDegrees(350)).toBe(-10);
    expect(signedDegrees(180)).toBe(180);
    expect(signedDegrees(181)).toBe(-179);
    expect(signedDegrees(360)).toBe(0);
    expect(signedDegrees(90.4)).toBe(90);
  });
});

describe('frameLeavesPhoto', () => {
  it('is false for the default cover frame and for a frame flush with the edges', () => {
    // Cover at zoom 1: full height, centred.
    const coverW = ((PHOTO.height * FACIAL_ASPECT) / PHOTO.width) * 100;
    expect(frameLeavesPhoto({ x: (100 - coverW) / 2, y: 0, width: coverW, height: 100 }, PHOTO, 0)).toBe(false);
    expect(frameLeavesPhoto({ x: 0, y: 0, width: 100, height: 100 }, PHOTO, 0)).toBe(false);
  });

  it('is true for a frame panned past an edge or zoomed out beyond the photo', () => {
    expect(frameLeavesPhoto({ x: -5, y: 0, width: 50, height: 100 }, PHOTO, 0)).toBe(true);
    expect(frameLeavesPhoto({ x: -10, y: -42, width: 120, height: 184 }, PHOTO, 0)).toBe(true);
  });

  it('catches the white corners a small free rotation uncovers, until the frame is zoomed in', () => {
    // Full photo height at 5°: the top-left / bottom-right corners are past the turned photo.
    expect(frameLeavesPhoto(frameAt(5, 0, 0, 2600, 3000), PHOTO, 5)).toBe(true);
    expect(frameLeavesPhoto(frameAt(5, 0, 0, 1300, 1500), PHOTO, 5)).toBe(false);
  });

  it('turns the photo CLOCKWISE (CSS rotate): a frame near the top-right corner tells +10° from −10°', () => {
    // Clockwise, the photo's top-right corner swings down and leaves the bbox's top-right
    // white; counter-clockwise, that region is inside the photo.
    expect(frameLeavesPhoto(frameAt(10, 1600, -1700, 100, 100), PHOTO, 10)).toBe(true);
    expect(frameLeavesPhoto(frameAt(350, 1600, -1700, 100, 100), PHOTO, 350)).toBe(false);
  });
});

describe('outputSize', () => {
  it("is the frame's native pixels in the original", () => {
    expect(outputSize({ x: 0, y: 0, width: 50, height: 50 }, PHOTO, 0)).toEqual({ width: 2000, height: 1500 });
  });

  it("is capped at the render's long edge, keeping the shape", () => {
    expect(outputSize({ x: -150, y: -150, width: 400, height: 400 }, PHOTO, 0)).toEqual({ width: 8000, height: 6000 });
  });
});

const saved: SavedFraming = {
  v: 1,
  source: { name: 'IMG_1.jpg', modified: '2026-10-01T09:00:00.000Z', width: 4000, height: 3000 },
  rotation: 0,
  flipH: false,
  flipV: false,
  zoom: 1.4,
  area: { x: 20, y: 10, width: 46, height: 70 },
};

describe('framingMatchesOriginal', () => {
  it('needs the same original, by name and (when both know it) by mtime', () => {
    expect(framingMatchesOriginal(saved, 'IMG_1.jpg', '2026-10-01T09:00:00.000Z')).toBe(true);
    expect(framingMatchesOriginal(saved, 'IMG_2.jpg', '2026-10-01T09:00:00.000Z')).toBe(false);
    expect(framingMatchesOriginal(saved, 'IMG_1.jpg', '2026-10-02T09:00:00.000Z')).toBe(false);
    expect(framingMatchesOriginal(saved, null, null)).toBe(false);
    expect(framingMatchesOriginal(saved, 'IMG_1.jpg', null)).toBe(true);
    expect(framingMatchesOriginal({ ...saved, source: { ...saved.source, modified: null } }, 'IMG_1.jpg', 'x')).toBe(true);
  });
});

describe('sameFraming', () => {
  const base: SlotFraming = { rotation: 0, flipH: false, flipV: false, zoom: 1.4, area: saved.area };
  it('absorbs float noise and the proxy/original rounding, not a visible move', () => {
    expect(sameFraming(base, { ...base, area: { ...base.area, x: base.area.x + 0.2 } })).toBe(true);
    expect(sameFraming(base, { ...base, area: { ...base.area, x: base.area.x + 1 } })).toBe(false);
  });
  it('compares rotation around the circle, and flips exactly', () => {
    expect(sameFraming(base, { ...base, rotation: 359.995 })).toBe(true);
    expect(sameFraming(base, { ...base, rotation: 1 })).toBe(false);
    expect(sameFraming(base, { ...base, flipH: true })).toBe(false);
  });
});

describe('isSlotDirty / slotStatus', () => {
  const live = { ...makeInitialSlot('i12'), sourceRelPath: 'S/IMG_1.jpg', sourceName: 'IMG_1.jpg' };
  const baseline: SlotFraming = { rotation: 0, flipH: false, flipV: false, zoom: 1.4, area: saved.area };

  it('empty and saved-only slots have nothing to save', () => {
    expect(isSlotDirty(makeInitialSlot('i12'))).toBe(false);
    expect(slotStatus(makeInitialSlot('i12'))).toBe('empty');
    const savedOnly = { ...makeInitialSlot('i12'), savedImageUrl: '/x.jpg' };
    expect(isSlotDirty(savedOnly)).toBe(false);
    expect(slotStatus(savedOnly)).toBe('saved');
  });

  it('a live edit with nothing to compare against is a change', () => {
    expect(isSlotDirty(live)).toBe(true);
    expect(slotStatus(live)).toBe('unsaved');
  });

  it('a re-opened saved view is unchanged until it is moved', () => {
    // Before the cropper reports: judged by the framing about to be applied.
    expect(isSlotDirty({ ...live, baseline, pendingFraming: baseline })).toBe(false);
    expect(isSlotDirty({ ...live, baseline, croppedArea: saved.area })).toBe(false);
    expect(slotStatus({ ...live, baseline, croppedArea: saved.area })).toBe('saved');
    expect(isSlotDirty({ ...live, baseline, croppedArea: { ...saved.area, y: 14 } })).toBe(true);
    expect(isSlotDirty({ ...live, baseline, croppedArea: saved.area, rotation: 3 })).toBe(true);
  });
});
