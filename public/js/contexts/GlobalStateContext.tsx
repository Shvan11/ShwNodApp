import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import wsService from '../services/websocket';
import { WebSocketEvents } from '../constants/websocket-events';

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

interface WhatsAppInitialStateData {
  clientReady?: boolean;
  qr?: string;
}

/**
 * Global State Provider — shared app-wide state.
 * The WebSocket itself is a singleton (`wsService`); this provider only
 * mirrors a few derived values into React state for convenient consumption.
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

  // Mirror WhatsApp client state from the shared socket. The actual connection
  // is initiated by feature hooks via ConnectionManager.
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

    const handleInitialState = (data: unknown): void => {
      const typed = data as WhatsAppInitialStateData | null;
      if (!typed) return;
      if (typed.clientReady !== undefined) setWhatsappClientReady(typed.clientReady);
      setWhatsappQrCode(typed.qr ?? null);
    };

    wsService.on(WebSocketEvents.WHATSAPP_CLIENT_READY, handleWhatsAppReady);
    wsService.on(WebSocketEvents.WHATSAPP_QR_UPDATED, handleWhatsAppQR);
    wsService.on(WebSocketEvents.WHATSAPP_INITIAL_STATE_RESPONSE, handleInitialState);

    return () => {
      wsService.off(WebSocketEvents.WHATSAPP_CLIENT_READY, handleWhatsAppReady);
      wsService.off(WebSocketEvents.WHATSAPP_QR_UPDATED, handleWhatsAppQR);
      wsService.off(WebSocketEvents.WHATSAPP_INITIAL_STATE_RESPONSE, handleInitialState);
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
