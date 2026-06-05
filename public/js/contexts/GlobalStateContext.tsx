import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { fetchJSON } from '@/core/http';
import * as authContract from '@shared/contracts/auth.contract';
import sseWhatsapp from '../services/sse-whatsapp';

/**
 * Patient data structure
 */
export interface PatientData {
  code?: number;
  id?: number;
  patient_name?: string;
  first_name?: string;
  last_name?: string;
  Phone?: string;
  [key: string]: unknown;
}

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
 * Appointment data structure
 */
export interface AppointmentData {
  appointment_id?: number;
  PatientID?: number;
  patient_name?: string;
  AppsDate?: string;
  AppsTime?: string;
  State?: string;
  [key: string]: unknown;
}

/**
 * Appointments cache by date
 */
export type AppointmentsCache = Record<string, AppointmentData[]>;

/** Cap on distinct dates retained in the in-memory appointments cache (LRU-ish). */
const MAX_CACHED_APPOINTMENT_DATES = 14;

/**
 * Global state context value
 */
export interface GlobalStateContextValue {
  // User
  user: UserData | null;
  setUser: React.Dispatch<React.SetStateAction<UserData | null>>;

  // Patient
  currentPatient: PatientData | null;
  updateCurrentPatient: (patient: PatientData | null) => void;
  clearCurrentPatient: () => void;

  // WhatsApp
  whatsappClientReady: boolean;
  setWhatsappClientReady: React.Dispatch<React.SetStateAction<boolean>>;
  whatsappQrCode: string | null;
  setWhatsappQrCode: React.Dispatch<React.SetStateAction<string | null>>;

  // Appointments
  appointmentsCache: AppointmentsCache;
  updateAppointmentsCache: (date: string, appointments: AppointmentData[]) => void;
}

const GlobalStateContext = createContext<GlobalStateContextValue | null>(null);

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
  qr: string;
}

/**
 * Global State Provider — shared app-wide state.
 * The SSE WhatsApp channel is a singleton (`sseWhatsapp`); this provider
 * holds a refcount on it so QR/ready state stays live even on pages that
 * don't mount a feature hook.
 */
export function GlobalStateProvider({ children }: GlobalStateProviderProps): React.ReactElement {
  const [user, setUser] = useState<UserData | null>(() => {
    try {
      const cached = sessionStorage.getItem('currentUser');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    fetchJSON<{ success?: boolean; user?: UserData }>('/api/auth/me', { schema: authContract.me.response })
      .then(data => {
        if (data?.success && data?.user) {
          setUser(data.user);
          sessionStorage.setItem('currentUser', JSON.stringify(data.user));
        }
      })
      .catch(() => { /* ignore */ });
  }, []);

  const [currentPatient, setCurrentPatient] = useState<PatientData | null>(null);
  const [appointmentsCache, setAppointmentsCache] = useState<AppointmentsCache>({});
  const [whatsappClientReady, setWhatsappClientReady] = useState(false);
  const [whatsappQrCode, setWhatsappQrCode] = useState<string | null>(null);

  // Mirror WhatsApp client state from the shared SSE channel, AND reconcile it
  // against the authoritative server snapshot every time the transport opens.
  //
  // `whatsapp_client_ready` is a one-shot event: the broadcaster fires it once
  // when the client becomes ready and never replays it to streams that connect
  // afterwards. A tab whose SSE stream opens *after* the client was already
  // authenticated (server booted from a restored session, or this page loaded
  // later) therefore never sees it, leaving `whatsappClientReady` stuck `false`
  // even though the server is connected. That is the split brain it produced —
  // the Send page and the per-patient SendMessage gate read this flag and show
  // "Authentication Required" / block sending, while the Auth page (which GETs
  // /api/wa/initial-state itself) shows connected. Reconciling from REST on
  // every open — initial connect and every reconnect — closes the whole
  // missed-event category for every consumer at once.
  useEffect(() => {
    const handleWhatsAppReady = (data: unknown): void => {
      const typed = data as WhatsAppReadyData | null;
      setWhatsappClientReady(typed?.clientReady ?? true);
      if (typed?.clientReady) setWhatsappQrCode(null);
    };

    const handleWhatsAppQR = (data: unknown): void => {
      const typed = data as WhatsAppQRData;
      setWhatsappQrCode(typed.qr);
      if (typed.qr) setWhatsappClientReady(false);
    };

    // Authoritative reconcile. On REST failure keep the last known state — the
    // live SSE events above remain the fallback — rather than forcing `false`.
    const reconcileFromRest = (): void => {
      fetchJSON<{ clientReady?: boolean }>('/api/wa/initial-state')
        .then((data) => {
          if (!data) return;
          if (data.clientReady) {
            setWhatsappClientReady(true);
            setWhatsappQrCode(null);
          } else {
            setWhatsappClientReady(false);
          }
        })
        .catch(() => { /* keep last known state; live events still update it */ });
    };

    sseWhatsapp.on('whatsapp_client_ready', handleWhatsAppReady);
    sseWhatsapp.on('whatsapp_qr_updated', handleWhatsAppQR);
    sseWhatsapp.on('connected', reconcileFromRest);

    void sseWhatsapp.ensureConnected().catch(() => { /* hook will surface errors */ });
    // If the stream was already open before we subscribed, `connected` won't
    // fire for us — reconcile once now to cover that path.
    if (sseWhatsapp.getFreshness() === 'fresh') reconcileFromRest();

    return () => {
      sseWhatsapp.off('whatsapp_client_ready', handleWhatsAppReady);
      sseWhatsapp.off('whatsapp_qr_updated', handleWhatsAppQR);
      sseWhatsapp.off('connected', reconcileFromRest);
      sseWhatsapp.release();
    };
  }, []);

  const updateCurrentPatient = (patient: PatientData | null): void => {
    setCurrentPatient(patient);
  };

  const clearCurrentPatient = (): void => {
    setCurrentPatient(null);
  };

  const updateAppointmentsCache = (date: string, appointments: AppointmentData[]): void => {
    setAppointmentsCache((prev) => {
      // Bound the cache to the most-recently-touched dates so it can't grow
      // unbounded over a long-lived tab (one entry per unique date viewed).
      // Re-insert `date` last (refresh its recency), then drop the oldest keys.
      const { [date]: _drop, ...rest } = prev;
      const next: AppointmentsCache = { ...rest, [date]: appointments };
      const keys = Object.keys(next);
      if (keys.length > MAX_CACHED_APPOINTMENT_DATES) {
        for (const stale of keys.slice(0, keys.length - MAX_CACHED_APPOINTMENT_DATES)) {
          delete next[stale];
        }
      }
      return next;
    });
  };

  const value: GlobalStateContextValue = {
    user,
    setUser,
    currentPatient,
    updateCurrentPatient,
    clearCurrentPatient,
    whatsappClientReady,
    setWhatsappClientReady,
    whatsappQrCode,
    setWhatsappQrCode,
    appointmentsCache,
    updateAppointmentsCache,
  };

  return <GlobalStateContext.Provider value={value}>{children}</GlobalStateContext.Provider>;
}

/**
 * Hook to access global state
 */
export function useGlobalState(): GlobalStateContextValue {
  const context = useContext(GlobalStateContext);
  if (!context) {
    throw new Error('useGlobalState must be used within GlobalStateProvider');
  }
  return context;
}

export default GlobalStateContext;
