/**
 * Reducer over the 8 photo-editor slots. React 19 + React Compiler is on, so the
 * returned action callbacks are not manually memoized.
 */
import { useReducer } from 'react';
import type { CropArea, PhotoViewCode, SlotMap } from './photoEditorTypes';
import { makeInitialSlot, makeInitialSlots } from './photoEditorTypes';

type Action =
  | { type: 'PLACE'; view: PhotoViewCode; sourceRelPath: string; sourceName: string }
  | { type: 'CLEAR'; view: PhotoViewCode }
  | { type: 'RESET'; view: PhotoViewCode }
  | { type: 'SET_CROP'; view: PhotoViewCode; crop: { x: number; y: number } }
  | { type: 'SET_ZOOM'; view: PhotoViewCode; zoom: number }
  | { type: 'SET_ROTATION'; view: PhotoViewCode; rotation: number }
  | { type: 'TOGGLE_FLIP_H'; view: PhotoViewCode }
  | { type: 'TOGGLE_FLIP_V'; view: PhotoViewCode }
  | { type: 'SET_CROPPED'; view: PhotoViewCode; area: CropArea };

function reducer(state: SlotMap, action: Action): SlotMap {
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
  };
}
