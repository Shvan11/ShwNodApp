/**
 * Read side of the photo editor's framing record (the write side is
 * photo-render.service, which embeds it in each render — see photo-framing-xmp.ts).
 *
 *  - readSavedFramings: each of a session's rendered views → the framing it was saved
 *    with, so the editor can offer "Continue editing" and show a saved view's zoom /
 *    rotation without reopening it.
 *  - readSourceSize: an original's post-EXIF pixel size. The editor frames against a
 *    2048 px proxy by default; the saved view keeps the crop's NATIVE pixels, so this
 *    is how it shows the resolution a save will keep.
 *
 * Both are header-only reads (`sharp().metadata()` parses the container, XMP and EXIF
 * without decoding a pixel).
 */
import sharp from 'sharp';
import { VIEW_CODES, type PhotoViewCode } from '../../shared/photo-views.js';
import type { SavedFraming } from '../../shared/contracts/photo-editor.contract.js';
import { getFileCategory } from '../../utils/file-mime.js';
import { workingFileNameVariants, workingFilePath } from '../files/clinic-paths.js';
import { resolveFileForServe, FileExplorerError } from '../files/file-explorer.service.js';
import { framingFromXmp } from './photo-framing-xmp.js';

/** Same cap as the render: a source the render would refuse is not sized either. */
const MAX_INPUT_PIXELS = 300_000_000;

/**
 * `{ view: framing | null }` for one session. A view that is not rendered, or whose
 * render carries no (readable) record, is null. Never throws for a single view: an
 * unreadable file just has no framing to offer.
 */
export async function readSavedFramings(
  personId: number,
  tpCode: number
): Promise<Record<PhotoViewCode, SavedFraming | null>> {
  if (!/^\d+$/.test(String(personId))) throw new FileExplorerError('Invalid patient id', 400);
  if (!/^\d+$/.test(String(tpCode))) throw new FileExplorerError('Invalid timepoint code', 400);

  const probe = async (view: PhotoViewCode): Promise<SavedFraming | null> => {
    // Canonical lowercase name first, then the Dolphin-era uppercase one — the same
    // order the gallery resolves, so this reads the file the grid shows.
    for (const name of workingFileNameVariants(personId, tpCode, view)) {
      let xmp: Uint8Array | undefined;
      try {
        ({ xmp } = await sharp(workingFilePath(name)).metadata());
      } catch {
        continue; // missing (or unreadable) under this spelling — try the next
      }
      return framingFromXmp(xmp);
    }
    return null;
  };

  const entries = await Promise.all(VIEW_CODES.map(async (view) => [view, await probe(view)] as const));
  return Object.fromEntries(entries) as Record<PhotoViewCode, SavedFraming | null>;
}

/** An original's pixel size after EXIF orientation — what the browser reports for it. */
export async function readSourceSize(
  personId: number,
  relPath: string
): Promise<{ width: number; height: number }> {
  // Validates + symlink-guards the path under the patient root (404 when missing).
  const { abs } = await resolveFileForServe(personId, relPath);
  if (getFileCategory(relPath) !== 'image') {
    throw new FileExplorerError('Source is not an image', 415);
  }
  let meta: sharp.Metadata;
  try {
    meta = await sharp(abs, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' }).metadata();
  } catch {
    throw new FileExplorerError('Unreadable image', 415);
  }
  if (!meta.width || !meta.height) throw new FileExplorerError('Unreadable image', 415);
  // EXIF orientations 5–8 are quarter turns: the displayed photo is the stored one on its side.
  return meta.orientation && meta.orientation >= 5
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}
