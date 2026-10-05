import React, { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authMeQuery, whatsappInitialStateQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import sseWhatsapp from '../services/sse-whatsapp';

/**
 * User data structure
 */
export interface UserData {
  id?: number;
  username?: string;
  role?: string;
  [key: string]: unknown;
}

/**
 * WhatsApp client status, mirrored from the shared SSE channel (see below).
 * Read-only by design, like the auth user.
 */
export interface WhatsAppStatus {
  clientReady: boolean;
  qrCode: string | null;
}

/**
 * Two contexts, not one (audit FE-F3-6). The auth user and the WhatsApp status
 * change for unrelated reasons, and while the client is unpaired whatsapp-web.js
 * mints a new QR about every 20 s: in one shared value, each rotation re-rendered
 * every screen that only wanted `user` (header, dashboard, statistics, works,
 * expenses, aligner sets…). Each now re-renders only its own readers.
 *
 * The setters, a `currentPatient` slot and a per-date `appointmentsCache` that
 * used to sit here were removed in the F3 audit — nothing read them since React
 * Query took over server state. Add a member only with a consumer.
 */
const AuthUserContext = createContext<{ user: UserData | null } | null>(null);
const WhatsAppStatusContext = createContext<WhatsAppStatus | null>(null);

/**
 * Props for GlobalStateProvider
 */
interface GlobalStateProviderProps {
  children: ReactNode;
}

interface WhatsAppReadyData {
  clientReady?: boolean;
}

interface WhatsAppQRData {
  /** `null` on streams that may not pair — the server withholds the QR by role. */
  qr: string | null;
  clientReady?: boolean;
}

/**
 * Global State Provider — the auth user and the WhatsApp client status, each in
 * its own context.
 */
export function GlobalStateProvider({ children }: GlobalStateProviderProps): React.ReactElement {
  return (
    <AuthUserProvider>
      <WhatsAppStatusProvider>{children}</WhatsAppStatusProvider>
    </AuthUserProvider>
  );
}

function AuthUserProvider({ children }: GlobalStateProviderProps): React.ReactElement {
  const [user, setUser] = useState<UserData | null>(() => {
    try {
      const cached = sessionStorage.getItem('currentUser');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  // Authoritative identity from React Query, mirrored into local state (so the
  // sessionStorage seed can paint before the query resolves) + written back to
  // sessionStorage for an instant initial paint on the next load.
  const { data: meData } = useQuery(authMeQuery());

  // Sync into `user` during render (keyed on the query result) — no setState-in-effect.
  const [seededMe, setSeededMe] = useState<unknown>(null);
  if (meData !== seededMe) {
    setSeededMe(meData);
    const data = meData as { success?: boolean; user?: UserData } | undefined;
    if (data?.success && data?.user) {
      setUser(data.user);
    }
  }

  // Persist to sessionStorage (external-system write stays in an effect).
  useEffect(() => {
    const data = meData as { success?: boolean; user?: UserData } | undefined;
    if (data?.success && data?.user) {
      sessionStorage.setItem('currentUser', JSON.stringify(data.user));
    }
  }, [meData]);

  // Memoized: the identity changes only when the user does (every context in the
  // tree does this — ToastContext carries the note about the refetch storm a fresh
  // object per render causes).
  const value = useMemo(() => ({ user }), [user]);

  return <AuthUserContext.Provider value={value}>{children}</AuthUserContext.Provider>;
}

/**
 * The SSE WhatsApp channel is a singleton (`sseWhatsapp`); this provider holds a
 * refcount on it so QR/ready state stays live even on pages that don't mount a
 * feature hook.
 */
function WhatsAppStatusProvider({ children }: GlobalStateProviderProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [whatsappClientReady, setWhatsappClientReady] = useState(false);
  const [whatsappQrCode, setWhatsappQrCode] = useState<string | null>(null);

  // Reconcile against the authoritative server snapshot every time the transport
  // opens, as well as on mount.
  //
  // `whatsapp_client_ready` is a one-shot event: the broadcaster fires it once
  // when the client becomes ready and never replays it to streams that connect
  // afterwards. A tab whose SSE stream opens *after* the client was already
  // authenticated (server booted from a restored session, or this page loaded
  // later) therefore never sees it, leaving `whatsappClientReady` stuck `false`
  // even though the server is connected. That is the split brain it produced —
  // the Send page and the per-patient SendMessage gate read this flag and show
  // "Authentication Required" / block sending, while the Auth page shows
  // connected. Reconciling from REST on every open — initial connect and every
  // reconnect — closes the whole missed-event category for every consumer.
  //
  // The snapshot is one shared query (`whatsappInitialStateQuery`) that the send
  // and auth pages read too, so a page load no longer GETs it three times
  // (FE-F16-16). It is applied once per successful fetch (keyed on
  // `dataUpdatedAt`); on a failed read the last known state stands, and the live
  // SSE events below remain the fallback.
  const { data: snapshot, dataUpdatedAt } = useQuery(whatsappInitialStateQuery());
  const [appliedAt, setAppliedAt] = useState(0);
  if (snapshot && dataUpdatedAt !== appliedAt) {
    setAppliedAt(dataUpdatedAt);
    if (snapshot.clientReady) {
      setWhatsappClientReady(true);
      setWhatsappQrCode(null);
    } else {
      setWhatsappClientReady(false);
      // Seed the QR from the snapshot too. The live `whatsapp_qr_updated` event
      // is one-shot: a tab whose SSE stream opens *after* the client already
      // emitted its QR (the normal case — boot emits within ~3s, long before the
      // auth page loads) never sees it, leaving the page stuck on "Generating QR
      // Code…" despite a valid QR being available here.
      if (snapshot.qr) setWhatsappQrCode(snapshot.qr);
    }
  }

  useEffect(() => {
    const handleWhatsAppReady = (data: unknown): void => {
      const typed = data as WhatsAppReadyData | null;
      setWhatsappClientReady(typed?.clientReady ?? true);
      if (typed?.clientReady) setWhatsappQrCode(null);
    };

    const handleWhatsAppQR = (data: unknown): void => {
      const typed = data as WhatsAppQRData;
      setWhatsappQrCode(typed.qr);
      // Read the frame's OWN `clientReady`, not the presence of `qr`. The server
      // blanks `qr` for streams whose role may not pair (sse-whatsapp.ts), so
      // inferring "not ready" from `typed.qr` would leave every non-finance tab
      // believing WhatsApp is still linked — and `SendMessage`'s gate reads that
      // flag, so it would keep offering a send that cannot go out.
      if (typed.clientReady === false) setWhatsappClientReady(false);
    };

    // After every open, a snapshot taken AFTER it: a read already in flight began
    // before the stream existed (on a page load they start together), so an event
    // fired between that read and the open would be missed. Cancel it, then re-read.
    const reconcileFromRest = (): void => {
      const queryKey = qk.whatsapp.initialState();
      void queryClient.cancelQueries({ queryKey }).then(() => queryClient.invalidateQueries({ queryKey }));
    };

    sseWhatsapp.on('whatsapp_client_ready', handleWhatsAppReady);
    sseWhatsapp.on('whatsapp_qr_updated', handleWhatsAppQR);
    sseWhatsapp.on('connected', reconcileFromRest);

    void sseWhatsapp.ensureConnected().catch(() => { /* hook will surface errors */ });

    return () => {
      sseWhatsapp.off('whatsapp_client_ready', handleWhatsAppReady);
      sseWhatsapp.off('whatsapp_qr_updated', handleWhatsAppQR);
      sseWhatsapp.off('connected', reconcileFromRest);
      sseWhatsapp.release();
    };
  }, [queryClient]);

  const value = useMemo<WhatsAppStatus>(
    () => ({ clientReady: whatsappClientReady, qrCode: whatsappQrCode }),
    [whatsappClientReady, whatsappQrCode]
  );

  return <WhatsAppStatusContext.Provider value={value}>{children}</WhatsAppStatusContext.Provider>;
}

/** The signed-in staff user (from `/api/auth/me`, seeded from sessionStorage for first paint). */
export function useAuthUser(): UserData | null {
  const context = useContext(AuthUserContext);
  if (!context) {
    throw new Error('useAuthUser must be used within GlobalStateProvider');
  }
  return context.user;
}

/** The WhatsApp client's ready flag and current pairing QR. */
export function useWhatsAppStatus(): WhatsAppStatus {
  const context = useContext(WhatsAppStatusContext);
  if (!context) {
    throw new Error('useWhatsAppStatus must be used within GlobalStateProvider');
  }
  return context;
}
