import { useCallback, useEffect, useState } from 'react';
import PortalLogin from './PortalLogin';
import PortalDashboard from './PortalDashboard';
import styles from './portal.module.css';

export interface PortalPatient {
  personId: number;
  patientName: string | null;
  firstName: string | null;
  lastName: string | null;
  language: number | null;
}

const LANG_RTL = new Set([1, 2]);

function applyLanguage(language: number | null): void {
  const rtl = language != null && LANG_RTL.has(language);
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  document.documentElement.lang = rtl ? 'ar' : 'en';
}

const PortalApp = () => {
  const [patient, setPatient] = useState<PortalPatient | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async (): Promise<PortalPatient | null> => {
    try {
      const res = await fetch('/api/portal/me', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = (await res.json()) as { success: boolean; patient: PortalPatient };
      if (!data.success || !data.patient) return null;
      applyLanguage(data.patient.language);
      return data.patient;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await refreshSession();
      if (!cancelled) {
        setPatient(p);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  const handleLogin = useCallback((p: PortalPatient) => {
    applyLanguage(p.language);
    setPatient(p);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/portal/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {
      /* ignore */
    }
    applyLanguage(null);
    setPatient(null);
  }, []);

  if (loading) {
    return (
      <div className={styles.bootScreen}>
        <div className={styles.spinner} />
        <span>Loading…</span>
      </div>
    );
  }

  if (!patient) {
    return <PortalLogin onLogin={handleLogin} />;
  }

  return <PortalDashboard patient={patient} onLogout={handleLogout} />;
};

export default PortalApp;
