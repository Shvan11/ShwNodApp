/**
 * Reducer over the 8 photo-editor slots. React 19 + React Compiler is on, so the
 * returned action callbacks are not manually memoized.
 */
import { useReducer } from 'react';
import type { CropArea, PhotoViewCode, SlotHydration, SlotMap } from './photoEditorTypes';
import { makeInitialSlot, makeInitialSlots, VIEW_CODES } from './photoEditorTypes';

type Action =
  | { type: 'PLACE'; view: PhotoViewCode; sourceRelPath: string; sourceName: string }
  | { type: 'CLEAR'; view: PhotoViewCode }
  | { type: 'RESET'; view: PhotoViewCode }
  | { type: 'SET_CROP'; view: PhotoViewCode; crop: { x: number; y: number } }
  | { type: 'SET_ZOOM'; view: PhotoViewCode; zoom: number }
  | { type: 'SET_ROTATION'; view: PhotoViewCode; rotation: number }
  | { type: 'TOGGLE_FLIP_H'; view: PhotoViewCode }
  | { type: 'TOGGLE_FLIP_V'; view: PhotoViewCode }
  | { type: 'SET_CROPPED'; view: PhotoViewCode; area: CropArea }
  | { type: 'SET_MEDIA_SIZE'; view: PhotoViewCode; size: { width: number; height: number } }
  | { type: 'HYDRATE'; views: Partial<Record<PhotoViewCode, SlotHydration>> };

function reducer(state: SlotMap, action: Action): SlotMap {
  // Seed read-only "saved" display + re-edit info when a timepoint is opened. Has no
  // single `view`, so it's handled before the per-view `slot` lookup below.
  if (action.type === 'HYDRATE') {
    const next = { ...state };
    for (const v of VIEW_CODES) {
      const h = action.views[v];
      if (!h) continue;
      // A live edit always wins over (possibly late) hydration — e.g. the SSE
      // re-hydrate after a background render must not wipe a slot the user has
      // already started re-framing.
      if (state[v].sourceRelPath) continue;
      next[v] = {
        ...makeInitialSlot(v),
        savedImageUrl: h.savedImageUrl,
        canReEdit: h.canReEdit,
        reEditRelPath: h.reEditRelPath,
        reEditName: h.reEditName,
      };
    }
    return next;
  }
  const slot = state[action.view];
  switch (action.type) {
    case 'PLACE':
      return {
        ...state,
        [action.view]: {
          ...makeInitialSlot(action.view),
          sourceRelPath: action.sourceRelPath,
          sourceName: action.sourceName,
        },
      };
    case 'CLEAR':
      return { ...state, [action.view]: makeInitialSlot(action.view) };
    case 'RESET':
      return {
        ...state,
        [action.view]: {
          ...makeInitialSlot(action.view),
          sourceRelPath: slot.sourceRelPath,
          sourceName: slot.sourceName,
        },
      };
    case 'SET_CROP':
      return { ...state, [action.view]: { ...slot, crop: action.crop } };
    case 'SET_ZOOM':
      return { ...state, [action.view]: { ...slot, zoom: action.zoom } };
    case 'SET_ROTATION':
      return { ...state, [action.view]: { ...slot, rotation: ((action.rotation % 360) + 360) % 360 } };
    case 'TOGGLE_FLIP_H':
      return { ...state, [action.view]: { ...slot, flipH: !slot.flipH } };
    case 'TOGGLE_FLIP_V':
      return { ...state, [action.view]: { ...slot, flipV: !slot.flipV } };
    case 'SET_CROPPED':
      return { ...state, [action.view]: { ...slot, croppedAreaPixels: action.area } };
    case 'SET_MEDIA_SIZE':
      // Record only — the rect is NOT rescaled here. react-easy-crop re-emits
      // croppedAreaPixels in the new media space on load (before onMediaLoaded),
      // so rescaling would double-apply the change.
      return { ...state, [action.view]: { ...slot, mediaSize: action.size } };
    default:
      return state;
  }
}

export interface PhotoEditorState {
  slots: SlotMap;
  place: (view: PhotoViewCode, sourceRelPath: string, sourceName: string) => void;
  clear: (view: PhotoViewCode) => void;
  reset: (view: PhotoViewCode) => void;
  setCrop: (view: PhotoViewCode, crop: { x: number; y: number }) => void;
  setZoom: (view: PhotoViewCode, zoom: number) => void;
  setRotation: (view: PhotoViewCode, rotation: number) => void;
  toggleFlipH: (view: PhotoViewCode) => void;
  toggleFlipV: (view: PhotoViewCode) => void;
  setCropped: (view: PhotoViewCode, area: CropArea) => void;
  setMediaSize: (view: PhotoViewCode, size: { width: number; height: number }) => void;
  hydrate: (views: Partial<Record<PhotoViewCode, SlotHydration>>) => void;
}

export function usePhotoEditorState(): PhotoEditorState {
  const [slots, dispatch] = useReducer(reducer, undefined, makeInitialSlots);
  return {
    slots,
    place: (view, sourceRelPath, sourceName) => dispatch({ type: 'PLACE', view, sourceRelPath, sourceName }),
    clear: (view) => dispatch({ type: 'CLEAR', view }),
    reset: (view) => dispatch({ type: 'RESET', view }),
    setCrop: (view, crop) => dispatch({ type: 'SET_CROP', view, crop }),
    setZoom: (view, zoom) => dispatch({ type: 'SET_ZOOM', view, zoom }),
    setRotation: (view, rotation) => dispatch({ type: 'SET_ROTATION', view, rotation }),
    toggleFlipH: (view) => dispatch({ type: 'TOGGLE_FLIP_H', view }),
    toggleFlipV: (view) => dispatch({ type: 'TOGGLE_FLIP_V', view }),
    setCropped: (view, area) => dispatch({ type: 'SET_CROPPED', view, area }),
    setMediaSize: (view, size) => dispatch({ type: 'SET_MEDIA_SIZE', view, size }),
    hydrate: (views) => dispatch({ type: 'HYDRATE', views }),
  };
}
