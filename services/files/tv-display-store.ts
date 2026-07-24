/**
 * TV signage store — the media folder and the settings file behind the
 * waiting-room slideshow.
 *
 * Owned by two routes with deliberately different postures, which is exactly why
 * this module exists (they must agree on paths, ordering, and the allow-list):
 *   - routes/public/tv-display.routes.ts — session-less reads for the TV browser
 *     and the LG daemon (page, manifest, media stream, settings feed).
 *   - routes/api/tv-display.routes.ts    — authenticated writes from
 *     Settings → TV Display (edit settings, upload/delete/reorder media).
 *
 * NO DATABASE, BY DESIGN. Settings live in one JSON file beside the app's other
 * runtime state (`data/tv-display.settings.json`, override
 * `TV_DISPLAY_SETTINGS_FILE`) and the media are plain files on disk
 * (`tv-media/`, override `TV_DISPLAY_MEDIA_DIR`). Both are per-deployment
 * machine config rather than clinic data, and keeping them off the DB means the
 * waiting-room screen keeps playing through a database outage. Neither file ever
 * holds PHI — the folder must contain signage content only.
 *
 * Writes are atomic (temp file on the SAME volume → `rename`), so a crash or a
 * power cut mid-save can never leave a half-written settings file or a partial
 * media file where the TV can find it.
 */
import path from 'path';
import fs from 'fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { log } from '../../utils/logger.js';
import type { TvDisplaySettings } from '../../shared/contracts/tv-display.contract.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Media folder. Override per deployment with TV_DISPLAY_MEDIA_DIR; otherwise a
 * dedicated `tv-media` folder at the app root (kept separate from ./data, which
 * holds runtime state and is never served).
 */
export const MEDIA_DIR = process.env.TV_DISPLAY_MEDIA_DIR
  ? path.resolve(process.env.TV_DISPLAY_MEDIA_DIR)
  : path.join(process.cwd(), 'tv-media');

/** Settings file. Lives with the app's other runtime state, never served. */
export const SETTINGS_FILE = process.env.TV_DISPLAY_SETTINGS_FILE
  ? path.resolve(process.env.TV_DISPLAY_SETTINGS_FILE)
  : path.join(process.cwd(), 'data', 'tv-display.settings.json');

/** Uploads stage here (same volume as MEDIA_DIR) before an atomic rename in. */
export const UPLOAD_STAGE_DIR = path.join(MEDIA_DIR, '.uploads');

// ---------------------------------------------------------------------------
// What the webOS browser can render
// ---------------------------------------------------------------------------

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
export const VIDEO_EXT = new Set(['.mp4', '.webm', '.ogg']);

export const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
};

/** Sorted allow-list, for the upload picker's `accept` and error messages. */
export const ALLOWED_EXTENSIONS = [...IMAGE_EXT, ...VIDEO_EXT].sort();

export type MediaKind = 'image' | 'video';

