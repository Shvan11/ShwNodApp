/**
 * Patient file-explorer service — all filesystem logic + safety for the
 * per-patient file browser. Every disk operation flows through `resolveSafe`
 * (pure path math + containment) and, where the target must already exist,
 * `realpathGuard` (symlink-escape defence). See the plan / CLAUDE.md
 * "Deployment & environments" for the cross-platform + same-volume staging
 * constraints this file is written against. Note: on the current deployment the
 * patient volume is the server's LOCAL disk (`MACHINE_PATH=C:` → `C:\clinic1`),
 * so the stat/volume notes below are portability insurance for WSL `/mnt/c`
 * (drvfs) and a future network-mounted server — not a cost paid in prod today.
 */
import fs from 'fs/promises';
import path from 'path';
import { clinicPath, patientDir } from './clinic-paths.js';
import { getFileCategory, type FileCategory } from '../../utils/file-mime.js';

// ===========================================
// TYPES
// ===========================================

export type FileEntryType = 'file' | 'dir' | 'symlink';

export interface FileEntry {
  name: string;
  /** Path relative to the patient root, web-style `/` separators. */
  relPath: string;
  type: FileEntryType;
  /** Bytes — present in browse mode, omitted in flat mode (per-file stat cost on remote/drvfs mounts). */
  size?: number;
  /** ISO mtime — present in browse mode, omitted in flat mode. */
  modified?: string;
  ext: string;
  category: FileCategory;
}

export interface FileListing {
  /** The browsed path relative to the patient root (`''` = root). */
  path: string;
  /** Parent relPath, or null at the root. */
  parent: string | null;
  flat: boolean;
  truncated: boolean;
  entries: FileEntry[];
}

/** Error carrying an HTTP status for the route layer to map to ErrorResponses. */
export class FileExplorerError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'FileExplorerError';
    this.status = status;
  }
}

// ===========================================
// CONSTANTS
// ===========================================

const MAX_DEPTH = 12;
const MAX_ENTRIES = 5000;
/** App-managed infra dirs that must never surface in a patient listing. */
const INFRA_DIRS = new Set(['.trash', '.thumbs', '.uploads']);

/** Trash root: sibling of the numeric patient folders, same volume. */
const TRASH_ROOT = clinicPath('.trash');
/** Upload staging root: sibling of patient folders, same volume, so the
 *  final rename into a patient folder is atomic + EXDEV-free. */
const UPLOADS_ROOT = clinicPath('.uploads');

// ===========================================
// PATH SAFETY
// ===========================================

export interface SafePath {
  root: string;
  abs: string;
}

function patientRoot(personId: string | number): string {
  return patientDir(personId);
}

function withSep(dir: string): string {
  return dir.endsWith(path.sep) ? dir : dir + path.sep;
}

/**
 * The security chokepoint — pure path math, NO `fs` calls. Validates the
 * patient id, normalizes a web-style relative path, resolves it under the
 * patient root, and asserts containment using the platform separator
 * (`\` on Windows, `/` on posix). Throws FileExplorerError on any violation.
 */
export function resolveSafe(personId: string | number, relPath = ''): SafePath {
  if (!/^\d+$/.test(String(personId))) {
    throw new FileExplorerError('Invalid patient id', 400);
  }
  const root = patientRoot(personId);

  let rel: string;
  try {
    rel = decodeURIComponent(relPath || '');
  } catch {
    throw new FileExplorerError('Malformed path', 400);
  }
  if (rel.includes('\0')) {
    throw new FileExplorerError('Invalid path', 400);
  }
  // Accept web-style separators from the client; strip leading slashes so the
  // value can never be treated as absolute by path.resolve.
  rel = rel.replace(/\\/g, '/').replace(/^\/+/, '');

  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(withSep(root))) {
    throw new FileExplorerError('Path is outside the patient folder', 403);
  }
  return { root, abs };
}

