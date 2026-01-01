import { useState, useEffect, useCallback, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import DolphinPhotoDialog from './DolphinPhotoDialog';
import AlertModal from './AlertModal';
import { useToast } from '../../contexts/ToastContext';

interface Props {
    patientId?: string;
}

interface Alert {
    AlertID: number;
    AlertDetails: string;
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
    patientID?: string;
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

const ViewPatientInfo = ({ patientId }: Props) => {
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

    // Cost editing state
    const [editingCost, setEditingCost] = useState<EditingCostState | null>(null);
    const [savingCost, setSavingCost] = useState(false);
    const [costPresets, setCostPresets] = useState<CostPreset[]>([]);
    const [presetsLoading, setPresetsLoading] = useState(false);

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
        if (!patientId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await fetch(`/api/patients/${patientId}/info`);

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
    }, [patientId]);

    const loadAlerts = useCallback(async () => {
        if (!patientId) return;

        try {
            setAlertsLoading(true);
            const response = await fetch(`/api/patients/${patientId}/alerts`);

            if (response.ok) {
                const data = await response.json();
                setAlerts(data);
            }
        } catch (err) {
            console.error('Error loading alerts:', err);
        } finally {
            setAlertsLoading(false);
        }
    }, [patientId]);

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
    }, [patientId, loadPatientInfo, loadAlerts, loadCostPresets, loadAlertTypes]);

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
        if (!editingCost) return;

        try {
            setSavingCost(true);

            const response = await fetch(`/api/patients/${patientId}/estimated-cost`, {
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
            <div className="patient-info-loading">
                <i className="fas fa-spinner fa-spin patient-loading-spinner"></i>
                <p>Loading patient information...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="patient-info-error">
                <i className="fas fa-exclamation-triangle patient-error-icon"></i>
                <p>{error}</p>
                <button onClick={loadPatientInfo}>Retry</button>
            </div>
        );
    }

    if (!patientInfo) {
        return (
            <div className="patient-info-empty">
                <i className="fas fa-user patient-empty-icon"></i>
                <p>No patient information found</p>
            </div>
        );
    }

    return (
        <div className="patient-info-container">
            {/* Header Section */}
            <div className="patient-info-header">
                <div className="patient-avatar">
                    <i className="fas fa-user-circle patient-avatar-icon"></i>
                </div>
                <div className="patient-header-details">
                    <h2 className="patient-primary-name">{patientInfo.PatientName}</h2>
                    {(patientInfo.FirstName || patientInfo.LastName) && (
                        <p className="patient-secondary-name">
                            {patientInfo.FirstName} {patientInfo.LastName}
                        </p>
                    )}
                    <p className="patient-id">ID: {patientInfo.patientID || patientInfo.PersonID}</p>
                </div>
                <div className="patient-header-actions">
                    <button
                        onClick={() => navigate(`/patient/${patientId}/edit-patient`)}
                        className="btn btn-primary"
                    >
                        <i className="fas fa-edit pi-icon-gap"></i>
                        Edit Patient
                    </button>
                    <button
                        onClick={() => setShowDolphinDialog(true)}
                        className="btn btn-secondary"
                    >
                        <i className="fas fa-camera pi-icon-gap"></i>
                        Add Photos
                    </button>
                </div>
            </div>

            {/* Alerts Section */}
            {(alerts.length > 0 || (patientInfo.AlertCount != null && patientInfo.AlertCount > 0)) && (
                <div className="patient-alerts-section">
                    <h3 className="patient-section-title">
                        <i className="fas fa-exclamation-triangle alert-icon pi-icon-gap"></i>
                        Important Alerts
                    </h3>
                    <div className="patient-alerts-list">
                        {alertsLoading ? (
                            <div className="patient-alerts-loading">
                                <i className="fas fa-spinner fa-spin"></i>
                                Loading alerts...
                            </div>
                        ) : (
                            alerts.map(alert => (
                                <div key={alert.AlertID} className="patient-alert-item">
                                    <span className="patient-alert-text">{alert.AlertDetails}</span>
                                    <button
                                        onClick={() => handleDeleteAlert(alert.AlertID)}
                                        disabled={deletingAlertId === alert.AlertID}
                                        className="patient-alert-delete"
                                        title="Delete alert"
                                    >
                                        {deletingAlertId === alert.AlertID ? (
                                            <i className="fas fa-spinner fa-spin"></i>
                                        ) : (
                                            <i className="fas fa-times"></i>
                                        )}
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Add Alert Button */}
            <div className="patient-add-alert-section">
                <button
                    onClick={() => setShowAlertModal(true)}
                    className="btn btn-warning"
                >
                    <i className="fas fa-plus pi-icon-gap"></i>
                    Add New Alert
                </button>
            </div>

            {/* Info Grid */}
            <div className="patient-info-grid">
                {/* Contact Information */}
                <div className="patient-info-card">
                    <h3 className="patient-card-title">
                        <i className="fas fa-address-book pi-icon-gap"></i>
                        Contact Information
                    </h3>
                    <div className="patient-info-rows">
                        <div className="patient-info-row">
                            <span className="patient-info-label">Phone:</span>
                            <span className="patient-info-value">
                                {formatPhoneDisplay(patientInfo.CountryCode, patientInfo.Phone)}
                            </span>
                        </div>
                        {patientInfo.Phone2 && (
                            <div className="patient-info-row">
                                <span className="patient-info-label">Phone 2:</span>
                                <span className="patient-info-value">{patientInfo.Phone2}</span>
                            </div>
                        )}
                        <div className="patient-info-row">
                            <span className="patient-info-label">Email:</span>
                            <span className="patient-info-value">{patientInfo.Email || '-'}</span>
                        </div>
                        <div className="patient-info-row">
                            <span className="patient-info-label">Address:</span>
                            <span className="patient-info-value">{patientInfo.Address || '-'}</span>
                        </div>
                    </div>
                </div>

                {/* Personal Information */}
                <div className="patient-info-card">
                    <h3 className="patient-card-title">
                        <i className="fas fa-user pi-icon-gap"></i>
                        Personal Information
                    </h3>
                    <div className="patient-info-rows">
                        <div className="patient-info-row">
                            <span className="patient-info-label">Date of Birth:</span>
                            <span className="patient-info-value">
                                {formatDateDisplay(patientInfo.DateOfBirth)}
                            </span>
                        </div>
                        <div className="patient-info-row">
                            <span className="patient-info-label">Age:</span>
                            <span className="patient-info-value">
                                {calculateAge(patientInfo.DateOfBirth)}
                            </span>
                        </div>
                        <div className="patient-info-row">
                            <span className="patient-info-label">Gender:</span>
                            <span className="patient-info-value">
                                {patientInfo.GenderDisplay || patientInfo.Gender || '-'}
                            </span>
                        </div>
                        <div className="patient-info-row">
                            <span className="patient-info-label">Language:</span>
                            <span className="patient-info-value">
                                {getLanguageDisplay(patientInfo.Language)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Additional Information */}
                <div className="patient-info-card">
                    <h3 className="patient-card-title">
                        <i className="fas fa-info-circle pi-icon-gap"></i>
                        Additional Information
                    </h3>
                    <div className="patient-info-rows">
                        <div className="patient-info-row">
                            <span className="patient-info-label">Patient Type:</span>
                            <span className="patient-info-value">{patientInfo.PatientType || '-'}</span>
                        </div>
                        <div className="patient-info-row">
                            <span className="patient-info-label">Referral Source:</span>
                            <span className="patient-info-value">{patientInfo.ReferralSource || '-'}</span>
                        </div>
                        {patientInfo.Tag && (
                            <div className="patient-info-row">
                                <span className="patient-info-label">Tag:</span>
                                <span className="patient-info-value patient-tag">{patientInfo.Tag}</span>
                            </div>
                        )}
                        <div className="patient-info-row">
                            <span className="patient-info-label">Dolphin ID:</span>
                            <span className="patient-info-value">
                                {patientInfo.DolphinId || '-'}
                            </span>
                        </div>
                        <div className="patient-info-row">
                            <span className="patient-info-label">Date Added:</span>
                            <span className="patient-info-value">
                                {formatDateDisplay(patientInfo.DateAdded)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Cost Information */}
                <div className="patient-info-card">
                    <h3 className="patient-card-title">
                        <i className="fas fa-dollar-sign pi-icon-gap"></i>
                        Estimated Cost
                    </h3>
                    <div className="patient-info-rows">
                        {editingCost ? (
                            <div className="patient-cost-edit-form">
                                <div className="patient-cost-input-group">
                                    <input
                                        type="text"
                                        value={formatCostInput(editingCost.value)}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => setEditingCost({
                                            ...editingCost,
                                            value: parseCostInput(e.target.value)
                                        })}
                                        className="patient-cost-input"
                                        placeholder="Enter cost..."
                                    />
                                    <select
                                        value={editingCost.currency}
                                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setEditingCost({
                                            ...editingCost,
                                            currency: e.target.value
                                        })}
                                        className="patient-cost-currency"
                                    >
                                        <option value="IQD">IQD</option>
                                        <option value="USD">USD</option>
                                        <option value="EUR">EUR</option>
                                    </select>
                                </div>
                                {/* Cost Presets */}
                                {presetsLoading ? (
                                    <div className="patient-cost-presets-loading">
                                        <i className="fas fa-spinner fa-spin"></i>
                                    </div>
                                ) : getFilteredPresets().length > 0 && (
                                    <div className="patient-cost-presets">
                                        {getFilteredPresets().map(preset => (
                                            <button
                                                key={preset.PresetID}
                                                type="button"
                                                onClick={() => handleSelectPreset(preset)}
                                                className="patient-cost-preset-btn"
                                            >
                                                {formatPresetAmount(preset.Amount)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className="patient-cost-edit-actions">
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
                            <div className="patient-info-row">
                                <span className="patient-info-label">Estimated Cost:</span>
                                <span className="patient-info-value patient-cost-display">
                                    {formatCostDisplay(patientInfo.EstimatedCost, patientInfo.Currency)}
                                    <button
                                        onClick={handleStartEditingCost}
                                        className="patient-cost-edit-btn"
                                        title="Edit cost"
                                    >
                                        <i className="fas fa-pencil-alt"></i>
                                    </button>
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Notes Section */}
            {patientInfo.Notes && (
                <div className="patient-notes-section">
                    <h3 className="patient-section-title">
                        <i className="fas fa-sticky-note pi-icon-gap"></i>
                        Notes
                    </h3>
                    <div className="patient-notes-content">
                        {patientInfo.Notes}
                    </div>
                </div>
            )}

            {/* Dolphin Photo Dialog */}
            {showDolphinDialog && (
                <DolphinPhotoDialog
                    patientId={patientId}
                    patientInfo={patientInfo}
                    onClose={() => setShowDolphinDialog(false)}
                />
            )}

            {/* Alert Modal */}
            <AlertModal
                isOpen={showAlertModal}
                onClose={() => setShowAlertModal(false)}
                onSave={handleAlertSaved}
                personId={patientId || ''}
                alertTypes={alertTypes}
            />
        </div>
    );
};

export default ViewPatientInfo;
