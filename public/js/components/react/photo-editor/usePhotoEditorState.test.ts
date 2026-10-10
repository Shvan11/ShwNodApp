import { describe, expect, it } from 'vitest';
import { slotsReducer } from './usePhotoEditorState';
import {
  EMPTY_HYDRATION,
  aspectForView,
  makeInitialSlots,
  type SavedFraming,
  type SlotHydration,
  type SlotMap,
} from './photoEditorTypes';
import { coverArea, isSlotDirty } from './framing';

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
  savedName: '7012.i12',
  savedVersion: '1759309200000',
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

describe('slotsReducer — Recrop the saved photo (no original needed)', () => {
  // An occlusal view saved by Dolphin: no original, no recorded framing.
  const orphan: SlotHydration = {
    ...EMPTY_HYDRATION,
    savedImageUrl: '/api/patients/7/working-files/content?name=7012.i23',
    savedSize: { width: 3000, height: 2077 },
    savedName: '7012.i23',
    savedVersion: '1759309200000',
  };
  const orphaned = (): SlotMap => slotsReducer(makeInitialSlots(), { type: 'HYDRATE', views: { i23: orphan } });

  it('frames the saved photo itself, as it is — untouched, it is no change', () => {
    const before = orphaned();
    const s = slotsReducer(before, { type: 'RECROP_SAVED', view: 'i23' });
    const slot = s.i23;
    expect(slot.sourceFromSaved).toBe(true);
    expect(slot.sourceRelPath).toBe('7012.i23');
    expect(slot.sourceVersion).toBe('1759309200000');
    // The saved photo already carries the occlusal flip: the default flip would mirror it again.
    expect([slot.rotation, slot.flipH, slot.flipV, slot.zoom]).toEqual([0, false, false, 1]);
    // The whole photo, in the largest frame of the view's aspect.
    expect(slot.pendingFraming?.area).toEqual(coverArea({ width: 3000, height: 2077 }, aspectForView('i23')));
    expect(slot.framingKey).toBe(before.i23.framingKey + 1);
    expect(isSlotDirty(slot)).toBe(false);
  });

  it('a Dolphin render a little off the view’s aspect opens unchanged too', () => {
    // Patient 7's Rest, 3811×4443 against 13:15: no frame of that aspect holds all of it.
    const rest: SlotHydration = { ...orphan, savedName: '700.i12', savedSize: { width: 3811, height: 4443 } };
    let s = slotsReducer(makeInitialSlots(), { type: 'HYDRATE', views: { i12: rest } });
    s = slotsReducer(s, { type: 'RECROP_SAVED', view: 'i12' });
    // The 2048 px proxy loads, and the cropper reports where its cover fit put the frame.
    const proxy = { width: 1757, height: 2048 };
    s = slotsReducer(s, { type: 'SET_MEDIA_SIZE', view: 'i12', size: proxy });
    s = slotsReducer(s, {
      type: 'SET_CROPPED',
      view: 'i12',
      area: coverArea(proxy, aspectForView('i12')),
      pixels: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(isSlotDirty(s.i12)).toBe(false);
  });

  it('becomes a change once moved, and Reset returns to the photo as it is', () => {
    let s = slotsReducer(orphaned(), { type: 'RECROP_SAVED', view: 'i23' });
    s = slotsReducer(s, { type: 'SET_MEDIA_SIZE', view: 'i23', size: { width: 2048, height: 1418 } });
    s = slotsReducer(s, { type: 'SET_ZOOM', view: 'i23', zoom: 1.3 });
    s = slotsReducer(s, { type: 'SET_CROPPED', view: 'i23', area: { x: 10, y: 10, width: 77, height: 77 }, pixels: { x: 1, y: 1, width: 1, height: 1 } });
    expect(isSlotDirty(s.i23)).toBe(true);
    const r = slotsReducer(s, { type: 'RESET', view: 'i23' });
    expect([r.i23.zoom, r.i23.flipV]).toEqual([1, false]);
    expect(isSlotDirty(r.i23)).toBe(false);
  });

  it('Discard goes back to the saved photo; a new photo placed over it is no re-crop', () => {
    const live = slotsReducer(orphaned(), { type: 'RECROP_SAVED', view: 'i23' });
    const discarded = slotsReducer(live, { type: 'DISCARD', view: 'i23' });
    expect(discarded.i23.sourceRelPath).toBeNull();
    expect(discarded.i23.sourceFromSaved).toBe(false);
    expect(discarded.i23.savedName).toBe('7012.i23');
    const placed = slotsReducer(live, { type: 'PLACE', view: 'i23', sourceRelPath: 'S/u.jpg', sourceName: 'u.jpg', sourceVersion: null });
    expect(placed.i23.sourceFromSaved).toBe(false);
  });

  it('is refused for a slot with nothing saved', () => {
    const s = makeInitialSlots();
    expect(slotsReducer(s, { type: 'RECROP_SAVED', view: 'i23' })).toBe(s);
  });
});

describe('slotsReducer — Re-crop from the photos grid', () => {
  it('continues from the original when the save recorded its framing', () => {
    const s = slotsReducer(hydrated(), { type: 'RECROP', view: 'i12' });
    expect(s.i12.sourceRelPath).toBe(hydration.reEditRelPath);
    expect(s.i12.sourceFromSaved).toBe(false);
    expect(s.i12.pendingFraming?.area).toEqual(saved.area);
    expect(isSlotDirty(s.i12)).toBe(false);
  });

  it('frames the saved photo itself otherwise — original gone, or saved without a record', () => {
    const noOriginal = slotsReducer(makeInitialSlots(), {
      type: 'HYDRATE',
      views: { i12: { ...hydration, canReEdit: false, canContinue: false, reEditRelPath: null } },
    });
    const noRecord = slotsReducer(makeInitialSlots(), {
      type: 'HYDRATE',
      views: { i12: { ...hydration, savedFraming: null, canContinue: false } },
    });
    for (const before of [noOriginal, noRecord]) {
      const s = slotsReducer(before, { type: 'RECROP', view: 'i12' });
      expect(s.i12.sourceFromSaved).toBe(true);
      expect(s.i12.sourceRelPath).toBe('7012.i12');
      expect(isSlotDirty(s.i12)).toBe(false);
    }
  });

  it('never replaces a live edit, and does nothing for a slot with nothing saved', () => {
    let live = slotsReducer(hydrated(), { type: 'PLACE', view: 'i12', sourceRelPath: 'S/x.jpg', sourceName: 'x.jpg', sourceVersion: null });
    live = slotsReducer(live, { type: 'SET_ZOOM', view: 'i12', zoom: 2 });
    expect(slotsReducer(live, { type: 'RECROP', view: 'i12' })).toBe(live);
    const empty = makeInitialSlots();
    expect(slotsReducer(empty, { type: 'RECROP', view: 'i12' })).toBe(empty);
  });
});
