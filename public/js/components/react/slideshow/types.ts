/** Shared types for the Patient Presentation Slideshow feature. */

export interface Timepoint {
  tpCode: string;
  tpDescription: string;
  tpDateTime: string;
}

/** The per-photo data rendered inside a slide. */
export interface SlidePhoto {
  name: string; // Dolphin filename, e.g. `12340A.i13`
  url: string; // `/DolImgs/${name}`
  tp: string; // timepoint code
  tpDescription: string;
  tpDate: string; // formatted dd-mm-yyyy
  label: string; // e.g. "Smile"
}

/**
 * One placed slide in the sequence. The primary photo lives in flat fields (kept
 * flat for the single-photo render path); when paired for a side-by-side
 * comparison, `second` holds the right-hand photo.
 *
 * `uid` is a unique *instance* id minted on add — distinct from photo identity
 * (`${tp}:${name}`, see `photoId`) so the same photo can appear more than once.
 */
export interface SlideItem extends SlidePhoto {
  uid: string; // unique per-instance id (React key + reorder/remove target)
  second?: SlidePhoto; // optional right-hand photo (side-by-side slide)
}

export type TransitionStyle = 'crossfade' | 'slide';

/** `fit` = contain to screen (landscape consults); `reel` = centered 9:16 frame (social). */
export type Framing = 'fit' | 'reel';
