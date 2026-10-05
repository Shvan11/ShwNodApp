import { describe, expect, it } from 'vitest';
import { slotsReducer } from './usePhotoEditorState';
import { EMPTY_HYDRATION, makeInitialSlots, type SavedFraming, type SlotHydration, type SlotMap } from './photoEditorTypes';
import { isSlotDirty } from './framing';

const saved: SavedFraming = {
  v: 1,
  source: { name: 'IMG_1.jpg', modified: '2026-10-01T09:00:00.000Z', width: 4000, height: 3000 },
  rotation: 350,
  flipH: true,
  flipV: false,
  zoom: 1.4,
  area: { x: 20, y: 10, width: 46, height: 70 },
};

const hydration: SlotHydration = {
  ...EMPTY_HYDRATION,
  savedImageUrl: '/api/patients/7/working-files/content?name=7012.i12',
  savedSize: { width: 2000, height: 2308 },
  savedFraming: saved,
  canReEdit: true,
  canContinue: true,
  reEditRelPath: 'Initial_01-10-2026/i12-IMG_1.jpg',
  reEditName: 'IMG_1.jpg',
  reEditVersion: '2026-10-01T09:00:00.000Z',
};

function hydrated(): SlotMap {
  return slotsReducer(makeInitialSlots(), { type: 'HYDRATE', views: { i12: hydration } });
}

describe('slotsReducer — the saved half survives the live edit', () => {
  it('HYDRATE seeds the saved half and clears views no longer saved', () => {
    const s = hydrated();
    expect(s.i12.savedFraming).toEqual(saved);
    expect(s.i12.sourceRelPath).toBeNull();
    const after = slotsReducer(s, { type: 'HYDRATE', views: {} });
    expect(after.i12.savedImageUrl).toBeNull();
  });

  it('HYDRATE refreshes a live slot’s saved half without touching its edit', () => {
    let s = slotsReducer(hydrated(), { type: 'PLACE', view: 'i12', sourceRelPath: 'S/other.jpg', sourceName: 'other.jpg', sourceVersion: null });
    s = slotsReducer(s, { type: 'SET_ZOOM', view: 'i12', zoom: 2 });
    s = slotsReducer(s, { type: 'HYDRATE', views: { i12: { ...hydration, savedImageUrl: '/new.jpg' } } });
    expect(s.i12.sourceRelPath).toBe('S/other.jpg');
    expect(s.i12.zoom).toBe(2);
    expect(s.i12.savedImageUrl).toBe('/new.jpg');
  });

  it('DISCARD drops the edit and shows the saved photo again; CLEAR empties the slot', () => {
    const live = slotsReducer(hydrated(), { type: 'CONTINUE', view: 'i12' });
    const discarded = slotsReducer(live, { type: 'DISCARD', view: 'i12' });
    expect(discarded.i12.sourceRelPath).toBeNull();
    expect(discarded.i12.savedImageUrl).toBe(hydration.savedImageUrl);
    expect(discarded.i12.canContinue).toBe(true);
    const cleared = slotsReducer(live, { type: 'CLEAR', view: 'i12' });
    expect(cleared.i12.savedImageUrl).toBeNull();
    expect(cleared.i12.sourceRelPath).toBeNull();
  });
});

describe('slotsReducer — Continue editing', () => {
  it('reopens the tagged original framed as saved, pending until the photo loads', () => {
    const before = hydrated();
    const s = slotsReducer(before, { type: 'CONTINUE', view: 'i12' });
    const slot = s.i12;
    expect(slot.sourceRelPath).toBe(hydration.reEditRelPath);
    expect(slot.sourceVersion).toBe(hydration.reEditVersion);
    expect([slot.rotation, slot.flipH, slot.flipV, slot.zoom]).toEqual([350, true, false, 1.4]);
    expect(slot.pendingFraming?.area).toEqual(saved.area);
    expect(slot.baseline?.area).toEqual(saved.area);
    expect(slot.resetTo?.area).toEqual(saved.area);
    expect(slot.framingKey).toBe(before.i12.framingKey + 1);
    expect(isSlotDirty(slot)).toBe(false);
  });

  it('is refused when the recorded framing does not belong to the current original', () => {
    const s = slotsReducer(makeInitialSlots(), { type: 'HYDRATE', views: { i12: { ...hydration, canContinue: false } } });
    expect(slotsReducer(s, { type: 'CONTINUE', view: 'i12' })).toBe(s);
  });

  it('takes the recorded frame as the slot’s on the first media load', () => {
    let s = slotsReducer(hydrated(), { type: 'CONTINUE', view: 'i12' });
    // The cropper's own emission on that load is the frame from BEFORE the restore …
    s = slotsReducer(s, { type: 'SET_CROPPED', view: 'i12', area: { x: 0, y: 0, width: 50, height: 100 }, pixels: { x: 0, y: 0, width: 1, height: 1 } });
    // … then onMediaLoaded: the pending framing wins and is consumed.
    s = slotsReducer(s, { type: 'SET_MEDIA_SIZE', view: 'i12', size: { width: 2048, height: 1536 } });
    expect(s.i12.pendingFraming).toBeNull();
    expect(s.i12.croppedArea).toEqual(saved.area);
    expect(s.i12.croppedAreaPixels).not.toBeNull();
    expect(s.i12.mediaSize).toEqual({ width: 2048, height: 1536 });
    expect(isSlotDirty(s.i12)).toBe(false);
    // A later reload (proxy ↔ original) only records the size.
    const reloaded = slotsReducer(s, { type: 'SET_MEDIA_SIZE', view: 'i12', size: { width: 4000, height: 3000 } });
    expect(reloaded.i12.croppedArea).toEqual(saved.area);
  });

  it('becomes a change once moved', () => {
    let s = slotsReducer(hydrated(), { type: 'CONTINUE', view: 'i12' });
    s = slotsReducer(s, { type: 'SET_MEDIA_SIZE', view: 'i12', size: { width: 2048, height: 1536 } });
    s = slotsReducer(s, { type: 'SET_CROPPED', view: 'i12', area: { ...saved.area, x: 25 }, pixels: { x: 1, y: 1, width: 1, height: 1 } });
    expect(isSlotDirty(s.i12)).toBe(true);
  });
});

