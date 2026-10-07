import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PortalPatient } from './PortalApp';
import { loginResponseSchema } from './portal.schemas';
import styles from './portal.module.css';
import PortalIcon from './PortalIcon';

interface Props {
  onLogin: (patient: PortalPatient) => void;
  /** The configured clinic name, or null (unset/unreachable) — never a literal (FE-F23-8). */
  clinicName: string | null;
  /** Shown above the form, e.g. after a session ended mid-use (FE-F23-10). */
  notice: string | null;
}

function readPidFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('pid') || '';
  return /^\d+$/.test(raw) ? raw : '';
}

const PortalLogin = ({ onLogin, clinicName, notice }: Props) => {
  const [personId, setPersonId] = useState(() => readPidFromUrl());
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // eslint-disable-next-line no-restricted-syntax -- portal Zod boundary (CLAUDE.md / audit N17): validates the raw body and reads error/lockedUntil on non-2xx; the throwing staff client would obscure that.
      const res = await fetch('/api/portal/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: pid, pin: cleanPin }),
      });
      const parsed = loginResponseSchema.safeParse(await res.json());
      if (!res.ok || !parsed.success || !parsed.data.success) {
        setError((parsed.success ? parsed.data.error : undefined) || 'Invalid credentials');
        return;
      }
      const data = parsed.data;
      const pidNum = Number(pid);
      onLogin({
        personId: pidNum,
        patientName: data.patientName ?? null,
        firstName: null,
        lastName: null,
      });
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.loginPage}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <div className={styles.loginHeader}>
          <PortalIcon name="tooth" className={styles.loginIcon} />
          <h1 className={styles.loginTitle}>Patient Portal</h1>
          {clinicName && <p className={styles.loginSubtitle}>{clinicName}</p>}
        </div>

        {notice && !error && <div className={styles.noticeBox} role="status">{notice}</div>}

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
    </main>
  );
};

export default PortalLogin;
