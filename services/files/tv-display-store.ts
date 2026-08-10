/**
 * TV signage store — the media folder and the settings file behind the
 * waiting-room slideshow.
 *
 * Owned by two routes with deliberately different postures, which is exactly why
 * this module exists (they must agree on paths, ordering, and the allow-list):
 *   - routes/public/tv-display.routes.ts — session-less reads for the TV browser
 *     and the LG daemon (page, manifest, media stream, settings feed).
 *   - routes/api/tv-display.routes.ts    — authenticated writes from
 *     Settings → TV Display (edit settings, upload/delete media, edit the playlist).
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

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.ogg']);

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
const DEFAULT_SETTINGS: TvDisplaySettings = {
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
  /**
   * The play sequence: ordered media filenames, repeats allowed, the single
   * source of truth for what the TV plays. `null` means "never initialized" —
   * an older settings file from before playlists existed. The first time the
   * management side needs it (`ensurePlaylist`), it is seeded ONCE from the
   * folder's current filename order so an existing deployment keeps playing its
   * content, then it is authoritative (dropping a new file no longer auto-plays
   * it — the tab prompts to add it). The public/TV read path treats `null` as
   * "fall back to folder order" WITHOUT persisting, so it never writes.
   */
  playlist: string[] | null;
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
 * Coerce the stored playlist. A real array → its string entries reduced to
 * basenames (defence in depth: the play sequence can never carry a path), with
 * order and repeats preserved and empties dropped. Anything else (absent key,
 * wrong type) → `null`, the "never initialized, seed me from the folder" marker.
 * Membership against actual files is a render-time concern, not enforced here —
 * a dangling entry is kept so the tab can surface it rather than silently losing it.
 */
