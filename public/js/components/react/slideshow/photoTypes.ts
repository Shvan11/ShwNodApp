/**
 * Shared mapping of Dolphin image-type codes to human labels.
 *
 * Gallery / on-disk filenames end with a `.iNN` code (e.g. `12340A.i10`), built
 * by `services/imaging/index.ts:getImageSizes`. This is the single source of truth
 * for that code→label mapping (previously duplicated as `fileNameMap` in
 * GridComponent).
 */

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
 * Stable identity of a photo within a patient: `${tp}:${name}`. NOT unique within
 * a sequence — a photo may be placed more than once (each placement gets its own
 * `SlideItem.uid`). Use this for "is this gallery photo already in the sequence?".
 */
export function photoId(photo: { tp: string; name: string }): string {
  return `${photo.tp}:${photo.name}`;
}