export function classify(ext: string): MediaKind | null {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Shipped defaults — also the fallback whenever the file is missing, empty, or
 * corrupt, so a bad file can never take the screen down. They reproduce the
 * behavior the feature had before it was configurable (3 PM–9 PM, 7 s photos,
 * sound on at volume 15). No per-image overrides out of the box — every picture
 * uses `photoMs` until staff set one.
 */
export const DEFAULT_SETTINGS: TvDisplaySettings = {
  enabled: true,
  onHour: 15,
  onMinute: 0,
  offHour: 21,
  offMinute: 0,
  volume: 15,
  photoMs: 7000,
  photoMsByName: {},
  shuffle: false,
  fit: 'contain',
  sound: true,
};

/** One-shot actions staff trigger from the settings tab. */
export type TvDisplayCommandAction = 'on' | 'off' | 'reload';

interface StoredFile {
  settings: TvDisplaySettings;
}

/** Coerce one unknown JSON value into a valid settings object. */
function normalize(raw: unknown): TvDisplaySettings {
  const src = (raw ?? {}) as Partial<Record<keyof TvDisplaySettings, unknown>>;
  const int = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof v === 'number' ? Math.round(v) : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;

  // Per-image overrides: keep only finite, in-range values, clamped to the same
  // bounds as `photoMs`. A junk entry (bad key or value) is dropped rather than
  // failing the whole read — the screen matters more than one override.
  const overrides: Record<string, number> = {};
  const rawOverrides = src.photoMsByName;
  if (rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)) {
    for (const [name, value] of Object.entries(rawOverrides as Record<string, unknown>)) {
      if (!name) continue;
      const n = typeof value === 'number' ? Math.round(value) : NaN;
      if (Number.isFinite(n)) overrides[name] = Math.min(120_000, Math.max(1000, n));
    }
  }

  return {
    enabled: bool(src.enabled, DEFAULT_SETTINGS.enabled),
    onHour: int(src.onHour, 0, 23, DEFAULT_SETTINGS.onHour),
    onMinute: int(src.onMinute, 0, 59, DEFAULT_SETTINGS.onMinute),
    offHour: int(src.offHour, 0, 23, DEFAULT_SETTINGS.offHour),
    offMinute: int(src.offMinute, 0, 59, DEFAULT_SETTINGS.offMinute),
    volume: int(src.volume, 0, 100, DEFAULT_SETTINGS.volume),
    photoMs: int(src.photoMs, 1000, 120_000, DEFAULT_SETTINGS.photoMs),
    photoMsByName: overrides,
    shuffle: bool(src.shuffle, DEFAULT_SETTINGS.shuffle),
    fit: src.fit === 'cover' ? 'cover' : 'contain',
    sound: bool(src.sound, DEFAULT_SETTINGS.sound),
  };
}

/**
 * In-process cache of the settings file, validated against the file's mtime (one
 * cheap `stat`) rather than trusted blindly — a hand-edit of the JSON is then
 * picked up on the next read instead of surviving until a restart. Saves write
 * through both.
 */
let cached: StoredFile | null = null;
let cachedMtimeMs = -1;

async function load(): Promise<StoredFile> {
  // -1 = no file yet; the cache stays valid at that value too, so a missing
  // file doesn't re-parse defaults on every poll.
  const mtimeMs = await stat(SETTINGS_FILE).then(
    (s) => s.mtimeMs,
    () => -1
  );
  if (cached && mtimeMs === cachedMtimeMs) return cached;

  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8');
    // Strip a UTF-8 BOM: Notepad and PowerShell's Out-File write one by default
    // on Windows, and JSON.parse rejects it — this file is meant to survive a
    // hand-edit, so a BOM must not cost the clinic its settings.
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as { settings?: unknown };
    cached = { settings: normalize(parsed.settings) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      // Corrupt/unreadable file: fall back to defaults rather than failing the
      // request — the screen matters more than the customization.
      log.error('[TV Display] settings unreadable, using defaults', {
        file: SETTINGS_FILE,
        error: (error as Error).message,
      });
    }
    cached = { settings: { ...DEFAULT_SETTINGS } };
  }
  cachedMtimeMs = mtimeMs;
  return cached;
}

async function persist(next: StoredFile): Promise<void> {
  await mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await rename(tmp, SETTINGS_FILE);
  cached = next;
  try {
    cachedMtimeMs = (await stat(SETTINGS_FILE)).mtimeMs;
  } catch {
    cachedMtimeMs = -1; // force a re-read next time rather than trusting this
  }
}

export async function getSettings(): Promise<TvDisplaySettings> {
  return { ...(await load()).settings };
}

export async function saveSettings(settings: TvDisplaySettings): Promise<TvDisplaySettings> {
  const current = await load();
  const next = normalize(settings);
  await persist({ ...current, settings: next });
  log.info('[TV Display] settings updated', { settings: next });
  return { ...next };
}

/**
 * Drop a per-image dwell override once its file is gone, so a stale key can't
 * accumulate in the settings file (and can't reattach to a future upload that
 * happens to reuse the name). No-op when the file had no override.
 */
