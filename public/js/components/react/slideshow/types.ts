/** Shared types for the Patient Presentation Slideshow feature. */

export interface Timepoint {
  tpCode: string;
  tpDescription: string;
  tpDateTime: string;
}

/** One selectable/playable photo. `id` is unique across timepoints. */
export interface SlideItem {
  id: string; // `${tp}:${name}`
  name: string; // Dolphin filename, e.g. `12340A.i13`
  url: string; // `/DolImgs/${name}`
  tp: string; // timepoint code
  tpDescription: string;
  tpDate: string; // formatted dd-mm-yyyy
  label: string; // e.g. "Smile"
}

export type TransitionStyle = 'crossfade' | 'slide';

/** `fit` = contain to screen (landscape consults); `reel` = centered 9:16 frame (social). */
export type Framing = 'fit' | 'reel';
