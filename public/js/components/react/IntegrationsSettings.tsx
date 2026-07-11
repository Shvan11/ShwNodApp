/**
 * Settings → Integrations: manage external-service authentication.
 *
 * Telegram only for now (WhatsApp / Google will live here later). The Telegram
 * card surfaces live auth status and drives the interactive MTProto user login
 * (phone → code → optional 2FA password). The session is persisted server-side
 * (options table), so once authorized the file-share Telegram option starts
 * working with no restart. Admin-only tab; the backend routes are admin-gated too.
 */
import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { postJSON, httpErrorMessage } from '@/core/http';
import { useToast } from '@/contexts/ToastContext';
import {
  integrationsTelegramStatusQuery,
  integrationsThreeShapeStatusQuery,
  integrationsGeminiStatusQuery,
  integrationsGoogleDriveStatusQuery,
  integrationsCloudflareListStatusQuery,
} from '@/query/queries';
import { qk } from '@/query/keys';
import * as integrations from '@shared/contracts/integrations.contract';
import styles from './IntegrationsSettings.module.css';

interface Props {
  onChangesUpdate?: (hasChanges: boolean) => void;
}

type LoginStep = null | 'phone' | 'code' | 'password';

const IntegrationsSettings = ({ onChangesUpdate }: Props) => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading: loading, isError, error: queryError, refetch } =
    useQuery(integrationsTelegramStatusQuery());
  const status = (data as integrations.TelegramStatusResponse | undefined) ?? null;

  const [busy, setBusy] = useState(false);

  const [step, setStep] = useState<LoginStep>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  // No save semantics — actions apply immediately, so never flag unsaved changes.
  useEffect(() => {
    onChangesUpdate?.(false);
  }, [onChangesUpdate]);

  // Surface a load failure as a toast (the prior fetch's catch path).
  useEffect(() => {
    if (isError) toast.error(httpErrorMessage(queryError, 'Failed to load Telegram status'));
  }, [isError, queryError, toast]);

  // Re-read status after an auth action. Invalidating refetches the one cache entry.
  const loadStatus = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: qk.settings.integrationsTelegramStatus() });
  }, [queryClient]);

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

  // ── 3Shape Unite (OAuth Web Service) ──
  const { data: tsData, isLoading: tsLoading } = useQuery(integrationsThreeShapeStatusQuery());
  const tsStatus = (tsData as integrations.ThreeShapeStatusResponse | undefined) ?? null;
  const [tsBusy, setTsBusy] = useState(false);

  // Handle the one-shot ?threeshape=connected|error flag the OAuth callback
  // redirects back with: toast, refresh status, then strip it from the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const oauthFlagHandled = useRef(false);
  useEffect(() => {
    if (oauthFlagHandled.current) return;
    const flag = searchParams.get('threeshape');
    if (!flag) return;
    oauthFlagHandled.current = true;
    if (flag === 'connected') {
      toast.success('3Shape connected');
    } else {
      const reason = searchParams.get('reason');
      toast.error(reason ? `3Shape connection failed: ${reason}` : '3Shape connection failed');
    }
    void queryClient.invalidateQueries({ queryKey: qk.settings.integrationsThreeShapeStatus() });
    const next = new URLSearchParams(searchParams);
    next.delete('threeshape');
    next.delete('reason');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, toast, queryClient]);

  // Start OAuth: full-page navigation to the server route, which 302s to 3Shape.
  // External-provider redirect — a sanctioned exception to the SPA-only nav rule.
  const connectThreeShape = useCallback((): void => {
    window.location.href = '/api/auth/3shape/login';
  }, []);

  const disconnectThreeShape = useCallback(async (): Promise<void> => {
    setTsBusy(true);
    try {
      await postJSON(
        '/api/integrations/3shape/disconnect',
        {},
        { schema: integrations.threeshapeDisconnect.response }
      );
      toast.success('3Shape disconnected');
      await queryClient.invalidateQueries({ queryKey: qk.settings.integrationsThreeShapeStatus() });
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to disconnect 3Shape'));
    } finally {
      setTsBusy(false);
    }
  }, [toast, queryClient]);

  // ── Google Drive (aligner PDF storage, OAuth) ──
  const { data: gdData, isLoading: gdLoading } = useQuery(integrationsGoogleDriveStatusQuery());
  const gdStatus = (gdData as integrations.GoogleDriveStatusResponse | undefined) ?? null;
  const [gdBusy, setGdBusy] = useState(false);

  // Handle the one-shot ?googleDrive=connected|error flag the OAuth callback
  // redirects back with: toast, refresh status, then strip it from the URL.
  const gdOauthFlagHandled = useRef(false);
  useEffect(() => {
    if (gdOauthFlagHandled.current) return;
    const flag = searchParams.get('googleDrive');
    if (!flag) return;
    gdOauthFlagHandled.current = true;
    if (flag === 'connected') {
      toast.success('Google Drive connected');
    } else {
      const reason = searchParams.get('reason');
      toast.error(reason ? `Google Drive connection failed: ${reason}` : 'Google Drive connection failed');
    }
    void queryClient.invalidateQueries({ queryKey: qk.settings.integrationsGoogleDriveStatus() });
    const next = new URLSearchParams(searchParams);
    next.delete('googleDrive');
    next.delete('reason');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, toast, queryClient]);

  // Start OAuth: full-page navigation to the server route, which 302s to Google.
  // External-provider redirect — a sanctioned exception to the SPA-only nav rule.
  const connectGoogleDrive = useCallback((): void => {
    window.location.href = '/api/admin/google-drive/auth-url';
  }, []);

  const disconnectGoogleDrive = useCallback(async (): Promise<void> => {
    setGdBusy(true);
    try {
      await postJSON(
        '/api/integrations/google-drive/disconnect',
        {},
        { schema: integrations.googleDriveDisconnect.response }
      );
      toast.success('Google Drive disconnected');
      await queryClient.invalidateQueries({ queryKey: qk.settings.integrationsGoogleDriveStatus() });
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to disconnect Google Drive'));
    } finally {
      setGdBusy(false);
    }
  }, [toast, queryClient]);

  // ── Gemini (Google GenAI) ──
  const { data: gmData, isLoading: gmLoading } = useQuery(integrationsGeminiStatusQuery());
  const gmStatus = (gmData as integrations.GeminiStatusResponse | undefined) ?? null;
  const [gmKey, setGmKey] = useState('');
  const [gmModel, setGmModel] = useState('');
  const [gmBusy, setGmBusy] = useState(false);
  const [gmTest, setGmTest] = useState<{ ok: boolean; msg: string } | null>(null);

  // Seed the model input once from the loaded status (don't clobber user edits).
  const [gmSeeded, setGmSeeded] = useState(false);
  if (!gmSeeded && gmStatus) {
    setGmSeeded(true);
    setGmModel(gmStatus.model);
  }

  const saveGemini = useCallback(async (): Promise<void> => {
    setGmBusy(true);
    setGmTest(null);
    try {
      // Only send a field the user actually set — omitting apiKey keeps the
      // stored key, so changing just the model never wipes it.
      const body: { apiKey?: string; model?: string } = {};
      if (gmKey.trim()) body.apiKey = gmKey.trim();
      if (gmModel.trim()) body.model = gmModel.trim();
      await postJSON('/api/integrations/gemini/config', body, { schema: integrations.geminiConfig.response });
      setGmKey('');
      toast.success('Gemini settings saved');
      await queryClient.invalidateQueries({ queryKey: qk.settings.integrationsGeminiStatus() });
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to save Gemini settings'));
    } finally {
      setGmBusy(false);
    }
  }, [gmKey, gmModel, toast, queryClient]);

  const testGemini = useCallback(async (): Promise<void> => {
    setGmBusy(true);
    setGmTest(null);
    try {
      const result = await postJSON<integrations.GeminiTestResponse>(
        '/api/integrations/gemini/test',
        {},
        { schema: integrations.geminiTest.response }
      );
      setGmTest(
        result.ok
          ? { ok: true, msg: `Connected — model ${result.model} responded.` }
          : { ok: false, msg: result.error || 'Test failed' }
      );
    } catch (err) {
      setGmTest({ ok: false, msg: httpErrorMessage(err, 'Test failed') });
    } finally {
      setGmBusy(false);
    }
  }, []);

  const clearGemini = useCallback(async (): Promise<void> => {
    setGmBusy(true);
    setGmTest(null);
    try {
      await postJSON('/api/integrations/gemini/clear', {}, { schema: integrations.geminiClear.response });
      setGmKey('');
      toast.success('Reverted to environment configuration');
      await queryClient.invalidateQueries({ queryKey: qk.settings.integrationsGeminiStatus() });
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to clear Gemini settings'));
    } finally {
      setGmBusy(false);
    }
  }, [toast, queryClient]);

  // ── Cloudflare Access (aligner-portal doctor allow-list) ──
  const { data: cfData, isLoading: cfLoading } = useQuery(integrationsCloudflareListStatusQuery());
  const cfStatus = (cfData as integrations.CloudflareListStatusResponse | undefined) ?? null;
  const [cfBusy, setCfBusy] = useState(false);

  const syncCloudflareList = useCallback(async (): Promise<void> => {
    setCfBusy(true);
    try {
      const result = await postJSON<integrations.CloudflareListStatusResponse>(
        '/api/integrations/cloudflare-list/sync',
        {},
        { schema: integrations.cloudflareListSync.response }
      );
      const outcome = result.lastSync;
      if (outcome?.ok && !outcome.skipped) {
        toast.success(`Doctor emails synced — ${outcome.emailCount} on the portal allow-list`);
      } else if (outcome?.skipped) {
        toast.warning('Nothing to sync — no aligner doctor has an email set');
      } else {
        toast.error(outcome?.error || 'Sync failed');
      }
      // The POST returns the same shape as the status GET — write it into the cache.
      queryClient.setQueryData(qk.settings.integrationsCloudflareListStatus(), result);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to sync the doctor email list'));
    } finally {
      setCfBusy(false);
    }
  }, [toast, queryClient]);

  const cfHealth: 'ok' | 'warn' | 'off' = !cfStatus?.configured
    ? 'off'
    : cfStatus.lastSync && !cfStatus.lastSync.ok
      ? 'warn'
      : 'ok';
  const cfHealthLabel = !cfStatus?.configured
    ? 'Not configured'
    : !cfStatus.lastSync
      ? 'Configured'
      : cfStatus.lastSync.ok
        ? 'Active'
        : 'Last sync failed';

  const gmHealth: 'ok' | 'warn' | 'off' = gmStatus?.configured ? 'ok' : 'off';
  const gmHealthLabel = !gmStatus?.configured
    ? 'Not configured'
    : gmStatus.source === 'db'
      ? 'Configured'
      : 'Configured (env)';

  const tsHealth: 'ok' | 'warn' | 'off' = !tsStatus?.configured
    ? 'off'
    : tsStatus.connected
      ? 'ok'
      : 'warn';
  const tsHealthLabel = !tsStatus?.configured
    ? 'Not configured'
    : tsStatus.connected
      ? 'Connected'
      : 'Not connected';

  const gdHealth: 'ok' | 'warn' | 'off' = !gdStatus?.configured
    ? 'off'
    : gdStatus.connected
      ? 'ok'
      : 'warn';
  const gdHealthLabel = !gdStatus?.configured
    ? 'Not configured'
    : gdStatus.connected
      ? 'Connected'
      : 'Not connected';

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
            Manage authentication for external services. More integrations (WhatsApp) will
            appear here.
          </p>
        </div>
        <button type="button" className={styles.refreshBtn} onClick={() => void refetch()} disabled={loading}>
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
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
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
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
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
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
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

      {/* ── 3Shape Unite card ── */}
      <div className={`${styles.card} ${styles[tsHealth]}`}>
        <div className={styles.cardHeader}>
          <span className={styles.serviceName}>
            <i className="fas fa-cube" aria-hidden="true" /> 3Shape Unite
          </span>
          <span className={`${styles.badge} ${styles[tsHealth]}`}>
            <span className={styles.dot} />
            {tsLoading && !tsStatus ? 'Checking…' : tsHealthLabel}
          </span>
        </div>
        <p className={styles.serviceDescription}>
          The clinic 3Shape account used by the scanner Web Service. Connect once to push
          patients / start scans and pull finished cases. Sign in as the clinic account.
        </p>

        {tsStatus && !tsStatus.configured && (
          <div className={styles.notice}>
            3Shape is not configured. Set <code>THREESHAPE_CLIENT_ID</code> and{' '}
            <code>THREESHAPE_WEBSERVICE_BASE</code> in the server environment, then refresh.
          </div>
        )}

        {tsStatus?.configured && (
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>Status</dt>
              <dd>
                {tsStatus.connected ? (
                  <span className={styles.okText}>Connected</span>
                ) : (
                  'Not connected'
                )}
              </dd>
            </div>
            {tsStatus.connected && tsStatus.expiresAt && (
              <div className={styles.row}>
                <dt>Token expires</dt>
                <dd>{new Date(tsStatus.expiresAt).toLocaleString()}</dd>
              </div>
            )}
          </dl>
        )}

        {tsStatus?.configured && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={connectThreeShape}
              disabled={tsBusy}
            >
              {tsStatus.connected ? 'Reconnect' : 'Connect'}
            </button>
            {tsStatus.connected && (
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void disconnectThreeShape()}
                disabled={tsBusy}
              >
                Disconnect
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Google Drive card ── */}
      <div className={`${styles.card} ${styles[gdHealth]}`}>
        <div className={styles.cardHeader}>
          <span className={styles.serviceName}>
            <i className="fab fa-google-drive" aria-hidden="true" /> Google Drive
          </span>
          <span className={`${styles.badge} ${styles[gdHealth]}`}>
            <span className={styles.dot} />
            {gdLoading && !gdStatus ? 'Checking…' : gdHealthLabel}
          </span>
        </div>
        <p className={styles.serviceDescription}>
          Stores uploaded aligner-set PDFs. Connect the Google account that owns the target
          Drive folder — reconnect here whenever uploads start failing with an authorization error.
        </p>

        {gdStatus && !gdStatus.configured && (
          <div className={styles.notice}>
            Google Drive is not configured. Set <code>GOOGLE_DRIVE_CLIENT_ID</code> and{' '}
            <code>GOOGLE_DRIVE_CLIENT_SECRET</code> (or the shared <code>GOOGLE_CLIENT_ID</code> /{' '}
            <code>GOOGLE_CLIENT_SECRET</code>) in the server environment, then refresh.
          </div>
        )}

        {gdStatus?.configured && !gdStatus.folderConfigured && (
          <div className={styles.notice}>
            <code>GOOGLE_DRIVE_FOLDER_ID</code> is not set — connecting will succeed, but uploads
            will fail until a destination folder is configured.
          </div>
        )}

        {gdStatus?.configured && (
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>Status</dt>
              <dd>
                {gdStatus.connected ? (
                  <span className={styles.okText}>Connected</span>
                ) : (
                  'Not connected'
                )}
              </dd>
            </div>
            {gdStatus.connected && gdStatus.expiresAt && (
              <div className={styles.row}>
                <dt>Access token expires</dt>
                <dd>{new Date(gdStatus.expiresAt).toLocaleString()}</dd>
              </div>
            )}
          </dl>
        )}

        {gdStatus?.configured && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={connectGoogleDrive}
              disabled={gdBusy}
            >
              {gdStatus.connected ? 'Reconnect' : 'Connect'}
            </button>
            {gdStatus.connected && (
              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() => void disconnectGoogleDrive()}
                disabled={gdBusy}
              >
                Disconnect
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Gemini (AI) card ── */}
      <div className={`${styles.card} ${styles[gmHealth]}`}>
        <div className={styles.cardHeader}>
          <span className={styles.serviceName}>
            <i className="fas fa-robot" aria-hidden="true" /> Gemini (AI)
          </span>
          <span className={`${styles.badge} ${styles[gmHealth]}`}>
            <span className={styles.dot} />
            {gmLoading && !gmStatus ? 'Checking…' : gmHealthLabel}
          </span>
        </div>
        <p className={styles.serviceDescription}>
          Google Gemini powers AI name transliteration and the Stand product-vision scan. Set the
          API key here to add or rotate it without restarting the server.
        </p>

        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt>API key</dt>
            <dd>
              {gmStatus?.maskedKey ? (
                <span className={styles.okText}>
                  {gmStatus.maskedKey}
                  {gmStatus.source === 'env' ? ' · from environment' : ''}
                </span>
              ) : (
                'Not set'
              )}
            </dd>
          </div>
          {gmStatus?.configured && (
            <div className={styles.row}>
              <dt>Model</dt>
              <dd>{gmStatus.model}</dd>
            </div>
          )}
        </dl>

        <div className={styles.loginRow}>
          <label className={styles.loginLabel}>
            {gmStatus?.configured ? 'API key (enter a new key to replace)' : 'API key'}
            <input
              className={styles.input}
              type="password"
              value={gmKey}
              onChange={(e) => setGmKey(e.target.value)}
              placeholder={gmStatus?.configured ? 'Leave blank to keep current key' : 'AIza…'}
              autoComplete="off"
            />
          </label>
          <label className={styles.loginLabel}>
            Model
            <input
              className={styles.input}
              value={gmModel}
              onChange={(e) => setGmModel(e.target.value)}
              placeholder="gemini-3-flash-preview"
            />
          </label>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => void saveGemini()}
            disabled={gmBusy || (!gmKey.trim() && !gmModel.trim())}
          >
            {gmBusy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className={styles.toolBtn}
            onClick={() => void testGemini()}
            disabled={gmBusy || !gmStatus?.configured}
          >
            Test connection
          </button>
          {gmStatus?.source === 'db' && (
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={() => void clearGemini()}
              disabled={gmBusy}
            >
              Clear
            </button>
          )}
        </div>

        {gmTest && (
          <div className={styles.notice}>
            <span className={gmTest.ok ? styles.okText : styles.warnText}>
              {gmTest.ok ? '✓ ' : '✗ '}
              {gmTest.msg}
            </span>
          </div>
        )}
      </div>

      {/* ── Cloudflare Access (aligner portal) card ── */}
      <div className={`${styles.card} ${styles[cfHealth]}`}>
        <div className={styles.cardHeader}>
          <span className={styles.serviceName}>
            <i className="fab fa-cloudflare" aria-hidden="true" /> Aligner Portal Access (Cloudflare)
          </span>
          <span className={`${styles.badge} ${styles[cfHealth]}`}>
            <span className={styles.dot} />
            {cfLoading && !cfStatus ? 'Checking…' : cfHealthLabel}
          </span>
        </div>
        <p className={styles.serviceDescription}>
          Controls which partner doctors can open the external aligner portal. Doctor emails
          (Settings → Aligner Doctors) are mirrored into the Cloudflare Access allow-list
          automatically whenever a doctor is added, edited or deleted — use Sync now after a
          failed run or to verify the setup.
        </p>

        {cfStatus && !cfStatus.configured && (
          <div className={styles.notice}>
            Cloudflare sync is not configured. Set <code>CLOUDFLARE_ZT_API_TOKEN</code> (or <code>CLOUDFLARE_API_TOKEN</code>),{' '}
            <code>CLOUDFLARE_ACCOUNT_ID</code> and <code>CLOUDFLARE_DOCTOR_EMAIL_LIST_ID</code> in
            the server environment, then refresh.
          </div>
        )}

        {cfStatus?.configured && (
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt>Last sync</dt>
              <dd>
                {cfStatus.lastSync
                  ? `${new Date(cfStatus.lastSync.at).toLocaleString()} · ${cfStatus.lastSync.trigger}`
                  : 'Not run since server start'}
              </dd>
            </div>
            {cfStatus.lastSync && (
              <div className={styles.row}>
                <dt>Result</dt>
                <dd>
                  {cfStatus.lastSync.ok ? (
                    cfStatus.lastSync.skipped ? (
                      <span className={styles.warnText}>Skipped — no doctor emails to push</span>
                    ) : (
                      <span className={styles.okText}>
                        {cfStatus.lastSync.emailCount} email
                        {cfStatus.lastSync.emailCount === 1 ? '' : 's'} on the allow-list
                      </span>
                    )
                  ) : (
                    <span className={styles.warnText}>{cfStatus.lastSync.error || 'Failed'}</span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        )}

        {cfStatus?.configured && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void syncCloudflareList()}
              disabled={cfBusy}
            >
              {cfBusy ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default IntegrationsSettings;
