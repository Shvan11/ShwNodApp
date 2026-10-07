import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { formatLocaleDateTime } from '../../utils/formatters';
import { postJSON, httpErrorMessage } from '@/core/http';
import { portalStatusQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import * as patientContract from '@shared/contracts/patient.contract';
import viewStyles from './ViewPatientInfo.module.css';
import styles from './PortalAccessCard.module.css';

interface Props {
  personId: number;
}

/**
 * Staff side of the Patient Portal for one patient: enable/disable, PIN, lock state, QR.
 * Rendered only for roles the portal routes admit (`roleCaps().managePatientPortal`,
 * checked by the caller). Lives on the translated patient-info page, so it is in the
 * `patients` namespace (audit FE-F22-12).
 */
const PortalAccessCard = ({ personId }: Props) => {
  const { t } = useTranslation('patients');
  const { language } = useLanguage();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: status, isLoading: loading, error: queryError, refetch } = useQuery(
    portalStatusQuery(personId)
  );
  const error = queryError ? httpErrorMessage(queryError, t('portal.toast.loadFailed')) : null;

  const [busyAction, setBusyAction] = useState<
    null | 'enable' | 'reset' | 'unlock'
  >(null);
  const [newPin, setNewPin] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const formatDateTime = (iso: string | null): string => {
    if (!iso) return t('portal.never');
    return formatLocaleDateTime(iso, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }, language) || iso;
  };

  const invalidatePortal = () =>
    queryClient.invalidateQueries({ queryKey: qk.patient.portal(personId) });

  const handleEnableToggle = async () => {
    if (!status || busyAction) return;
    const next = !status.enabled;
    setBusyAction('enable');
    try {
      await postJSON(`/api/patients/${personId}/portal/enable`, { enabled: next });
      await invalidatePortal();
      toast.success(next ? t('portal.toast.enabledOn') : t('portal.toast.enabledOff'));
    } catch (err) {
      toast.error(httpErrorMessage(err, t('portal.toast.updateFailed')));
    } finally {
      setBusyAction(null);
    }
  };

  const handleResetPin = async () => {
    if (busyAction) return;
    // Replacing a working PIN locks the patient out until they get the new one, so it
    // asks first; creating the first PIN doesn't.
    if (status?.hasPin) {
      const ok = await confirm(t('portal.confirmReset.message'), {
        title: t('portal.confirmReset.title'),
        confirmText: t('portal.confirmReset.confirm'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusyAction('reset');
    try {
      const data = await postJSON<patientContract.ResetPinResponse>(
        `/api/patients/${personId}/portal/reset-pin`,
        {},
        { schema: patientContract.resetPin.response }
      );
      setNewPin(data.pin);
      setCopyState('idle');
      await invalidatePortal();
    } catch (err) {
      toast.error(httpErrorMessage(err, t('portal.toast.resetFailed')));
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnlock = async () => {
    if (busyAction) return;
    setBusyAction('unlock');
    try {
      await postJSON(`/api/patients/${personId}/portal/unlock`, {});
      toast.success(t('portal.toast.unlocked'));
      await invalidatePortal();
    } catch (err) {
      toast.error(httpErrorMessage(err, t('portal.toast.unlockFailed')));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyPin = async () => {
    if (!newPin) return;
    try {
      await navigator.clipboard.writeText(newPin);
      setCopyState('copied');
    } catch {
      toast.error(t('portal.toast.copyFailed'));
    }
  };

  // Put the Copy button back 1.5 s after a copy; cleared if the dialog closes first.
  useEffect(() => {
    if (copyState !== 'copied') return;
    const id = setTimeout(() => setCopyState('idle'), 1500);
    return () => clearTimeout(id);
  }, [copyState]);

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
        <i className={`fas fa-qrcode ${viewStyles.piIconGap}`} aria-hidden="true"></i>
        {t('portal.title')}
      </h3>

      {loading && (
        <div className={styles.loadingRow}>
          <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {t('portal.loading')}
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
            {t('portal.retry')}
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
            <span>{t('portal.enabled')}</span>
          </label>

          <div className={styles.statusGrid}>
            <div>
              <span className={styles.label}>{t('portal.pin')}</span>
              <span className={styles.value}>
                {status.hasPin ? t('portal.pinSet') : t('portal.pinNotSet')}
              </span>
            </div>
            <div>
              <span className={styles.label}>{t('portal.lastLogin')}</span>
              <span className={styles.value}>
                {formatDateTime(status.lastLoginAt)}
              </span>
            </div>
            <div>
              <span className={styles.label}>{t('portal.failedAttempts')}</span>
              <span className={styles.value}>{status.failedAttempts}</span>
            </div>
            <div>
              <span className={styles.label}>{t('portal.status')}</span>
              <span
                className={
                  isLocked
                    ? `${styles.value} ${styles.valueWarning}`
                    : styles.value
                }
              >
                {isLocked
                  ? t('portal.lockedUntil', { time: formatDateTime(status.lockedUntil) })
                  : status.enabled
                  ? t('portal.active')
                  : t('portal.disabled')}
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
              <i className="fas fa-key" aria-hidden="true"></i>{' '}
              {status.hasPin ? t('portal.resetPin') : t('portal.createPin')}
            </button>
            {isLocked && (
              <button
                type="button"
                className="btn btn-warning btn-sm"
                onClick={handleUnlock}
                disabled={busyAction === 'unlock'}
              >
                <i className="fas fa-unlock" aria-hidden="true"></i> {t('portal.unlock')}
              </button>
            )}
          </div>

          {status.qrDataUrl && (
            <div className={styles.qrBlock}>
              <img
                src={status.qrDataUrl}
                alt={t('portal.qrAlt')}
                className={styles.qrImage}
              />
              {status.portalUrl && (
                <code className={styles.portalUrl}>{status.portalUrl}</code>
              )}
              {status.usesDefaultAddress && (
                <p className={styles.qrWarning} role="alert">
                  <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>{' '}
                  {t('portal.defaultAddress')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* The PIN is shown once, so only Done closes this — a stray backdrop click or
          Escape used to throw it away (audit FE-F22-12). */}
      <Modal
        isOpen={newPin !== null}
        onClose={() => setNewPin(null)}
        closeOnBackdropClick={false}
        closeOnEscape={false}
        contentClassName={styles.pinModal}
        ariaLabelledBy="portal-pin-modal-title"
      >
        <div className={styles.pinModalBody}>
          <h3 id="portal-pin-modal-title" className={styles.pinModalTitle}>
            {t('portal.pinModal.title')}
          </h3>
          <p className={styles.pinModalHint}>
            {t('portal.pinModal.hint')}
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
                } aria-hidden="true"
              ></i>{' '}
              {copyState === 'copied' ? t('portal.pinModal.copied') : t('portal.pinModal.copy')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setNewPin(null)}
            >
              {t('portal.pinModal.done')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PortalAccessCard;
