/**
 * API contract — waiting-room TV signage management (`/api/tv-display*`).
 *
 * The staff-facing half of the signage feature: Settings → TV Display edits the
 * slideshow's schedule/appearance and manages the media folder. The public,
 * session-less half the TV itself talks to (`/tv-display`, its manifest, media
 * stream, and the settings feed the LG daemon polls) stays deliberately raw and
 * un-enveloped — see routes/public/tv-display.routes.ts.
 *
 * Settings persist as one JSON file on disk (services/files/tv-display-store.ts),
 * NOT in the database: they are per-deployment machine config that belongs beside
 * the media folder, and keeping them off the DB means the waiting-room screen
 * keeps running through a database outage.
 *
 * SSoT for each endpoint's request + response, imported by BOTH the Express
 * route (relative `.js`) and the React app (`@shared` alias). See CLAUDE.md
 * "Shared API contracts".
 */
import { z } from 'zod';

/** How a photo/video is scaled into the 16:9 panel. */
export const FIT_MODES = ['contain', 'cover'] as const;
/** One-shot actions pushed to the daemon over its open stream. */
export const COMMAND_ACTIONS = ['on', 'off', 'reload'] as const;

// Fully-modeled, closed containers owned end-to-end here, so plain `z.object`
// (not `looseObject`) is correct — same call as branding.contract.ts.

/**
 * The tunables. `enabled` is the master switch (off = the daemon leaves the TV
 * alone entirely); the on/off times drive the daemon's daily schedule; `volume`
 * is applied with an unmute at each scheduled/reconnect launch; the rest are
 * read live by the signage page itself on its next poll.
 */
const settings = z.object({
  enabled: z.boolean(),
  onHour: z.number().int().min(0).max(23),
  onMinute: z.number().int().min(0).max(59),
  offHour: z.number().int().min(0).max(23),
  offMinute: z.number().int().min(0).max(59),
  volume: z.number().int().min(0).max(100),
  /** Default image dwell time in ms (videos always play to their natural end). */
  photoMs: z.number().int().min(1000).max(120000),
  /**
   * Per-image dwell overrides, keyed by filename: this picture stays up for this
   * many ms instead of the global `photoMs`. A filename absent from the map uses
   * `photoMs`; videos ignore both (they play to their natural end). The store
   * keeps these keys in sync when media is reordered (renumbered) or deleted, so
   * an override follows its file. Defaulted so an older settings file or a body
   * without the field still validates.
   */
  photoMsByName: z.record(z.string(), z.number().int().min(1000).max(120000)).default({}),
  shuffle: z.boolean(),
  fit: z.enum(FIT_MODES),
  sound: z.boolean(),
});
export type TvDisplaySettings = z.infer<typeof settings>;

/** One playable file in the media folder, as the management UI sees it. */
const mediaItem = z.object({
  name: z.string(),
  type: z.enum(['image', 'video']),
  sizeBytes: z.number(),
  /** ISO timestamp of the file's mtime. */
  modifiedAt: z.string(),
});
export type TvDisplayMediaItem = z.infer<typeof mediaItem>;

/**
 * Liveness, observed rather than inferred: both consumers hold an event stream
 * open (`GET /tv-display/events`), so an open stream IS the proof that side is
 * alive. `pageConnected` means the TV browser has the slideshow loaded;
 * `daemonConnected` means the LG scheduler is running and reachable — and it is
 * also exactly the condition under which the manual on/off buttons can work.
 * In-memory, so a server restart resets it until each side reconnects (both do
 * so within seconds, on their own).
 */
const status = z.object({
  pageConnected: z.boolean(),
  /** When that stream connected, for "connected 4 min ago". */
  pageSince: z.string().nullable(),
  daemonConnected: z.boolean(),
  daemonSince: z.string().nullable(),
  /** Server clock, so the UI can render ages without trusting the browser's. */
  serverTime: z.string(),
});
export type TvDisplayStatus = z.infer<typeof status>;

/**
 * Every mutation returns the whole state, so the UI never has to reconcile a
 * partial write against its own optimistic copy (media edits change filenames).
 */
const state = z.object({
  settings,
  media: z.array(mediaItem),
  /**
   * Files sitting in the media folder that the TV browser can't render (wrong
   * type — HEIC, MKV, …), so they are silently skipped. Surfaced in the settings
   * tab as a heads-up when someone drops an unsupported file in by hand; empty in
   * the normal case. (Internal/temp entries — dotfiles, the upload staging dir —
   * are never counted.)
   */
  ignoredFiles: z.array(z.string()),
  /** Absolute path of the media folder, shown in the UI so staff can find it. */
  mediaDir: z.string(),
  /** Absolute path of the settings file, shown alongside it. */
  settingsFile: z.string(),
  /** Extensions the TV browser can render, for the upload picker + error copy. */
  allowedExtensions: z.array(z.string()),
  status,
});
export type TvDisplayState = z.infer<typeof state>;

// GET /api/tv-display → settings + media + liveness.
export const getState = {
  response: state,
} as const;

// PUT /api/tv-display/settings → replace the whole settings object.
export const updateSettings = {
  body: settings,
  response: state,
} as const;
export type UpdateSettingsBody = z.infer<typeof updateSettings.body>;

// POST /api/tv-display/media → multipart upload (field `media`, no JSON body).
export const uploadMedia = {
  response: state,
} as const;

// DELETE /api/tv-display/media/:name → remove one file from the media folder.
export const deleteMedia = {
  params: z.object({ name: z.string().min(1).max(255) }),
  response: state,
} as const;
export type DeleteMediaParams = z.infer<typeof deleteMedia.params>;

// PUT /api/tv-display/media/order → rewrite play order by renumbering filename
// prefixes (`01-`, `02-`, …) to match the given sequence.
export const reorderMedia = {
  body: z.object({ names: z.array(z.string().min(1).max(255)).max(500) }),
  response: state,
} as const;
export type ReorderMediaBody = z.infer<typeof reorderMedia.body>;

// POST /api/tv-display/command → push a one-shot action to the daemon (turn the
// TV on/off now, or reload the signage page). 409 when no daemon is connected —
// nothing is queued for later.
export const sendCommand = {
  body: z.object({ action: z.enum(COMMAND_ACTIONS) }),
  response: state,
} as const;
export type SendCommandBody = z.infer<typeof sendCommand.body>;