async function forgetDuration(name: string): Promise<void> {
  const key = path.basename(name);
  const current = await load();
  if (!(key in current.settings.photoMsByName)) return;
  const photoMsByName = { ...current.settings.photoMsByName };
  delete photoMsByName[key];
  await persist({ ...current, settings: { ...current.settings, photoMsByName } });
}

/**
 * Re-key per-image dwell overrides after a reorder renames files, so an override
 * follows its picture through the `01-`, `02-` renumbering. `rename` maps each
 * old filename to its new one; keys not in the map keep their name.
 */
async function remapDurations(rename: Map<string, string>): Promise<void> {
  const current = await load();
  const src = current.settings.photoMsByName;
  if (Object.keys(src).length === 0) return;
  const photoMsByName: Record<string, number> = {};
  let changed = false;
  for (const [name, ms] of Object.entries(src)) {
    const to = rename.get(name) ?? name;
    if (to !== name) changed = true;
    photoMsByName[to] = ms;
  }
  if (changed) await persist({ ...current, settings: { ...current.settings, photoMsByName } });
}

// ---------------------------------------------------------------------------
// Push — the TV page and the daemon each hold one SSE stream open
// ---------------------------------------------------------------------------
//
// NOTHING here polls. Both consumers connect once and are pushed a `state` frame
// on connect and again whenever staff change something, so a save reaches the
// screen in about a second at zero idle cost — no directory scans on a timer, no
// repeated HTTP. It also makes liveness *observed* rather than inferred: an open
// stream IS the proof that side is alive.

/** Which side of the feature a stream belongs to. */
export type SignageClientKind = 'page' | 'daemon';

/** The subset of `res` this module needs — keeps the store free of Express types. */
interface SseSink {
  write(chunk: string): boolean;
  end(): void;
}

interface SignageClient {
  kind: SignageClientKind;
  sink: SseSink;
  connectedAt: number;
}

const clients = new Set<SignageClient>();

/**
 * One shared keepalive for every stream: a comment frame under Caddy's ~30s idle
 * timeout, matching the app's other SSE channels. Started with the first client
 * and cleared with the last, so an idle clinic runs no timer at all.
 */
let heartbeat: NodeJS.Timeout | null = null;
const HEARTBEAT_MS = 25_000;

function startHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const client of clients) safeWrite(client, ':\n\n');
  }, HEARTBEAT_MS);
  // Never hold the process open for a keepalive.
  heartbeat.unref?.();
}

