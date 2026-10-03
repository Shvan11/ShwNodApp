/**
 * Cache-Control for a patient image — a thumbnail, a rendered view, an original.
 *
 * A URL may be cached hard only when it NAMES the version it carries. Clients put the
 * file's mtime in `?v=` (the gallery's `mtime` in epoch ms, or a folder listing's
 * `modified` ISO string); when that matches the file actually being sent, no other
 * bytes can ever come back from this URL. Every other request — no `v`, or a `v` from
 * a listing that has gone stale since — must revalidate: `no-cache` plus the ETag /
 * Last-Modified that `send` emits, so an unchanged file costs a 304. Caching those for
 * days is how a path that later held a DIFFERENT photo (a re-upload under the same
 * name, an Explorer replace) kept showing the old one, and how the photo editor framed
 * one photo while Save rendered another.
 *
 * Always `private`: these are PHI and must never sit in a shared cache such as the
 * off-LAN cloudflared edge — auth lives at our origin.
 *
 * Import-free on purpose: the CI gate runs its tests without a `.env`.
 */

/** Ask the origin every time (a 304 when nothing changed). */
export const REVALIDATE = 'private, no-cache';

/**
 * Does `v` name this mtime? Epoch ms (`1790672188802`) or an ISO timestamp, within
 * 1 ms — `fs.Stats#mtime` (behind a listing's ISO `modified`) and the gallery's
 * `Math.round(mtimeMs)` both drop the sub-millisecond part.
 */
export function versionMatches(v: unknown, mtimeMs: number): boolean {
  let ms = NaN;
  if (typeof v === 'number') ms = v;
  else if (typeof v === 'string' && v !== '') ms = /^\d+(\.\d+)?$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isFinite(ms) && Number.isFinite(mtimeMs) && Math.abs(ms - mtimeMs) < 1;
}

/**
 * The header for an image whose source file has `mtimeMs`, requested with `v`
 * (pass `req.query.v` as-is): long-lived only when `v` names that mtime.
 */
export function imageCacheControl(
  v: unknown,
  mtimeMs: number,
  { maxAgeSeconds, immutable = false }: { maxAgeSeconds: number; immutable?: boolean }
): string {
  if (!versionMatches(v, mtimeMs)) return REVALIDATE;
  return `private, max-age=${maxAgeSeconds}${immutable ? ', immutable' : ''}`;
}
