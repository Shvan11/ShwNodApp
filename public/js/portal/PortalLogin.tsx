import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { PortalPatient } from './PortalApp';
import type { LoginResponse } from '@/types/api.types';
import styles from './portal.module.css';

interface Props {
  onLogin: (patient: PortalPatient) => void;
}

function readPidFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('pid') || '';
  return /^\d+$/.test(raw) ? raw : '';
}

const PortalLogin = ({ onLogin }: Props) => {
  const [personId, setPersonId] = useState(() => readPidFromUrl());
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Patient Portal — Shwan Orthodontics';
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const pid = personId.trim();
    const cleanPin = pin.trim();
    if (!pid || !cleanPin) {
      setError('Please enter your patient number and PIN.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/portal/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: pid, pin: cleanPin }),
      });
      const data = (await res.json()) as LoginResponse;
      if (!res.ok || !data.success) {
        setError(data.error || 'Invalid credentials');
        return;
      }
      const pidNum = Number(pid);
      onLogin({
        personId: pidNum,
        patientName: data.patientName ?? null,
        firstName: null,
        lastName: null,
        language: data.language ?? null,
      });
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.loginPage}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <div className={styles.loginHeader}>
          <i className={`fas fa-tooth ${styles.loginIcon}`} aria-hidden="true" />
          <h1 className={styles.loginTitle}>Patient Portal</h1>
          <p className={styles.loginSubtitle}>Shwan Orthodontics</p>
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Patient Number</span>
          <input
            className={styles.input}
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="username"
            value={personId}
            onChange={(e) => setPersonId(e.target.value.replace(/\D/g, ''))}
            disabled={busy}
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>PIN</span>
          <input
            className={styles.input}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="current-password"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={busy}
            maxLength={6}
            required
          />
        </label>

        {error && <div className={styles.errorBox}>{error}</div>}

        <button type="submit" className={styles.primaryButton} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        <p className={styles.loginHint}>
          Your PIN defaults to the last 4 digits of your phone number. If it doesn't
          work, ask the reception desk to reset it.
        </p>
      </form>
    </div>
  );
};

export default PortalLogin;
