/**
 * Clinic branding asset storage — the uploaded header logo on the clinic volume.
 *
 * The logo bytes live under `clinic1/branding/` (beside `working/`), so the
 * temp→final `rename` is same-volume (no EXDEV on a network-mounted server),
 * mirroring share-stage.ts. This module owns ONLY the bytes on disk; the routes
 * own the `CLINIC_LOGO` option that points at the current file. Filenames are
 * timestamped + random so a fresh upload always gets a new URL (cache-busting)
 * and the prior file can be pruned.
 */
import path from 'path';
import { randomBytes } from 'crypto';
import { mkdir, writeFile, rename, unlink, readdir } from 'fs/promises';
import { clinicPath } from './clinic-paths.js';

const BRANDING_REL = 'branding';

/**
 * Accepted raster logo formats → canonical extension. SVG is deliberately
 * excluded: an uploaded SVG can embed scripts, an XSS vector when served from
 * our own origin. PNG/JPEG/WebP cover real logos safely.
 */
export const LOGO_MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;
export type LogoExt = (typeof LOGO_MIME_EXT)[keyof typeof LOGO_MIME_EXT];

/** Canonical extension → content-type, for streaming the stored file back. */
export const LOGO_EXT_MIME: Record<LogoExt, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

// `logo-<epoch-ms>-<16 hex>.<ext>` — no separators, validated before any disk op.
const FILENAME_RE = /^logo-\d+-[a-f0-9]{16}\.(?:png|jpg|webp)$/;

/** Absolute path of the branding dir (`clinic1/branding`). */
function brandingDir(): string {
  return clinicPath(BRANDING_REL);
}

/** True when `name` is a well-formed branding filename (and has no separators). */
export function isLogoFilename(name: string): boolean {
  return FILENAME_RE.test(name);
}

/**
 * Absolute path of a stored logo, guarded to stay inside the branding dir.
 * Returns '' for a malformed/escaping name (callers treat that as "no logo").
 */
export function logoFilePath(filename: string): string {
  if (!isLogoFilename(filename)) return '';
  const dir = brandingDir();
  const abs = path.join(dir, filename);
  const rel = path.relative(dir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return '';
  return abs;
}

/** Persist logo bytes atomically; return the filename to store in `CLINIC_LOGO`. */
export async function saveLogo(buf: Buffer, ext: LogoExt): Promise<string> {
  const dir = brandingDir();
  await mkdir(dir, { recursive: true });
  const filename = `logo-${Date.now()}-${randomBytes(8).toString('hex')}.${ext}`;
  const abs = path.join(dir, filename);
  const tmp = `${abs}.tmp-${process.pid}`;
  await writeFile(tmp, buf);
  await rename(tmp, abs); // atomic publish, same volume.
  return filename;
}

/**
 * Delete every logo file except `keep` (pass null to clear all). Best-effort:
 * a missing dir or racey unlink is harmless, so it never throws. Called after a
 * successful upload (keep the new file) or a delete (keep nothing) so the dir
 * never accumulates superseded logos.
 */
export async function pruneLogosExcept(keep: string | null): Promise<void> {
  const dir = brandingDir();
  try {
    const names = await readdir(dir);
    await Promise.all(
      names
        .filter((n) => isLogoFilename(n) && n !== keep)
        .map((n) => unlink(path.join(dir, n)).catch(() => {})),
    );
  } catch {
    /* best effort */
  }
}
