import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const ViewPatientInfo = ({ patientId }) => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [patientData, setPatientData] = useState(null);
    const [lookupData, setLookupData] = useState({
        genders: [],
        addresses: [],
        referralSources: [],
        patientTypes: []
    });
    const [editingCost, setEditingCost] = useState(false);
    const [costValue, setCostValue] = useState('');
    const [currencyValue, setCurrencyValue] = useState('IQD');
    const [savingCost, setSavingCost] = useState(false);

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
            const [gendersRes, addressesRes, referralsRes, typesRes] = await Promise.all([
                fetch('/api/genders'),
                fetch('/api/addresses'),
                fetch('/api/referral-sources'),
                fetch('/api/patient-types')
            ]);

            const lookups = {
                genders: gendersRes.ok ? await gendersRes.json() : [],
                addresses: addressesRes.ok ? await addressesRes.json() : [],
                referralSources: referralsRes.ok ? await referralsRes.json() : [],
                patientTypes: typesRes.ok ? await typesRes.json() : []
            };

            setLookupData(lookups);
        } catch (err) {
            console.error('Error loading lookup data:', err);
        }
    }, []);

    useEffect(() => {
        loadPatientData();
        loadLookupData();
    }, [loadPatientData, loadLookupData]);

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
        setCostValue(patientData.EstimatedCost || '');
        setCurrencyValue(patientData.Currency || 'IQD');
        setEditingCost(true);
    };

    const handleSaveCost = async () => {
        try {
            setSavingCost(true);
            const response = await fetch(`/api/patients/${patientId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ...patientData,
                    EstimatedCost: costValue || null,
                    Currency: currencyValue
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to update estimated cost');
            }

            // Update local state
            setPatientData({
                ...patientData,
                EstimatedCost: costValue || null,
                Currency: currencyValue
            });
            setEditingCost(false);
        } catch (err) {
            console.error('Error saving cost:', err);
            alert('Failed to save estimated cost');
        } finally {
            setSavingCost(false);
        }
    };

    const handleCancelCost = () => {
        setEditingCost(false);
        setCostValue('');
        setCurrencyValue('IQD');
    };

    const formatNumberWithCommas = (value) => {
        if (!value) return '';
        return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };

    const handleCostInputChange = (e) => {
        // Remove non-numeric characters except for the value itself
        const rawValue = e.target.value.replace(/,/g, '');
        if (rawValue === '' || /^\d+$/.test(rawValue)) {
            setCostValue(rawValue);
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
                            <span className="info-label">
                                Estimated Cost (Consultation):
                                {!editingCost && (
                                    <button
                                        onClick={handleEditCost}
                                        style={{
                                            marginLeft: '0.5rem',
                                            background: 'none',
                                            border: 'none',
                                            color: '#3b82f6',
                                            cursor: 'pointer',
                                            fontSize: '0.9rem',
                                            padding: '0.25rem'
                                        }}
                                        title="Edit estimated cost"
                                    >
                                        <i className="fas fa-pen"></i>
                                    </button>
                                )}
                            </span>
                            {editingCost ? (
                                <span className="info-value" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        value={formatNumberWithCommas(costValue)}
                                        onChange={handleCostInputChange}
                                        placeholder="Enter cost"
                                        style={{
                                            width: '150px',
                                            padding: '0.25rem 0.5rem',
                                            border: '1px solid #d1d5db',
                                            borderRadius: '4px',
                                            fontSize: '0.9rem'
                                        }}
                                    />
                                    <select
                                        value={currencyValue}
                                        onChange={(e) => setCurrencyValue(e.target.value)}
                                        style={{
                                            padding: '0.25rem 0.5rem',
                                            border: '1px solid #d1d5db',
                                            borderRadius: '4px',
                                            fontSize: '0.9rem'
                                        }}
                                    >
                                        <option value="IQD">IQD</option>
                                        <option value="USD">USD</option>
                                        <option value="EUR">EUR</option>
                                    </select>
                                    <button
                                        onClick={handleSaveCost}
                                        disabled={savingCost}
                                        style={{
                                            padding: '0.25rem 0.75rem',
                                            backgroundColor: '#059669',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: savingCost ? 'not-allowed' : 'pointer',
                                            fontSize: '0.85rem'
                                        }}
                                    >
                                        {savingCost ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-check"></i>}
                                    </button>
                                    <button
                                        onClick={handleCancelCost}
                                        disabled={savingCost}
                                        style={{
                                            padding: '0.25rem 0.75rem',
                                            backgroundColor: '#6b7280',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: savingCost ? 'not-allowed' : 'pointer',
                                            fontSize: '0.85rem'
                                        }}
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>
                                </span>
                            ) : (
                                <span className="info-value" style={{ fontWeight: '600', color: '#059669' }}>
                                    {patientData.EstimatedCost
                                        ? `${formatNumberWithCommas(patientData.EstimatedCost)} ${patientData.Currency || 'IQD'}`
                                        : 'Not set'}
                                </span>
                            )}
                        </div>
                        {patientData.Alerts && (
                            <div className="info-row alert-row">
                                <span className="info-label">
                                    <i className="fas fa-exclamation-triangle"></i> Alerts:
                                </span>
                                <span className="info-value alert-value">{patientData.Alerts}</span>
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
        </div>
    );
};

export default ViewPatientInfo;
