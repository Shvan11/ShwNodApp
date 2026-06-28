/**
 * Shared mapping of Dolphin image-type codes to human labels.
 *
 * Gallery / on-disk filenames end with a `.iNN` code (e.g. `12340A.i10`), built
 * by `services/imaging/index.ts:getImageSizes`. This is the single source of truth
 * for that code→label mapping (previously duplicated as `fileNameMap` in
 * GridComponent).
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

export const PHOTO_TYPE_LABELS: Record<string, string> = {
  i10: 'Profile',
  i12: 'Rest',
  i13: 'Smile',
  i23: 'Upper',
  i24: 'Lower',
  i20: 'Right',
  i22: 'Center',
  i21: 'Left',
};

/** Extract the lowercase `iNN` code from a Dolphin filename, or null if none. */
export function imageTypeCode(fileName: string): string | null {
  const m = fileName.match(/\.(i\d+)$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Human label for a Dolphin photo filename (falls back to the raw code). */
export function labelForImageName(fileName: string): string {
  const code = imageTypeCode(fileName);
  if (!code) return 'Photo';
  return PHOTO_TYPE_LABELS[code] ?? code.toUpperCase();
}

/** The practice-logo slot returned by the gallery endpoint — never presented. */
export function isLogoImage(fileName: string): boolean {
  return /logo\.png$/i.test(fileName);
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
