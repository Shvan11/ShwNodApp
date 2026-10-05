/**
 * Reducer over the 8 photo-editor slots. React 19 + React Compiler is on, so the
 * returned action callbacks are not manually memoized.
 *
 * A slot has two halves (see SlotState): the SAVED half — what is on disk, seeded by
 * HYDRATE — and an optional LIVE edit on top of it. Dropping the live edit
 * (DISCARD) shows the saved photo again; only a server-side removal empties a slot
 * that has one (CLEAR).
 */
import { useReducer } from 'react';
import type { CropArea, FramingArea, PhotoViewCode, SlotFraming, SlotHydration, SlotMap, SlotState } from './photoEditorTypes';
import { EMPTY_HYDRATION, aspectForView, defaultFlipV, makeInitialSlot, makeInitialSlots, VIEW_CODES } from './photoEditorTypes';
import { areaToPixels, framingOf } from './framing';

type Action =
  | { type: 'PLACE'; view: PhotoViewCode; sourceRelPath: string; sourceName: string; sourceVersion: string | null }
  | { type: 'CONTINUE'; view: PhotoViewCode }
  | { type: 'DISCARD'; view: PhotoViewCode }
  | { type: 'CLEAR'; view: PhotoViewCode }
  | { type: 'RESET'; view: PhotoViewCode }
  | { type: 'SET_CROP'; view: PhotoViewCode; crop: { x: number; y: number } }
  | { type: 'SET_ZOOM'; view: PhotoViewCode; zoom: number }
  | { type: 'SET_ROTATION'; view: PhotoViewCode; rotation: number }
  | { type: 'TOGGLE_FLIP_H'; view: PhotoViewCode }
  | { type: 'TOGGLE_FLIP_V'; view: PhotoViewCode }
  | { type: 'SET_CROPPED'; view: PhotoViewCode; area: FramingArea; pixels: CropArea }
  | { type: 'SET_MEDIA_SIZE'; view: PhotoViewCode; size: { width: number; height: number } }
  | { type: 'HYDRATE'; views: Partial<Record<PhotoViewCode, SlotHydration>> };

/** A slot's saved half — what survives its live edit being dropped. */
function savedHalf(s: SlotState): SlotHydration {
  return {
    savedImageUrl: s.savedImageUrl,
    savedSize: s.savedSize,
    savedFraming: s.savedFraming,
    canReEdit: s.canReEdit,
    canContinue: s.canContinue,
    reEditRelPath: s.reEditRelPath,
    reEditName: s.reEditName,
    reEditVersion: s.reEditVersion,
  };
}

/**
 * A live edit of `source`, starting at `framing` (null = the default framing), over
 * `s`'s saved half. The cropper remounts (framingKey), so its first media load reports
 * the new photo's size and frame — and applies `framing`, held as pending until then.
 */
function startEdit(
  s: SlotState,
  source: { relPath: string; name: string; version: string | null },
  framing: SlotFraming | null,
  baseline: SlotFraming | null
): SlotState {
  return {
    ...makeInitialSlot(s.view),
    ...savedHalf(s),
    sourceRelPath: source.relPath,
    sourceName: source.name,
    sourceVersion: source.version,
    ...(framing
      ? { rotation: framing.rotation, flipH: framing.flipH, flipV: framing.flipV, zoom: framing.zoom }
      : {}),
    pendingFraming: framing,
    resetTo: framing,
    baseline,
    framingKey: s.framingKey + 1,
  };
}

