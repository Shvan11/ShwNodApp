/**
 * Cache-Control for a file of the built client (`dist/`).
 *
 * Vite writes everything under `dist/assets/` with a content hash in its name
 * (`main-B5Mf_65y.js`, `fa-solid-900-tLH6XCuf.woff2`), so a given URL can only
 * ever return the same bytes: cache it for a year and never ask again. A new
 * build references new names from the HTML, and the HTML is the one thing that
 * must be re-checked on every load.
 *
 * `express.static`'s default is `public, max-age=0` for all of it, which made
 * every page load revalidate every chunk, stylesheet and font it used: 13
 * conditional requests on the dashboard, 38 on a patient's Photos page, each a
 * round trip to the clinic through the tunnel for an off-LAN user (audit
 * FE-F26-5).
 *
 * `public` on purpose (unlike patient images, `image-cache-control.ts`): this is
 * the application's code, the same for every user and already served without a
 * session, so a shared cache such as the cloudflared edge may keep it.
 *
 * Import-free on purpose: the CI gate runs its tests without a `.env`.
 */

/** A year, and no revalidation inside it. */
export const HASHED_ASSET = 'public, max-age=31536000, immutable';

/** Stored, but checked against the origin on every use (a 304 when unchanged). */
export const ALWAYS_REVALIDATE = 'no-cache';

/** `filePath` is the absolute path `express.static` resolved, with the host's separators. */
export function buildCacheControl(filePath: string): string {
  return /[\\/]assets[\\/][^\\/]+$/.test(filePath) ? HASHED_ASSET : ALWAYS_REVALIDATE;
}
