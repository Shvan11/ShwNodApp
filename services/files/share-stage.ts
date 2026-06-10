/**
 * Staging area for ad-hoc, browser-generated images that need to be shared.
 *
 * Screens like Compare build an image in a `<canvas>` and have no file on disk,
 * but the share targets (LocalSend / Telegram) resolve everything to an on-disk
 * path via `share-ref.ts`. This module bridges that gap: the route uploads the
 * bytes, we write them to a short-lived temp dir under the clinic volume, and the
 * client hands the returned token back as a `{ source: 'staged' }` SendFileRef
 * (resolved here by `resolveStagedShare`).
 *
 * The dir sits beside `working/` under `clinic1/` so the temp→final `rename` is
 * same-volume (no EXDEV on a network-mounted server). Files are swept on a TTL on
 * each new stage — no long-lived state, lost-on-restart is fine (they're temp).
 */
import path from 'path';
import { randomBytes } from 'crypto';
import { mkdir, writeFile, rename, readdir, unlink, stat } from 'fs/promises';
import { clinicPath } from './clinic-paths.js';
import { FileExplorerError } from './file-explorer.service.js';
import type { ResolvedShareFile } from './share-ref.js';

const STAGE_REL = '.uploads/share-stage';
const TTL_MS = 60 * 60 * 1000; // 1 hour — long enough to pick a recipient, short enough to not pile up.
// `<epoch-ms>-<16 hex>.<ext>` — no separators, parseable age, validated on read.
const TOKEN_RE = /^\d+-[a-f0-9]{16}\.(?:png|jpg)$/;

/** Absolute path of the share-staging dir (`clinic1/.uploads/share-stage`). */
export function shareStageDir(): string {
  return clinicPath(STAGE_REL);
}

/** Persist uploaded image bytes and return the opaque token the client re-sends. */
export async function stageShareImage(buf: Buffer, ext: 'png' | 'jpg'): Promise<string> {
  const dir = shareStageDir();
  await mkdir(dir, { recursive: true });
  void sweepExpired(dir); // best-effort GC of past uploads; never blocks this one.

  const token = `${Date.now()}-${randomBytes(8).toString('hex')}.${ext}`;
  const abs = path.join(dir, token);
  const tmp = `${abs}.tmp-${process.pid}`;
  await writeFile(tmp, buf);
  await rename(tmp, abs); // atomic publish, same volume.
  return token;
}

/** Resolve a `{ source: 'staged' }` ref to a guarded absolute path + metadata. */
export async function resolveStagedShare(
  token: string,
  displayName?: string,
): Promise<ResolvedShareFile> {
  if (!TOKEN_RE.test(token)) {
    throw new FileExplorerError('Invalid staged reference', 400);
  }
  const dir = shareStageDir();
  const abs = path.join(dir, token);
  // Containment: the resolved path must stay inside the staging dir.
  const rel = path.relative(dir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new FileExplorerError('Path is outside the staging folder', 403);
  }
  const st = await stat(abs).catch(() => {
    throw new FileExplorerError('Staged file not found (it may have expired)', 404);
  });
  return {
    abs,
    size: st.size,
    name: displayName || token,
    fileType: token.endsWith('.png') ? 'image/png' : 'image/jpeg',
  };
}

/** Delete staged files older than the TTL. Age comes from the filename — no stat. */
async function sweepExpired(dir: string): Promise<void> {
  try {
    const now = Date.now();
    const names = await readdir(dir);
    await Promise.all(
      names.map(async (name) => {
        const m = /^(\d+)-/.exec(name);
        if (m && now - Number(m[1]) > TTL_MS) {
          await unlink(path.join(dir, name)).catch(() => {});
        }
      }),
    );
  } catch {
    /* best effort — a missing dir or racey unlink is harmless */
  }
}
