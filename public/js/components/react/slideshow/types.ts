/** Shared types for the Patient Presentation Slideshow feature. */
import { z } from 'zod';
import type { TimepointRow } from '@shared/contracts/patient.contract';

/** A photo session, as the timepoints read returns it (no hand-written copy — FE-F15-11). */
export type Timepoint = TimepointRow;

/**
 * The per-photo data rendered inside a slide.
 *
 * IDENTITY is `tp` + `name` (gallery) or `path` (folder). `url`, `thumbUrl` and the
 * caption fields are DERIVED at render time from the live gallery read
 * (`resolveSlides` in PatientSlideshow): a URL frozen when the photo was added kept its
 * old `?v=` after a re-render in the editor, so the slideshow played the old version
 * behind the immutable cache header (FE-F15-4).
 */
export interface SlidePhoto {
  name: string; // Dolphin filename (gallery) or file name (folder), e.g. `12340A.i13`
  url: string; // gallery: `/DolImgs/${name}?v={mtime}` · folder: the files/content endpoint
  /** A small version for the builder's tiles, chips and drag ghost (FE-F15-10). */
  thumbUrl?: string;
  tp: string; // timepoint code (empty '' for folder photos)
  tpDescription: string; // empty '' for folder photos
  tpDate: string; // formatted dd-mm-yyyy (empty '' for folder photos)
  label: string; // e.g. "Smile" (gallery) or the file name (folder)
  /** Where the photo comes from. Absent = gallery (the default, back-compat). */
  source?: 'gallery' | 'folder';
  /** Folder photos only: the patient-folder relative path (identity + url rebuild). */
  path?: string;
  /** Set at render when the session's gallery no longer has this photo. */
  missing?: boolean;
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

// The working timeline persisted in sessionStorage is a BOUNDARY (a previous build, a
// hand edit): parsed, not cast — an entry that does not parse is dropped (FE-F15-11).
const storedPhoto = z.object({
  name: z.string(),
  url: z.string(),
  tp: z.string(),
  tpDescription: z.string(),
  tpDate: z.string(),
  label: z.string(),
  source: z.enum(['gallery', 'folder']).optional(),
  path: z.string().optional(),
});
export const storedSlide = storedPhoto.extend({
  uid: z.string(),
  extras: z.array(storedPhoto).max(2).optional(),
});

export type TransitionStyle = 'crossfade' | 'slide';

/** `fit` = contain to screen (landscape consults); `reel` = centered 9:16 frame (social). */
export type Framing = 'fit' | 'reel';
