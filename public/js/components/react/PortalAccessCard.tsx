import { useCallback, useEffect, useState } from 'react';
import type {
  PortalStatus,
  PortalStatusResponse,
  PortalPinResetResponse,
} from '@/types/api.types';
import Modal from './Modal';
import { useToast } from '../../contexts/ToastContext';
import viewStyles from './ViewPatientInfo.module.css';
import styles from './PortalAccessCard.module.css';

interface Props {
  personId: number;
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
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    null | 'enable' | 'reset' | 'unlock'
  >(null);
  const [newPin, setNewPin] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/patients/${personId}/portal`, {
        credentials: 'same-origin',
      });
      const data = (await res.json()) as PortalStatusResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load portal status');
      }
      setStatus({
        enabled: data.enabled ?? false,
        hasPin: data.hasPin ?? false,
        lockedUntil: data.lockedUntil ?? null,
        lastLoginAt: data.lastLoginAt ?? null,
        failedAttempts: data.failedAttempts ?? 0,
        qrDataUrl: data.qrDataUrl ?? '',
        portalUrl: data.portalUrl ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleEnableToggle = async () => {
    if (!status || busyAction) return;
    const next = !status.enabled;
    setBusyAction('enable');
    try {
      const res = await fetch(`/api/patients/${personId}/portal/enable`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update');
      }
      setStatus({ ...status, enabled: next });
      toast.success(next ? 'Portal access enabled' : 'Portal access disabled');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setBusyAction(null);
    }
  };

  const handleResetPin = async () => {
    if (busyAction) return;
    setBusyAction('reset');
    try {
      const res = await fetch(`/api/patients/${personId}/portal/reset-pin`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = (await res.json()) as PortalPinResetResponse;
      if (!res.ok || !data.success || !data.pin) {
        throw new Error(data.error || 'Failed to reset PIN');
      }
      setNewPin(data.pin);
      setCopyState('idle');
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset PIN');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnlock = async () => {
    if (busyAction) return;
    setBusyAction('unlock');
    try {
      const res = await fetch(`/api/patients/${personId}/portal/unlock`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to unlock');
      }
      toast.success('Portal access unlocked');
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unlock');
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

  const isLocked =
    !!status?.lockedUntil &&
    new Date(status.lockedUntil).getTime() > Date.now();

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
            onClick={loadStatus}
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