describe('slotsReducer — Start over / placing a photo', () => {
  it('the saved view’s own original is measured against its saved framing', () => {
    const s = slotsReducer(hydrated(), {
      type: 'PLACE',
      view: 'i12',
      sourceRelPath: hydration.reEditRelPath as string,
      sourceName: 'IMG_1.jpg',
      sourceVersion: hydration.reEditVersion,
    });
    expect(s.i12.baseline?.area).toEqual(saved.area);
    expect(s.i12.resetTo).toBeNull();
    expect(s.i12.pendingFraming).toBeNull();
    // The default framing is not the saved one, so Start over is a change.
    expect(isSlotDirty(s.i12)).toBe(true);
    expect(s.i12.savedImageUrl).toBe(hydration.savedImageUrl);
  });

  it('any other photo has no baseline', () => {
    const s = slotsReducer(hydrated(), { type: 'PLACE', view: 'i12', sourceRelPath: 'S/x.jpg', sourceName: 'x.jpg', sourceVersion: null });
    expect(s.i12.baseline).toBeNull();
    expect(isSlotDirty(s.i12)).toBe(true);
  });
});

describe('slotsReducer — Reset framing', () => {
  it('keeps the media size a proxy-framed rect needs, and remounts the cropper', () => {
    let s = slotsReducer(makeInitialSlots(), { type: 'PLACE', view: 'i12', sourceRelPath: 'S/x.jpg', sourceName: 'x.jpg', sourceVersion: null });
    s = slotsReducer(s, { type: 'SET_MEDIA_SIZE', view: 'i12', size: { width: 2048, height: 1536 } });
    s = slotsReducer(s, { type: 'SET_ZOOM', view: 'i12', zoom: 2 });
    s = slotsReducer(s, { type: 'SET_ROTATION', view: 'i12', rotation: 12 });
    const key = s.i12.framingKey;
    const r = slotsReducer(s, { type: 'RESET', view: 'i12' });
    expect(r.i12.mediaSize).toEqual({ width: 2048, height: 1536 });
    expect([r.i12.zoom, r.i12.rotation]).toEqual([1, 0]);
    expect(r.i12.framingKey).toBe(key + 1);
    // No stale rect for Save: the remount re-reports it (a missing rect centre-crops).
    expect(r.i12.croppedAreaPixels).toBeNull();
    // Occlusal views keep their mirror-shot default flip.
    let o = slotsReducer(makeInitialSlots(), { type: 'PLACE', view: 'i23', sourceRelPath: 'S/u.jpg', sourceName: 'u.jpg', sourceVersion: null });
    o = slotsReducer(o, { type: 'TOGGLE_FLIP_V', view: 'i23' });
    expect(slotsReducer(o, { type: 'RESET', view: 'i23' }).i23.flipV).toBe(true);
  });

  it('after Continue, returns to the saved framing', () => {
    let s = slotsReducer(hydrated(), { type: 'CONTINUE', view: 'i12' });
    s = slotsReducer(s, { type: 'SET_MEDIA_SIZE', view: 'i12', size: { width: 2048, height: 1536 } });
    s = slotsReducer(s, { type: 'SET_ROTATION', view: 'i12', rotation: 0 });
    s = slotsReducer(s, { type: 'TOGGLE_FLIP_H', view: 'i12' });
    const r = slotsReducer(s, { type: 'RESET', view: 'i12' });
    expect([r.i12.rotation, r.i12.flipH, r.i12.zoom]).toEqual([350, true, 1.4]);
    expect(r.i12.pendingFraming?.area).toEqual(saved.area);
    expect(r.i12.croppedArea).toEqual(saved.area);
    expect(isSlotDirty(r.i12)).toBe(false);
  });
});