/**
 * Symlink-escape guard for a target that MUST already exist. Resolves real
 * paths and re-checks containment, so a symlink pointing outside the patient
 * root is rejected. Returns the real (canonical) absolute path.
 */
async function realpathGuard(abs: string, root: string): Promise<string> {
  let real: string;
  let realRoot: string;
  try {
    real = await fs.realpath(abs);
    realRoot = await fs.realpath(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FileExplorerError('Not found', 404);
    }
    throw err;
  }
  if (real !== realRoot && !real.startsWith(withSep(realRoot))) {
    throw new FileExplorerError('Path is outside the patient folder', 403);
  }
  return real;
}

/** Guard the PARENT of a not-yet-existing create/upload/rename target. */
async function realpathGuardParent(abs: string, root: string): Promise<void> {
  await realpathGuard(path.dirname(abs), root);
}

// ===========================================
// SMALL HELPERS
// ===========================================

function normalizeRel(relPath: string | undefined): string {
  return (relPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function joinRel(relPath: string | undefined, name: string): string {
  const base = normalizeRel(relPath);
  return base ? `${base}/${name}` : name;
}

function parentOf(relPath: string | undefined): string | null {
  const norm = normalizeRel(relPath);
  if (!norm) return null;
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '' : norm.slice(0, idx);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Bounded-concurrency map — keeps us from firing thousands of parallel stats. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Filename / folder-name sanitizer — a single path segment, safe on BOTH
 * Windows and posix. Throws FileExplorerError(400) on anything suspicious.
 */
export function sanitizeName(name: string): string {
  const n = (name ?? '').trim();
  if (!n || n === '.' || n === '..') {
    throw new FileExplorerError('Invalid name', 400);
  }
  if (!/^[^/\\\0]+$/.test(n)) {
    throw new FileExplorerError('Name cannot contain path separators', 400);
  }
  // Windows-hostile bits: ':' (drive / alternate-data-stream), trailing dot or
  // space (Windows silently strips them), and reserved device names.
  if (n.includes(':')) {
    throw new FileExplorerError('Name cannot contain ":"', 400);
  }
  if (/[ .]$/.test(n)) {
    throw new FileExplorerError('Name cannot end with a space or dot', 400);
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(n)) {
    throw new FileExplorerError('Reserved name', 400);
  }
  return n;
}

// ===========================================
// LISTING
// ===========================================

/**
 * Browse a single directory. Type comes from the Dirent (no stat); size/mtime
 * come from a bounded-parallel `lstat`. App infra dirs are filtered out.
 */
export async function listDirectory(
  personId: string | number,
  relPath = ''
): Promise<FileListing> {
  const { root, abs } = resolveSafe(personId, relPath);
  await realpathGuard(abs, root);

  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const visible = dirents.filter((d) => !INFRA_DIRS.has(d.name));

  const entries = await mapLimit(visible, 32, async (d): Promise<FileEntry> => {
    const type: FileEntryType = d.isSymbolicLink()
      ? 'symlink'
      : d.isDirectory()
        ? 'dir'
        : 'file';

    let size: number | undefined;
    let modified: string | undefined;
    try {
      const st = await fs.lstat(path.join(abs, d.name));
      modified = st.mtime.toISOString();
      if (st.isFile()) size = st.size;
    } catch {
      /* entry vanished between readdir and lstat — report it without metadata */
    }

    return {
      name: d.name,
      relPath: joinRel(relPath, d.name),
      type,
      size,
      modified,
      ext: path.extname(d.name).toLowerCase(),
      category: type === 'file' ? getFileCategory(d.name) : 'other',
    };
  });

  const norm = normalizeRel(relPath);
  return { path: norm, parent: parentOf(relPath), flat: false, truncated: false, entries };
}

/**
 * Recursively flatten a subtree into a file-only list. Streams via `opendir`,
 * emits names/types straight from the Dirent (NO per-file lstat — that cost
 * bites on remote/drvfs mounts), skips symlinked dirs, and stops at the
 * depth/entry caps.
 */
export async function walkFlat(
  personId: string | number,
  relPath = ''
): Promise<FileListing> {
  const { root, abs } = resolveSafe(personId, relPath);
  await realpathGuard(abs, root);

  const entries: FileEntry[] = [];
  let truncated = false;

  async function walk(dirAbs: string, dirRel: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let dir;
    try {
      dir = await fs.opendir(dirAbs);
    } catch {
      return; // unreadable dir — skip rather than fail the whole walk
    }
    // The async iterator closes the Dir handle when the loop exits (including
    // via `return`), so no explicit close is needed here.
    for await (const d of dir) {
      if (entries.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      if (INFRA_DIRS.has(d.name) || d.isSymbolicLink()) continue;

      const childRel = joinRel(dirRel, d.name);
      if (d.isDirectory()) {
        await walk(path.join(dirAbs, d.name), childRel, depth + 1);
        if (truncated) return;
      } else if (d.isFile()) {
        entries.push({
          name: d.name,
          relPath: childRel,
          type: 'file',
          ext: path.extname(d.name).toLowerCase(),
          category: getFileCategory(d.name),
        });
      }
    }
  }

  const norm = normalizeRel(relPath);
  await walk(abs, norm, 0);
  return { path: norm, parent: parentOf(relPath), flat: true, truncated, entries };
}

// ===========================================
// CONTENT (path resolution for the route's res.sendFile)
// ===========================================

/**
 * Resolve + guard a file for serving. Returns the real absolute path and the
 * stat. Throws 404 if missing, 400 if it's a directory.
 */
export async function resolveFileForServe(
  personId: string | number,
  relPath: string
): Promise<{ abs: string; size: number; mtimeMs: number }> {
  const { root, abs } = resolveSafe(personId, relPath);
  const real = await realpathGuard(abs, root);
  const st = await fs.stat(real);
  if (st.isDirectory()) {
    throw new FileExplorerError('Path is a directory', 400);
  }
  return { abs: real, size: st.size, mtimeMs: st.mtimeMs };
}

// ===========================================
// WRITES
// ===========================================

export async function createFolder(
  personId: string | number,
  relPath: string,
  name: string
): Promise<FileEntry> {
  const safeName = sanitizeName(name);
  const { root, abs } = resolveSafe(personId, joinRel(relPath, safeName));
  // Bootstrap the patient root if this is the patient's first folder — a brand-new
  // patient has no `clinic1/{personId}` dir yet, which would otherwise make the
  // parent guard below throw 404. Only the (safe, validated) root is auto-created;
  // nested parents still must exist (non-recursive create semantics preserved).
  if (normalizeRel(relPath) === '') {
    await fs.mkdir(root, { recursive: true });
  }
  await realpathGuardParent(abs, root);
  try {
    await fs.mkdir(abs); // non-recursive: fails if parent missing
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new FileExplorerError('A file or folder with that name already exists', 409);
    }
    throw err;
  }
  return {
    name: safeName,
    relPath: joinRel(relPath, safeName),
    type: 'dir',
    ext: '',
    category: 'other',
  };
}

export async function renameEntry(
  personId: string | number,
  relPath: string,
  newName: string
): Promise<FileEntry> {
  const safeName = sanitizeName(newName);
  const src = resolveSafe(personId, relPath);
  if (src.abs === src.root) {
    throw new FileExplorerError('Cannot rename the patient root', 400);
  }
  await realpathGuard(src.abs, src.root);

  const destRel = joinRel(parentOf(relPath) ?? '', safeName);
  const dest = resolveSafe(personId, destRel);
  await realpathGuardParent(dest.abs, dest.root);

  if (await exists(dest.abs)) {
    throw new FileExplorerError('A file or folder with that name already exists', 409);
  }
  await fs.rename(src.abs, dest.abs);

  const st = await fs.lstat(dest.abs);
  const type: FileEntryType = st.isSymbolicLink()
    ? 'symlink'
    : st.isDirectory()
      ? 'dir'
      : 'file';
  return {
    name: safeName,
    relPath: destRel,
    type,
    size: st.isFile() ? st.size : undefined,
    modified: st.mtime.toISOString(),
    ext: path.extname(safeName).toLowerCase(),
    category: type === 'file' ? getFileCategory(safeName) : 'other',
  };
}

/**
 * Soft delete — move the entry into `clinic1/.trash/{personId}/{timestamp}/`.
 * Same volume as the source, so the rename is atomic; recoverable; never
 * surfaced in a listing.
 */
export async function softDelete(personId: string | number, relPath: string): Promise<void> {
  const { root, abs } = resolveSafe(personId, relPath);
  if (abs === root) {
    throw new FileExplorerError('Cannot delete the patient root', 400);
  }
  await realpathGuard(abs, root);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trashDir = path.join(TRASH_ROOT, String(personId), stamp);
  await fs.mkdir(trashDir, { recursive: true });
  await fs.rename(abs, path.join(trashDir, path.basename(abs)));
}

/** One entry's outcome in a {@link softDeleteBatch}. */
export interface BatchDeleteItemResult {
  relPath: string;
  ok: boolean;
  /** Present when ok === false. */
  error?: string;
}

export interface BatchDeleteResult {
  results: BatchDeleteItemResult[];
  succeeded: number;
  failed: number;
}

/**
 * Soft-delete many entries into ONE shared trash stamp dir
 * (`clinic1/.trash/{personId}/{timestamp}/`), so the whole batch lands together
 * and could be restored as a unit. Each entry rides the same guards as
 * `softDelete` (in-root + symlink-escape, patient-root refused); a per-item
 * failure is captured rather than aborting the batch. Basename collisions
 * inside the shared dir (two same-named files from different subfolders) are
 * de-duped with a ` (n)` suffix so the second never clobbers the first. The
 * stamp dir is removed if nothing landed, to avoid littering empty folders.
 *
 * Moving a folder is a single rename regardless of subtree size (same
 * volume), so batch cost scales with the number of selected entries, not their
 * contents.
 */
export async function softDeleteBatch(
  personId: string | number,
  relPaths: string[]
): Promise<BatchDeleteResult> {
  if (!/^\d+$/.test(String(personId))) {
    throw new FileExplorerError('Invalid patient id', 400);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trashDir = path.join(TRASH_ROOT, String(personId), stamp);
  await fs.mkdir(trashDir, { recursive: true });

  // Reserve a unique landing name per item. The check+reserve is synchronous
  // (no await between `has` and `add`), so concurrent workers can't race it.
  const usedNames = new Set<string>();
  const reserveName = (base: string): string => {
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    let i = 1;
    let candidate = `${stem} (${i})${ext}`;
    while (usedNames.has(candidate)) {
      candidate = `${stem} (${++i})${ext}`;
    }
    usedNames.add(candidate);
    return candidate;
  };

  const results = await mapLimit(relPaths, 16, async (relPath): Promise<BatchDeleteItemResult> => {
    try {
      const { root, abs } = resolveSafe(personId, relPath);
      if (abs === root) {
        throw new FileExplorerError('Cannot delete the patient root', 400);
      }
      await realpathGuard(abs, root);
      await fs.rename(abs, path.join(trashDir, reserveName(path.basename(abs))));
      return { relPath, ok: true };
    } catch (err) {
      return {
        relPath,
        ok: false,
        error: err instanceof FileExplorerError ? err.message : 'Delete failed',
      };
    }
  });

  const succeeded = results.filter((r) => r.ok).length;
  if (succeeded === 0) {
    await fs.rm(trashDir, { recursive: true, force: true }).catch(() => {});
  }
  return { results, succeeded, failed: results.length - succeeded };
}

/**
 * Existence check for an entry under the patient root. Pure existence (one
 * `stat`); `resolveSafe` still enforces containment, so it can't probe outside
 * the patient folder. ENOENT → false. Cheap enough for an on-demand check.
 */
export async function entryExists(personId: string | number, relPath: string): Promise<boolean> {
  const { abs } = resolveSafe(personId, relPath);
  try {
    await fs.stat(abs);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Hard delete — permanently remove the entry (recursive). Unlike `softDelete`
 * (which moves to `.trash`), this is unrecoverable. Same guards: in-root +
 * symlink-escape, and the patient root itself is refused. Idempotent: a missing
 * target is a no-op (so callers can delete "the folder if it exists" cleanly).
 */
export async function hardDelete(personId: string | number, relPath: string): Promise<void> {
  const { root, abs } = resolveSafe(personId, relPath);
  if (abs === root) {
    throw new FileExplorerError('Cannot delete the patient root', 400);
  }
  try {
    await realpathGuard(abs, root);
  } catch (err) {
    if (err instanceof FileExplorerError && err.status === 404) return; // already gone
    throw err;
  }
  await fs.rm(abs, { recursive: true, force: true });
}

/**
 * Permanently remove a patient's ENTIRE folder (`clinic1/{personId}`) — used when
 * the patient record itself is deleted. Unlike `hardDelete` (which refuses the
 * patient root), this targets the root on purpose. Unrecoverable. Idempotent: a
 * missing folder is a no-op (`force: true`), so it's safe for patients that never
 * had any files on the share.
 */
export async function deletePatientFolder(personId: string | number): Promise<void> {
  if (!/^\d+$/.test(String(personId))) {
    throw new FileExplorerError('Invalid patient id', 400);
  }
  const root = patientRoot(personId);
  await fs.rm(root, { recursive: true, force: true });
}

// ===========================================
// UPLOAD (multer helpers — staged in-place to dodge EXDEV)
// ===========================================

/** Validate the directory an upload TARGETS (must exist + be in-root). */
export async function validateUploadTargetDir(
  personId: string | number,
  relPath: string
): Promise<string> {
  const { root, abs } = resolveSafe(personId, relPath);
  await realpathGuard(abs, root); // dir must exist
  return abs;
}

/**
 * Staging dir for in-flight uploads: `clinic1/.uploads/{personId}` — a sibling
 * of the patient folder (so temp files never appear in a listing) but on the
 * same volume (so the finalize rename into the patient folder is atomic,
 * never `EXDEV`). Used as multer's `destination`.
 */
export async function getUploadStagingDir(personId: string | number): Promise<string> {
  if (!/^\d+$/.test(String(personId))) {
    throw new FileExplorerError('Invalid patient id', 400);
  }
  const dir = path.join(UPLOADS_ROOT, String(personId));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Finalize an upload: pick a safe, non-clobbering name and rename the multer
 * temp file (in the staging dir) into the target directory. Returns the entry.
 */
export async function finalizeUpload(
  personId: string | number,
  relPath: string,
  tempAbs: string,
  originalName: string,
  overwrite: boolean
): Promise<FileEntry> {
  const dirAbs = await validateUploadTargetDir(personId, relPath);

  const safe = sanitizeName(path.basename(originalName));
  let finalName = safe;
  if (!overwrite) {
    const ext = path.extname(safe);
    const stem = safe.slice(0, safe.length - ext.length);
    let i = 1;
    while (await exists(path.join(dirAbs, finalName))) {
      finalName = `${stem} (${i++})${ext}`;
    }
  }

  const finalAbs = path.join(dirAbs, finalName);
  await fs.rename(tempAbs, finalAbs);

  const st = await fs.stat(finalAbs);
  return {
    name: finalName,
    relPath: joinRel(relPath, finalName),
    type: 'file',
    size: st.size,
    modified: st.mtime.toISOString(),
    ext: path.extname(finalName).toLowerCase(),
    category: getFileCategory(finalName),
  };
}
