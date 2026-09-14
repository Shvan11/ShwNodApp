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
 * How long the chair-display kiosk waits before reloading itself after its
 * EventSource reaches CLOSED. CLOSED means the server answered with an HTTP
 * error (a dead server leaves the stream CONNECTING instead), and EventSource
 * never retries after one — so for the kiosk, which is unattended, the only way
 * out is a reload that lets the web auth gate redirect to the login screen. The
 * delay keeps a transient 5xx from turning into a reload loop.
 */
export const CLOSED_STREAM_RELOAD_DELAY_MS = 15 * 1000;
