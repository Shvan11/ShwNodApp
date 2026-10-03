/**
 * "Date taken" for the original photos in a patient folder — each file's EXIF capture
 * time (see exif-taken-at.ts), for the photo grid's caption and the photo editor's
 * Sequence Files list.
 *
 * The grid's photos are renders in `working/`, which carry no EXIF; the date lives on
 * the camera original in the session folder, view-tagged `{view}-…` by the editor
 * (shared/photo-views.ts). Scope `views` reads only those tagged originals (≤ 8 —
 * the grid's need); `all` reads every image (the editor, choosing what to place).
 *
 * Header-only: `sharp().metadata()` parses the container + EXIF without decoding a
 * pixel — a session's 8 originals (~7.6 MB each) measured ~60 ms over WSL's /mnt/c,
 * the slow path. Names and types come from the Dirent, no per-file stat (CLAUDE.md
 * filesystem discipline).
 */
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { FileExplorerError, mapLimit, resolveDirForRead } from '../files/file-explorer.service.js';
import { getFileCategory } from '../../utils/file-mime.js';
import { VIEW_TAG_RE } from '../../shared/photo-views.js';
import { exifTakenAt } from './exif-taken-at.js';

export type TakenDatesScope = 'views' | 'all';

/** Header reads in flight at once — enough to hide disk latency, not enough to crowd renders. */
const CONCURRENCY = 4;
/** A folder is a session's photos; past this it is something else, and we stop reading. */
const MAX_FILES = 300;

/** One file's capture time, or null when it has none or can't be opened (e.g. HEIC). */
export async function readTakenAt(absFile: string): Promise<string | null> {
  try {
    const { exif } = await sharp(absFile).metadata();
    return exifTakenAt(exif);
  } catch {
    return null;
  }
}

/**
 * `{ fileName: 'YYYY-MM-DDTHH:MM:SS' | null }` for the images in `folderRel`. A folder
 * that doesn't exist yields `{}` — a Dolphin-era session has none, and that is "no
 * dates", not an error.
 */
export async function listTakenDates(
  personId: string | number,
  folderRel: string,
  scope: TakenDatesScope
): Promise<Record<string, string | null>> {
  let dirAbs: string;
  try {
    dirAbs = await resolveDirForRead(personId, folderRel);
  } catch (err) {
    if (err instanceof FileExplorerError && err.status === 404) return {};
    throw err;
  }

  let dirents;
  try {
    dirents = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    if (code === 'ENOTDIR') throw new FileExplorerError('Path is not a folder', 400);
    throw err;
  }

  // isFile() is false for a symlink Dirent, so a link can't point the read elsewhere.
  const names = dirents
    .filter((d) => d.isFile() && getFileCategory(d.name) === 'image')
    .map((d) => d.name)
    .filter((name) => scope === 'all' || VIEW_TAG_RE.test(name))
    .slice(0, MAX_FILES);

  const dates = await mapLimit(names, CONCURRENCY, (name) => readTakenAt(path.join(dirAbs, name)));
  return Object.fromEntries(names.map((name, i) => [name, dates[i]]));
}