function stopHeartbeatIfIdle(): void {
  if (clients.size === 0 && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

/** Write to one stream, dropping it if the socket is already gone. */
function safeWrite(client: SignageClient, frame: string): void {
  try {
    client.sink.write(frame);
  } catch {
    clients.delete(client);
    stopHeartbeatIfIdle();
  }
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Register a stream. The caller must call the returned dispose on close/error. */
export function addClient(kind: SignageClientKind, sink: SseSink): () => void {
  const client: SignageClient = { kind, sink, connectedAt: Date.now() };
  clients.add(client);
  startHeartbeat();
  log.info('[TV Display] stream connected', { kind, streams: clients.size });
  return () => {
    if (clients.delete(client)) {
      log.info('[TV Display] stream closed', { kind, streams: clients.size });
    }
    stopHeartbeatIfIdle();
  };
}

/** Current playlist + settings — the payload of every `state` frame. */
export async function currentState(): Promise<{
  settings: TvDisplaySettings;
  items: { name: string; type: MediaKind }[];
}> {
  const [settings, items] = await Promise.all([getSettings(), listMedia()]);
  return { settings, items };
}

/** Send the current state to one stream (used right after it connects). */
export async function sendState(sink: SseSink): Promise<void> {
  const state = await currentState();
  sink.write(frame('state', state));
}

/**
 * Push the current state to every stream. Called after any write, so the TV and
 * the daemon apply changes immediately instead of discovering them later.
 */
export async function broadcastState(): Promise<void> {
  if (clients.size === 0) return;
  const state = await currentState();
  const payload = frame('state', state);
  for (const client of clients) safeWrite(client, payload);
}

/**
 * Push a one-shot command to the daemon(s). Returns false when no daemon stream
 * is connected — nothing is queued, and the caller tells the user plainly rather
 * than letting a button silently do nothing.
 */
export function broadcastCommand(action: TvDisplayCommandAction): boolean {
  const payload = frame('command', { action });
  let delivered = false;
  for (const client of clients) {
    if (client.kind !== 'daemon') continue;
    safeWrite(client, payload);
    delivered = true;
  }
  log.info('[TV Display] command pushed', { action, delivered });
  return delivered;
}

/** Live connection state, for the settings tab's status card. */
export function getConnections(): {
  pageConnected: boolean;
  pageSince: string | null;
  daemonConnected: boolean;
  daemonSince: string | null;
} {
  let page: number | null = null;
  let daemon: number | null = null;
  for (const client of clients) {
    // Oldest connection of each kind wins: "connected since" should not reset
    // if a second viewer (e.g. a preview iframe) joins later.
    if (client.kind === 'page') page = page === null ? client.connectedAt : Math.min(page, client.connectedAt);
    else daemon = daemon === null ? client.connectedAt : Math.min(daemon, client.connectedAt);
  }
  return {
    pageConnected: page !== null,
    pageSince: page === null ? null : new Date(page).toISOString(),
    daemonConnected: daemon !== null,
    daemonSince: daemon === null ? null : new Date(daemon).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Media folder
// ---------------------------------------------------------------------------

export interface MediaEntry {
  name: string;
  type: MediaKind;
  sizeBytes: number;
  modifiedAt: string;
}

/** Play order: filename, numeric-aware so `2-x.jpg` sorts before `10-x.jpg`. */
function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Renderable files in play order — the TV's hot path. A missing folder is not an
 * error: it yields an empty list so the page shows its placeholder and keeps
 * polling. Type comes straight off the `Dirent`, with no per-file `stat` (see
 * CLAUDE.md "Filesystem discipline").
 */
export async function listMedia(): Promise<{ name: string; type: MediaKind }[]> {
  let entries: fs.Dirent[];
  try {
    entries = await readdir(MEDIA_DIR, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  return entries
    .filter((e) => e.isFile())
    .map((e) => ({ name: e.name, type: classify(path.extname(e.name).toLowerCase()) }))
    .filter((x): x is { name: string; type: MediaKind } => x.type !== null)
    .sort((a, b) => byName(a.name, b.name));
}

/**
 * Files in the folder the TV can't play — a real file, non-dotfile, whose
 * extension isn't on the allow-list (HEIC, MKV, a stray .txt, …). These are
 * silently skipped by `listMedia`, which is exactly why the management UI wants
 * to name them: otherwise "I dropped a file and it won't show" has no explanation.
 * Dotfiles and the `.uploads` staging dir are internal and never counted (both
 * start with `.` or aren't files). Management-UI only — the TV never calls this.
 */
export async function listUnsupportedFiles(): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await readdir(MEDIA_DIR, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  return entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .filter((name) => classify(path.extname(name).toLowerCase()) === null)
    .sort(byName);
}

/**
 * The same list plus size/mtime — one `stat` per file, so this is for the
 * management UI only, never the TV's poll.
 */
export async function listMediaDetailed(): Promise<MediaEntry[]> {
  const playable = await listMedia();
  return Promise.all(
    playable.map(async (item): Promise<MediaEntry> => {
      try {
        const s = await stat(path.join(MEDIA_DIR, item.name));
        return { ...item, sizeBytes: s.size, modifiedAt: s.mtime.toISOString() };
      } catch {
        return { ...item, sizeBytes: 0, modifiedAt: new Date(0).toISOString() };
      }
    })
  );
}

/**
 * Absolute path of a media file, or '' when the name escapes MEDIA_DIR or is not
 * a renderable type. Every disk operation in this module and in the routes goes
 * through this guard (path traversal via `..`, absolute paths, and UNC alike).
 */
export function mediaFilePath(name: string): string {
  const requested = path.basename(name);
  if (!requested || requested === '.' || requested === '..') return '';
  if (!classify(path.extname(requested).toLowerCase())) return '';
  const abs = path.join(MEDIA_DIR, requested);
  const rel = path.relative(MEDIA_DIR, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return '';
  return abs;
}

/**
 * Make an uploaded filename safe to sit in a folder that is served over HTTP:
 * basename only, spaces and separators collapsed, anything outside a conservative
 * set replaced, length capped, extension normalized to lower case. Returns ''
 * when the extension is not renderable.
 */
export function sanitizeUploadName(original: string): string {
  const base = path.basename(original || '');
  const ext = path.extname(base).toLowerCase();
  if (!classify(ext)) return '';
  const stem = base
    .slice(0, base.length - path.extname(base).length)
    .replace(/[^\w\-. ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${stem || 'media'}${ext}`;
}

/** `name.jpg` → `name-2.jpg` → `name-3.jpg` … until nothing is in the way. */
async function uniqueName(name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 2; n < 1000; n++) {
    const abs = path.join(MEDIA_DIR, candidate);
    try {
      await stat(abs);
    } catch {
      return candidate; // free
    }
    candidate = `${stem}-${n}${ext}`;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * Move one staged upload into the media folder under a safe, unique name.
 * The staging dir is inside MEDIA_DIR, so this rename never crosses volumes
 * (no EXDEV on a network-mounted deployment).
 */
export async function commitUpload(stagedPath: string, originalName: string): Promise<string> {
  const safe = sanitizeUploadName(originalName);
  if (!safe) {
    await unlink(stagedPath).catch(() => {});
    throw new Error(`Unsupported file type: ${path.extname(originalName) || originalName}`);
  }
  await mkdir(MEDIA_DIR, { recursive: true });
  const finalName = await uniqueName(safe);
  await rename(stagedPath, path.join(MEDIA_DIR, finalName));
  log.info('[TV Display] media added', { name: finalName });
  return finalName;
}

export async function deleteMedia(name: string): Promise<boolean> {
  const abs = mediaFilePath(name);
  if (!abs) return false;
  try {
    await unlink(abs);
    await forgetDuration(name);
    log.info('[TV Display] media deleted', { name: path.basename(name) });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Rewrite play order by renumbering filename prefixes to match `names`
 * (`01-clip.mp4`, `02-slide.jpg`, …) — the folder's own sort order IS the
 * playlist, so ordering has to live in the filenames for the manual
 * drop-files-in-a-folder workflow to keep working alongside this UI.
 *
 * Two-phase (everything to a temp name first) so a swap can't collide with a
 * name it is about to free. Files not named in `names` keep their current name
 * and sort after the renumbered ones.
 */
export async function reorderMedia(names: string[]): Promise<void> {
  const present = new Set((await listMedia()).map((m) => m.name));
  const ordered = names.filter((n) => present.has(path.basename(n)));
  if (ordered.length === 0) return;

  const width = String(ordered.length).length < 2 ? 2 : String(ordered.length).length;
  const staged: { tmp: string; final: string }[] = [];
  // old filename → new filename, so per-image dwell overrides can follow the file.
  const renamed = new Map<string, string>();

  for (const [i, name] of ordered.entries()) {
    const from = mediaFilePath(name);
    if (!from) continue;
    const base = path.basename(name).replace(/^\d+[-_ ]*/, '');
    const finalName = `${String(i + 1).padStart(width, '0')}-${base}`;
    if (finalName === path.basename(name)) continue; // already correct
    renamed.set(path.basename(name), finalName);
    const tmp = path.join(MEDIA_DIR, `.reorder-${process.pid}-${i}-${base}`);
    await rename(from, tmp);
    staged.push({ tmp, final: path.join(MEDIA_DIR, finalName) });
  }

  for (const { tmp, final } of staged) {
    await rename(tmp, final);
  }
  if (staged.length) {
    await remapDurations(renamed);
    log.info('[TV Display] media reordered', { count: staged.length });
  }
}
