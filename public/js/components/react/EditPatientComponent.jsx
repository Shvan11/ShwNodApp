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

    // WebCeph integration state
    const [webcephData, setWebcephData] = useState(null);
    const [webcephLoading, setWebcephLoading] = useState(false);
    const [webcephError, setWebcephError] = useState(null);
    const [webcephSuccess, setWebcephSuccess] = useState('');
    const [photoTypes, setPhotoTypes] = useState([]);
    const [uploadData, setUploadData] = useState({
        recordDate: new Date().toISOString().split('T')[0],
        targetClass: 'ceph_photo',
        imageFile: null
    });

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
        loadWebcephData();
        loadPhotoTypes();
    }, [patientId, loadDropdownData, loadPatientData]);

    // Load WebCeph data for patient
    const loadWebcephData = async () => {
        if (!patientId) return;

        try {
            const response = await fetch(`/api/webceph/patient-link/${patientId}`);
            const data = await response.json();

            if (data.success && data.data) {
                setWebcephData(data.data);
            }
        } catch (err) {
            console.error('Error loading WebCeph data:', err);
        }
    };

    // Load available photo types
    const loadPhotoTypes = async () => {
        try {
            const response = await fetch('/api/webceph/photo-types');
            const data = await response.json();

            if (data.success) {
                setPhotoTypes(data.data);
            }
        } catch (err) {
            console.error('Error loading photo types:', err);
        }
    };

    // Create patient in WebCeph
    const handleCreateWebcephPatient = async () => {
        if (!patientData) return;

        try {
            setWebcephLoading(true);
            setWebcephError(null);

            // Map gender ID to gender name
            let genderName = '';
            if (formData.Gender) {
                const gender = genders.find(g => g.id === parseInt(formData.Gender));
                genderName = gender ? gender.name : '';
            }

            // Pad patient ID with zeros to meet 6-character minimum
            let paddedPatientID = formData.patientID || patientData.PersonID.toString();
            if (paddedPatientID.length < 6) {
                paddedPatientID = paddedPatientID.padStart(6, '0');
            }

            const webcephPatientData = {
                patientID: paddedPatientID,
                firstName: formData.FirstName || '',
                lastName: formData.LastName || '',
                gender: genderName,
                birthday: formData.DateofBirth || '',
                race: 'Asian' // Default value
            };

            const response = await fetch('/api/webceph/create-patient', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    personId: patientData.PersonID,
                    patientData: webcephPatientData
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || data.details || 'Failed to create patient in WebCeph');
            }

            setWebcephData({
                webcephPatientId: data.data.webcephPatientId,
                link: data.data.link,
                createdAt: new Date().toISOString()
            });

            setWebcephSuccess('Patient created in WebCeph successfully!');
            setTimeout(() => setWebcephSuccess(''), 5000);
        } catch (err) {
            console.error('Error creating WebCeph patient:', err);
            setWebcephError(err.message);
        } finally {
            setWebcephLoading(false);
        }
    };

    // Upload X-ray image to WebCeph
    const handleUploadImage = async () => {
        if (!uploadData.imageFile) {
            setWebcephError('Please select an image file');
            return;
        }

        try {
            setWebcephLoading(true);
            setWebcephError(null);

            const formDataObj = new FormData();
            formDataObj.append('image', uploadData.imageFile);
            formDataObj.append('patientID', formData.patientID || patientData.PersonID.toString());
            formDataObj.append('recordDate', uploadData.recordDate);
            formDataObj.append('targetClass', uploadData.targetClass);

            const response = await fetch('/api/webceph/upload-image', {
                method: 'POST',
                body: formDataObj
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || data.details || 'Failed to upload image');
            }

            setWebcephSuccess(`Image uploaded successfully! View at: ${data.data.link}`);
            setTimeout(() => setWebcephSuccess(''), 10000);

            // Reset upload form
            setUploadData({
                recordDate: new Date().toISOString().split('T')[0],
                targetClass: 'ceph_photo',
                imageFile: null
            });

            // Clear file input
            const fileInput = document.getElementById('webceph-image-upload');
            if (fileInput) fileInput.value = '';
        } catch (err) {
            console.error('Error uploading image:', err);
            setWebcephError(err.message);
        } finally {
            setWebcephLoading(false);
        }
    };

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

                {/* WebCeph AI X-Ray Analysis Section */}
                <div style={{
                    marginTop: '3rem',
                    padding: '2rem',
                    backgroundColor: '#f8fafc',
                    borderRadius: '12px',
                    border: '2px solid #e2e8f0'
                }}>
                    <h3 style={{
                        fontSize: '1.25rem',
                        fontWeight: 'bold',
                        color: '#1f2937',
                        marginBottom: '1.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem'
                    }}>
                        <i className="fas fa-brain" style={{ color: '#8b5cf6' }}></i>
                        WebCeph AI X-Ray Analysis
                    </h3>

                    {webcephError && (
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
                                {webcephError}
                            </div>
                            <button onClick={() => setWebcephError(null)} style={{
                                background: 'transparent',
                                border: 'none',
                                fontSize: '1.5rem',
                                cursor: 'pointer',
                                color: '#991b1b'
                            }}>×</button>
                        </div>
                    )}

                    {webcephSuccess && (
                        <div style={{
                            backgroundColor: '#d1fae5',
                            color: '#065f46',
                            padding: '1rem',
                            borderRadius: '8px',
                            marginBottom: '1rem'
                        }}>
                            <i className="fas fa-check-circle" style={{ marginRight: '0.5rem' }}></i>
                            {webcephSuccess}
                        </div>
                    )}

                    {!webcephData ? (
                        <div style={{
                            backgroundColor: 'white',
                            padding: '2rem',
                            borderRadius: '8px',
                            textAlign: 'center'
                        }}>
                            <i className="fas fa-user-plus" style={{ fontSize: '3rem', color: '#8b5cf6', marginBottom: '1rem' }}></i>
                            <h4 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                                Create Patient in WebCeph
                            </h4>
                            <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
                                Get AI-powered cephalometric analysis by creating this patient in WebCeph
                            </p>
                            <button
                                type="button"
                                onClick={handleCreateWebcephPatient}
                                disabled={webcephLoading}
                                style={{
                                    backgroundColor: '#8b5cf6',
                                    color: 'white',
                                    padding: '0.75rem 2rem',
                                    borderRadius: '8px',
                                    border: 'none',
                                    fontSize: '1rem',
                                    fontWeight: '600',
                                    cursor: webcephLoading ? 'not-allowed' : 'pointer',
                                    opacity: webcephLoading ? 0.6 : 1
                                }}
                            >
                                {webcephLoading ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin" style={{ marginRight: '0.5rem' }}></i>
                                        Creating...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-plus-circle" style={{ marginRight: '0.5rem' }}></i>
                                        Create in WebCeph
                                    </>
                                )}
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {/* Patient Link Card */}
                            <div style={{
                                backgroundColor: 'white',
                                padding: '1.5rem',
                                borderRadius: '8px',
                                border: '1px solid #e2e8f0'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <i className="fas fa-check-circle" style={{ color: '#10b981' }}></i>
                                        <span style={{ fontWeight: '600', color: '#1f2937' }}>Patient Created in WebCeph</span>
                                    </div>
                                    <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                                        {webcephData.createdAt ? new Date(webcephData.createdAt).toLocaleDateString() : ''}
                                    </span>
                                </div>
                                <div style={{ marginBottom: '1rem' }}>
                                    <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.25rem' }}>WebCeph Patient ID</div>
                                    <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: '#1f2937' }}>
                                        {webcephData.webcephPatientId}
                                    </div>
                                </div>
                                <a
                                    href={webcephData.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        backgroundColor: '#8b5cf6',
                                        color: 'white',
                                        padding: '0.5rem 1.5rem',
                                        borderRadius: '6px',
                                        textDecoration: 'none',
                                        fontSize: '0.9rem',
                                        fontWeight: '600'
                                    }}
                                >
                                    <i className="fas fa-external-link-alt"></i>
                                    Open in WebCeph
                                </a>
                            </div>

                            {/* Upload X-Ray Card */}
                            <div style={{
                                backgroundColor: 'white',
                                padding: '1.5rem',
                                borderRadius: '8px',
                                border: '1px solid #e2e8f0'
                            }}>
                                <h4 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '1rem', color: '#1f2937' }}>
                                    <i className="fas fa-upload" style={{ marginRight: '0.5rem', color: '#8b5cf6' }}></i>
                                    Upload X-Ray Image
                                </h4>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                                            Record Date
                                        </label>
                                        <input
                                            type="date"
                                            value={uploadData.recordDate}
                                            onChange={(e) => setUploadData({...uploadData, recordDate: e.target.value})}
                                            style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                                            Photo Type
                                        </label>
                                        <select
                                            value={uploadData.targetClass}
                                            onChange={(e) => setUploadData({...uploadData, targetClass: e.target.value})}
                                            style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #d1d5db' }}
                                        >
                                            {photoTypes.map(type => (
                                                <option key={type.class} value={type.class}>{type.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem', color: '#374151' }}>
                                        X-Ray Image
                                    </label>
                                    <input
                                        id="webceph-image-upload"
                                        type="file"
                                        accept="image/jpeg,image/png,image/jpg"
                                        onChange={(e) => setUploadData({...uploadData, imageFile: e.target.files[0]})}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            borderRadius: '6px',
                                            border: '1px solid #d1d5db',
                                            fontSize: '0.9rem'
                                        }}
                                    />
                                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>
                                        Accepted formats: JPEG, PNG (Max 10MB)
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleUploadImage}
                                    disabled={webcephLoading || !uploadData.imageFile}
                                    style={{
                                        backgroundColor: '#059669',
                                        color: 'white',
                                        padding: '0.75rem 1.5rem',
                                        borderRadius: '6px',
                                        border: 'none',
                                        fontSize: '0.9rem',
                                        fontWeight: '600',
                                        cursor: (webcephLoading || !uploadData.imageFile) ? 'not-allowed' : 'pointer',
                                        opacity: (webcephLoading || !uploadData.imageFile) ? 0.6 : 1
                                    }}
                                >
                                    {webcephLoading ? (
                                        <>
                                            <i className="fas fa-spinner fa-spin" style={{ marginRight: '0.5rem' }}></i>
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <i className="fas fa-cloud-upload-alt" style={{ marginRight: '0.5rem' }}></i>
                                            Upload to WebCeph
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
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
