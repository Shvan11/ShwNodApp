/** Shared types for the Patient Presentation Slideshow feature. */

export interface Timepoint {
  tpCode: string;
  tpDescription: string;
  tpDateTime: string;
}

/** The per-photo data rendered inside a slide. */
export interface SlidePhoto {
  name: string; // Dolphin filename (gallery) or file name (folder), e.g. `12340A.i13`
  url: string; // gallery: `/DolImgs/${name}` · folder: the files/content endpoint
  tp: string; // timepoint code (empty '' for folder photos)
  tpDescription: string; // empty '' for folder photos
  tpDate: string; // formatted dd-mm-yyyy (empty '' for folder photos)
  label: string; // e.g. "Smile" (gallery) or the file name (folder)
  /** Where the photo comes from. Absent = gallery (the default, back-compat). */
  source?: 'gallery' | 'folder';
  /** Folder photos only: the patient-folder relative path (identity + url rebuild). */
  path?: string;
}

/**
 * One placed slide in the sequence. The primary photo lives in flat fields (kept
 * flat for the single-photo render path); when paired for a side-by-side
 * comparison, `extras` holds the additional right-hand photos. Total photos on a
 * slide (primary + extras) is capped at `MAX_PHOTOS_PER_SLIDE` (see `photoTypes`).
 *
 * `uid` is a unique *instance* id minted on add — distinct from photo identity
 * (`${tp}:${name}`, see `photoId`) so the same photo can appear more than once.
 */
export interface SlideItem extends SlidePhoto {
  uid: string; // unique per-instance id (React key + reorder/remove target)
  extras?: SlidePhoto[]; // additional side-by-side photos (right of the primary)
}

export type TransitionStyle = 'crossfade' | 'slide';

/** `fit` = contain to screen (landscape consults); `reel` = centered 9:16 frame (social). */
export type Framing = 'fit' | 'reel';
