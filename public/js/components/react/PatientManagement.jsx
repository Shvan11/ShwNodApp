import React, { useState, useEffect } from 'react';
import AsyncSelect from 'react-select/async';

/**
 * Patient Management Component
 * Provides patient search, editing, and management functionality
 * Memoized to prevent unnecessary re-renders
 */
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

    // Handle patient selection from quick search
    const handleQuickSearchSelect = (selectedOption) => {
        if (selectedOption && selectedOption.value) {
            window.location.href = `/patient/${selectedOption.value}/works`;
        }
    };

    // Async search function for name (with RTL support)
    // Searches from the beginning of the name for better performance
    const loadNameOptions = (inputValue, callback) => {
        if (!inputValue || inputValue.length < 2) {
            callback([]);
            return;
        }

        const filtered = allPatients
            .filter(p => p.name && p.name.startsWith(inputValue))
            .slice(0, 50) // Limit to 50 results for performance
            .map(p => ({ value: p.id, label: p.name }));

        callback(filtered);
    };

    // Async search function for phone
    const loadPhoneOptions = (inputValue, callback) => {
        if (!inputValue || inputValue.length < 2) {
            callback([]);
            return;
        }

        const filtered = allPatients
            .filter(p => p.phone && p.phone.includes(inputValue))
            .slice(0, 50)
            .map(p => ({ value: p.id, label: p.phone }));

        callback(filtered);
    };

    // Async search function for ID
    const loadIdOptions = (inputValue, callback) => {
        if (!inputValue || inputValue.length < 1) {
            callback([]);
            return;
        }

        const filtered = allPatients
            .filter(p => p.id.toString().includes(inputValue))
            .slice(0, 50)
            .map(p => ({ value: p.id, label: p.id.toString() }));

        callback(filtered);
    };

    // Custom styles for React Select
    const selectStyles = {
        control: (provided) => ({
            ...provided,
            minHeight: '44px',
            borderColor: '#d1d5db',
            '&:hover': {
                borderColor: '#3b82f6'
            }
        }),
        menu: (provided) => ({
            ...provided,
            zIndex: 100
        })
    };

    // RTL styles for Arabic name search
    const selectStylesRTL = {
        ...selectStyles,
        input: (provided) => ({
            ...provided,
            direction: 'rtl',
            textAlign: 'right'
        }),
        singleValue: (provided) => ({
            ...provided,
            direction: 'rtl',
            textAlign: 'right'
        }),
        placeholder: (provided) => ({
            ...provided,
            direction: 'rtl',
            textAlign: 'right'
        })
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
            <div className="patient-management-header">
                <h2>Patient Management</h2>
                <div className="patient-management-header-actions">
                    <button
                        onClick={() => setShowQuickSearch(!showQuickSearch)}
                        className="btn btn-secondary"
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        <i className={`fas fa-${showQuickSearch ? 'chevron-up' : 'chevron-down'} pm-icon-gap`}></i>
                        {showQuickSearch ? 'Hide' : 'Show'} Quick Search
                    </button>
                    <button
                        onClick={() => window.location.href = '/views/patient/add-patient.html'}
                        className="btn btn-primary"
                    >
                        <i className="fas fa-plus pm-icon-gap"></i>
                        Add New Patient
                    </button>
                </div>
            </div>

            {/* Quick Search Dropdowns */}
            {showQuickSearch && (
                <div className="pm-quick-search-container">
                    <div className="pm-quick-search-header">
                        <i className="fas fa-bolt"></i>
                        <h3>Quick Search - Select & Go</h3>
                    </div>
                    <p className="pm-quick-search-description">
                        Start typing in any dropdown below to quickly find and open a patient's page
                    </p>
                    <div className="pm-quick-search-grid">
                        <div className="pm-quick-search-field">
                            <label>
                                <i className="fas fa-user pm-icon-gap"></i>
                                Search by Name (Arabic)
                            </label>
                            <AsyncSelect
                                cacheOptions
                                defaultOptions={false}
                                loadOptions={loadNameOptions}
                                onChange={handleQuickSearchSelect}
                                placeholder="اكتب للبحث..."
                                isClearable
                                styles={selectStylesRTL}
                                noOptionsMessage={() => "لم يتم العثور على مرضى"}
                                loadingMessage={() => "جاري البحث..."}
                            />
                        </div>
                        <div className="pm-quick-search-field">
                            <label>
                                <i className="fas fa-phone pm-icon-gap"></i>
                                Search by Phone
                            </label>
                            <AsyncSelect
                                cacheOptions
                                defaultOptions={false}
                                loadOptions={loadPhoneOptions}
                                onChange={handleQuickSearchSelect}
                                placeholder="Type to search by phone..."
                                isClearable
                                styles={selectStyles}
                                noOptionsMessage={() => "No patients found"}
                                loadingMessage={() => "Searching..."}
                            />
                        </div>
                        <div className="pm-quick-search-field">
                            <label>
                                <i className="fas fa-id-card pm-icon-gap"></i>
                                Search by ID
                            </label>
                            <AsyncSelect
                                cacheOptions
                                defaultOptions={false}
                                loadOptions={loadIdOptions}
                                onChange={handleQuickSearchSelect}
                                placeholder="Type to search by ID..."
                                isClearable
                                styles={selectStyles}
                                noOptionsMessage={() => "No patients found"}
                                loadingMessage={() => "Searching..."}
                            />
                        </div>
                    </div>
                </div>
            )}

            <hr className="pm-section-divider" />

            <div className="pm-search-section-header">
                <h3>
                    <i className="fas fa-search"></i>
                    Advanced Search & Management
                </h3>
                <p>
                    Search by name fields with auto-complete, or use phone/ID search. Edit and manage patient records.
                </p>
            </div>

            {/* Search Form - 3 separate name fields */}
            <div className="pm-name-search-grid">
                <div>
                    <label>
                        Patient Name (Arabic)
                    </label>
                    <input
                        type="text"
                        placeholder="e.g., احمد محمد"
                        value={searchPatientName}
                        onChange={(e) => setSearchPatientName(e.target.value)}
                        className="search-input"
                        style={{ direction: 'rtl', textAlign: 'right' }}
                        lang="ar"
                        dir="rtl"
                    />
                </div>
                <div>
                    <label>
                        First Name (English)
                    </label>
                    <input
                        type="text"
                        placeholder="e.g., Ahmad"
                        value={searchFirstName}
                        onChange={(e) => setSearchFirstName(e.target.value)}
                        className="search-input"
                    />
                </div>
                <div>
                    <label>
                        Last Name (English)
                    </label>
                    <input
                        type="text"
                        placeholder="e.g., Mohammad"
                        value={searchLastName}
                        onChange={(e) => setSearchLastName(e.target.value)}
                        className="search-input"
                    />
                </div>
            </div>

            {/* Additional search options */}
            <form onSubmit={handleSearch} className="pm-search-form">
                <input
                    type="text"
                    placeholder="Or search by phone or ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input pm-search-input"
                />
                <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading}
                >
                    <i className="fas fa-search pm-icon-gap"></i>
                    {loading ? 'Searching...' : 'Search'}
                </button>
                <button
                    type="button"
                    onClick={handleShowAll}
                    className="btn btn-secondary"
                    disabled={loading}
                >
                    <i className="fas fa-list pm-icon-gap"></i>
                    Show All
                </button>
            </form>

            {error && (
                <div className="pm-error-message">
                    {error}
                    <button onClick={() => setError(null)} className="pm-error-close">
                        ×
                    </button>
                </div>
            )}

            {successMessage && (
                <div className="pm-success-message">
                    <i className="fas fa-check-circle pm-icon-gap"></i>
                    {successMessage}
                </div>
            )}

            {hasSearched && (
                <div className="pm-results-summary">
                    <div className="summary-card">
                        <h3>Results Found</h3>
                        <span className="summary-value">{patients.length}</span>
                    </div>
                </div>
            )}

            {loading && (
                <div className="pm-loading-container">
                    <i className="fas fa-spinner fa-spin pm-loading-spinner"></i>
                    <p>Searching patients...</p>
                </div>
            )}

            {!loading && !hasSearched && (
                <div className="pm-empty-state">
                    <i className="fas fa-search"></i>
                    <h3>Start Typing to Search</h3>
                    <p>
                        Type at least 2 characters in any name field above. Results will appear automatically as you type.
                    </p>
                    <p>
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
                                        <div className="pm-patient-name-secondary">
                                            {patient.FirstName} {patient.LastName}
                                        </div>
                                    )}
                                </td>
                                <td>{patient.Phone || 'N/A'}</td>
                                <td>{patient.Email || 'N/A'}</td>
                                <td>{formatDate(patient.DateofBirth)}</td>
                                <td>{patient.GenderName || 'N/A'}</td>
                                <td>
                                    <div className="pm-action-buttons">
                                        <button
                                            onClick={() => handleQuickCheckin(patient)}
                                            className="btn btn-sm pm-btn-checkin"
                                            title="Add to today's appointments and check in"
                                            disabled={loading}
                                        >
                                            <i className="fas fa-check-circle"></i> Check In
                                        </button>
                                        <button
                                            onClick={() => window.location.href = `/patient/${patient.PersonID}/works`}
                                            className="btn btn-sm pm-btn-view"
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
                                            className="btn btn-sm pm-btn-delete"
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
                    <div className="work-modal pm-modal-wide">
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
                                    <label>Patient Name <span className="pm-required-asterisk">*</span></label>
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
                    <div className="work-modal pm-modal-narrow">
                        <div className="modal-header">
                            <h3>Confirm Delete</h3>
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="modal-close"
                            >
                                ×
                            </button>
                        </div>

                        <div className="pm-delete-modal-content">
                            <div className="pm-delete-warning-box">
                                <div className="pm-delete-warning-header">
                                    <i className="fas fa-exclamation-triangle"></i>
                                    <strong>PERMANENT DELETION WARNING</strong>
                                </div>
                                <p>
                                    Are you sure you want to permanently delete patient <strong>{selectedPatient.PatientName}</strong>?
                                </p>
                                <div className="pm-delete-warning-list-container">
                                    <p>
                                        The following data will be PERMANENTLY DELETED:
                                    </p>
                                    <ul>
                                        <li>All treatment works and procedures</li>
                                        <li>All payment records</li>
                                        <li>All appointments (past and future)</li>
                                        <li>All visit records</li>
                                        <li>All orthodontic records (wires, screws, etc.)</li>
                                        <li>Patient photos and documents</li>
                                        <li>All other patient data</li>
                                    </ul>
                                </div>
                                <p className="pm-delete-final-warning">
                                    ⚠️ THIS ACTION CANNOT BE UNDONE! ⚠️
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
                                    className="btn pm-btn-delete"
                                >
                                    <i className="fas fa-trash pm-icon-gap"></i>
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

// Memoize to prevent unnecessary re-renders
export default React.memo(PatientManagement);
