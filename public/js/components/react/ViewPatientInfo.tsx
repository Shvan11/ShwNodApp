import { useState, useEffect, useCallback, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import DolphinPhotoDialog from './DolphinPhotoDialog';
import AlertModal from './AlertModal';
import { useToast } from '../../contexts/ToastContext';
import styles from './ViewPatientInfo.module.css';

interface Props {
    personId?: number | null;  // Validated PersonID from loader (null if invalid)
}

interface Alert {
    AlertID: number;
    AlertDetails: string;
    AlertTypeID?: number;
    AlertSeverity?: number;
    CreationDate?: string;
}

interface PatientInfo {
    PersonID: number;
    PatientName?: string;
    FirstName?: string;
    LastName?: string;
    Phone?: string;
    Phone2?: string;
    Email?: string;
    DateOfBirth?: string;
    Gender?: string;
    GenderDisplay?: string;
    Address?: string;
    ReferralSource?: string;
    PatientType?: string;
    Tag?: string;
    Notes?: string;
    DateAdded?: string;
    CountryCode?: string;
    DolphinId?: number | null;
    EstimatedCost?: string | number;
    Currency?: string;
    Language?: number;
    AlertCount?: number;
}

interface EditingCostState {
    value: string;
    currency: string;
}

type Currency = 'IQD' | 'USD' | 'EUR';

interface CostPreset {
    PresetID: number;
    Amount: number;
    Currency: Currency;
    DisplayOrder: number;
}

interface AlertType {
    AlertTypeID: number;
    TypeName: string;
}

const ViewPatientInfo = ({ personId }: Props) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [alertsLoading, setAlertsLoading] = useState(false);
    const [alertTypes, setAlertTypes] = useState<AlertType[]>([]);
    const [showAlertModal, setShowAlertModal] = useState(false);
    const [deletingAlertId, setDeletingAlertId] = useState<number | null>(null);
    const [showDolphinDialog, setShowDolphinDialog] = useState(false);
    const [editingAlert, setEditingAlert] = useState<Alert | null>(null);

    // Cost editing state
    const [editingCost, setEditingCost] = useState<EditingCostState | null>(null);
    const [savingCost, setSavingCost] = useState(false);
    const [costPresets, setCostPresets] = useState<CostPreset[]>([]);
    const [presetsLoading, setPresetsLoading] = useState(false);

    // Use validated PersonID from loader, fallback to patientInfo.PersonID
    const validPersonId = personId ?? patientInfo?.PersonID ?? null;

    const formatPhoneDisplay = (countryCode: string | undefined, phone: string | undefined): string => {
        if (!phone) return '-';
        if (!countryCode) return phone;
        return `+${countryCode.replace('+', '')} ${phone}`;
    };

    const formatDateDisplay = (dateStr: string | undefined): string => {
        if (!dateStr) return '-';
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch {
            return dateStr;
        }
    };

    const calculateAge = (dateOfBirth: string | undefined): string => {
        if (!dateOfBirth) return '-';
        try {
            const dob = new Date(dateOfBirth);
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const monthDiff = today.getMonth() - dob.getMonth();
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
                age--;
            }
            return `${age} years old`;
        } catch {
            return '-';
        }
    };

    const getLanguageDisplay = (langId: number | undefined): string => {
        switch (langId) {
            case 0: return 'Kurdish';
            case 1: return 'Arabic';
            case 2: return 'English';
            default: return '-';
        }
    };

    // Format cost for display
    const formatCostDisplay = (cost: string | number | undefined, currency: string | undefined): string => {
        if (!cost) return '-';
        const numericCost = typeof cost === 'string' ? parseFloat(cost) : cost;
        if (isNaN(numericCost)) return '-';

        const formattedNumber = numericCost.toLocaleString('en-US');
        return `${formattedNumber} ${currency || 'IQD'}`;
    };

    // Format cost for input (with commas)
    const formatCostInput = (value: string): string => {
        const numericValue = value.replace(/[^0-9]/g, '');
        if (!numericValue) return '';
        return parseInt(numericValue).toLocaleString('en-US');
    };

    // Parse formatted input to numeric value
    const parseCostInput = (value: string): string => {
        return value.replace(/[^0-9]/g, '');
    };

    const loadPatientInfo = useCallback(async () => {
        // Use validated personId from loader
        if (!personId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await fetch(`/api/patients/${personId}/info`);

            if (!response.ok) {
                throw new Error('Failed to load patient info');
            }

            const data = await response.json();
            setPatientInfo(data);
        } catch (err) {
            console.error('Error loading patient info:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [personId]);

    const loadAlerts = useCallback(async () => {
        // Use validated personId from loader
        if (!personId) return;

        try {
            setAlertsLoading(true);
            const response = await fetch(`/api/patients/${personId}/alerts`);

            if (response.ok) {
                const data = await response.json();
                setAlerts(data);
            }
        } catch (err) {
            console.error('Error loading alerts:', err);
        } finally {
            setAlertsLoading(false);
        }
    }, [personId]);

    const loadCostPresets = useCallback(async () => {
        try {
            setPresetsLoading(true);
            const response = await fetch('/api/settings/cost-presets');
            if (response.ok) {
                const data = await response.json();
                setCostPresets(data);
            }
        } catch (err) {
            console.error('Error loading cost presets:', err);
        } finally {
            setPresetsLoading(false);
        }
    }, []);

    const loadAlertTypes = useCallback(async () => {
        try {
            const response = await fetch('/api/alert-types');
            if (response.ok) {
                const data = await response.json();
                setAlertTypes(data);
            }
        } catch (err) {
            console.error('Error loading alert types:', err);
        }
    }, []);

    useEffect(() => {
        loadPatientInfo();
        loadAlerts();
        loadCostPresets();
        loadAlertTypes();
    }, [personId, loadPatientInfo, loadAlerts, loadCostPresets, loadAlertTypes]);

    // Handle alert modal save - refresh alerts list
    const handleAlertSaved = async () => {
        await loadAlerts();
    };

    const handleDeleteAlert = async (alertId: number) => {
        try {
            setDeletingAlertId(alertId);
            const response = await fetch(`/api/alerts/${alertId}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: false })
            });

            if (!response.ok) {
                throw new Error('Failed to delete alert');
            }

            loadAlerts(); // Reload alerts
            toast.success('Alert deleted');
        } catch (err) {
            console.error('Error deleting alert:', err);
            toast.error('Failed to delete alert');
        } finally {
            setDeletingAlertId(null);
        }
    };

    // Cost editing handlers
    const handleStartEditingCost = () => {
        setEditingCost({
            value: patientInfo?.EstimatedCost?.toString() || '',
            currency: patientInfo?.Currency || 'IQD'
        });
    };

    const handleSaveCost = async () => {
        if (!editingCost || !validPersonId) return;

        try {
            setSavingCost(true);

            const response = await fetch(`/api/patients/${validPersonId}/estimated-cost`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    estimatedCost: parseCostInput(editingCost.value),
                    currency: editingCost.currency
                })
            });

            if (!response.ok) {
                throw new Error('Failed to save cost');
            }

            toast.success('Cost updated successfully');
            setEditingCost(null);
            loadPatientInfo(); // Reload to get updated data
        } catch (err) {
            console.error('Error saving cost:', err);
            toast.error('Failed to save cost');
        } finally {
            setSavingCost(false);
        }
    };

    const handleCancelEditingCost = () => {
        setEditingCost(null);
    };

    // Handle preset selection
    const handleSelectPreset = (preset: CostPreset) => {
        setEditingCost({
            value: preset.Amount.toString(),
            currency: preset.Currency
        });
    };

    // Get presets filtered by current currency
    const getFilteredPresets = (): CostPreset[] => {
        if (!editingCost) return [];
        return costPresets
            .filter(p => p.Currency === editingCost.currency)
            .sort((a, b) => a.DisplayOrder - b.DisplayOrder);
    };

    // Format preset amount for display
    const formatPresetAmount = (amount: number): string => {
        return amount.toLocaleString('en-US');
    };

    if (loading) {
        return (
            <div className={styles.patientInfoLoading}>
                <i className={`fas fa-spinner fa-spin ${styles.patientLoadingSpinner}`}></i>
                <p>Loading patient information...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.patientInfoError}>
                <i className={`fas fa-exclamation-triangle ${styles.patientErrorIcon}`}></i>
                <p>{error}</p>
                <button onClick={loadPatientInfo}>Retry</button>
            </div>
        );
    }

    if (!patientInfo) {
        return (
            <div className={styles.patientInfoEmpty}>
                <i className={`fas fa-user ${styles.patientEmptyIcon}`}></i>
                <p>No patient information found</p>
            </div>
        );
    }

    return (
        <div className={styles.patientInfoContainer}>
            {/* Header Section */}
            <div className={styles.patientInfoHeader}>
                <div className={styles.patientAvatar}>
                    <i className={`fas fa-user-circle ${styles.patientAvatarIcon}`}></i>
                </div>
                <div className={styles.patientHeaderDetails}>
                    <h2 className={styles.patientPrimaryName}>{patientInfo.PatientName}</h2>
                    <p className={styles.patientSecondaryName}>
                        {(patientInfo.FirstName || patientInfo.LastName) && (
                            <span>{patientInfo.FirstName} {patientInfo.LastName}</span>
                        )}
                        <span className={styles.patientId}>ID: {patientInfo.PersonID}</span>
                    </p>
                </div>
                <div className={styles.patientHeaderActions}>
                    <button
                        onClick={() => navigate(`/patient/${validPersonId}/edit-patient`)}
                        className="btn btn-primary"
                        disabled={!validPersonId}
                    >
                        <i className={`fas fa-edit ${styles.piIconGap}`}></i>
                        Edit Patient
                    </button>
                    <button
                        onClick={() => setShowDolphinDialog(true)}
                        className="btn btn-secondary"
                    >
                        <i className={`fas fa-camera ${styles.piIconGap}`}></i>
                        Add Photos
                    </button>
                </div>
            </div>

            {/* Alerts Section */}
            <div className={styles.patientAlertsSection}>
                <div className={styles.patientAlertHeader}>
                    <h3 className={styles.patientSectionTitle}>
                        <i className={`fas fa-exclamation-triangle ${styles.alertIcon} ${styles.piIconGap}`}></i>
                        Alerts
                    </h3>
                    <button
                        onClick={() => {
                            setEditingAlert(null);
                            setShowAlertModal(true);
                        }}
                        className="btn btn-warning btn-sm"
                        disabled={!validPersonId}
                    >
                        <i className={`fas fa-plus ${styles.piIconGap}`}></i>
                        Add Alert
                    </button>
                </div>
                {alertsLoading ? (
                    <div className={styles.patientAlertsLoading}>
                        <i className="fas fa-spinner fa-spin"></i>
                        Loading alerts...
                    </div>
                ) : alerts.length > 0 ? (
                    <div className={styles.patientAlertsList}>
                        {alerts.map(alert => (
                            <div key={alert.AlertID} className={styles.patientAlertItem}>
                                <div className={styles.patientAlertContent}>
                                    <span className={styles.patientAlertText}>{alert.AlertDetails}</span>
                                    {alert.CreationDate && (
                                        <span className={styles.patientAlertDate}>
                                            {new Date(alert.CreationDate).toLocaleDateString('en-US', {
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric'
                                            })}
                                        </span>
                                    )}
                                </div>
                                <div className={styles.patientAlertActions}>
                                    <button
                                        onClick={() => {
                                            setEditingAlert(alert);
                                            setShowAlertModal(true);
                                        }}
                                        className={styles.patientAlertEdit}
                                        title="Edit alert"
                                    >
                                        <i className="fas fa-pencil-alt"></i>
                                    </button>
                                    <button
                                        onClick={() => handleDeleteAlert(alert.AlertID)}
                                        disabled={deletingAlertId === alert.AlertID}
                                        className={styles.patientAlertDelete}
                                        title="Archive alert"
                                    >
                                        {deletingAlertId === alert.AlertID ? (
                                            <i className="fas fa-spinner fa-spin"></i>
                                        ) : (
                                            <i className="fas fa-times"></i>
                                        )}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className={styles.patientAlertsEmpty}>
                        No alerts for this patient
                    </div>
                )}
            </div>

            {/* Info Grid */}
            <div className={styles.patientInfoGrid}>
                {/* Contact Information */}
                <div className={styles.patientInfoCard}>
                    <h3 className={styles.patientCardTitle}>
                        <i className={`fas fa-address-book ${styles.piIconGap}`}></i>
                        Contact Information
                    </h3>
                    <div className={styles.patientInfoRows}>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Phone:</span>
                            <span className={styles.patientInfoValue}>
                                {formatPhoneDisplay(patientInfo.CountryCode, patientInfo.Phone)}
                            </span>
                        </div>
                        {patientInfo.Phone2 && (
                            <div className={styles.patientInfoRow}>
                                <span className={styles.patientInfoLabel}>Phone 2:</span>
                                <span className={styles.patientInfoValue}>{patientInfo.Phone2}</span>
                            </div>
                        )}
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Email:</span>
                            <span className={styles.patientInfoValue}>{patientInfo.Email || '-'}</span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Address:</span>
                            <span className={styles.patientInfoValue}>{patientInfo.Address || '-'}</span>
                        </div>
                    </div>
                </div>

                {/* Personal Information */}
                <div className={styles.patientInfoCard}>
                    <h3 className={styles.patientCardTitle}>
                        <i className={`fas fa-user ${styles.piIconGap}`}></i>
                        Personal Information
                    </h3>
                    <div className={styles.patientInfoRows}>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Date of Birth:</span>
                            <span className={styles.patientInfoValue}>
                                {formatDateDisplay(patientInfo.DateOfBirth)}
                            </span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Age:</span>
                            <span className={styles.patientInfoValue}>
                                {calculateAge(patientInfo.DateOfBirth)}
                            </span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Gender:</span>
                            <span className={styles.patientInfoValue}>
                                {patientInfo.GenderDisplay || patientInfo.Gender || '-'}
                            </span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Language:</span>
                            <span className={styles.patientInfoValue}>
                                {getLanguageDisplay(patientInfo.Language)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Additional Information */}
                <div className={styles.patientInfoCard}>
                    <h3 className={styles.patientCardTitle}>
                        <i className={`fas fa-info-circle ${styles.piIconGap}`}></i>
                        Additional Information
                    </h3>
                    <div className={styles.patientInfoRows}>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Patient Type:</span>
                            <span className={styles.patientInfoValue}>{patientInfo.PatientType || '-'}</span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Referral Source:</span>
                            <span className={styles.patientInfoValue}>{patientInfo.ReferralSource || '-'}</span>
                        </div>
                        {patientInfo.Tag && (
                            <div className={styles.patientInfoRow}>
                                <span className={styles.patientInfoLabel}>Tag:</span>
                                <span className={`${styles.patientInfoValue} ${styles.patientTag}`}>{patientInfo.Tag}</span>
                            </div>
                        )}
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Dolphin ID:</span>
                            <span className={styles.patientInfoValue}>
                                {patientInfo.DolphinId || '-'}
                            </span>
                        </div>
                        <div className={styles.patientInfoRow}>
                            <span className={styles.patientInfoLabel}>Date Added:</span>
                            <span className={styles.patientInfoValue}>
                                {formatDateDisplay(patientInfo.DateAdded)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Cost Information */}
                <div className={styles.patientInfoCard}>
                    <h3 className={styles.patientCardTitle}>
                        <i className={`fas fa-dollar-sign ${styles.piIconGap}`}></i>
                        Estimated Cost
                    </h3>
                    <div className={styles.patientInfoRows}>
                        {editingCost ? (
                            <div className={styles.patientCostEditForm}>
                                <div className={styles.patientCostInputGroup}>
                                    <input
                                        type="text"
                                        value={formatCostInput(editingCost.value)}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => setEditingCost({
                                            ...editingCost,
                                            value: parseCostInput(e.target.value)
                                        })}
                                        className={styles.patientCostInput}
                                        placeholder="Enter cost..."
                                    />
                                    <select
                                        value={editingCost.currency}
                                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setEditingCost({
                                            ...editingCost,
                                            currency: e.target.value
                                        })}
                                        className={styles.patientCostCurrency}
                                    >
                                        <option value="IQD">IQD</option>
                                        <option value="USD">USD</option>
                                        <option value="EUR">EUR</option>
                                    </select>
                                </div>
                                {/* Cost Presets */}
                                {presetsLoading ? (
                                    <div className={styles.patientCostPresetsLoading}>
                                        <i className="fas fa-spinner fa-spin"></i>
                                    </div>
                                ) : getFilteredPresets().length > 0 && (
                                    <div className={styles.patientCostPresets}>
                                        {getFilteredPresets().map(preset => (
                                            <button
                                                key={preset.PresetID}
                                                type="button"
                                                onClick={() => handleSelectPreset(preset)}
                                                className={styles.patientCostPresetBtn}
                                            >
                                                {formatPresetAmount(preset.Amount)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className={styles.patientCostEditActions}>
                                    <button
                                        onClick={handleSaveCost}
                                        disabled={savingCost}
                                        className="btn btn-primary btn-sm"
                                    >
                                        {savingCost ? (
                                            <i className="fas fa-spinner fa-spin"></i>
                                        ) : (
                                            <i className="fas fa-check"></i>
                                        )}
                                    </button>
                                    <button
                                        onClick={handleCancelEditingCost}
                                        disabled={savingCost}
                                        className="btn btn-secondary btn-sm"
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className={styles.patientInfoRow}>
                                <span className={styles.patientInfoLabel}>Estimated Cost:</span>
                                <span className={`${styles.patientInfoValue} ${styles.patientCostDisplay}`}>
                                    {formatCostDisplay(patientInfo.EstimatedCost, patientInfo.Currency)}
                                    <button
                                        onClick={handleStartEditingCost}
                                        className={styles.patientCostEditBtn}
                                        title="Edit cost"
                                    >
                                        <i className="fas fa-pencil-alt"></i>
                                    </button>
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Notes */}
                <div className={`${styles.patientInfoCard} ${styles.patientNotesCard}`}>
                    <h3 className={styles.patientCardTitle}>
                        <i className={`fas fa-sticky-note ${styles.piIconGap}`}></i>
                        Notes
                    </h3>
                    <div className={styles.patientNotesContent}>
                        {patientInfo.Notes || <span className={styles.patientNotesEmpty}>No notes for this patient</span>}
                    </div>
                </div>
            </div>

            {/* Dolphin Photo Dialog */}
            {showDolphinDialog && validPersonId && (
                <DolphinPhotoDialog
                    personId={String(validPersonId)}
                    patientInfo={patientInfo}
                    onClose={() => setShowDolphinDialog(false)}
                />
            )}

            {/* Alert Modal */}
            {validPersonId && (
                <AlertModal
                    isOpen={showAlertModal}
                    onClose={() => {
                        setShowAlertModal(false);
                        setEditingAlert(null);
                    }}
                    onSave={handleAlertSaved}
                    personId={validPersonId}
                    alertTypes={alertTypes}
                    editAlert={editingAlert}
                />
            )}
        </div>
    );
};

export default ViewPatientInfo;