function normalizePlaylist(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((n): n is string => typeof n === 'string')
    .map((n) => path.basename(n))
    .filter((n) => n && n !== '.' && n !== '..');
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
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as {
      settings?: unknown;
      playlist?: unknown;
    };
    cached = {
      settings: normalize(parsed.settings),
      playlist: normalizePlaylist(parsed.playlist),
    };
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
    // `playlist: null` = not yet initialized; the folder order stands in until
    // the management side seeds it (see `ensurePlaylist`).
    cached = { settings: { ...DEFAULT_SETTINGS }, playlist: null };
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

/**
 * Serializes every read-modify-write of the settings file onto one promise chain.
 *
 * Each mutation below is `load()` → compute → `persist()`, and the whole file is
 * rewritten wholesale, so two overlapping mutations would both read the same
 * snapshot and the second would silently discard the first's change (delete a
 * media file while a settings save is in flight and the playlist prune vanishes).
 * The chain is per-process, which is the right scope: one Windows service owns
 * this file, and `load()` still revalidates against the file's mtime so an
 * outside hand-edit is picked up rather than overwritten blindly.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  // Swallow the predecessor's rejection so one failed write can't poison the
  // queue for every later one; the original caller still sees its own error.
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => undefined);
  return run;
}

/** Deep-ish copy: `photoMsByName` must not hand out the cached object itself. */
function copySettings(s: TvDisplaySettings): TvDisplaySettings {
  return { ...s, photoMsByName: { ...s.photoMsByName } };
}

export async function getSettings(): Promise<TvDisplaySettings> {
  return copySettings((await load()).settings);
}

export async function saveSettings(settings: TvDisplaySettings): Promise<TvDisplaySettings> {
  return serialize(async () => {
    const current = await load();
    const next = normalize(settings);
    await persist({ ...current, settings: next });
    log.info('[TV Display] settings updated', { settings: next });
    return copySettings(next);
  });
}

/**
 * Drop a per-image dwell override once its file is gone, so a stale key can't
 * accumulate in the settings file (and can't reattach to a future upload that
 * happens to reuse the name). No-op when the file had no override.
 */
async function forgetDuration(name: string): Promise<void> {
  return serialize(async () => {
    const key = path.basename(name);
    const current = await load();
    if (!(key in current.settings.photoMsByName)) return;
    const photoMsByName = { ...current.settings.photoMsByName };
    delete photoMsByName[key];
    await persist({ ...current, settings: { ...current.settings, photoMsByName } });
  });
}

// ---------------------------------------------------------------------------
// Playlist — the ordered play sequence (repeats allowed), the single source of
// truth for what the TV plays. Order lives HERE, not in filename prefixes, so
// files are never renamed and one file can appear many times with no duplicate
// on disk. See the StoredFile.playlist doc for the null/seed semantics.
// ---------------------------------------------------------------------------

/**
 * The management playlist: the authoritative ordered sequence, seeded ONCE from
 * the folder's filename order the first time it's needed (the upgrade path — an
 * existing deployment keeps playing its content), then strict. Called only from
 * the authenticated management side, so the seed's write never happens on the
 * public/TV read path.
 */
export async function ensurePlaylist(): Promise<string[]> {
  return serialize(async () => {
    const stored = await load();
    if (stored.playlist !== null) return [...stored.playlist];
    const seeded = (await listMedia()).map((m) => m.name);
    await persist({ ...stored, playlist: seeded });
    log.info('[TV Display] playlist seeded from folder', { count: seeded.length });
    return seeded;
  });
}

/**
 * The play sequence the TV actually renders: stored order, each entry resolved
 * to its media type and dangling entries (file gone) dropped. Repeats are kept —
 * a name listed twice plays twice. Read-only: when the playlist was never
 * initialized (`null`), it stands in the folder's own order so the screen keeps
 * playing before the tab is ever opened, WITHOUT persisting anything here.
 */
export async function resolvedPlaylist(): Promise<{ name: string; type: MediaKind }[]> {
  const [stored, library] = await Promise.all([load(), listMedia()]);
  const typeByName = new Map(library.map((m) => [m.name, m.type]));
  const order = stored.playlist ?? library.map((m) => m.name);
  const out: { name: string; type: MediaKind }[] = [];
  for (const name of order) {
    const type = typeByName.get(name);
    if (type) out.push({ name, type }); // skip dangling references
  }
  return out;
}

/**
 * Replace the whole play sequence (reorder / add / remove-one-instance /
 * duplicate are all computed by the caller and sent wholesale). Basename-
 * sanitized, order and repeats preserved; dangling entries are NOT filtered out
 * here — the TV skips them and the tab flags them, so nothing vanishes silently.
 */
export async function savePlaylist(names: string[]): Promise<string[]> {
  return serialize(async () => {
    const current = await load();
    const cleaned = names
      .map((n) => path.basename(String(n)))
      .filter((n) => n && n !== '.' && n !== '..');
    await persist({ ...current, playlist: cleaned });
    log.info('[TV Display] playlist updated', { count: cleaned.length });
    return cleaned;
  });
}

/**
 * Append a just-uploaded file to the play sequence — an upload through the tab is
 * an explicit "I want this played" act (a file dropped into the folder by hand,
 * which never calls this, is the case that only prompts). When the playlist was
 * never initialized, seed it from the folder instead: the new file is already in
 * that snapshot, so seeding both migrates AND includes it without duplicating.
 */
async function addUploadedToPlaylist(name: string): Promise<void> {
  return serialize(async () => {
    const current = await load();
    if (current.playlist === null) {
      const seeded = (await listMedia()).map((m) => m.name);
      await persist({ ...current, playlist: seeded });
      return;
    }
    await persist({ ...current, playlist: [...current.playlist, path.basename(name)] });
  });
}

/**
 * Drop every instance of a file from the play sequence once its file is deleted,
 * so a deleted file can't linger as a dangling reference. No-op when the playlist
 * was never initialized (nothing persisted to prune) or the file isn't listed.
 */
async function removeFromPlaylist(name: string): Promise<void> {
  return serialize(async () => {
    const current = await load();
    if (current.playlist === null) return;
    const base = path.basename(name);
    const next = current.playlist.filter((n) => n !== base);
    if (next.length !== current.playlist.length) {
      await persist({ ...current, playlist: next });
    }
  });
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

/**
 * The subset of `res` this module needs — keeps the store free of Express types.
 *
 * `destroyed` is load-bearing, not decoration: it is the ONLY reliable liveness
 * signal here (see `safeWrite`). Optional so a plain test double stays valid.
 */
interface SseSink {
  write(chunk: string): boolean;
  end(): void;
  readonly destroyed?: boolean;
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
    // Snapshot: safeWrite can drop a client mid-loop. Doubles as the sweep that
    // reaps streams whose 'close' never fired.
    for (const client of [...clients]) safeWrite(client, ':\n\n');
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

/** Forget a stream whose socket is gone. Idempotent with `addClient`'s dispose. */
function dropClient(client: SignageClient, reason: string): void {
  if (clients.delete(client)) {
    log.info('[TV Display] stream dropped', { kind: client.kind, reason, streams: clients.size });
  }
  stopHeartbeatIfIdle();
}

/**
 * Write one frame to a stream. Returns whether it reached a LIVE stream, and
 * drops the client when it did not — so a caller that reports delivery to the
 * user (`broadcastCommand`) can tell the truth.
 *
 * The branches below follow measured `http.ServerResponse` behaviour, not
 * intuition:
 *   - `write()` NEVER throws on a dead stream — not when the client vanished, not
 *     after the response was ended. It returns `false`.
 *   - It ALSO returns `false` under ordinary backpressure on a perfectly healthy
 *     stream (a slow TV over the tunnel), where the frame IS buffered and does
 *     get sent.
 * So the return value cannot distinguish "gone" from "slow", and treating
 * `false` as failure would drop healthy screens mid-slideshow. `destroyed` is
 * true in exactly the dead cases and false under backpressure, so it is the
 * discriminator. The try/catch remains as a guard for a non-Node sink.
 */
function safeWrite(client: SignageClient, frame: string): boolean {
  if (client.sink.destroyed) {
    dropClient(client, 'socket destroyed');
    return false;
  }
  try {
    client.sink.write(frame); // `false` here = backpressure; still delivered
    return true;
  } catch (err) {
    dropClient(client, (err as Error).message);
    return false;
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

/**
 * The play sequence + settings — the payload of every `state` frame. `items` is
 * the RESOLVED playlist (ordered, repeats kept, dangling entries dropped), so the
 * TV page just plays `items` in order and one file listed twice plays twice.
 */
export async function currentState(): Promise<{
  settings: TvDisplaySettings;
  items: { name: string; type: MediaKind }[];
}> {
  const [settings, items] = await Promise.all([getSettings(), resolvedPlaylist()]);
  return { settings, items };
}

/**
 * Send the current state to one stream (used right after it connects). Guarded
 * like every other write here: building the state is async, so the socket can be
 * gone by the time we write, and that must not throw into the route handler.
 */
export async function sendState(sink: SseSink): Promise<void> {
  const state = await currentState();
  if (sink.destroyed) return; // vanished while we were reading the folder
  try {
    sink.write(frame('state', state));
  } catch {
    /* client vanished mid-connect — its dispose callback does the cleanup */
  }
}

/**
 * Push the current state to every stream. Called after any write, so the TV and
 * the daemon apply changes immediately instead of discovering them later.
 */
export async function broadcastState(): Promise<void> {
  if (clients.size === 0) return;
  const state = await currentState();
  const payload = frame('state', state);
  for (const client of [...clients]) safeWrite(client, payload); // snapshot: safeWrite can drop
}

/**
 * Push a one-shot command to the daemon(s). Returns whether the frame actually
 * reached a live daemon stream — false when none is connected OR when the only
 * ones registered turn out to have dead sockets. Nothing is queued, and the route
 * turns a false into a plain "the scheduler isn't connected" 409, so this must
 * never report success for a write that went nowhere: the staff member would be
 * told the TV was switched off while it stayed on.
 */
export function broadcastCommand(action: TvDisplayCommandAction): boolean {
  const payload = frame('command', { action });
  let delivered = false;
  for (const client of [...clients]) {
    // Snapshot: a failed write drops the client from the live set mid-loop.
    if (client.kind !== 'daemon') continue;
    if (safeWrite(client, payload)) delivered = true;
  }
  log.info('[TV Display] command pushed', { action, delivered });
  return delivered;
}

/**
 * Live connection state, for the settings tab's status card. Reaps dead streams
 * first: a socket that died without its 'close' firing would otherwise keep the
 * card showing a green "TV connected" indefinitely.
 */
export function getConnections(): {
  pageConnected: boolean;
  pageSince: string | null;
  daemonConnected: boolean;
  daemonSince: string | null;
} {
  for (const client of [...clients]) {
    if (client.sink.destroyed) dropClient(client, 'socket destroyed');
  }

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
function sanitizeUploadName(original: string): string {
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

/**
 * Delete staged uploads left behind by a crash or a dropped connection. Multer
 * names them `stage-{epochMs}-{hex}{ext}`, so age comes from the filename — no
 * stat, and mirrors share-stage.ts. A committed upload is renamed OUT of here, so
 * anything still present past the TTL is garbage; without this a single 1 GB
 * interrupted video would sit on the clinic volume forever.
 *
 * The TTL is deliberately long: a genuinely in-flight upload is still being
 * written under its (already old) name, and deleting one mid-transfer would be
 * far worse than keeping an orphan a few extra hours.
 */
const STAGE_TTL_MS = 6 * 60 * 60 * 1000;

async function sweepStagedUploads(): Promise<void> {
  try {
    const now = Date.now();
    const names = await readdir(UPLOAD_STAGE_DIR);
    await Promise.all(
      names.map(async (name) => {
        const m = /^stage-(\d+)-/.exec(name);
        if (m && now - Number(m[1]) > STAGE_TTL_MS) {
          await unlink(path.join(UPLOAD_STAGE_DIR, name)).catch(() => {});
        }
      })
    );
  } catch {
    /* best effort — a missing dir or racey unlink is harmless */
  }
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
  void sweepStagedUploads(); // best-effort GC of crashed uploads; never blocks this one.
  await mkdir(MEDIA_DIR, { recursive: true });
  const finalName = await uniqueName(safe);
  await rename(stagedPath, path.join(MEDIA_DIR, finalName));
  // An upload through the tab is an explicit "play this" — add it to the
  // sequence now (a hand-dropped file, which never reaches here, only prompts).
  await addUploadedToPlaylist(finalName);
  log.info('[TV Display] media added', { name: finalName });
  return finalName;
}

export async function deleteMedia(name: string): Promise<boolean> {
  const abs = mediaFilePath(name);
  if (!abs) return false;
  try {
    await unlink(abs);
    await forgetDuration(name);
    await removeFromPlaylist(name);
    log.info('[TV Display] media deleted', { name: path.basename(name) });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

