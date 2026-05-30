/**
 * On-demand, disk-cached image thumbnails for the file-explorer grid.
 *
 * Cache lives SERVER-LOCAL, off the SMB share (fast writes; never visible to
 * the explorer or to Windows Explorer): `${THUMB_CACHE_DIR}/{id}/{w}/{sha1}-{mtime}.webp`.
 * The mtime in the key auto-invalidates when the source changes; the sha1 of
 * relPath means no attacker-controlled path segment is ever written to disk.
 * Source paths are validated through the file-explorer service first.
 */
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import sharp from 'sharp';
import { log } from '../../utils/logger.js';
import { getFileCategory } from '../../utils/file-mime.js';
import { FileExplorerError, resolveFileForServe } from './file-explorer.service.js';

/** Fixed set so the endpoint can't be driven to generate unbounded sizes. */
const ALLOWED_WIDTHS = new Set([120, 240, 480]);

const THUMB_CACHE_DIR =
  process.env.THUMB_CACHE_DIR || path.join(process.cwd(), '.cache', 'thumbs');

export function isAllowedThumbWidth(width: number): boolean {
  return ALLOWED_WIDTHS.has(width);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Render (or reuse a cached) WebP thumbnail for an already-resolved source.
 * `cacheNamespace` segments + `cacheKeyInput` (hashed) namespace the cache; the
 * source `mtimeMs` in the filename auto-invalidates on change. Shared by the
 * patient-file and working-file entry points below.
 */
async function renderThumb(
  abs: string,
  mtimeMs: number,
  cacheNamespace: string[],
  cacheKeyInput: string,
  width: number
): Promise<string> {
  if (!ALLOWED_WIDTHS.has(width)) {
    throw new FileExplorerError('Unsupported thumbnail width', 400);
  }

  const key = crypto.createHash('sha1').update(cacheKeyInput).digest('hex');
  const cacheDir = path.join(THUMB_CACHE_DIR, ...cacheNamespace, String(width));
  const cachePath = path.join(cacheDir, `${key}-${Math.round(mtimeMs)}.webp`);

  if (await exists(cachePath)) {
    return cachePath;
  }

  await fs.mkdir(cacheDir, { recursive: true });
  // Generate to a temp file then rename — atomic, so a concurrent request never
  // serves a half-written thumbnail. Same (local) volume → no EXDEV.
  const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await sharp(abs)
      .rotate() // honor EXIF orientation (phone-shot clinical photos)
      .resize(width, width, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toFile(tmpPath);
    await fs.rename(tmpPath, cachePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    log.warn('[Files] thumbnail generation failed', {
      source: cacheKeyInput,
      error: (err as Error).message,
    });
    // 415 → the client <img onError> falls back to a category icon.
    throw new FileExplorerError('Could not generate thumbnail for this image', 415);
  }

  return cachePath;
}

/**
 * Return the absolute path to a cached WebP thumbnail of an image, generating
 * it on first request. Validates + symlink-guards the source via the
 * file-explorer service. Images only — throws for other categories.
 */
export async function getThumbnail(
  personId: string | number,
  relPath: string,
  width = 240
): Promise<string> {
  // Validates id/path, guards symlink escape, rejects dirs/missing files.
  const { abs, mtimeMs } = await resolveFileForServe(personId, relPath);
  if (getFileCategory(relPath) !== 'image') {
    throw new FileExplorerError('Thumbnails are only generated for images', 415);
  }
  return renderThumb(abs, mtimeMs, [String(personId)], relPath, width);
}

/**
 * Thumbnail for a patient WORKING file (`.iNN`, always JPEG). The caller
 * (working-files route) has already validated `name` against the patient prefix
 * and resolved `abs`/`mtimeMs`, so this skips patient-root resolution and the
 * extension/category check (the `.iNN` extension isn't in the mime table, but
 * the bytes are JPEG). Cached under a `working/{personId}` namespace.
 */
export async function getWorkingThumbnail(
  personId: string | number,
  name: string,
  abs: string,
  mtimeMs: number,
  width = 240
): Promise<string> {
  return renderThumb(abs, mtimeMs, ['working', String(personId)], name, width);
}
