import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import AlertModal from './AlertModal.jsx';

const ViewPatientInfo = ({ patientId }) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [patientData, setPatientData] = useState(null);
    const [lookupData, setLookupData] = useState({
        genders: [],
        addresses: [],
        referralSources: [],
        patientTypes: [],
        tags: []
    });
    const [editingCost, setEditingCost] = useState(false);
    const [costValue, setCostValue] = useState('');
    const [currencyValue, setCurrencyValue] = useState('IQD');
    const [savingCost, setSavingCost] = useState(false);
    const [costPresets, setCostPresets] = useState([]);
    const [isCustomCost, setIsCustomCost] = useState(false);
    const [customCostValue, setCustomCostValue] = useState('');
    const [alertTypes, setAlertTypes] = useState([]);
    const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);

    const loadPatientData = useCallback(async () => {
        if (!patientId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await fetch(`/api/getpatient/${patientId}`);

            if (!response.ok) throw new Error('Failed to load patient data');

            const data = await response.json();
            console.log('Patient data loaded:', data);
            console.log('Alerts:', data.alerts);
            setPatientData(data);
            setError(null);
        } catch (err) {
            console.error('Error loading patient data:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [patientId]);

    const loadLookupData = useCallback(async () => {
        try {
            const [gendersRes, addressesRes, referralsRes, typesRes, alertTypesRes, tagsRes] = await Promise.all([
                fetch('/api/genders'),
                fetch('/api/addresses'),
                fetch('/api/referral-sources'),
                fetch('/api/patient-types'),
                fetch('/api/alert-types'),
                fetch('/api/tag-options')
            ]);

            const lookups = {
                genders: gendersRes.ok ? await gendersRes.json() : [],
                addresses: addressesRes.ok ? await addressesRes.json() : [],
                referralSources: referralsRes.ok ? await referralsRes.json() : [],
                patientTypes: typesRes.ok ? await typesRes.json() : [],
                tags: tagsRes.ok ? await tagsRes.json() : []
            };

            setLookupData(lookups);

            // Set alert types separately
            if (alertTypesRes.ok) {
                const types = await alertTypesRes.json();
                setAlertTypes(types);
            }
        } catch (err) {
            console.error('Error loading lookup data:', err);
        }
    }, []);

    const loadCostPresets = useCallback(async () => {
        try {
            const response = await fetch('/api/settings/cost-presets');
            if (response.ok) {
                const presets = await response.json();
                setCostPresets(presets);
            }
        } catch (err) {
            console.error('Error loading cost presets:', err);
        }
    }, []);

    useEffect(() => {
        loadPatientData();
        loadLookupData();
        loadCostPresets();
    }, [loadPatientData, loadLookupData, loadCostPresets]);

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const getGenderName = (genderId) => {
        const gender = lookupData.genders.find(g => g.GenderID === genderId);
        return gender?.GenderName || 'N/A';
    };

    const getAddressName = (addressId) => {
        const address = lookupData.addresses.find(a => a.AddressID === addressId);
        return address?.AddressName || 'N/A';
    };

    const getReferralSourceName = (referralId) => {
        const source = lookupData.referralSources.find(r => r.ReferralSourceID === referralId);
        return source?.SourceName || 'N/A';
    };

    const getPatientTypeName = (typeId) => {
        const type = lookupData.patientTypes.find(t => t.PatientTypeID === typeId);
        return type?.TypeName || 'N/A';
    };

    const getTagName = (tagId) => {
        const tag = lookupData.tags.find(t => t.id === tagId);
        return tag?.tag || 'N/A';
    };

    const calculateAge = (dateOfBirth) => {
        if (!dateOfBirth) return 'N/A';
        const birthDate = new Date(dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return `${age} years`;
    };

    const handleEditCost = () => {
        const currentCost = patientData.EstimatedCost;
        const currentCurrency = patientData.Currency || 'IQD';

        setCurrencyValue(currentCurrency);

        // Check if current cost matches a preset
        const matchingPreset = costPresets.find(
            p => p.Amount === parseFloat(currentCost) && p.Currency === currentCurrency
        );

        if (matchingPreset) {
            // Use preset value
            setCostValue(currentCost);
            setIsCustomCost(false);
            setCustomCostValue('');
        } else {
            // Use custom value
            setCostValue('custom');
            setIsCustomCost(true);
            setCustomCostValue(currentCost || '');
        }

        setEditingCost(true);
    };

    const handleSaveCost = async () => {
        try {
            setSavingCost(true);

            // Determine the final cost value to save
            const finalCost = isCustomCost ? customCostValue : costValue;

            if (!finalCost) {
                toast.warning('Please enter a cost value');
                setSavingCost(false);
                return;
            }

            const response = await fetch(`/api/patients/${patientData.PersonID}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ...patientData,
                    EstimatedCost: finalCost || null,
                    Currency: currencyValue
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to update estimated cost');
            }

            // Update local state
            setPatientData({
                ...patientData,
                EstimatedCost: finalCost || null,
                Currency: currencyValue
            });
            setEditingCost(false);
            setIsCustomCost(false);
            setCustomCostValue('');
            toast.success('Estimated cost updated successfully');
        } catch (err) {
            console.error('Error saving cost:', err);
            toast.error('Failed to save estimated cost');
        } finally {
            setSavingCost(false);
        }
    };

    const handleCancelCost = () => {
        setEditingCost(false);
        setCostValue('');
        setCurrencyValue('IQD');
        setIsCustomCost(false);
        setCustomCostValue('');
    };

    const formatNumberWithCommas = (value) => {
        if (!value) return '';
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };

    const handlePresetSelectChange = (e) => {
        const selectedValue = e.target.value;
        if (selectedValue === 'custom') {
            setIsCustomCost(true);
            setCostValue('custom');
            setCustomCostValue('');
        } else {
            setIsCustomCost(false);
            setCostValue(selectedValue);
            setCustomCostValue('');
        }
    };

    const handleCustomCostInputChange = (e) => {
        // Remove non-numeric characters except for the value itself
        const rawValue = e.target.value.replace(/,/g, '');
        if (rawValue === '' || /^\d+$/.test(rawValue)) {
            setCustomCostValue(rawValue);
        }
    };

    const handleCurrencyChange = (e) => {
        setCurrencyValue(e.target.value);
    };

    // Alert handlers
    const handleAddAlert = () => {
        setIsAlertModalOpen(true);
    };

    const handleAlertSaved = async () => {
        // Refresh patient data to get updated alerts
        await loadPatientData();
    };

    const handleToggleAlert = async (alert) => {
        try {
            const newStatus = !alert.IsActive;
            const response = await fetch(`/api/alerts/${alert.AlertID}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ isActive: newStatus })
            });

            if (!response.ok) {
                throw new Error('Failed to update alert status');
            }

            toast.success(`Alert ${newStatus ? 'activated' : 'deactivated'} successfully`);
            await loadPatientData(); // Refresh data
        } catch (error) {
            console.error('Error toggling alert:', error);
            toast.error('Failed to update alert status');
        }
    };

    if (loading) {
        return (
            <div className="patient-info-viewer">
                <div className="loading-container">
                    <i className="fas fa-spinner fa-spin fa-2x"></i>
                    <p>Loading patient information...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="patient-info-viewer">
                <div className="error-container">
                    <i className="fas fa-exclamation-triangle fa-2x"></i>
                    <h3>Error Loading Patient Data</h3>
                    <p>{error}</p>
                    <button onClick={loadPatientData} className="btn btn-primary">
                        <i className="fas fa-redo"></i> Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!patientData) {
        return (
            <div className="patient-info-viewer">
                <div className="error-container">
                    <i className="fas fa-user-slash fa-2x"></i>
                    <h3>Patient Not Found</h3>
                    <p>No data available for patient ID: {patientId}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="patient-info-viewer">
            {/* Header with Edit Button */}
            <div className="patient-info-header">
                <div className="header-title">
                    <i className="fas fa-id-card"></i>
                    <h2>Patient Information</h2>
                </div>
                <button
                    onClick={() => navigate(`/patient/${patientId}/edit-patient`)}
                    className="btn btn-primary edit-btn"
                >
                    <i className="fas fa-edit"></i> Edit Patient
                </button>
            </div>

            {/* Patient Info Cards */}
            <div className="patient-info-content">
                {/* Personal Information Card */}
                <div className="info-card">
                    <div className="card-header">
                        <i className="fas fa-user"></i>
                        <h3>Personal Information</h3>
                    </div>
                    <div className="card-body">
                        <div className="info-row">
                            <span className="info-label">Patient ID:</span>
                            <span className="info-value">{patientData.patientID || 'N/A'}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Full Name:</span>
                            <span className="info-value">{patientData.PatientName || 'N/A'}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">First Name:</span>
                            <span className="info-value">{patientData.FirstName || 'N/A'}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Last Name:</span>
                            <span className="info-value">{patientData.LastName || 'N/A'}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Date of Birth:</span>
                            <span className="info-value">{formatDate(patientData.DateofBirth)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Age:</span>
                            <span className="info-value">{calculateAge(patientData.DateofBirth)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Gender:</span>
                            <span className="info-value">{getGenderName(patientData.Gender)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Date Added:</span>
                            <span className="info-value">{formatDate(patientData.DateAdded)}</span>
                        </div>
                    </div>
                </div>

                {/* Contact Information Card */}
                <div className="info-card">
                    <div className="card-header">
                        <i className="fas fa-phone"></i>
                        <h3>Contact Information</h3>
                    </div>
                    <div className="card-body">
                        <div className="info-row">
                            <span className="info-label">Primary Phone:</span>
                            <span className="info-value">{patientData.Phone || 'N/A'}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Secondary Phone:</span>
                            <span className="info-value">{patientData.Phone2 || 'N/A'}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Email:</span>
                            <span className="info-value">{patientData.Email || 'N/A'}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Address:</span>
                            <span className="info-value">{getAddressName(patientData.AddressID)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Country Code:</span>
                            <span className="info-value">{patientData.CountryCode || 'N/A'}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Language:</span>
                            <span className="info-value">{patientData.Language === '0' ? 'Kurdish' : 'English'}</span>
                        </div>
                    </div>
                </div>

                {/* Medical Information Card */}
                <div className="info-card">
                    <div className="card-header">
                        <i className="fas fa-notes-medical"></i>
                        <h3>Medical Information</h3>
                    </div>
                    <div className="card-body">
                        <div className="info-row">
                            <span className="info-label">Patient Type:</span>
                            <span className="info-value">{getPatientTypeName(patientData.PatientTypeID)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Referral Source:</span>
                            <span className="info-value">{getReferralSourceName(patientData.ReferralSourceID)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Tag:</span>
                            <span className="info-value">{getTagName(patientData.TagID)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">
                                Estimated Cost (Consultation):
                                {!editingCost && (
                                    <button
                                        onClick={handleEditCost}
                                        className="btn-edit-inline"
                                        title="Edit estimated cost"
                                    >
                                        <i className="fas fa-pen"></i>
                                    </button>
                                )}
                            </span>
                            {editingCost ? (
                                <span className="info-value cost-edit-container">
                                    <select
                                        value={currencyValue}
                                        onChange={handleCurrencyChange}
                                        className="cost-edit-select"
                                    >
                                        <option value="IQD">IQD</option>
                                        <option value="USD">USD</option>
                                        <option value="EUR">EUR</option>
                                    </select>
                                    <select
                                        value={costValue}
                                        onChange={handlePresetSelectChange}
                                        className="cost-edit-select-preset"
                                        disabled={isCustomCost && costValue !== 'custom'}
                                    >
                                        <option value="">Select amount...</option>
                                        {costPresets
                                            .filter(p => p.Currency === currencyValue)
                                            .map(preset => (
                                                <option key={preset.PresetID} value={preset.Amount}>
                                                    {formatNumberWithCommas(preset.Amount)}
                                                </option>
                                            ))}
                                        <option value="custom">Custom Amount...</option>
                                    </select>
                                    {isCustomCost && (
                                        <input
                                            type="text"
                                            value={formatNumberWithCommas(customCostValue)}
                                            onChange={handleCustomCostInputChange}
                                            placeholder="Enter custom amount"
                                            className="cost-edit-input-custom"
                                        />
                                    )}
                                    <button
                                        onClick={handleSaveCost}
                                        disabled={savingCost}
                                        className="cost-edit-save"
                                    >
                                        {savingCost ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check"></i>}
                                    </button>
                                    <button
                                        onClick={handleCancelCost}
                                        disabled={savingCost}
                                        className="cost-edit-cancel"
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>
                                </span>
                            ) : (
                                <span className="info-value cost-value-display">
                                    {patientData.EstimatedCost
                                        ? `${formatNumberWithCommas(patientData.EstimatedCost)} ${patientData.Currency || 'IQD'}`
                                        : 'Not set'}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Alerts Card */}
                <div className="info-card alerts-card">
                    <div className="card-header">
                        <div className="card-header-title">
                            <i className="fas fa-exclamation-triangle"></i>
                            <h3>Alerts</h3>
                        </div>
                        <button
                            onClick={handleAddAlert}
                            className="btn-add-alert"
                            title="Add new alert"
                        >
                            <i className="fas fa-plus"></i>
                            Add Alert
                        </button>
                    </div>
                    <div className="card-body">
                        {!patientData.alerts || patientData.alerts.length === 0 ? (
                            <p className="no-alerts">No alerts for this patient</p>
                        ) : (
                            <div className="alert-list">
                                {patientData.alerts
                                    .sort((a, b) => {
                                        // Sort by IsActive (active first), then by severity (high to low), then by date (newest first)
                                        if (a.IsActive !== b.IsActive) return b.IsActive - a.IsActive;
                                        if (a.AlertSeverity !== b.AlertSeverity) return b.AlertSeverity - a.AlertSeverity;
                                        return new Date(b.CreationDate) - new Date(a.CreationDate);
                                    })
                                    .map(alert => (
                                        <div
                                            key={alert.AlertID}
                                            className={`alert-item ${alert.IsActive ? 'active' : 'inactive'} severity-${alert.AlertSeverity}`}
                                        >
                                            <div className="alert-header">
                                                <span className={`alert-severity-badge severity-${alert.AlertSeverity}`}>
                                                    {alert.AlertSeverity === 1 ? 'Mild' : alert.AlertSeverity === 2 ? 'Moderate' : 'Severe'}
                                                </span>
                                                <span className={`alert-type-badge type-${alert.AlertTypeName.toLowerCase()}`}>
                                                    {alert.AlertTypeName}
                                                </span>
                                            </div>
                                            <p className="alert-details">{alert.AlertDetails}</p>
                                            <div className="alert-footer">
                                                <span className="alert-date">
                                                    <i className="fas fa-calendar"></i>
                                                    {new Date(alert.CreationDate).toLocaleDateString()}
                                                </span>
                                                <button
                                                    onClick={() => handleToggleAlert(alert)}
                                                    className={`btn-toggle-alert ${alert.IsActive ? 'btn-deactivate' : 'btn-activate'}`}
                                                    title={alert.IsActive ? 'Deactivate alert' : 'Activate alert'}
                                                >
                                                    <i className={`fas ${alert.IsActive ? 'fa-times-circle' : 'fa-check-circle'}`}></i>
                                                    {alert.IsActive ? 'Deactivate' : 'Activate'}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Notes Card */}
                {patientData.Notes && (
                    <div className="info-card notes-card">
                        <div className="card-header">
                            <i className="fas fa-sticky-note"></i>
                            <h3>Notes</h3>
                        </div>
                        <div className="card-body">
                            <div className="notes-content">
                                {patientData.Notes}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Alert Modal */}
            <AlertModal
                isOpen={isAlertModalOpen}
                onClose={() => setIsAlertModalOpen(false)}
                onSave={handleAlertSaved}
                personId={patientId}
                alertTypes={alertTypes}
            />
        </div>
    );
};

export default ViewPatientInfo;
