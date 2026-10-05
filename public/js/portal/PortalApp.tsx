import { useCallback, useEffect, useState } from 'react';
import PortalLogin from './PortalLogin';
import PortalDashboard from './PortalDashboard';
import { portalMeResponseSchema } from './portal.schemas';
import { portalCsrfHeader } from './portal.csrf';
import { fetchClinicName, setSessionEndedHandler } from './portalApi';
import styles from './portal.module.css';

export interface PortalPatient {
  personId: number;
  patientName: string | null;
  firstName: string | null;
  lastName: string | null;
}

// No language switch: the portal's text is English only, so it stays `lang="en"
// dir="ltr"` (portal.html) for every patient until it is translated. It used to flip
// to RTL + `lang="ar"` for codes 1 and 2 — the codebook RB1 retired, under which 1 is
// ENGLISH — so English patients got mirrored English (owner decision 2026-10-05,
// audit FE-F23-5).

const PortalApp = () => {
  const [patient, setPatient] = useState<PortalPatient | null>(null);
  const [loading, setLoading] = useState(true);
  const [clinicName, setClinicName] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  const refreshSession = useCallback(async (): Promise<PortalPatient | null> => {
    try {
      // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (CLAUDE.md / audit N17): validates the raw body itself and inspects res.ok; the envelope-unwrapping/throwing staff client would obscure that.
      const res = await fetch('/api/portal/me', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const parsed = portalMeResponseSchema.safeParse(await res.json());
      if (!parsed.success || !parsed.data.success || !parsed.data.patient) return null;
      return parsed.data.patient;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, name] = await Promise.all([refreshSession(), fetchClinicName()]);
      if (!cancelled) {
        setPatient(p);
        setClinicName(name);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  // The tab title names the clinic once it is known (FE-F23-8).
  useEffect(() => {
    document.title = clinicName ? `Patient Portal — ${clinicName}` : 'Patient Portal';
  }, [clinicName]);

  // A read that comes back 401 (session expired, access disabled, PIN changed)
  // returns to sign-in instead of leaving every tab saying "Authentication
  // required" (FE-F23-10).
  useEffect(() => {
    setSessionEndedHandler(() => {
      setPatient(null);
      setSessionEnded(true);
    });
    return () => setSessionEndedHandler(null);
  }, []);

  const handleLogin = useCallback((p: PortalPatient) => {
    setSessionEnded(false);
    setPatient(p);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (CLAUDE.md / audit N17): part of the portal's self-contained session lifecycle.
      await fetch('/api/portal/logout', {
        method: 'POST',
        credentials: 'same-origin',
        // CSRF token (audit H2) — required, else the server rejects logout and
        // the portal session survives despite the client clearing its state.
        headers: await portalCsrfHeader(),
      });
    } catch {
      /* ignore */
    }
    setSessionEnded(false);
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
    return (
      <PortalLogin
        onLogin={handleLogin}
        clinicName={clinicName}
        notice={sessionEnded ? 'Your session has ended. Please sign in again.' : null}
      />
    );
  }

  return <PortalDashboard patient={patient} onLogout={handleLogout} />;
};

export default PortalApp;
