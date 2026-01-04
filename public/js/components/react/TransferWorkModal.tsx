import React, { useState, useEffect, useCallback } from 'react';
import styles from './TransferWorkModal.module.css';
import { useToast } from '../../contexts/ToastContext';

/**
 * Work data for transfer
 */
interface Work {
  workid: number;
  PersonID: number;
  TypeName?: string;
  StatusName?: string;
  DoctorName?: string;
  TotalRequired?: number;
  Currency?: string;
  PatientName?: string;
}

/**
 * Patient search result
 */
interface PatientSearchResult {
  PersonID: number;
  PatientName: string;
  Phone?: string;
}

/**
 * Transfer preview data from API
 */
interface TransferPreview {
  success: boolean;
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
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<PatientSearchResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSearchResult | null>(null);
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);

  // Search patients with debounce
  useEffect(() => {
    if (searchTerm.length < 2) {
      setSearchResults([]);
      return;
    }

    const searchPatients = async (): Promise<void> => {
      setLoading(true);
      try {
        const response = await fetch(`/api/patients/search?q=${encodeURIComponent(searchTerm)}`);
        if (!response.ok) {
          throw new Error('Search failed');
        }
        const data = await response.json() as PatientSearchResult[];
        // Exclude current patient from results
        const filtered = data.filter((p) => p.PersonID !== work.PersonID);
        setSearchResults(filtered);
      } catch (error) {
        console.error('Search failed:', error);
        toast.error('Failed to search patients');
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(searchPatients, 300);
    return () => clearTimeout(debounce);
  }, [searchTerm, work.PersonID, toast]);

  // Load preview when patient selected
  const loadPreview = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await fetch(`/api/work/${work.workid}/transfer-preview`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to load preview');
      }
      const data = await response.json() as TransferPreview;
      setPreview(data);
      setStep('confirm');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load transfer preview');
    } finally {
      setLoading(false);
    }
  }, [work.workid, toast]);

  // Handle patient selection
  const handleSelectPatient = (patient: PatientSearchResult): void => {
    setSelectedPatient(patient);
    loadPreview();
  };

  // Execute transfer
  const handleTransfer = async (): Promise<void> => {
    if (!selectedPatient) return;

    setTransferring(true);
    try {
      const response = await fetch(`/api/work/${work.workid}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPatientId: selectedPatient.PersonID })
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          toast.error(result.message || 'Target patient already has an active work');
        } else if (response.status === 404) {
          toast.error(result.message || 'Work or patient not found');
        } else {
          throw new Error(result.error || result.message || 'Transfer failed');
        }
        return;
      }

      toast.success(`Work transferred to ${selectedPatient.PatientName}`);
      onSuccess({
        sourcePatientId: work.PersonID,
        targetPatientId: selectedPatient.PersonID
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Transfer failed');
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

  // Handle overlay click (close modal)
  const handleOverlayClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={handleOverlayClick}>
      <div className={styles.modalContent}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerLeft}>
            <i className="fas fa-exchange-alt"></i>
            <h3>Transfer Work</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={styles.closeBtn}
            aria-label="Close"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>
          {step === 'search' && (
            <>
              {/* Current work info */}
              <div className={styles.currentInfo}>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Work Type:</span>
                  <span className={styles.infoValue}>{work.TypeName || 'Unknown'}</span>
                </div>
                <div className={styles.infoRow}>
                  <span className={styles.infoLabel}>Status:</span>
                  <span className={styles.infoValue}>{work.StatusName || 'Unknown'}</span>
                </div>
                {work.DoctorName && (
                  <div className={styles.infoRow}>
                    <span className={styles.infoLabel}>Doctor:</span>
                    <span className={styles.infoValue}>{work.DoctorName}</span>
                  </div>
                )}
              </div>

              {/* Search section */}
              <div className={styles.searchSection}>
                <label htmlFor="patient-search" className={styles.searchLabel}>
                  Search for target patient:
                </label>
                <div className={styles.searchInputWrapper}>
                  <i className="fas fa-search"></i>
                  <input
                    id="patient-search"
                    type="text"
                    placeholder="Enter patient name or phone..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className={styles.searchInput}
                    autoFocus
                  />
                  {loading && <i className="fas fa-spinner fa-spin"></i>}
                </div>

                {/* Search results */}
                <div className={styles.searchResults}>
                  {searchResults.length === 0 && searchTerm.length >= 2 && !loading && (
                    <div className={styles.noResults}>No patients found</div>
                  )}
                  {searchResults.map((patient) => (
                    <button
                      key={patient.PersonID}
                      type="button"
                      className={styles.patientRow}
                      onClick={() => handleSelectPatient(patient)}
                    >
                      <span className={styles.patientName}>{patient.PatientName}</span>
                      {patient.Phone && (
                        <span className={styles.patientPhone}>{patient.Phone}</span>
                      )}
                      <span className={styles.patientId}>#{patient.PersonID}</span>
                    </button>
                  ))}
                </div>
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
                    <span className={styles.boxName}>{selectedPatient.PatientName}</span>
                    <span className={styles.boxId}>#{selectedPatient.PersonID}</span>
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
                  setPreview(null);
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
      </div>
    </div>
  );
};

export default TransferWorkModal;
