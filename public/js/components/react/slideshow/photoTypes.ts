/**
 * Slide/photo helpers for the slideshow.
 *
 * Gallery / on-disk filenames end with a `.iNN` code (e.g. `12340A.i10`), built
 * by `services/imaging/index.ts:getImageSizes`. The code→label table is
 * `shared/photo-views.ts#VIEW_LABELS`.
 */

import type { SlideItem, SlidePhoto } from './types';

/** Max photos shown side-by-side on a single slide (primary + extras). */
export const MAX_PHOTOS_PER_SLIDE = 3;

/** All photos on a slide in display order: the primary, then any paired extras. */
export function slidePhotos(slide: SlideItem): SlidePhoto[] {
  return slide.extras?.length ? [slide, ...slide.extras] : [slide];
}

/** How many photos a slide holds (1 when single, up to MAX_PHOTOS_PER_SLIDE). */
export function slidePhotoCount(slide: SlideItem): number {
  return 1 + (slide.extras?.length ?? 0);
}

/** Extract the lowercase `iNN` code from a Dolphin filename, or null if none. */
export function imageTypeCode(fileName: string): string | null {
  const m = fileName.match(/\.(i\d+)$/i);
  return m ? m[1].toLowerCase() : null;
}


/**
 * Stable identity of a photo within a patient. Gallery photos key on
 * `${tp}:${name}`; patient-folder photos key on `folder:${path}` (they have no
 * timepoint). NOT unique within a sequence — a photo may be placed more than once
 * (each placement gets its own `SlideItem.uid`). Use this for "is this photo
 * already in the sequence?".
 */
export function photoId(photo: {
  tp: string;
  name: string;
  source?: 'gallery' | 'folder';
  path?: string;
}): string {
  if (photo.source === 'folder' && photo.path) return `folder:${photo.path}`;
  return `${photo.tp}:${photo.name}`;
}
