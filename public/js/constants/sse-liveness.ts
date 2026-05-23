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
