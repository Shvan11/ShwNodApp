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
        CountryCode: '',
        EstimatedCost: '',
        Currency: 'IQD'
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
                CountryCode: data.CountryCode || '',
                EstimatedCost: data.EstimatedCost || '',
                Currency: data.Currency || 'IQD'
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
            <div className="edit-patient-loading">
                <i className="fas fa-spinner fa-spin edit-patient-loading-spinner"></i>
                <p>Loading patient data...</p>
            </div>
        );
    }

    return (
        <div className="edit-patient-container">
            <div className="edit-patient-header">
                <h2 className="edit-patient-title">
                    <i className="fas fa-user-edit edit-patient-title-icon"></i>
                    Edit Patient
                </h2>
                {patientData && (
                    <p className="edit-patient-description">
                        Editing: <strong>{patientData.PatientName}</strong> (ID: {patientData.patientID || patientData.PersonID})
                    </p>
                )}
            </div>

            {error && (
                <div className="edit-patient-error">
                    <div>
                        <i className="fas fa-exclamation-circle pm-icon-gap"></i>
                        {error}
                    </div>
                    <button onClick={() => setError(null)} className="edit-patient-error-close">×</button>
                </div>
            )}

            {successMessage && (
                <div className="edit-patient-success">
                    <i className="fas fa-check-circle"></i>
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
                        <label>Patient Name (Arabic) <span className="required-asterisk">*</span></label>
                        <input
                            type="text"
                            value={formData.PatientName}
                            onChange={(e) => setFormData({...formData, PatientName: e.target.value})}
                            required
                            className="input-height-consistent"
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

                <div className="form-row">
                    <div className="form-group">
                        <label>Estimated Cost (Consultation)</label>
                        <input
                            type="text"
                            value={formData.EstimatedCost ? formData.EstimatedCost.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
                            onChange={(e) => {
                                const rawValue = e.target.value.replace(/,/g, '');
                                if (rawValue === '' || /^\d+$/.test(rawValue)) {
                                    setFormData({...formData, EstimatedCost: rawValue});
                                }
                            }}
                            placeholder="Cost quoted at consultation"
                        />
                    </div>
                    <div className="form-group">
                        <label>Currency</label>
                        <select
                            value={formData.Currency}
                            onChange={(e) => setFormData({...formData, Currency: e.target.value})}
                        >
                            <option value="IQD">Iraqi Dinar (IQD)</option>
                            <option value="USD">US Dollar (USD)</option>
                            <option value="EUR">Euro (EUR)</option>
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
                <div className="webceph-integration-section">
                    <h3 className="webceph-section-header">
                        <i className="fas fa-brain webceph-header-icon"></i>
                        WebCeph AI X-Ray Analysis
                    </h3>

                    {webcephError && (
                        <div className="webceph-error">
                            <div>
                                <i className="fas fa-exclamation-circle pm-icon-gap"></i>
                                {webcephError}
                            </div>
                            <button onClick={() => setWebcephError(null)} className="webceph-error-close">×</button>
                        </div>
                    )}

                    {webcephSuccess && (
                        <div className="edit-patient-success">
                            <i className="fas fa-check-circle"></i>
                            {webcephSuccess}
                        </div>
                    )}

                    {!webcephData ? (
                        <div className="webceph-create-card">
                            <i className="fas fa-user-plus webceph-create-icon"></i>
                            <h4 className="webceph-create-title">
                                Create Patient in WebCeph
                            </h4>
                            <p className="webceph-create-description">
                                Get AI-powered cephalometric analysis by creating this patient in WebCeph
                            </p>
                            <button
                                type="button"
                                onClick={handleCreateWebcephPatient}
                                disabled={webcephLoading}
                                className="webceph-btn-send"
                            >
                                {webcephLoading ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin"></i>
                                        Creating...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-plus-circle"></i>
                                        Create in WebCeph
                                    </>
                                )}
                            </button>
                        </div>
                    ) : (
                        <div className="webceph-status-container">
                            {/* Patient Link Card */}
                            <div className="webceph-patient-created-card">
                                <div className="webceph-card-header">
                                    <div className="webceph-card-title-group">
                                        <i className="fas fa-check-circle webceph-success-icon"></i>
                                        <span className="webceph-card-title">Patient Created in WebCeph</span>
                                    </div>
                                    <span className="webceph-card-subtitle">
                                        {webcephData.createdAt ? new Date(webcephData.createdAt).toLocaleDateString() : ''}
                                    </span>
                                </div>
                                <div className="webceph-info-section">
                                    <div className="webceph-info-label">WebCeph Patient ID</div>
                                    <div className="webceph-info-value">
                                        {webcephData.webcephPatientId}
                                    </div>
                                </div>
                                <a
                                    href={webcephData.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="webceph-btn-send inline-flex-link"
                                >
                                    <i className="fas fa-external-link-alt"></i>
                                    Open in WebCeph
                                </a>
                            </div>

                            {/* Upload X-Ray Card */}
                            <div className="webceph-analysis-card">
                                <h4 className="webceph-analysis-title">
                                    <i className="fas fa-upload webceph-header-icon"></i>
                                    Upload X-Ray Image
                                </h4>

                                <div className="webceph-form-row">
                                    <div>
                                        <label className="whatsapp-form-label">
                                            Record Date
                                        </label>
                                        <input
                                            type="date"
                                            value={uploadData.recordDate}
                                            onChange={(e) => setUploadData({...uploadData, recordDate: e.target.value})}
                                            className="input-height-consistent"
                                            className="w-full"
                                        />
                                    </div>
                                    <div>
                                        <label className="whatsapp-form-label">
                                            Photo Type
                                        </label>
                                        <select
                                            value={uploadData.targetClass}
                                            onChange={(e) => setUploadData({...uploadData, targetClass: e.target.value})}
                                            className="input-height-consistent"
                                            className="w-full"
                                        >
                                            {photoTypes.map(type => (
                                                <option key={type.class} value={type.class}>{type.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="webceph-upload-section">
                                    <label className="webceph-upload-label">
                                        X-Ray Image
                                    </label>
                                    <input
                                        id="webceph-image-upload"
                                        type="file"
                                        accept="image/jpeg,image/png,image/jpg"
                                        onChange={(e) => setUploadData({...uploadData, imageFile: e.target.files[0]})}
                                        className="webceph-file-input-styled"
                                    />
                                    <div className="webceph-help-text">
                                        Accepted formats: JPEG, PNG (Max 10MB)
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleUploadImage}
                                    disabled={webcephLoading || !uploadData.imageFile}
                                    className="webceph-btn-upload"
                                >
                                    {webcephLoading ? (
                                        <>
                                            <i className="fas fa-spinner fa-spin"></i>
                                            Uploading...
                                        </>
                                    ) : (
                                        <>
                                            <i className="fas fa-cloud-upload-alt"></i>
                                            Upload to WebCeph
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="modal-actions flex-end-actions mt-4">
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
                        className="btn bg-success"
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
