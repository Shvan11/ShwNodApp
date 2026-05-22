/**
 * Shared liveness thresholds for the WebSocket layer.
 *
 * Both the singleton `wsService` and the standalone chair-display kiosk
 * use these. Keeping them in one place prevents the two implementations
 * from drifting apart on a future tuning pass.
 *
 * Notes on what's NOT shared:
 *   - The freshness-poll *interval* is per-implementation (singleton polls
 *     every 5 s for the "Live" indicator; kiosk polls every 10 s — no
 *     indicator to drive).
 *   - The freshness *signal* (30 s threshold for "fresh" vs "stale") only
 *     exists on the singleton — the kiosk has no equivalent UI.
 */

/**
 * No-message-received window before the socket is treated as dead and
 * force-reconnected. Covers the SERVER_HEARTBEAT cadence (15 s) plus one
 * missed heartbeat plus jitter.
 */
export const LIVENESS_STALE_THRESHOLD_MS = 35_000;

/**
 * Tab-hidden duration that triggers a forced reconnect on visibility
 * return. Short alt-tabs don't qualify; NAT/tunnel idle drops take
 * minutes to manifest.
 */
export const VISIBILITY_RESUME_THRESHOLD_MS = 2 * 60 * 1000;
