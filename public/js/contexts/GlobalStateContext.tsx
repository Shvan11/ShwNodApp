import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import sseWhatsapp from '../services/sse-whatsapp';

/**
 * Patient data structure
 */
export interface PatientData {
  code?: number;
  id?: number;
  PatientName?: string;
  FirstName?: string;
  LastName?: string;
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
  AppointmentID?: number;
  PatientID?: number;
  PatientName?: string;
  AppsDate?: string;
  AppsTime?: string;
  State?: string;
  [key: string]: unknown;
}

/**
 * Appointments cache by date
 */
export type AppointmentsCache = Record<string, AppointmentData[]>;

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
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
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

  // Mirror WhatsApp client state from the shared SSE channel. Initial state
  // is primed by the feature hooks via REST (/api/wa/initial-state); this
  // effect only subscribes to live updates.
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

    sseWhatsapp.on('whatsapp_client_ready', handleWhatsAppReady);
    sseWhatsapp.on('whatsapp_qr_updated', handleWhatsAppQR);
    void sseWhatsapp.ensureConnected().catch(() => { /* hook will surface errors */ });

    return () => {
      sseWhatsapp.off('whatsapp_client_ready', handleWhatsAppReady);
      sseWhatsapp.off('whatsapp_qr_updated', handleWhatsAppQR);
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
    setAppointmentsCache((prev) => ({ ...prev, [date]: appointments }));
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
