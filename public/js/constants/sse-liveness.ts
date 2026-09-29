/**
 * Shared liveness threshold for the SSE layer.
 *
 * Used by the shared singletons (`sseAppointments`, `sseWhatsapp`) and the
 * standalone chair-display kiosk. Keeping the constant in one place prevents
 * the implementations from drifting apart on a future tuning pass.
 */

/**
 * Tab-hidden duration that triggers a forced EventSource reconnect on
 * visibility return. Short alt-tabs don't qualify; NAT/tunnel idle drops
 * take minutes to manifest.
 */
export const VISIBILITY_RESUME_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * A stream that has delivered nothing for this long is treated as dead, even
 * though EventSource still reports OPEN. The server sends a named `ping` event
 * every 25 s (a comment frame would be invisible to EventSource), so this is two
 * missed pings plus slack. Without it, a transport that went quiet without closing
 * (a frozen proxy, a NAT drop, a sleep the tab never noticed) left the board on
 * "Live" and the kiosk on "● Connected" indefinitely (audit FE-F11-7).
 */
export const SILENT_STREAM_TIMEOUT_MS = 60 * 1000;

/** How often a stream's silence is checked against SILENT_STREAM_TIMEOUT_MS. */
export const LIVENESS_CHECK_INTERVAL_MS = 15 * 1000;

/**
 * Backoff for reopening a stream that EventSource gave up on (CLOSED). CLOSED
 * follows any non-200 answer — a proxy's 502 while the service restarts behind
 * Caddy or the tunnel — and EventSource never retries after one, so the board
 * sat on "Connection Error" until the user changed the date (audit FE-F11-3).
 * The last delay repeats.
 */
export const CLOSED_STREAM_RETRY_DELAYS_MS = [3_000, 5_000, 10_000, 20_000, 30_000] as const;

/**
 * How long the chair-display kiosk waits before reloading itself after its
 * EventSource reaches CLOSED. CLOSED means the server answered with an HTTP
 * error (a dead server leaves the stream CONNECTING instead), and EventSource
 * never retries after one — so for the kiosk, which is unattended, the only way
 * out is a reload that lets the web auth gate redirect to the login screen. The
 * delay keeps a transient 5xx from turning into a reload loop.
 */
export const CLOSED_STREAM_RELOAD_DELAY_MS = 15 * 1000;