/** The slots reducer — exported for its unit tests. */
export function slotsReducer(state: SlotMap, action: Action): SlotMap {
  // Seed (or refresh) every slot's saved half when a timepoint is opened or a render
  // lands. Has no single `view`, so it's handled before the per-view `slot` lookup.
  if (action.type === 'HYDRATE') {
    // Authoritative: a view absent from `views` is not saved any more, so its saved
    // display is cleared — a removed photo used to stay (FE-F14-2).
    const next = { ...state };
    for (const v of VIEW_CODES) {
      const h = action.views[v] ?? EMPTY_HYDRATION;
      // A live edit always wins over (possibly late) hydration — e.g. the SSE
      // re-hydrate after a background render must not wipe a slot the user has
      // already started re-framing. Only its saved half is refreshed, so Discard
      // shows what is on disk NOW.
      next[v] = state[v].sourceRelPath ? { ...state[v], ...h } : { ...makeInitialSlot(v), ...h };
    }
    return next;
  }
  const slot = state[action.view];
  const put = (s: SlotState): SlotMap => ({ ...state, [action.view]: s });
  switch (action.type) {
    case 'PLACE': {
      // Placing the saved view's own original ("Start over", or dragging it back in)
      // is measured against the saved framing: framing it as saved is no change.
      const own = action.sourceRelPath === slot.reEditRelPath && slot.canContinue && slot.savedFraming;
      return put(
        startEdit(
          slot,
          { relPath: action.sourceRelPath, name: action.sourceName, version: action.sourceVersion },
          null,
          own ? framingOf(own) : null
        )
      );
    }
    case 'CONTINUE': {
      if (!slot.canContinue || !slot.savedFraming || !slot.reEditRelPath) return state;
      const saved = framingOf(slot.savedFraming);
      return put(
        startEdit(
          slot,
          { relPath: slot.reEditRelPath, name: slot.reEditName ?? slot.reEditRelPath, version: slot.reEditVersion },
          saved,
          saved
        )
      );
    }
    case 'DISCARD':
      // Drop the live edit only: a saved photo underneath shows again.
      return put({ ...makeInitialSlot(action.view), ...savedHalf(slot), framingKey: slot.framingKey });
    case 'CLEAR':
      // The saved photo itself is gone (removed on the server): empty the slot.
      return put(makeInitialSlot(action.view));
    case 'RESET': {
      // Back to where this edit started — the saved framing after "Continue editing",
      // else the default. The media (and its size) stays; the cropper remounts so it
      // reports the reset frame. A pan back to the centre at an unchanged zoom used to
      // keep the old rect for Save, and the reset wiped the media size a proxy-framed
      // rect needs to be scaled to the original.
      const to = slot.resetTo;
      return put({
        ...slot,
        crop: { x: 0, y: 0 },
        zoom: to?.zoom ?? 1,
        rotation: to?.rotation ?? 0,
        flipH: to?.flipH ?? false,
        flipV: to ? to.flipV : defaultFlipV(action.view),
        pendingFraming: to,
        // A known media size pins the frame now; the remount's load re-confirms it.
        croppedArea: to && slot.mediaSize ? to.area : null,
        croppedAreaPixels:
          to && slot.mediaSize ? areaToPixels(to.area, slot.mediaSize, to.rotation, aspectForView(action.view)) : null,
        framingKey: slot.framingKey + 1,
      });
    }
    case 'SET_CROP':
      return put({ ...slot, crop: action.crop });
    case 'SET_ZOOM':
      return put({ ...slot, zoom: action.zoom });
    case 'SET_ROTATION':
      return put({ ...slot, rotation: ((action.rotation % 360) + 360) % 360 });
    case 'TOGGLE_FLIP_H':
      return put({ ...slot, flipH: !slot.flipH });
    case 'TOGGLE_FLIP_V':
      return put({ ...slot, flipV: !slot.flipV });
    case 'SET_CROPPED':
      return put({ ...slot, croppedArea: action.area, croppedAreaPixels: action.pixels });
    case 'SET_MEDIA_SIZE': {
      // Record only — the rect is NOT rescaled here. react-easy-crop re-emits
      // croppedAreaPixels in the new media space on load (before onMediaLoaded),
      // so rescaling would double-apply the change.
      const p = slot.pendingFraming;
      if (!p) return put({ ...slot, mediaSize: action.size });
      // A pending framing was just applied by this load (initialCroppedAreaPercentages,
      // right before this callback). Take its frame as the slot's: the cropper reports
      // it only if the pan or zoom moved, and a restore that lands where the cropper
      // already stood would leave the slot holding the frame from BEFORE it.
      return put({
        ...slot,
        mediaSize: action.size,
        pendingFraming: null,
        croppedArea: p.area,
        croppedAreaPixels: areaToPixels(p.area, action.size, slot.rotation, aspectForView(action.view)),
      });
    }
    default:
      return state;
  }
}

export interface PhotoEditorState {
  slots: SlotMap;
  /** Frame a photo from the sidebar (or the saved view's original, from scratch).
   *  `sourceVersion`: the listing's mtime for the source (null when unknown). */
  place: (view: PhotoViewCode, sourceRelPath: string, sourceName: string, sourceVersion: string | null) => void;
  /** Reopen a saved view's original with the framing it was saved with. */
  continueEditing: (view: PhotoViewCode) => void;
  /** Drop the live edit; a saved photo underneath shows again. */
  discard: (view: PhotoViewCode) => void;
  /** Empty the slot entirely (after its saved photo was removed on the server). */
  clear: (view: PhotoViewCode) => void;
  /** Back to where the live edit started. */
  reset: (view: PhotoViewCode) => void;
  setCrop: (view: PhotoViewCode, crop: { x: number; y: number }) => void;
  setZoom: (view: PhotoViewCode, zoom: number) => void;
  setRotation: (view: PhotoViewCode, rotation: number) => void;
  toggleFlipH: (view: PhotoViewCode) => void;
  toggleFlipV: (view: PhotoViewCode) => void;
  setCropped: (view: PhotoViewCode, area: FramingArea, pixels: CropArea) => void;
  setMediaSize: (view: PhotoViewCode, size: { width: number; height: number }) => void;
  hydrate: (views: Partial<Record<PhotoViewCode, SlotHydration>>) => void;
}

export function usePhotoEditorState(): PhotoEditorState {
  const [slots, dispatch] = useReducer(slotsReducer, undefined, makeInitialSlots);
  return {
    slots,
    place: (view, sourceRelPath, sourceName, sourceVersion) =>
      dispatch({ type: 'PLACE', view, sourceRelPath, sourceName, sourceVersion }),
    continueEditing: (view) => dispatch({ type: 'CONTINUE', view }),
    discard: (view) => dispatch({ type: 'DISCARD', view }),
    clear: (view) => dispatch({ type: 'CLEAR', view }),
    reset: (view) => dispatch({ type: 'RESET', view }),
    setCrop: (view, crop) => dispatch({ type: 'SET_CROP', view, crop }),
    setZoom: (view, zoom) => dispatch({ type: 'SET_ZOOM', view, zoom }),
    setRotation: (view, rotation) => dispatch({ type: 'SET_ROTATION', view, rotation }),
    toggleFlipH: (view) => dispatch({ type: 'TOGGLE_FLIP_H', view }),
    toggleFlipV: (view) => dispatch({ type: 'TOGGLE_FLIP_V', view }),
    setCropped: (view, area, pixels) => dispatch({ type: 'SET_CROPPED', view, area, pixels }),
    setMediaSize: (view, size) => dispatch({ type: 'SET_MEDIA_SIZE', view, size }),
    hydrate: (views) => dispatch({ type: 'HYDRATE', views }),
  };
}
