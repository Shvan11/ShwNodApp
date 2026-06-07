/**
 * Settings → Integrations: manage external-service authentication.
 *
 * Telegram only for now (WhatsApp / Google will live here later). The Telegram
 * card surfaces live auth status and drives the interactive MTProto user login
 * (phone → code → optional 2FA password). The session is persisted server-side
 * (options table), so once authorized the file-share Telegram option starts
 * working with no restart. Admin-only tab; the backend routes are admin-gated too.
 */
import { useState, useEffect, useCallback, type KeyboardEvent } from 'react';
import { fetchJSON, postJSON, httpErrorMessage } from '@/core/http';
import { useToast } from '@/contexts/ToastContext';
import * as integrations from '@shared/contracts/integrations.contract';
import styles from './IntegrationsSettings.module.css';

interface Props {
  onChangesUpdate?: (hasChanges: boolean) => void;
}

type LoginStep = null | 'phone' | 'code' | 'password';

const IntegrationsSettings = ({ onChangesUpdate }: Props) => {
  const toast = useToast();

  const [status, setStatus] = useState<integrations.TelegramStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [step, setStep] = useState<LoginStep>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  // No save semantics — actions apply immediately, so never flag unsaved changes.
  useEffect(() => {
    onChangesUpdate?.(false);
  }, [onChangesUpdate]);

  const loadStatus = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const s = await fetchJSON<integrations.TelegramStatusResponse>(
        '/api/integrations/telegram/status',
        { schema: integrations.telegramStatus.response }
      );
      setStatus(s);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to load Telegram status'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const resetLogin = useCallback((): void => {
    setStep(null);
    setPhone('');
    setCode('');
    setPassword('');
  }, []);

  const startLogin = useCallback(() => {
    setCode('');
    setPassword('');
    setStep('phone');
  }, []);

  const sendCode = useCallback(async (): Promise<void> => {
    if (!phone.trim()) return;
    setBusy(true);
    try {
      await postJSON(
        '/api/integrations/telegram/auth/start',
        { phone: phone.trim() },
        { schema: integrations.telegramAuthStart.response }
      );
      toast.success('Code sent — check your Telegram app');
      setStep('code');
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Could not request a login code'));
    } finally {
      setBusy(false);
    }
  }, [phone, toast]);

  const submitCode = useCallback(async (): Promise<void> => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const result = await postJSON<{ authorized: boolean; passwordNeeded: boolean; account: integrations.TelegramAccount }>(
        '/api/integrations/telegram/auth/code',
        { code: code.trim() },
        { schema: integrations.telegramAuthCode.response }
      );
      if (result.passwordNeeded) {
        toast.info('Two-factor enabled — enter your Telegram password');
        setStep('password');
      } else {
        toast.success('Telegram connected');
        resetLogin();
        await loadStatus();
      }
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Could not verify the code'));
    } finally {
      setBusy(false);
    }
  }, [code, toast, resetLogin, loadStatus]);

  const submitPassword = useCallback(async (): Promise<void> => {
    if (!password) return;
    setBusy(true);
    try {
      await postJSON(
        '/api/integrations/telegram/auth/password',
        { password },
        { schema: integrations.telegramAuthPassword.response }
      );
      toast.success('Telegram connected');
      resetLogin();
      await loadStatus();
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Could not verify the password'));
    } finally {
      setBusy(false);
    }
  }, [password, toast, resetLogin, loadStatus]);

  const cancelLogin = useCallback(async (): Promise<void> => {
    resetLogin();
    try {
      await postJSON(
        '/api/integrations/telegram/auth/cancel',
        {},
        { schema: integrations.telegramAuthCancel.response }
      );
    } catch {
      /* best effort */
    }
  }, [resetLogin]);

  const logout = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await postJSON(
        '/api/integrations/telegram/logout',
        {},
        { schema: integrations.telegramLogout.response }
      );
      toast.success('Telegram session cleared');
      await loadStatus();
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to log out'));
    } finally {
      setBusy(false);
    }
  }, [toast, loadStatus]);

  const onKey = (e: KeyboardEvent, fn: () => void): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fn();
    }
  };

  const health: 'ok' | 'warn' | 'off' = !status?.configured
    ? 'off'
    : status.authorized
      ? 'ok'
      : 'warn';
  const healthLabel = !status?.configured
    ? 'Not configured'
    : status.authorized
      ? 'Connected'
      : 'Not authorized';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>
            <i className="fas fa-plug" aria-hidden="true" /> Integrations
          </h3>
          <p className={styles.description}>
            Manage authentication for external services. More integrations (WhatsApp, Google) will
            appear here.
          </p>
        </div>
        <button type="button" className={styles.refreshBtn} onClick={() => void loadStatus()} disabled={loading}>
          <i className={`fas fa-sync-alt ${loading ? styles.spin : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>

      {/* ── Telegram card ── */}
      <div className={`${styles.card} ${styles[health]}`}>
        <div className={styles.cardHeader}>
          <span className={styles.serviceName}>
            <i className="fab fa-telegram" aria-hidden="true" /> Telegram
          </span>
          <span className={`${styles.badge} ${styles[health]}`}>
            <span className={styles.dot} />
            {loading && !status ? 'Checking…' : healthLabel}
          </span>
        </div>
        <p className={styles.serviceDescription}>
          The user account that sends patient files via Telegram. Re-authenticate here when the
          session expires.
        </p>

        {status && !status.configured && (
          <div className={styles.notice}>
            Telegram API credentials are missing. Set <code>TELEGRAM_API_ID</code> and{' '}
            <code>TELEGRAM_API_HASH</code> in the server environment, then refresh.
          </div>
        )}

        {status?.configured && (
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>Status</dt>
              <dd>
                {status.authorized ? (
                  <span className={styles.okText}>Authorized</span>
                ) : status.hasSession ? (
                  <span className={styles.warnText}>
                    Session saved but not authorized{status.error ? ` — ${status.error}` : ''}
                  </span>
                ) : (
                  'No session — not logged in'
                )}
              </dd>
            </div>
            {status.authorized && status.account && (
              <div className={styles.row}>
                <dt>Account</dt>
                <dd>
                  {status.account.firstName || '—'}
                  {status.account.username ? ` (@${status.account.username})` : ''}
                  {status.account.phone ? ` · +${status.account.phone}` : ''}
                </dd>
              </div>
            )}
          </dl>
        )}

        {/* Actions / login flow */}
        {status?.configured && (
          <div className={styles.actions}>
            {step === null && (
              <>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={startLogin}
                  disabled={busy}
                >
                  {status.authorized ? 'Re-authenticate' : 'Log in'}
                </button>
                {status.hasSession && (
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    onClick={() => void logout()}
                    disabled={busy}
                  >
                    Log out
                  </button>
                )}
              </>
            )}

            {step === 'phone' && (
              <div className={styles.loginRow}>
                <label className={styles.loginLabel}>
                  Account phone number
                  <input
                    className={styles.input}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => onKey(e, () => void sendCode())}
                    placeholder="+9647XXXXXXXX"
                    inputMode="tel"
                    autoFocus
                  />
                </label>
                <div className={styles.loginButtons}>
                  <button type="button" className={styles.toolBtn} onClick={() => void cancelLogin()} disabled={busy}>
                    Cancel
                  </button>
                  <button type="button" className={styles.primaryBtn} onClick={() => void sendCode()} disabled={busy || !phone.trim()}>
                    {busy ? 'Sending…' : 'Send code'}
                  </button>
                </div>
              </div>
            )}

            {step === 'code' && (
              <div className={styles.loginRow}>
                <label className={styles.loginLabel}>
                  Login code (sent to your Telegram app)
                  <input
                    className={styles.input}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => onKey(e, () => void submitCode())}
                    placeholder="12345"
                    inputMode="numeric"
                    autoFocus
                  />
                </label>
                <div className={styles.loginButtons}>
                  <button type="button" className={styles.toolBtn} onClick={() => void cancelLogin()} disabled={busy}>
                    Cancel
                  </button>
                  <button type="button" className={styles.primaryBtn} onClick={() => void submitCode()} disabled={busy || !code.trim()}>
                    {busy ? 'Verifying…' : 'Verify'}
                  </button>
                </div>
              </div>
            )}

            {step === 'password' && (
              <div className={styles.loginRow}>
                <label className={styles.loginLabel}>
                  Two-factor password
                  <input
                    className={styles.input}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => onKey(e, () => void submitPassword())}
                    placeholder="Telegram cloud password"
                    autoFocus
                  />
                </label>
                <div className={styles.loginButtons}>
                  <button type="button" className={styles.toolBtn} onClick={() => void cancelLogin()} disabled={busy}>
                    Cancel
                  </button>
                  <button type="button" className={styles.primaryBtn} onClick={() => void submitPassword()} disabled={busy || !password}>
                    {busy ? 'Verifying…' : 'Submit'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default IntegrationsSettings;
