import React, { useState, useEffect } from 'react';
import AsyncSelect from 'react-select/async';
import Select from 'react-select';

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

    // Advanced filters state
    const [selectedWorkTypes, setSelectedWorkTypes] = useState([]);
    const [selectedKeywords, setSelectedKeywords] = useState([]);
    const [selectedTags, setSelectedTags] = useState([]);
    const [workTypes, setWorkTypes] = useState([]);
    const [keywords, setKeywords] = useState([]);
    const [tags, setTags] = useState([]);
    const [showFilters, setShowFilters] = useState(false);


    useEffect(() => {
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

    // Load filter data on mount
    useEffect(() => {
        loadFilterData();
    }, []);

    const loadFilterData = async () => {
        try {
            // Load work types
            const workTypesResponse = await fetch('/api/getworktypes');
            if (workTypesResponse.ok) {
                const workTypesData = await workTypesResponse.json();
                setWorkTypes(workTypesData.map(wt => ({
                    value: wt.ID,
                    label: wt.WorkType
                })));
            }

            // Load keywords
            const keywordsResponse = await fetch('/api/getworkkeywords');
            if (keywordsResponse.ok) {
                const keywordsData = await keywordsResponse.json();
                setKeywords(keywordsData.map(kw => ({
                    value: kw.ID,
                    label: kw.KeyWord
                })));
            }

            // Load tags
            const tagsResponse = await fetch('/api/tag-options');
            if (tagsResponse.ok) {
                const tagsData = await tagsResponse.json();
                setTags(tagsData.map(tag => ({
                    value: tag.ID,
                    label: tag.Tag
                })));
            }
        } catch (err) {
            console.error('Error loading filter data:', err);
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

    // RTL styles for Arabic name search (dynamic runtime values - allowed)
    const selectStylesRTL = {
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

        // Check if any field has at least 2 characters OR any filters are selected
        const hasMinimumInput =
            searchPatientName.trim().length >= 2 ||
            searchFirstName.trim().length >= 2 ||
            searchLastName.trim().length >= 2;

        const hasFilters =
            selectedWorkTypes.length > 0 ||
            selectedKeywords.length > 0 ||
            selectedTags.length > 0;

        if (hasMinimumInput || hasFilters) {
            // Set new timeout for debounced search
            const timeoutId = setTimeout(() => {
                performSearch();
            }, 500); // 500ms delay

            setSearchDebounce(timeoutId);
        } else {
            // Clear results if all fields are empty or too short and no filters
            if (!searchPatientName && !searchFirstName && !searchLastName && !hasFilters) {
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
    }, [searchPatientName, searchFirstName, searchLastName, selectedWorkTypes, selectedKeywords, selectedTags]);

    const performSearch = async () => {
        try {
            setLoading(true);
            setError(null);

            // Build query parameters
            const params = new URLSearchParams();
            if (searchPatientName.trim()) params.append('patientName', searchPatientName.trim());
            if (searchFirstName.trim()) params.append('firstName', searchFirstName.trim());
            if (searchLastName.trim()) params.append('lastName', searchLastName.trim());

            // Add filter parameters
            if (selectedWorkTypes.length > 0) {
                params.append('workTypes', selectedWorkTypes.map(wt => wt.value).join(','));
            }
            if (selectedKeywords.length > 0) {
                params.append('keywords', selectedKeywords.map(kw => kw.value).join(','));
            }
            if (selectedTags.length > 0) {
                params.append('tags', selectedTags.map(tag => tag.value).join(','));
            }

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
                        className="btn btn-secondary whitespace-nowrap"
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
                                classNamePrefix="pm-select"
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
                                classNamePrefix="pm-select"
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
                                classNamePrefix="pm-select"
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
                        className="search-input text-rtl"
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

            {/* Advanced Filters Section */}
            <div className="pm-advanced-filters">
                <div className="pm-advanced-filters__header" onClick={() => setShowFilters(!showFilters)}>
                    <h4>
                        <i className={`fas fa-filter pm-icon-gap`}></i>
                        Advanced Filters
                        {(selectedWorkTypes.length + selectedKeywords.length + selectedTags.length > 0) && (
                            <span className="pm-filter-badge">
                                {selectedWorkTypes.length + selectedKeywords.length + selectedTags.length} active
                            </span>
                        )}
                    </h4>
                    <i className={`fas fa-chevron-${showFilters ? 'up' : 'down'}`}></i>
                </div>

                {showFilters && (
                    <div className="pm-advanced-filters__content">
                        <div className="pm-advanced-filters__grid">
                            <div className="pm-filter-group">
                                <label>
                                    <i className="fas fa-tooth pm-icon-gap"></i>
                                    Filter by Work Type
                                </label>
                                <Select
                                    isMulti
                                    isClearable
                                    isSearchable
                                    closeMenuOnSelect={false}
                                    options={workTypes}
                                    value={selectedWorkTypes}
                                    onChange={setSelectedWorkTypes}
                                    placeholder="Select work types..."
                                    className="pm-filter-select"
                                    classNamePrefix="pm-select"
                                    menuPortalTarget={document.body}
                                    menuPosition="fixed"
                                    noOptionsMessage={() => "No work types found"}
                                />
                            </div>

                            <div className="pm-filter-group">
                                <label>
                                    <i className="fas fa-tags pm-icon-gap"></i>
                                    Filter by Keywords
                                </label>
                                <Select
                                    isMulti
                                    isClearable
                                    isSearchable
                                    closeMenuOnSelect={false}
                                    options={keywords}
                                    value={selectedKeywords}
                                    onChange={setSelectedKeywords}
                                    placeholder="Search keywords..."
                                    className="pm-filter-select"
                                    classNamePrefix="pm-select"
                                    menuPortalTarget={document.body}
                                    menuPosition="fixed"
                                    noOptionsMessage={() => "No keywords found"}
                                />
                            </div>

                            <div className="pm-filter-group">
                                <label>
                                    <i className="fas fa-bookmark pm-icon-gap"></i>
                                    Filter by Patient Tag
                                </label>
                                <Select
                                    isMulti
                                    isClearable
                                    isSearchable
                                    options={tags}
                                    value={selectedTags}
                                    onChange={setSelectedTags}
                                    placeholder="Select tags..."
                                    className="pm-filter-select"
                                    classNamePrefix="pm-select"
                                    menuPortalTarget={document.body}
                                    menuPosition="fixed"
                                    noOptionsMessage={() => "No tags found"}
                                />
                            </div>
                        </div>

                        {/* Selected Filters Display */}
                        {(selectedWorkTypes.length + selectedKeywords.length + selectedTags.length > 0) && (
                            <div className="pm-active-filters">
                                <div className="pm-active-filters__header">
                                    <span>Active Filters:</span>
                                    <button
                                        type="button"
                                        className="pm-clear-filters-btn"
                                        onClick={() => {
                                            setSelectedWorkTypes([]);
                                            setSelectedKeywords([]);
                                            setSelectedTags([]);
                                        }}
                                    >
                                        <i className="fas fa-times pm-icon-gap"></i>
                                        Clear All Filters
                                    </button>
                                </div>
                                <div className="pm-filter-chips">
                                    {selectedWorkTypes.map(wt => (
                                        <span key={`wt-${wt.value}`} className="pm-filter-chip pm-filter-chip--work">
                                            <i className="fas fa-tooth pm-icon-gap"></i>
                                            {wt.label}
                                            <button
                                                onClick={() => setSelectedWorkTypes(selectedWorkTypes.filter(item => item.value !== wt.value))}
                                                className="pm-filter-chip__remove"
                                            >
                                                ×
                                            </button>
                                        </span>
                                    ))}
                                    {selectedKeywords.map(kw => (
                                        <span key={`kw-${kw.value}`} className="pm-filter-chip pm-filter-chip--keyword">
                                            <i className="fas fa-tags pm-icon-gap"></i>
                                            {kw.label}
                                            <button
                                                onClick={() => setSelectedKeywords(selectedKeywords.filter(item => item.value !== kw.value))}
                                                className="pm-filter-chip__remove"
                                            >
                                                ×
                                            </button>
                                        </span>
                                    ))}
                                    {selectedTags.map(tag => (
                                        <span key={`tag-${tag.value}`} className="pm-filter-chip pm-filter-chip--tag">
                                            <i className="fas fa-bookmark pm-icon-gap"></i>
                                            {tag.label}
                                            <button
                                                onClick={() => setSelectedTags(selectedTags.filter(item => item.value !== tag.value))}
                                                className="pm-filter-chip__remove"
                                            >
                                                ×
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

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
                                <th>Tag</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {patients.map((patient) => (
                            <tr key={patient.PersonID}>
                                <td>{patient.PersonID}</td>
                                <td>
                                    <strong>{patient.PatientName}</strong>
                                    {patient.FirstName && (
                                        <div className="pm-patient-name-secondary">
                                            {patient.FirstName} {patient.LastName}
                                        </div>
                                    )}
                                </td>
                                <td>{patient.Phone || 'N/A'}</td>
                                <td>
                                    {patient.TagName ? (
                                        <span className="pm-tag-badge">{patient.TagName}</span>
                                    ) : (
                                        <span className="pm-empty-value">-</span>
                                    )}
                                </td>
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
                                            onClick={() => window.location.href = `/patient/${patient.PersonID}/edit-patient`}
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
