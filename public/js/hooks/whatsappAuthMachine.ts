/**
 * The WhatsApp auth page's state machine — pure, so it is testable without a
 * live (unpaired) WhatsApp client.
 *
 * It replaces two render-phase syncs in `useWhatsAppAuth` that both rewrote
 * `authState` from the same two inputs (`clientReady`, `qrCode`) with different
 * rules, plus five other writers of the same variable (audit FE-F3-5). Each
 * block covered a case the other missed, so the next state added would have been
 * handled by one and silently not the other. Here every input is an event, every
 * event goes through `step`, and `enforce` applies the invariants the two blocks
 * had been keeping between them — after EVERY event, so no writer can skip them.
 */

export const AUTH_STATES = {
  INITIALIZING: 'initializing',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  CHECKING_SESSION: 'checking_session',
  QR_REQUIRED: 'qr_required',
  AUTHENTICATED: 'authenticated',
  // A live client is restoring an existing session (0–120s); no QR is coming
  // unless/until it either readies or is parked. Shown instead of an empty QR box.
  RESTORING: 'restoring',
  // The session authenticated but never reached ready across the watchdog's whole
  // budget — it's poisoned and parked. The only fix is an explicit Re-link.
  NEEDS_RELINK: 'needs_relink',
  ERROR: 'error',
  DISCONNECTED: 'disconnected',
} as const;

export type AuthState = (typeof AUTH_STATES)[keyof typeof AUTH_STATES];

/** `/api/wa/initial-state` as the page reads it. */
export interface InitialStateResponse {
  qr?: string;
  clientReady?: boolean;
  needsRelink?: boolean;
  restoring?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface AuthModel {
  authState: AuthState;
  error: string | null;
  /** Mirrored from the WhatsApp status context (SSE + REST reconcile). */
  clientReady: boolean;
  qrCode: string | null;
}

export type AuthEvent =
  /** The status context's `clientReady` / `qrCode` changed. */
  | { type: 'status'; clientReady: boolean; qrCode: string | null }
  /** `/api/wa/initial-state` answered. */
  | { type: 'initialState'; data: InitialStateResponse }
  /** CHECKING_SESSION has settled for 3 s with nothing arriving — assume a QR is coming. */
  | { type: 'settleCheck' }
  | { type: 'transport'; event: 'connecting' | 'connected' | 'disconnected' }
  /** The `whatsapp_client_ready` DATA frame (server park / re-link / restart). */
  | { type: 'clientFrame'; clientReady?: boolean; state?: string }
  /** Retry / refresh QR / restart / re-link started. */
  | { type: 'reset' }
  /** The SSE stream or an action failed. */
  | { type: 'failed'; error: string };

const S = AUTH_STATES;

export function initialAuthModel(clientReady: boolean, qrCode: string | null): AuthModel {
  return enforce({ authState: S.INITIALIZING, error: null, clientReady, qrCode });
}

/**
 * The invariants, applied after every event:
 *  - a ready client IS authenticated, whatever else just happened;
 *  - a QR in hand while not ready means the QR is what to show, if the page
 *    still claims AUTHENTICATED (the client dropped) or is merely CHECKING_SESSION.
 */
function enforce(m: AuthModel): AuthModel {
  if (m.clientReady) {
    return m.authState === S.AUTHENTICATED ? m : { ...m, authState: S.AUTHENTICATED };
  }
  if (m.qrCode && (m.authState === S.AUTHENTICATED || m.authState === S.CHECKING_SESSION)) {
    return { ...m, authState: S.QR_REQUIRED };
  }
  return m;
}

function step(m: AuthModel, e: AuthEvent): AuthModel {
  const to = (authState: AuthState): AuthModel => ({ ...m, authState });
  /** Move unless currently in one of `keep`. */
  const unless = (keep: AuthState[], authState: AuthState): AuthModel =>
    keep.includes(m.authState) ? m : to(authState);

  switch (e.type) {
    case 'status': {
      const next = { ...m, clientReady: e.clientReady, qrCode: e.qrCode };
      // A QR arriving while not ready is the QR to scan — from any state.
      if (!e.clientReady && e.qrCode) return { ...next, authState: S.QR_REQUIRED };
      return next;
    }

    case 'initialState': {
      const d = e.data;
      if (d.clientReady) return to(S.AUTHENTICATED);
      // Poisoned session, parked by the server — a new QR only comes from an
      // explicit Re-link, never from waiting.
      if (d.needsRelink) return to(S.NEEDS_RELINK);
      // A real QR is available — show it immediately (no CHECKING_SESSION delay).
      if (d.qr) return unless([S.AUTHENTICATED], S.QR_REQUIRED);
      // Live client mid-restore — show a restoring state, NOT a forever-empty QR box.
      if (d.restoring) return unless([S.QR_REQUIRED, S.AUTHENTICATED], S.RESTORING);
      if (d.error) return { ...m, authState: S.ERROR, error: d.error };
      // No client, no QR yet (a brand-new setup before the first QR) — settle
      // briefly (the hook fires `settleCheck` after 3 s), then expect a QR.
      return unless([S.QR_REQUIRED, S.AUTHENTICATED, S.NEEDS_RELINK], S.CHECKING_SESSION);
    }

    case 'settleCheck':
      return m.authState === S.CHECKING_SESSION ? to(S.QR_REQUIRED) : m;

    case 'transport':
      if (e.event === 'connected') return to(S.CONNECTED);
      if (e.event === 'disconnected') return to(S.DISCONNECTED);
      return unless([S.AUTHENTICATED, S.QR_REQUIRED], S.CONNECTING);

    case 'clientFrame':
      if (e.clientReady) return to(S.AUTHENTICATED);
      if (e.state === 'needs_relink') return to(S.NEEDS_RELINK);
      if (e.state === 'relinking' || e.state === 'restarting' || e.state === 'initializing') {
        return unless([S.AUTHENTICATED], S.INITIALIZING);
      }
      return m;

    case 'reset':
      return { ...m, authState: S.INITIALIZING, error: null };

    case 'failed':
      return { ...m, authState: S.ERROR, error: e.error };
  }
}

export function authReducer(m: AuthModel, e: AuthEvent): AuthModel {
  return enforce(step(m, e));
}
