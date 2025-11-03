import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const EditPatientComponent = ({ patientId }) => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState('');
    const [patientData, setPatientData] = useState(null);

    // Dropdown data
    const [genders, setGenders] = useState([]);
    const [addresses, setAddresses] = useState([]);
    const [referralSources, setReferralSources] = useState([]);
    const [patientTypes, setPatientTypes] = useState([]);

    // Form data
    const [formData, setFormData] = useState({
        PersonID: '',
        patientID: '',
        PatientName: '',
        FirstName: '',
        LastName: '',
        Phone: '',
        Phone2: '',
        Email: '',
        DateofBirth: '',
        Gender: '',
        AddressID: '',
        ReferralSourceID: '',
        PatientTypeID: '',
        Notes: '',
        Alerts: '',
        Language: '0',
        CountryCode: ''
    });

    const loadDropdownData = useCallback(async () => {
        try {
            const [gendersRes, addressesRes, referralsRes, typesRes] = await Promise.all([
                fetch('/api/genders'),
                fetch('/api/addresses'),
                fetch('/api/referral-sources'),
                fetch('/api/patient-types')
            ]);

            if (gendersRes.ok) setGenders(await gendersRes.json());
            if (addressesRes.ok) setAddresses(await addressesRes.json());
            if (referralsRes.ok) setReferralSources(await referralsRes.json());
            if (typesRes.ok) setPatientTypes(await typesRes.json());
        } catch (err) {
            console.error('Error loading dropdown data:', err);
        }
    }, []);

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

            // Populate form
            setFormData({
                PersonID: data.PersonID,
                patientID: data.patientID || '',
                PatientName: data.PatientName || '',
                FirstName: data.FirstName || '',
                LastName: data.LastName || '',
                Phone: data.Phone || '',
                Phone2: data.Phone2 || '',
                Email: data.Email || '',
                DateofBirth: data.DateofBirth ? new Date(data.DateofBirth).toISOString().split('T')[0] : '',
                Gender: data.Gender || '',
                AddressID: data.AddressID || '',
                ReferralSourceID: data.ReferralSourceID || '',
                PatientTypeID: data.PatientTypeID || '',
                Notes: data.Notes || '',
                Alerts: data.Alerts || '',
                Language: (data.Language !== null && data.Language !== undefined) ? data.Language.toString() : '0',
                CountryCode: data.CountryCode || ''
            });
        } catch (err) {
            console.error('Error loading patient data:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [patientId]);

    useEffect(() => {
        loadDropdownData();
        loadPatientData();
    }, [patientId, loadDropdownData, loadPatientData]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.PatientName.trim()) {
            setError('Patient Name is required');
            return;
        }

        try {
            setSaving(true);
            setError(null);

            const response = await fetch(`/api/patients/${formData.PersonID}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update patient');
            }

            setSuccessMessage('Patient updated successfully!');
            setTimeout(() => {
                setSuccessMessage('');
            }, 3000);

            // Reload patient data to get fresh values
            await loadPatientData();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        // Navigate back to works page using React Router
        navigate(`/patient/${patientId}/works`);
    };

    if (loading) {
        return (
            <div className="work-loading" style={{ padding: '3rem', textAlign: 'center' }}>
                <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#3b82f6', marginBottom: '1rem' }}></i>
                <p>Loading patient data...</p>
            </div>
        );
    }

    return (
        <div className="patient-management" style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div className="work-header" style={{ marginBottom: '2rem' }}>
                <h2 style={{
                    fontSize: '1.5rem',
                    fontWeight: 'bold',
                    color: '#1f2937',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem'
                }}>
                    <i className="fas fa-user-edit" style={{ color: '#059669' }}></i>
                    Edit Patient
                </h2>
                {patientData && (
                    <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>
                        Editing: <strong>{patientData.PatientName}</strong> (ID: {patientData.patientID || patientData.PersonID})
                    </p>
                )}
            </div>

            {error && (
                <div style={{
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    padding: '1rem',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <div>
                        <i className="fas fa-exclamation-circle" style={{ marginRight: '0.5rem' }}></i>
                        {error}
                    </div>
                    <button onClick={() => setError(null)} style={{
                        background: 'transparent',
                        border: 'none',
                        fontSize: '1.5rem',
                        cursor: 'pointer',
                        color: '#991b1b'
                    }}>×</button>
                </div>
            )}

            {successMessage && (
                <div style={{
                    backgroundColor: '#d1fae5',
                    color: '#065f46',
                    padding: '1rem',
                    borderRadius: '8px',
                    marginBottom: '1rem'
                }}>
                    <i className="fas fa-check-circle" style={{ marginRight: '0.5rem' }}></i>
                    {successMessage}
                </div>
            )}

            <form onSubmit={handleSubmit} className="work-form edit-patient-form">
                <div className="form-row">
                    <div className="form-group">
                        <label>Patient ID</label>
                        <input
                            type="text"
                            value={formData.patientID}
                            onChange={(e) => setFormData({...formData, patientID: e.target.value})}
                        />
                    </div>
                    <div className="form-group">
                        <label>Patient Name (Arabic) <span style={{ color: '#dc2626' }}>*</span></label>
                        <input
                            type="text"
                            value={formData.PatientName}
                            onChange={(e) => setFormData({...formData, PatientName: e.target.value})}
                            required
                            style={{ height: '42px', lineHeight: '1.5' }}
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>First Name</label>
                        <input
                            type="text"
                            value={formData.FirstName}
                            onChange={(e) => setFormData({...formData, FirstName: e.target.value})}
                        />
                    </div>
                    <div className="form-group">
                        <label>Last Name</label>
                        <input
                            type="text"
                            value={formData.LastName}
                            onChange={(e) => setFormData({...formData, LastName: e.target.value})}
                        />
                    </div>
                </div>

                <div className="form-row phone-row">
                    <div className="form-group">
                        <label>Country Code</label>
                        <input
                            type="text"
                            value={formData.CountryCode}
                            onChange={(e) => setFormData({...formData, CountryCode: e.target.value})}
                            placeholder="+964"
                        />
                    </div>
                    <div className="form-group">
                        <label>Phone</label>
                        <input
                            type="tel"
                            value={formData.Phone}
                            onChange={(e) => setFormData({...formData, Phone: e.target.value})}
                        />
                    </div>
                    <div className="form-group">
                        <label>Phone 2</label>
                        <input
                            type="tel"
                            value={formData.Phone2}
                            onChange={(e) => setFormData({...formData, Phone2: e.target.value})}
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email"
                            value={formData.Email}
                            onChange={(e) => setFormData({...formData, Email: e.target.value})}
                        />
                    </div>
                    <div className="form-group">
                        <label>Date of Birth</label>
                        <input
                            type="date"
                            value={formData.DateofBirth}
                            onChange={(e) => setFormData({...formData, DateofBirth: e.target.value})}
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Gender</label>
                        <select
                            value={formData.Gender}
                            onChange={(e) => setFormData({...formData, Gender: e.target.value})}
                        >
                            <option value="">Select Gender</option>
                            {genders.map(gender => (
                                <option key={gender.id} value={gender.id}>
                                    {gender.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Language</label>
                        <select
                            value={formData.Language}
                            onChange={(e) => setFormData({...formData, Language: e.target.value})}
                        >
                            <option value="0">Kurdish</option>
                            <option value="1">Arabic</option>
                            <option value="2">English</option>
                        </select>
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Address/Zone</label>
                        <select
                            value={formData.AddressID}
                            onChange={(e) => setFormData({...formData, AddressID: e.target.value})}
                        >
                            <option value="">Select Address</option>
                            {addresses.map(address => (
                                <option key={address.id} value={address.id}>
                                    {address.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Referral Source</label>
                        <select
                            value={formData.ReferralSourceID}
                            onChange={(e) => setFormData({...formData, ReferralSourceID: e.target.value})}
                        >
                            <option value="">Select Referral Source</option>
                            {referralSources.map(source => (
                                <option key={source.id} value={source.id}>
                                    {source.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group full-width">
                        <label>Patient Type</label>
                        <select
                            value={formData.PatientTypeID}
                            onChange={(e) => setFormData({...formData, PatientTypeID: e.target.value})}
                        >
                            <option value="">Select Patient Type</option>
                            {patientTypes.map(type => (
                                <option key={type.id} value={type.id}>
                                    {type.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="form-group full-width">
                    <label>Notes</label>
                    <textarea
                        value={formData.Notes}
                        onChange={(e) => setFormData({...formData, Notes: e.target.value})}
                        rows="3"
                    />
                </div>

                <div className="form-group full-width">
                    <label>Alerts</label>
                    <textarea
                        value={formData.Alerts}
                        onChange={(e) => setFormData({...formData, Alerts: e.target.value})}
                        rows="2"
                        placeholder="Important alerts about this patient"
                    />
                </div>

                <div className="modal-actions" style={{
                    display: 'flex',
                    gap: '1rem',
                    marginTop: '2rem',
                    justifyContent: 'flex-end'
                }}>
                    <button
                        type="button"
                        onClick={handleCancel}
                        className="btn btn-secondary"
                        disabled={saving}
                    >
                        <i className="fas fa-times"></i> Cancel
                    </button>
                    <button
                        type="submit"
                        className="btn"
                        style={{
                            backgroundColor: '#059669',
                            color: 'white'
                        }}
                        disabled={saving}
                    >
                        {saving ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i> Saving...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save"></i> Save Changes
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default EditPatientComponent;
