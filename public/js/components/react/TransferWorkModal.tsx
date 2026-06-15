import React, { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import styles from './TransferWorkModal.module.css';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import { useToast } from '../../contexts/ToastContext';
import PatientQuickSearch, { type SelectedPatient } from './PatientQuickSearch';
import { postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { transferPreviewQuery } from '@/query/queries';

/**
 * Work data for transfer
 */
interface Work {
  work_id: number;
  person_id: number;
  type_name?: string;
  status_name?: string;
  doctor_name?: string;
  total_required?: number;
  currency?: string;
  patient_name?: string;
}

/**
 * Transfer preview data from API
 */
interface TransferPreview {
  work: {
    workId: number;
    type: string;
    status: string;
    doctor: string;
    totalRequired: number;
    currency: string;
    currentPatient: {
      personId: number;
      name: string;
    };
  };
  relatedRecords: {
    visits: number;
    invoices: number;
    diagnoses: number;
    workItems: number;
    alignerSets: number;
    alignerBatches: number;
    wires: number;
    implants: number;
    screws: number;
  };
}

/**
 * Props for TransferWorkModal
 */
interface TransferWorkModalProps {
  work: Work;
  onClose: () => void;
  onSuccess: (result: { sourcePatientId: number; targetPatientId: number }) => void;
}

/**
 * TransferWorkModal Component
 * Two-step modal for transferring a work to a different patient
 */
const TransferWorkModal: React.FC<TransferWorkModalProps> = ({
  work,
  onClose,
  onSuccess
}) => {
  const toast = useToast();
  const [step, setStep] = useState<'search' | 'confirm'>('search');
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatient | null>(null);
  const [transferring, setTransferring] = useState(false);

  // Load the transfer preview once a target patient is chosen (gated on selection
  // in the search step). The factory is keyed on the work id and stays disabled
  // until a patient is selected.
  const {
    data: previewData,
    isLoading: loading,
    isError: previewError,
    error: previewErrorObj,
  } = useQuery({
    ...transferPreviewQuery(work.work_id),
    enabled: selectedPatient !== null,
  });
  const preview = (previewData ?? null) as TransferPreview | null;

  // Advance to the confirm step once the preview is available. Done during render
  // (tracking the previous ready-state so it only fires on the transition) rather
  // than in an effect, so the React Compiler can optimize.
  const previewReady = !!preview && selectedPatient !== null;
  const [prevPreviewReady, setPrevPreviewReady] = useState(previewReady);
  if (previewReady !== prevPreviewReady) {
    setPrevPreviewReady(previewReady);
    if (previewReady) setStep('confirm');
  }

  // Surface a load failure as a toast.
  useEffect(() => {
    if (previewError) {
      toast.error(httpErrorMessage(previewErrorObj, 'Failed to load transfer preview'));
    }
  }, [previewError, previewErrorObj, toast]);

  // Handle patient selection from QuickSearch
  const handleSelectPatient = useCallback((patient: SelectedPatient): void => {
    setSelectedPatient(patient);
  }, []);

  // Execute transfer
  const handleTransfer = async (): Promise<void> => {
    if (!selectedPatient) return;

    setTransferring(true);
    try {
      await postJSON(`/api/work/${work.work_id}/transfer`, { targetPatientId: selectedPatient.person_id });

      toast.success(`Work transferred to ${selectedPatient.patient_name}`);
      onSuccess({
        sourcePatientId: work.person_id,
        targetPatientId: selectedPatient.person_id
      });
    } catch (error) {
      // Preserve the status-specific messaging the route returns (409/404), reading
      // off the thrown HttpError instead of the raw Response.
      const status = (error as HttpError).status;
      const data = (error as HttpError).data as { message?: string } | undefined;
      if (status === 409) {
        toast.error(data?.message || 'Target patient already has an active work');
      } else if (status === 404) {
        toast.error(data?.message || 'Work or patient not found');
      } else {
        toast.error(httpErrorMessage(error, 'Transfer failed'));
      }
    } finally {
      setTransferring(false);
    }
  };

  // Get total related records count
  const getTotalRelatedRecords = (): number => {
    if (!preview) return 0;
    const r = preview.relatedRecords;
    return r.visits + r.invoices + r.diagnoses + r.workItems +
           r.alignerSets + r.alignerBatches + r.wires + r.implants + r.screws;
  };

  return (
    <Modal isOpen={true} onClose={onClose} contentClassName={styles.modalContent}>
        {/* Header */}
        <ModalHeader
          title="Transfer Work"
          icon={<i className="fas fa-exchange-alt" />}
          onClose={onClose}
        />

        {/* Body */}
        <div className={styles.modalBody}>
          {step === 'search' && (
            <>
              {/* Current work info */}
              <div className={styles.currentInfo}>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Work Type:</span>
                  <span className={styles.infoValue}>{work.type_name || 'Unknown'}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Status:</span>
                  <span className={styles.infoValue}>{work.status_name || 'Unknown'}</span>
                </div>
                {work.doctor_name && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>Doctor:</span>
                    <span className={styles.infoValue}>{work.doctor_name}</span>
                  </div>
                )}
              </div>

              {/* Search section using reusable PatientQuickSearch */}
              <div className={styles.searchSection}>
                <span className={styles.searchLabel}>
                  Search for target patient:
                </span>
                <PatientQuickSearch
                    onSelect={handleSelectPatient}
                    excludePatientIds={[work.person_id]}
                    layout="vertical"
                    showHeader={false}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                    autoFocus={true}
                />
                {loading && (
                  <div className={styles.loadingIndicator}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Loading preview...</span>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 'confirm' && preview && selectedPatient && (
            <div className={styles.confirmSection}>
              {/* Transfer summary */}
              <div className={styles.transferSummary}>
                <h4>Transfer Summary</h4>

                <div className={styles.transferArrow}>
                  <div className={styles.patientBox}>
                    <span className={styles.boxLabel}>From</span>
                    <span className={styles.boxName}>{preview.work.currentPatient.name}</span>
                    <span className={styles.boxId}>#{preview.work.currentPatient.personId}</span>
                  </div>
                  <div className={styles.arrowIcon}>
                    <i className="fas fa-arrow-right"></i>
                  </div>
                  <div className={styles.patientBox}>
                    <span className={styles.boxLabel}>To</span>
                    <span className={styles.boxName}>{selectedPatient.patient_name}</span>
                    <span className={styles.boxId}>#{selectedPatient.person_id}</span>
                  </div>
                </div>
              </div>

              {/* Related records */}
              {getTotalRelatedRecords() > 0 && (
                <div className={styles.relatedRecords}>
                  <h4>
                    <i className="fas fa-link"></i>
                    Related Records ({getTotalRelatedRecords()} total)
                  </h4>
                  <ul>
                    {preview.relatedRecords.visits > 0 && (
                      <li><i className="fas fa-calendar-check"></i> {preview.relatedRecords.visits} visit(s)</li>
                    )}
                    {preview.relatedRecords.invoices > 0 && (
                      <li><i className="fas fa-dollar-sign"></i> {preview.relatedRecords.invoices} payment(s)</li>
                    )}
                    {preview.relatedRecords.diagnoses > 0 && (
                      <li><i className="fas fa-stethoscope"></i> {preview.relatedRecords.diagnoses} diagnosis(es)</li>
                    )}
                    {preview.relatedRecords.workItems > 0 && (
                      <li><i className="fas fa-list"></i> {preview.relatedRecords.workItems} work item(s)</li>
                    )}
                    {preview.relatedRecords.alignerSets > 0 && (
                      <li><i className="fas fa-teeth"></i> {preview.relatedRecords.alignerSets} aligner set(s)</li>
                    )}
                    {preview.relatedRecords.wires > 0 && (
                      <li><i className="fas fa-bezier-curve"></i> {preview.relatedRecords.wires} wire(s)</li>
                    )}
                    {preview.relatedRecords.implants > 0 && (
                      <li><i className="fas fa-tooth"></i> {preview.relatedRecords.implants} implant(s)</li>
                    )}
                    {preview.relatedRecords.screws > 0 && (
                      <li><i className="fas fa-cog"></i> {preview.relatedRecords.screws} screw(s)</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Warning */}
              <div className={styles.warningBox}>
                <i className="fas fa-exclamation-triangle"></i>
                <p>
                  This action cannot be undone. The source patient will lose access
                  to this work and all related records.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.modalFooter}>
          {step === 'search' && (
            <button
              type="button"
              onClick={onClose}
              className={styles.btnSecondary}
            >
              Cancel
            </button>
          )}
          {step === 'confirm' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setStep('search');
                  setSelectedPatient(null);
                }}
                className={styles.btnSecondary}
              >
                <i className="fas fa-arrow-left"></i> Back
              </button>
              <button
                type="button"
                onClick={handleTransfer}
                disabled={transferring}
                className={styles.btnPrimary}
              >
                {transferring ? (
                  <>
                    <i className="fas fa-spinner fa-spin"></i> Transferring...
                  </>
                ) : (
                  <>
                    <i className="fas fa-exchange-alt"></i> Confirm Transfer
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
