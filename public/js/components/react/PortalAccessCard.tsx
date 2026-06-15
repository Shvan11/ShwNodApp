import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import { useToast } from '../../contexts/ToastContext';
import { postJSON, httpErrorMessage } from '@/core/http';
import { portalStatusQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import * as patientContract from '@shared/contracts/patient.contract';
import viewStyles from './ViewPatientInfo.module.css';
import styles from './PortalAccessCard.module.css';

interface Props {
  personId: number;
}

// Staff-side portal read shapes. The contract's `portalStatus.response` is a loose
// container (only `enabled` enumerated), so these annotate the long-tail fields
// this card reads — co-located with the sole consumer rather than in the
// envelope-only api.types.ts.

/** Normalized read-shape of GET /api/patients/:id/portal. */
interface PortalStatus {
  enabled: boolean;
  hasPin: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  failedAttempts: number;
  qrDataUrl: string;
  portalUrl: string;
}

/** POST /api/patients/:id/portal/reset-pin. */
interface PortalPinResetResponse {
  success: boolean;
  pin?: string;
  error?: string;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PortalAccessCard = ({ personId }: Props) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading: loading, error: queryError, refetch } = useQuery(
    portalStatusQuery(personId)
  );
  const error = queryError ? httpErrorMessage(queryError, 'Unknown error') : null;

  const status: PortalStatus | null = useMemo(() => {
    if (!data) return null;
    const d = data as Partial<PortalStatus>;
    return {
      enabled: d.enabled ?? false,
      hasPin: d.hasPin ?? false,
      lockedUntil: d.lockedUntil ?? null,
      lastLoginAt: d.lastLoginAt ?? null,
      failedAttempts: d.failedAttempts ?? 0,
      qrDataUrl: d.qrDataUrl ?? '',
      portalUrl: d.portalUrl ?? '',
    };
  }, [data]);

  const [busyAction, setBusyAction] = useState<
    null | 'enable' | 'reset' | 'unlock'
  >(null);
  const [newPin, setNewPin] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const invalidatePortal = () =>
    queryClient.invalidateQueries({ queryKey: qk.patient.portal(personId) });

  const handleEnableToggle = async () => {
    if (!status || busyAction) return;
    const next = !status.enabled;
    setBusyAction('enable');
    try {
      await postJSON(`/api/patients/${personId}/portal/enable`, { enabled: next });
      await invalidatePortal();
      toast.success(next ? 'Portal access enabled' : 'Portal access disabled');
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to update'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleResetPin = async () => {
    if (busyAction) return;
    setBusyAction('reset');
    try {
      const data = await postJSON<PortalPinResetResponse>(`/api/patients/${personId}/portal/reset-pin`, {}, { schema: patientContract.resetPin.response });
      if (!data.pin) {
        throw new Error(data.error || 'Failed to reset PIN');
      }
      setNewPin(data.pin);
      setCopyState('idle');
      await invalidatePortal();
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to reset PIN'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnlock = async () => {
    if (busyAction) return;
    setBusyAction('unlock');
    try {
      await postJSON(`/api/patients/${personId}/portal/unlock`, {});
      toast.success('Portal access unlocked');
      await invalidatePortal();
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to unlock'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyPin = async () => {
    if (!newPin) return;
    try {
      await navigator.clipboard.writeText(newPin);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      toast.error('Unable to copy — please write the PIN down.');
    }
  };

  // A clock used only to re-evaluate the lock against the current time. `Date.now()`
  // can't be read during render (impure → the badge would never refresh on its own),
  // so we snapshot it once and schedule a single re-render the moment `lockedUntil`
  // passes — the "Locked until …" badge then clears itself without a manual refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!status?.lockedUntil) return;
    const ms = new Date(status.lockedUntil).getTime() - Date.now();
    if (ms <= 0) return; // already expired — the current snapshot is correct
    const id = setTimeout(() => setNow(Date.now()), ms);
    return () => clearTimeout(id);
  }, [status?.lockedUntil]);

  const isLocked =
    !!status?.lockedUntil &&
    new Date(status.lockedUntil).getTime() > now;

  return (
    <div className={viewStyles.patientInfoCard}>
      <h3 className={viewStyles.patientCardTitle}>
        <i className={`fas fa-qrcode ${viewStyles.piIconGap}`}></i>
        Portal Access
      </h3>

      {loading && (
        <div className={styles.loadingRow}>
          <i className="fas fa-spinner fa-spin"></i> Loading…
        </div>
      )}

      {error && !loading && (
        <div className={styles.errorRow}>
          {error}{' '}
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => refetch()}
          >
            Retry
          </button>
        </div>
      )}

      {status && !loading && (
        <div className={styles.cardBody}>
          <label className={styles.enableRow}>
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={busyAction === 'enable'}
              onChange={handleEnableToggle}
            />
            <span>Portal access enabled</span>
          </label>

          <div className={styles.statusGrid}>
            <div>
              <span className={styles.label}>PIN</span>
              <span className={styles.value}>
                {status.hasPin ? 'Set' : 'Not set'}
              </span>
            </div>
            <div>
              <span className={styles.label}>Last login</span>
              <span className={styles.value}>
                {formatDateTime(status.lastLoginAt)}
              </span>
            </div>
            <div>
              <span className={styles.label}>Failed attempts</span>
              <span className={styles.value}>{status.failedAttempts}</span>
            </div>
            <div>
              <span className={styles.label}>Status</span>
              <span
                className={
                  isLocked
                    ? `${styles.value} ${styles.valueWarning}`
                    : styles.value
                }
              >
                {isLocked
                  ? `Locked until ${formatDateTime(status.lockedUntil)}`
                  : status.enabled
                  ? 'Active'
                  : 'Disabled'}
              </span>
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleResetPin}
              disabled={busyAction === 'reset'}
            >
              <i className="fas fa-key"></i>{' '}
              {status.hasPin ? 'Reset PIN' : 'Create PIN'}
            </button>
            {isLocked && (
              <button
                type="button"
                className="btn btn-warning btn-sm"
                onClick={handleUnlock}
                disabled={busyAction === 'unlock'}
              >
                <i className="fas fa-unlock"></i> Unlock
              </button>
            )}
          </div>

          {status.qrDataUrl && (
            <div className={styles.qrBlock}>
              <img
                src={status.qrDataUrl}
                alt="Portal QR code"
                className={styles.qrImage}
              />
              {status.portalUrl && (
                <code className={styles.portalUrl}>{status.portalUrl}</code>
              )}
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={newPin !== null}
        onClose={() => setNewPin(null)}
        contentClassName={styles.pinModal}
        ariaLabelledBy="portal-pin-modal-title"
      >
        <div className={styles.pinModalBody}>
          <h3 id="portal-pin-modal-title" className={styles.pinModalTitle}>
            New Portal PIN
          </h3>
          <p className={styles.pinModalHint}>
            Share this PIN with the patient now — it won't be shown again.
          </p>
          <div className={styles.pinDisplay}>{newPin}</div>
          <div className={styles.pinModalActions}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCopyPin}
            >
              <i
                className={
                  copyState === 'copied' ? 'fas fa-check' : 'fas fa-copy'
                }
              ></i>{' '}
              {copyState === 'copied' ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setNewPin(null)}
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PortalAccessCard;
