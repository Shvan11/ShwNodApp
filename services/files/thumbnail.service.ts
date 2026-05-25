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
 * Return the absolute path to a cached WebP thumbnail of an image, generating
 * it on first request. Validates + symlink-guards the source via the
 * file-explorer service. Images only — throws for other categories.
 */
export async function getThumbnail(
  personId: string | number,
  relPath: string,
  width = 240
): Promise<string> {
  if (!ALLOWED_WIDTHS.has(width)) {
    throw new FileExplorerError('Unsupported thumbnail width', 400);
  }

  // Validates id/path, guards symlink escape, rejects dirs/missing files.
  const { abs, mtimeMs } = await resolveFileForServe(personId, relPath);
  if (getFileCategory(relPath) !== 'image') {
    throw new FileExplorerError('Thumbnails are only generated for images', 415);
  }

  const key = crypto.createHash('sha1').update(relPath).digest('hex');
  const cacheDir = path.join(THUMB_CACHE_DIR, String(personId), String(width));
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
      personId,
      relPath,
      error: (err as Error).message,
    });
    // 415 → the client <img onError> falls back to a category icon.
    throw new FileExplorerError('Could not generate thumbnail for this image', 415);
  }

  return cachePath;
}
