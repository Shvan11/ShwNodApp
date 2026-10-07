import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import styles from './TransferWorkModal.module.css';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import PatientSearchCombobox, { type PatientOption } from './PatientSearchCombobox';
import { useToast } from '../../contexts/ToastContext';
import { postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { transferPreviewQuery } from '@/query/queries';
import { WORK_STATUS } from '@shared/treatment-taxonomy';
import * as workContract from '@shared/contracts/work.contract';
import type { Work } from './WorkCard';

interface SelectedPatient {
  person_id: number;
  patient_name: string;
}

interface TransferWorkModalProps {
  work: Work;
  onClose: () => void;
  /** The work moved: the caller refreshes both patients and toasts (once). */
  onSuccess: (result: { workId: number; targetPatientId: number }) => void;
}

/**
 * TransferWorkModal — two steps: pick the target patient, then confirm against a
 * preview of what moves with the work. Opened from the (translated) Works page, so
 * it is translated too, and its From → To diagram reads the right way under RTL.
 */
const TransferWorkModal: React.FC<TransferWorkModalProps> = ({
  work,
  onClose,
  onSuccess
}) => {
  const { t } = useTranslation('works');
  const toast = useToast();
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatient | null>(null);
  const [nameQuery, setNameQuery] = useState('');
  const [phoneIdQuery, setPhoneIdQuery] = useState('');
  const [transferring, setTransferring] = useState(false);
  // The dialog opens to pick a patient, so focus starts in the name search (the
  // Modal would otherwise focus its first focusable, the header's close button).
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // The preview loads once a target is chosen; the confirm step shows when it has.
  const {
    data: preview,
    isLoading: loading,
    error: previewError,
  } = useQuery({
    ...transferPreviewQuery(work.work_id),
    enabled: selectedPatient !== null,
  });
  const step: 'search' | 'confirm' = selectedPatient && preview ? 'confirm' : 'search';

  // The pickers are the patient search's own (it used to be a three-AsyncSelect
  // `PatientQuickSearch` kept alive for this one dialog: audit FE-F4-13). They never
  // offer the work's own patient (`exclude`).
  const selectPatient = (patient: PatientOption) =>
    setSelectedPatient({ person_id: patient.id, patient_name: patient.name });

  const handleTransfer = async (): Promise<void> => {
    if (!selectedPatient) return;

    setTransferring(true);
    try {
      await postJSON(`/api/work/${work.work_id}/transfer`, { targetPatientId: selectedPatient.person_id }, {
        schema: workContract.transfer.response,
      });
      onSuccess({ workId: work.work_id, targetPatientId: selectedPatient.person_id });
    } catch (error) {
      // The server's own 404/409 text, read off the envelope's `error` (this used to
      // read `data.message`, which the envelope never carries: FE-F7-11).
      const status = (error as HttpError).status;
      const fallback = status === 409
        ? t('transfer.conflict')
        : status === 404
          ? t('transfer.notFound')
          : t('transfer.failed');
      toast.error(httpErrorMessage(error, fallback));
    } finally {
      setTransferring(false);
    }
  };

  const statusLabel = work.status === WORK_STATUS.FINISHED
    ? t('card.statusCompleted')
    : work.status === WORK_STATUS.DISCONTINUED
      ? t('card.statusDiscontinued')
      : t('card.statusActive');

  // What moves with the work. A wire on a visit is a lookup, not a record of the
  // patient's, so it is not counted; aligner batches are listed as well as counted.
  const related = preview?.relatedRecords;
  const relatedRows = related ? [
    { key: 'visits', n: related.visits, icon: 'fa-calendar-check', label: t('transfer.records.visits', { n: related.visits }) },
    { key: 'invoices', n: related.invoices, icon: 'fa-dollar-sign', label: t('transfer.records.payments', { n: related.invoices }) },
    { key: 'diagnoses', n: related.diagnoses, icon: 'fa-stethoscope', label: t('transfer.records.diagnoses', { n: related.diagnoses }) },
    { key: 'workItems', n: related.workItems, icon: 'fa-list', label: t('transfer.records.workItems', { n: related.workItems }) },
    { key: 'alignerSets', n: related.alignerSets, icon: 'fa-teeth', label: t('transfer.records.alignerSets', { n: related.alignerSets }) },
    { key: 'alignerBatches', n: related.alignerBatches, icon: 'fa-layer-group', label: t('transfer.records.alignerBatches', { n: related.alignerBatches }) },
    { key: 'implants', n: related.implants, icon: 'fa-tooth', label: t('transfer.records.implants', { n: related.implants }) },
    { key: 'screws', n: related.screws, icon: 'fa-cog', label: t('transfer.records.screws', { n: related.screws }) },
  ].filter((r) => r.n > 0) : [];
  const relatedTotal = relatedRows.reduce((sum, r) => sum + r.n, 0);

  const groupLabels = { ID: t('transfer.groupId'), Phone: t('transfer.groupPhone') };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      contentClassName={styles.modalContent}
      ariaLabelledBy="transfer-work-modal-title"
      initialFocusRef={nameInputRef}
    >
        <ModalHeader
          titleId="transfer-work-modal-title"
          title={t('transfer.title')}
          icon={<i className="fas fa-exchange-alt" aria-hidden="true" />}
          onClose={onClose}
        />

        <div className={styles.modalBody}>
          {step === 'search' && (
            <>
              {/* Current work info */}
              <div className={styles.currentInfo}>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>{t('common.workType')}</span>
                  <span className={styles.infoValue}>{work.type_name || t('card.otherTreatment')}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>{t('transfer.status')}</span>
                  <span className={styles.infoValue}>{statusLabel}</span>
                </div>
                {work.doctor_name && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>{t('common.doctor')}</span>
                    <span className={styles.infoValue}>{work.doctor_name}</span>
                  </div>
                )}
              </div>

              <div className={styles.searchSection}>
                <span className={styles.searchLabel}>{t('transfer.searchLabel')}</span>
                <div className={styles.searchFields}>
                  <label className={styles.searchField} htmlFor="transfer-search-name">
                    {t('transfer.byName')}
                    <PatientSearchCombobox
                      id="transfer-search-name"
                      value={nameQuery}
                      onChange={setNameQuery}
                      onPick={selectPatient}
                      exclude={work.person_id}
                      mode="name"
                      rtl
                      placeholder={t('transfer.namePlaceholder')}
                      hint={t('transfer.pickHint')}
                      errorText={t('transfer.lookupFailed')}
                      inputRef={nameInputRef}
                    />
                  </label>
                  <label className={styles.searchField} htmlFor="transfer-search-phone-id">
                    {t('transfer.byPhoneId')}
                    <PatientSearchCombobox
                      id="transfer-search-phone-id"
                      value={phoneIdQuery}
                      onChange={setPhoneIdQuery}
                      onPick={selectPatient}
                      exclude={work.person_id}
                      mode="phoneId"
                      placeholder={t('transfer.phoneIdPlaceholder')}
                      hint={t('transfer.pickHint')}
                      groupLabels={groupLabels}
                      errorText={t('transfer.lookupFailed')}
                    />
                  </label>
                </div>
                {selectedPatient && loading && (
                  <div className={styles.loadingIndicator}>
                    <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                    <span>{t('transfer.loadingPreview')}</span>
                  </div>
                )}
                {selectedPatient && previewError && (
                  <div className={styles.loadingIndicator} role="alert">
                    <i className="fas fa-exclamation-circle" aria-hidden="true"></i>
                    <span>{httpErrorMessage(previewError, t('transfer.previewFailed'))}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 'confirm' && preview && selectedPatient && (
            <div className={styles.confirmSection}>
              <div className={styles.transferSummary}>
                <h4>{t('transfer.summary')}</h4>

                <div className={styles.transferArrow}>
                  <div className={styles.patientBox}>
                    <span className={styles.boxLabel}>{t('transfer.from')}</span>
                    <span className={styles.boxName}>{preview.work.currentPatient.name}</span>
                    <span className={styles.boxId}>#{preview.work.currentPatient.personId}</span>
                  </div>
                  <div className={styles.arrowIcon}>
                    <i className="fas fa-arrow-right" aria-hidden="true"></i>
                  </div>
                  <div className={styles.patientBox}>
                    <span className={styles.boxLabel}>{t('transfer.to')}</span>
                    <span className={styles.boxName}>{selectedPatient.patient_name}</span>
                    <span className={styles.boxId}>#{selectedPatient.person_id}</span>
                  </div>
                </div>
              </div>

              {relatedRows.length > 0 && (
                <div className={styles.relatedRecords}>
                  <h4>
                    <i className="fas fa-link" aria-hidden="true"></i>
                    {t('transfer.related', { n: relatedTotal })}
                  </h4>
                  <ul>
                    {relatedRows.map((r) => (
                      <li key={r.key}><i className={`fas ${r.icon}`} aria-hidden="true"></i> {r.label}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className={styles.warningBox}>
                <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                <p>{t('transfer.warning')}</p>
              </div>
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          {step === 'search' && (
            <button
              type="button"
              onClick={onClose}
              className={styles.btnSecondary}
            >
              {t('common.cancel')}
            </button>
          )}
          {step === 'confirm' && (
            <>
              <button
                type="button"
                onClick={() => setSelectedPatient(null)}
                className={styles.btnSecondary}
              >
                <i className={`fas fa-arrow-left ${styles.backIcon}`} aria-hidden="true"></i> {t('transfer.back')}
              </button>
              <button
                type="button"
                onClick={handleTransfer}
                disabled={transferring}
                className={styles.btnPrimary}
              >
                {transferring ? (
                  <>
                    <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {t('transfer.transferring')}
                  </>
                ) : (
                  <>
                    <i className="fas fa-exchange-alt" aria-hidden="true"></i> {t('transfer.confirm')}
                  </>
                )}
              </button>
            </>
          )}
        </div>
    </Modal>
  );
};

export default TransferWorkModal;
