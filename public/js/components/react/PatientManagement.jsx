import React, { useState, useEffect, useRef } from 'react';

const PatientManagement = () => {
    const [patients, setPatients] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [hasSearched, setHasSearched] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);

    // Separate search fields for patient name components
    const [searchPatientName, setSearchPatientName] = useState('');
    const [searchFirstName, setSearchFirstName] = useState('');
    const [searchLastName, setSearchLastName] = useState('');
    const [searchDebounce, setSearchDebounce] = useState(null);

    // Dropdown quick search
    const [showQuickSearch, setShowQuickSearch] = useState(true);
    const [allPatients, setAllPatients] = useState([]);
    const nameSelectRef = useRef(null);
    const phoneSelectRef = useRef(null);
    const idSelectRef = useRef(null);
    const tomSelectRefs = useRef({});

    // Dropdown data
    const [genders, setGenders] = useState([]);
    const [addresses, setAddresses] = useState([]);
    const [referralSources, setReferralSources] = useState([]);
    const [patientTypes, setPatientTypes] = useState([]);

    // Edit form state
    const [editFormData, setEditFormData] = useState({
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

    useEffect(() => {
        loadDropdownData();
        loadAllPatientsForDropdown();

        // Check for search parameter in URL
        const urlParams = new URLSearchParams(window.location.search);
        const searchParam = urlParams.get('search');
        if (searchParam) {
            setSearchPatientName(searchParam);
            // The useEffect for searchPatientName will trigger the search automatically
        }
    }, []);

    // Initialize TomSelect when allPatients data is loaded
    useEffect(() => {
        if (allPatients.length > 0 && showQuickSearch) {
            initializeTomSelect();
        }
        return () => {
            // Cleanup TomSelect instances
            Object.values(tomSelectRefs.current).forEach(select => {
                if (select && select.destroy) {
                    select.destroy();
                }
            });
        };
    }, [allPatients, showQuickSearch]);

    const loadAllPatientsForDropdown = async () => {
        try {
            const response = await fetch('/api/patientsPhones');
            if (!response.ok) throw new Error('Failed to fetch patient list');
            const data = await response.json();
            setAllPatients(data);
        } catch (err) {
            console.error('Error loading patient list for dropdown:', err);
        }
    };

    const initializeTomSelect = () => {
        if (typeof window.TomSelect === 'undefined') {
            console.error('TomSelect library not loaded');
            return;
        }

        const baseSettings = {
            maxItems: 1,
            placeholder: 'Type to search...',
            create: false,
            sortField: { field: 'text', direction: 'asc' }
        };

        const handleChange = (value) => {
            if (value) {
                // Navigate to patient page using new React Router format
                window.location.href = `/patient/${value}/works`;
            }
        };

        const clearAllSelects = () => {
            Object.values(tomSelectRefs.current).forEach(select => {
                if (select && select.clear) {
                    select.clear(true);
                }
            });
        };

        // Name dropdown
        if (nameSelectRef.current && !tomSelectRefs.current.name) {
            const nameOptions = allPatients.map(p => ({ value: p.id, text: p.name }));
            tomSelectRefs.current.name = new window.TomSelect(nameSelectRef.current, {
                ...baseSettings,
                options: nameOptions,
                onChange: (value) => {
                    if (value) {
                        clearAllSelects();
                        handleChange(value);
                    }
                }
            });
        }

        // Phone dropdown
        if (phoneSelectRef.current && !tomSelectRefs.current.phone) {
            const phoneOptions = allPatients
                .filter(p => p.phone)
                .map(p => ({ value: p.id, text: p.phone }));
            tomSelectRefs.current.phone = new window.TomSelect(phoneSelectRef.current, {
                ...baseSettings,
                options: phoneOptions,
                onChange: (value) => {
                    if (value) {
                        clearAllSelects();
                        handleChange(value);
                    }
                }
            });
        }

        // ID dropdown
        if (idSelectRef.current && !tomSelectRefs.current.id) {
            const idOptions = allPatients.map(p => ({ value: p.id, text: p.id.toString() }));
            tomSelectRefs.current.id = new window.TomSelect(idSelectRef.current, {
                ...baseSettings,
                options: idOptions,
                onChange: (value) => {
                    if (value) {
                        clearAllSelects();
                        handleChange(value);
                    }
                }
            });
        }
    };

    // Auto-search when any name field changes (with debounce)
    useEffect(() => {
        // Clear previous timeout
        if (searchDebounce) {
            clearTimeout(searchDebounce);
        }

        // Check if any field has at least 2 characters
        const hasMinimumInput =
            searchPatientName.trim().length >= 2 ||
            searchFirstName.trim().length >= 2 ||
            searchLastName.trim().length >= 2;

        if (hasMinimumInput) {
            // Set new timeout for debounced search
            const timeoutId = setTimeout(() => {
                performSearch();
            }, 500); // 500ms delay

            setSearchDebounce(timeoutId);
        } else {
            // Clear results if all fields are empty or too short
            if (!searchPatientName && !searchFirstName && !searchLastName) {
                setPatients([]);
                setHasSearched(false);
            }
        }

        // Cleanup
        return () => {
            if (searchDebounce) {
                clearTimeout(searchDebounce);
            }
        };
    }, [searchPatientName, searchFirstName, searchLastName]);

    const performSearch = async () => {
        try {
            setLoading(true);
            setError(null);

            // Build query parameters
            const params = new URLSearchParams();
            if (searchPatientName.trim()) params.append('patientName', searchPatientName.trim());
            if (searchFirstName.trim()) params.append('firstName', searchFirstName.trim());
            if (searchLastName.trim()) params.append('lastName', searchLastName.trim());

            const response = await fetch(`/api/patients/search?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to search patients');
            const data = await response.json();
            setPatients(data);
            setHasSearched(true);
        } catch (err) {
            setError(err.message);
            setPatients([]);
        } finally {
            setLoading(false);
        }
    };

    const searchPatients = async (searchQuery = searchTerm, showAll = false) => {
        // Don't search if no query and not showing all
        if (!showAll && (!searchQuery || searchQuery.trim().length < 2)) {
            setError('Please enter at least 2 characters to search');
            return;
        }

        try {
            setLoading(true);
            setError(null);
            const query = showAll ? '' : searchQuery.trim();
            const response = await fetch(`/api/patients/search?q=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Failed to search patients');
            const data = await response.json();
            setPatients(data);
            setHasSearched(true);
        } catch (err) {
            setError(err.message);
            setPatients([]);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        searchPatients();
    };

    const handleShowAll = () => {
        setSearchTerm('');
        searchPatients('', true);
    };

    const loadDropdownData = async () => {
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
    };

    const handleEditClick = (patient) => {
        setSelectedPatient(patient);
        setEditFormData({
            PersonID: patient.PersonID,
            patientID: patient.patientID || '',
            PatientName: patient.PatientName || '',
            FirstName: patient.FirstName || '',
            LastName: patient.LastName || '',
            Phone: patient.Phone || '',
            Phone2: patient.Phone2 || '',
            Email: patient.Email || '',
            DateofBirth: patient.DateofBirth ? new Date(patient.DateofBirth).toISOString().split('T')[0] : '',
            Gender: patient.Gender || '',
            AddressID: patient.AddressID || '',
            ReferralSourceID: patient.ReferralSourceID || '',
            PatientTypeID: patient.PatientTypeID || '',
            Notes: patient.Notes || '',
            Alerts: patient.Alerts || '',
            Language: patient.Language !== null ? patient.Language.toString() : '0',
            CountryCode: patient.CountryCode || ''
        });
        setShowEditModal(true);
    };

    const handleDeleteClick = (patient) => {
        setSelectedPatient(patient);
        setShowDeleteConfirm(true);
    };

    const handleQuickCheckin = async (patient) => {
        try {
            setLoading(true);
            const response = await fetch('/api/appointments/quick-checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    PersonID: patient.PersonID
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to check in patient');
            }

            const result = await response.json();

            if (result.alreadyCheckedIn) {
                setSuccessMessage(`${patient.PatientName} is already checked in today!`);
            } else if (result.created) {
                setSuccessMessage(`${patient.PatientName} added to today's appointments and checked in!`);
            } else {
                setSuccessMessage(`${patient.PatientName} checked in successfully!`);
            }

            setTimeout(() => setSuccessMessage(null), 5000);
        } catch (err) {
            setError(err.message);
            setTimeout(() => setError(null), 5000);
        } finally {
            setLoading(false);
        }
    };

    const handleEditSubmit = async (e) => {
        e.preventDefault();

        try {
            const response = await fetch(`/api/patients/${editFormData.PersonID}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editFormData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update patient');
            }

            // Refresh search results
            if (hasSearched) {
                await searchPatients(searchTerm, searchTerm === '');
            }
            setShowEditModal(false);
            setSuccessMessage('Patient updated successfully!');
            setTimeout(() => setSuccessMessage(null), 5000);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDeleteConfirm = async () => {
        try {
            const response = await fetch(`/api/patients/${selectedPatient.PersonID}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete patient');
            }

            // Refresh search results
            if (hasSearched) {
                await searchPatients(searchTerm, searchTerm === '');
            }
            setShowDeleteConfirm(false);
            setSuccessMessage('Patient deleted successfully!');
            setTimeout(() => setSuccessMessage(null), 5000);
        } catch (err) {
            setError(err.message);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString();
    };

    return (
        <div className="patient-management">
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem',
                flexWrap: 'wrap',
                gap: '1rem'
            }}>
                <h2 style={{ margin: 0 }}>Patient Management</h2>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <button
                        onClick={() => setShowQuickSearch(!showQuickSearch)}
                        className="btn btn-secondary"
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        <i className={`fas fa-${showQuickSearch ? 'chevron-up' : 'chevron-down'}`} style={{ marginRight: '0.5rem' }}></i>
                        {showQuickSearch ? 'Hide' : 'Show'} Quick Search
                    </button>
                    <button
                        onClick={() => window.location.href = '/views/patient/add-patient.html'}
                        className="btn btn-primary"
                    >
                        <i className="fas fa-plus" style={{ marginRight: '0.5rem' }}></i>
                        Add New Patient
                    </button>
                </div>
            </div>

            {/* Quick Search Dropdowns */}
            {showQuickSearch && (
                <div style={{
                    marginBottom: '1.5rem',
                    padding: '1.5rem',
                    backgroundColor: '#eff6ff',
                    borderRadius: '12px',
                    border: '2px solid #3b82f6'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        marginBottom: '1rem',
                        gap: '0.5rem'
                    }}>
                        <i className="fas fa-bolt" style={{ color: '#3b82f6', fontSize: '1.25rem' }}></i>
                        <h3 style={{ margin: 0, color: '#1e40af', fontSize: '1.1rem' }}>Quick Search - Select & Go</h3>
                    </div>
                    <p style={{ margin: '0 0 1rem 0', color: '#1e40af', fontSize: '0.9rem' }}>
                        Start typing in any dropdown below to quickly find and open a patient's page
                    </p>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                        gap: '1rem'
                    }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1e3a8a' }}>
                                <i className="fas fa-user" style={{ marginRight: '0.5rem' }}></i>
                                Search by Name
                            </label>
                            <select ref={nameSelectRef} id="patient-name-select"></select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1e3a8a' }}>
                                <i className="fas fa-phone" style={{ marginRight: '0.5rem' }}></i>
                                Search by Phone
                            </label>
                            <select ref={phoneSelectRef} id="patient-phone-select"></select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', fontSize: '0.875rem', color: '#1e3a8a' }}>
                                <i className="fas fa-id-card" style={{ marginRight: '0.5rem' }}></i>
                                Search by ID
                            </label>
                            <select ref={idSelectRef} id="patient-id-select"></select>
                        </div>
                    </div>
                </div>
            )}

            <hr style={{ margin: '2rem 0', border: 'none', borderTop: '2px solid #e5e7eb' }} />

            <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#374151' }}>
                    <i className="fas fa-search" style={{ marginRight: '0.5rem', color: '#6b7280' }}></i>
                    Advanced Search & Management
                </h3>
                <p style={{ margin: '0.5rem 0 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                    Search by name fields with auto-complete, or use phone/ID search. Edit and manage patient records.
                </p>
            </div>

            {/* Search Form - 3 separate name fields */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: '0.75rem',
                marginBottom: '1.5rem',
                padding: '1.5rem',
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
                border: '1px solid #e5e7eb'
            }}>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', fontSize: '0.875rem', color: '#374151' }}>
                        Patient Name (Arabic)
                    </label>
                    <input
                        type="text"
                        placeholder="e.g., احمد محمد"
                        value={searchPatientName}
                        onChange={(e) => setSearchPatientName(e.target.value)}
                        className="search-input"
                        style={{ width: '100%', direction: 'rtl', textAlign: 'right', height: '2.75rem', lineHeight: '1.5', padding: '0.5rem 0.75rem' }}
                        lang="ar"
                        dir="rtl"
                    />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', fontSize: '0.875rem', color: '#374151' }}>
                        First Name (English)
                    </label>
                    <input
                        type="text"
                        placeholder="e.g., Ahmad"
                        value={searchFirstName}
                        onChange={(e) => setSearchFirstName(e.target.value)}
                        className="search-input"
                        style={{ width: '100%', height: '2.75rem', lineHeight: '1.5', padding: '0.5rem 0.75rem' }}
                    />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500', fontSize: '0.875rem', color: '#374151' }}>
                        Last Name (English)
                    </label>
                    <input
                        type="text"
                        placeholder="e.g., Mohammad"
                        value={searchLastName}
                        onChange={(e) => setSearchLastName(e.target.value)}
                        className="search-input"
                        style={{ width: '100%', height: '2.75rem', lineHeight: '1.5', padding: '0.5rem 0.75rem' }}
                    />
                </div>
            </div>

            {/* Additional search options */}
            <form onSubmit={handleSearch} style={{
                display: 'flex',
                gap: '0.75rem',
                marginBottom: '1.5rem',
                alignItems: 'center',
                flexWrap: 'wrap'
            }}>
                <input
                    type="text"
                    placeholder="Or search by phone or ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                    style={{ flex: '1 1 300px', minWidth: '250px' }}
                />
                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading}
                >
                    <i className="fas fa-search" style={{ marginRight: '0.5rem' }}></i>
                    {loading ? 'Searching...' : 'Search'}
                </button>
                <button
                    type="button"
                    onClick={handleShowAll}
                    className="btn btn-secondary"
                    disabled={loading}
                >
                    <i className="fas fa-list" style={{ marginRight: '0.5rem' }}></i>
                    Show All
                </button>
            </form>

            {error && (
                <div className="work-error" style={{
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    padding: '1rem',
                    borderRadius: '8px',
                    marginBottom: '1rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    {error}
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

            {hasSearched && (
                <div className="work-summary" style={{ marginBottom: '1.5rem' }}>
                    <div className="summary-card">
                        <h3>Results Found</h3>
                        <span className="summary-value">{patients.length}</span>
                    </div>
                </div>
            )}

            {loading && (
                <div className="work-loading" style={{ padding: '3rem', textAlign: 'center' }}>
                    <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#3b82f6', marginBottom: '1rem' }}></i>
                    <p>Searching patients...</p>
                </div>
            )}

            {!loading && !hasSearched && (
                <div style={{
                    padding: '3rem',
                    textAlign: 'center',
                    backgroundColor: '#f9fafb',
                    borderRadius: '8px',
                    border: '2px dashed #d1d5db'
                }}>
                    <i className="fas fa-search" style={{ fontSize: '3rem', color: '#9ca3af', marginBottom: '1rem' }}></i>
                    <h3 style={{ color: '#6b7280', marginBottom: '0.5rem' }}>Start Typing to Search</h3>
                    <p style={{ color: '#9ca3af', margin: 0 }}>
                        Type at least 2 characters in any name field above. Results will appear automatically as you type.
                    </p>
                    <p style={{ color: '#9ca3af', margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                        Or use the phone/ID search below, or click "Show All" to view first 100 patients.
                    </p>
                </div>
            )}

            {hasSearched && !loading && (
                <div className="work-table-container">
                    <table className="work-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Patient Name</th>
                                <th>Phone</th>
                                <th>Email</th>
                                <th>Date of Birth</th>
                                <th>Gender</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {patients.map((patient) => (
                            <tr key={patient.PersonID}>
                                <td>{patient.patientID || patient.PersonID}</td>
                                <td>
                                    <strong>{patient.PatientName}</strong>
                                    {patient.FirstName && (
                                        <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                                            {patient.FirstName} {patient.LastName}
                                        </div>
                                    )}
                                </td>
                                <td>{patient.Phone || 'N/A'}</td>
                                <td>{patient.Email || 'N/A'}</td>
                                <td>{formatDate(patient.DateofBirth)}</td>
                                <td>{patient.GenderName || 'N/A'}</td>
                                <td>
                                    <div className="action-buttons" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <button
                                            onClick={() => handleQuickCheckin(patient)}
                                            className="btn btn-sm"
                                            style={{
                                                backgroundColor: '#10b981',
                                                color: 'white',
                                                border: 'none'
                                            }}
                                            title="Add to today's appointments and check in"
                                            disabled={loading}
                                        >
                                            <i className="fas fa-check-circle"></i> Check In
                                        </button>
                                        <button
                                            onClick={() => window.location.href = `/patient/${patient.PersonID}/works`}
                                            className="btn btn-sm"
                                            style={{
                                                backgroundColor: '#3b82f6',
                                                color: 'white',
                                                border: 'none'
                                            }}
                                            title="View patient details"
                                        >
                                            <i className="fas fa-eye"></i> View
                                        </button>
                                        <button
                                            onClick={() => handleEditClick(patient)}
                                            className="btn btn-sm btn-secondary"
                                            title="Edit patient"
                                        >
                                            <i className="fas fa-edit"></i> Edit
                                        </button>
                                        <button
                                            onClick={() => handleDeleteClick(patient)}
                                            className="btn btn-sm"
                                            style={{
                                                backgroundColor: '#dc2626',
                                                color: 'white',
                                                border: 'none'
                                            }}
                                            title="Delete patient"
                                        >
                                            <i className="fas fa-trash"></i> Delete
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            ))}
                            {patients.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="no-data">
                                        No patients match your search
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Edit Patient Modal */}
            {showEditModal && selectedPatient && (
                <div className="modal-overlay">
                    <div className="work-modal" style={{ maxWidth: '800px', maxHeight: '90vh', overflow: 'auto' }}>
                        <div className="modal-header">
                            <h3>Edit Patient - {selectedPatient.PatientName}</h3>
                            <button
                                onClick={() => setShowEditModal(false)}
                                className="modal-close"
                            >
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleEditSubmit} className="work-form">
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Patient ID</label>
                                    <input
                                        type="text"
                                        value={editFormData.patientID}
                                        onChange={(e) => setEditFormData({...editFormData, patientID: e.target.value})}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Patient Name <span style={{ color: '#dc2626' }}>*</span></label>
                                    <input
                                        type="text"
                                        value={editFormData.PatientName}
                                        onChange={(e) => setEditFormData({...editFormData, PatientName: e.target.value})}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>First Name</label>
                                    <input
                                        type="text"
                                        value={editFormData.FirstName}
                                        onChange={(e) => setEditFormData({...editFormData, FirstName: e.target.value})}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Last Name</label>
                                    <input
                                        type="text"
                                        value={editFormData.LastName}
                                        onChange={(e) => setEditFormData({...editFormData, LastName: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Phone</label>
                                    <input
                                        type="tel"
                                        value={editFormData.Phone}
                                        onChange={(e) => setEditFormData({...editFormData, Phone: e.target.value})}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Phone 2</label>
                                    <input
                                        type="tel"
                                        value={editFormData.Phone2}
                                        onChange={(e) => setEditFormData({...editFormData, Phone2: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        value={editFormData.Email}
                                        onChange={(e) => setEditFormData({...editFormData, Email: e.target.value})}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Date of Birth</label>
                                    <input
                                        type="date"
                                        value={editFormData.DateofBirth}
                                        onChange={(e) => setEditFormData({...editFormData, DateofBirth: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Gender</label>
                                    <select
                                        value={editFormData.Gender}
                                        onChange={(e) => setEditFormData({...editFormData, Gender: e.target.value})}
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
                                    <label>Address/Zone</label>
                                    <select
                                        value={editFormData.AddressID}
                                        onChange={(e) => setEditFormData({...editFormData, AddressID: e.target.value})}
                                    >
                                        <option value="">Select Address</option>
                                        {addresses.map(address => (
                                            <option key={address.id} value={address.id}>
                                                {address.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Referral Source</label>
                                    <select
                                        value={editFormData.ReferralSourceID}
                                        onChange={(e) => setEditFormData({...editFormData, ReferralSourceID: e.target.value})}
                                    >
                                        <option value="">Select Referral Source</option>
                                        {referralSources.map(source => (
                                            <option key={source.id} value={source.id}>
                                                {source.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Patient Type</label>
                                    <select
                                        value={editFormData.PatientTypeID}
                                        onChange={(e) => setEditFormData({...editFormData, PatientTypeID: e.target.value})}
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
                                    value={editFormData.Notes}
                                    onChange={(e) => setEditFormData({...editFormData, Notes: e.target.value})}
                                    rows="3"
                                />
                            </div>

                            <div className="form-group full-width">
                                <label>Alerts</label>
                                <textarea
                                    value={editFormData.Alerts}
                                    onChange={(e) => setEditFormData({...editFormData, Alerts: e.target.value})}
                                    rows="2"
                                />
                            </div>

                            <div className="form-actions">
                                <button
                                    type="button"
                                    onClick={() => setShowEditModal(false)}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    Update Patient
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && selectedPatient && (
                <div className="modal-overlay">
                    <div className="work-modal" style={{ maxWidth: '500px' }}>
                        <div className="modal-header">
                            <h3>Confirm Delete</h3>
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="modal-close"
                            >
                                ×
                            </button>
                        </div>

                        <div style={{ padding: '1.5rem' }}>
                            <div style={{
                                backgroundColor: '#fef2f2',
                                border: '1px solid #fecaca',
                                borderRadius: '8px',
                                padding: '1rem',
                                marginBottom: '1.5rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                    <i className="fas fa-exclamation-triangle" style={{ color: '#dc2626', fontSize: '1.5rem' }}></i>
                                    <strong style={{ color: '#991b1b' }}>Warning: This action cannot be undone!</strong>
                                </div>
                                <p style={{ margin: 0, color: '#7f1d1d' }}>
                                    Are you sure you want to delete patient <strong>{selectedPatient.PatientName}</strong>?
                                    This will permanently remove all patient data including works, payments, and appointments.
                                </p>
                            </div>

                            <div className="form-actions">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDeleteConfirm}
                                    className="btn"
                                    style={{
                                        backgroundColor: '#dc2626',
                                        color: 'white'
                                    }}
                                >
                                    <i className="fas fa-trash" style={{ marginRight: '0.5rem' }}></i>
                                    Delete Patient
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PatientManagement;
