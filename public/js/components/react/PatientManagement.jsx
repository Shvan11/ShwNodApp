import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import AsyncSelect from 'react-select/async';
import Select from 'react-select';
import { useToast } from '../../contexts/ToastContext.jsx';

/**
 * Patient Management Component
 * Provides patient search, editing, and management functionality
 * Memoized to prevent unnecessary re-renders
 */
const PatientManagement = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [patients, setPatients] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [hasSearched, setHasSearched] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState(null);

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
    const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });

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

    // Save search state to sessionStorage (for search restoration only, NOT scroll)
    useEffect(() => {
        const stateToSave = {
            searchPatientName,
            searchFirstName,
            searchLastName,
            selectedWorkTypes,
            selectedKeywords,
            selectedTags,
            showFilters,
            sortConfig,
            hasSearched
        };
        sessionStorage.setItem('pm_search_state', JSON.stringify(stateToSave));
    }, [searchPatientName, searchFirstName, searchLastName, selectedWorkTypes, selectedKeywords, selectedTags, showFilters, sortConfig, hasSearched]);

    // Restore search state on mount (React Router handles scroll restoration)
    useEffect(() => {
        // Check for search parameter in URL - if present, skip restoration to allow URL to take precedence
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('search')) {
            return;
        }

        const savedState = sessionStorage.getItem('pm_search_state');
        if (savedState) {
            try {
                const parsed = JSON.parse(savedState);

                // Check if this was an advanced search
                const isAdvancedSearch = parsed.searchPatientName || parsed.searchFirstName || parsed.searchLastName ||
                    (parsed.selectedWorkTypes && parsed.selectedWorkTypes.length > 0) ||
                    (parsed.selectedKeywords && parsed.selectedKeywords.length > 0) ||
                    (parsed.selectedTags && parsed.selectedTags.length > 0);

                if (isAdvancedSearch) {
                    // Restore only advanced search states
                    setSearchPatientName(parsed.searchPatientName || '');
                    setSearchFirstName(parsed.searchFirstName || '');
                    setSearchLastName(parsed.searchLastName || '');
                    setSelectedWorkTypes(parsed.selectedWorkTypes || []);
                    setSelectedKeywords(parsed.selectedKeywords || []);
                    setSelectedTags(parsed.selectedTags || []);

                    // Restore UI state for advanced search
                    if (parsed.showFilters !== undefined) setShowFilters(parsed.showFilters);
                    if (parsed.sortConfig) setSortConfig(parsed.sortConfig);

                    // The auto-search useEffect will trigger when the above states update
                }
            } catch (e) {
                console.error('[PM] Failed to parse saved search state', e);
            }
        }
    }, []);

    // Handle patient selection from quick search
    const handleQuickSearchSelect = (selectedOption) => {
        if (selectedOption && selectedOption.value) {
            navigate(`/patient/${selectedOption.value}/works`);
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
            // Normal user typing behavior - use debounce
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

            // Add sort parameters
            params.append('sortBy', sortConfig.key);
            params.append('order', sortConfig.direction);

            const response = await fetch(`/api/patients/search?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to search patients');
            const data = await response.json();
            setPatients(data);
            setHasSearched(true);
        } catch (err) {
            toast.error(err.message || 'Failed to search patients');
            setPatients([]);
        } finally {
            setLoading(false);
        }
    };

    const searchPatients = async (searchQuery = searchTerm, showAll = false) => {
        // Don't search if no query and not showing all
        if (!showAll && (!searchQuery || searchQuery.trim().length < 2)) {
            toast.warning('Please enter at least 2 characters to search');
            return;
        }

        try {
            setLoading(true);
            const query = showAll ? '' : searchQuery.trim();
            const response = await fetch(`/api/patients/search?q=${encodeURIComponent(query)}&sortBy=${sortConfig.key}&order=${sortConfig.direction}`);
            if (!response.ok) throw new Error('Failed to search patients');
            const data = await response.json();
            setPatients(data);
            setHasSearched(true);
        } catch (err) {
            toast.error(err.message || 'Failed to search patients');
            setPatients([]);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e) => {
        if (e && e.preventDefault) {
            e.preventDefault();
        }

        // Validate search input
        if (!searchTerm || searchTerm.trim().length < 2) {
            toast.warning('Please enter at least 2 characters to search');
            return;
        }

        searchPatients();
    };

    const handleShowAll = () => {
        setSearchTerm('');
        searchPatients('', true);
    };

    const handleResetAdvancedSearch = () => {
        // Clear all advanced search fields
        setSearchPatientName('');
        setSearchFirstName('');
        setSearchLastName('');
        setSelectedWorkTypes([]);
        setSelectedKeywords([]);
        setSelectedTags([]);

        // Clear results and search state
        setPatients([]);
        setHasSearched(false);

        // Clear sessionStorage
        sessionStorage.removeItem('pm_search_state');
    };

    const handleSortToggle = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        } else if (key === 'date') {
            // Default to newest first for date
            direction = sortConfig.key === key && sortConfig.direction === 'desc' ? 'asc' : 'desc';
        }

        setSortConfig({ key, direction });

        // Trigger search with new sort immediately if we have results or search term
        if (hasSearched) {
            // Use a timeout to allow state update to propagate (or pass directly)
            setTimeout(() => {
                // We need to pass the current state values directly since state update is async
                // But simpler to just re-call performSearch which uses current state... 
                // actually performSearch uses state which might be stale in this closure without useEffect
                // Better to trigger via useEffect on sortConfig change or pass params

                // Re-implementing fetch here to ensure we use new sort params
                const params = new URLSearchParams();
                if (searchPatientName.trim()) params.append('patientName', searchPatientName.trim());
                if (searchFirstName.trim()) params.append('firstName', searchFirstName.trim());
                if (searchLastName.trim()) params.append('lastName', searchLastName.trim());
                if (searchTerm.trim()) params.append('q', searchTerm.trim());

                if (selectedWorkTypes.length > 0) params.append('workTypes', selectedWorkTypes.map(wt => wt.value).join(','));
                if (selectedKeywords.length > 0) params.append('keywords', selectedKeywords.map(kw => kw.value).join(','));
                if (selectedTags.length > 0) params.append('tags', selectedTags.map(tag => tag.value).join(','));

                params.append('sortBy', key);
                params.append('order', direction);

                setLoading(true);
                fetch(`/api/patients/search?${params.toString()}`)
                    .then(res => res.json())
                    .then(data => {
                        setPatients(data);
                        setLoading(false);
                    })
                    .catch(err => {
                        toast.error(err.message || 'Failed to sort patients');
                        setLoading(false);
                    });
            }, 0);
        }
    };


    const handleDeleteClick = (patient) => {
        setSelectedPatient(patient);
        setShowDeleteConfirm(true);
    };

    const handleQuickCheckin = async (e, patient) => {
        // Prevent any default browser behavior
        if (e && e.preventDefault) {
            e.preventDefault();
            e.stopPropagation();
        }

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
                toast.info(`${patient.PatientName} is already checked in today!`);
            } else if (result.created) {
                toast.success(`${patient.PatientName} added to today's appointments and checked in!`);
            } else {
                toast.success(`${patient.PatientName} checked in successfully!`);
            }
        } catch (err) {
            toast.error(err.message || 'Failed to check in patient');
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
            toast.success('Patient deleted successfully!');
        } catch (err) {
            toast.error(err.message || 'Failed to delete patient');
        }
    };

    return (
        <div className="page-patient-management">
            <div className="patient-management-header">
                <h2>Patient Management</h2>
                <div className="patient-management-header-actions">
                    <button
                        type="button"
                        onClick={() => setShowQuickSearch(!showQuickSearch)}
                        className="btn btn-secondary whitespace-nowrap"
                    >
                        <i className={`fas fa-${showQuickSearch ? 'chevron-up' : 'chevron-down'} pm-icon-gap`}></i>
                        {showQuickSearch ? 'Hide' : 'Show'} Quick Search
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/patient/new/edit-patient')}
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

            {/* Search Form - 4 separate fields now */}
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
                        className="form-control text-rtl"
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
                        className="form-control"
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
                        className="form-control"
                    />
                </div>
                <div>
                    <label>
                        Phone or ID
                    </label>
                    <input
                        type="text"
                        placeholder="Search by phone or ID..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch(e)}
                        className="form-control"
                    />
                </div>
            </div>

            {/* Search Actions */}
            <div className="pm-search-form">
                <button
                    type="button"
                    onClick={handleSearch}
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
                <button
                    onClick={handleResetAdvancedSearch}
                    className="btn btn-secondary"
                    type="button"
                    disabled={loading}
                    title="Clear all advanced search fields and filters"
                >
                    <i className="fas fa-redo pm-icon-gap"></i>
                    Reset
                </button>
            </div>

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
                                                type="button"
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
                                                type="button"
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
                                                type="button"
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

            {hasSearched && (
                <div className="pm-results-summary">
                    <div className="summary-card">
                        <h3>Results Found</h3>
                        <span className="summary-value">{patients.length}</span>
                    </div>
                    <div className="pm-sort-controls">
                        <span className="pm-sort-label">Sort by:</span>
                        <div className="pm-sort-toggle">
                            <button
                                type="button"
                                className={`pm-sort-btn ${sortConfig.key === 'name' ? 'active' : ''}`}
                                onClick={() => handleSortToggle('name')}
                            >
                                Name {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                            </button>
                            <button
                                type="button"
                                className={`pm-sort-btn ${sortConfig.key === 'date' ? 'active' : ''}`}
                                onClick={() => handleSortToggle('date')}
                            >
                                Date {sortConfig.key === 'date' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                            </button>
                        </div>
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
                <div className="pm-table-container">
                    <table className="pm-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Patient Name</th>
                                <th>Phone</th>
                                <th>Creation Date</th>
                                <th>Tag</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {patients.map((patient) => (
                                <tr key={patient.PersonID}>
                                    <td data-label="ID">{patient.PersonID}</td>
                                    <td data-label="Patient Name">
                                        <strong>{patient.PatientName}</strong>
                                        {patient.FirstName && (
                                            <div className="pm-patient-name-secondary">
                                                {patient.FirstName} {patient.LastName}
                                            </div>
                                        )}
                                    </td>
                                    <td data-label="Phone">{patient.Phone || 'N/A'}</td>
                                    <td data-label="Creation Date">
                                        {patient.DateAdded ? new Date(patient.DateAdded).toLocaleDateString() : 'N/A'}
                                    </td>
                                    <td data-label="Tag">
                                        {patient.TagName ? (
                                            <span className="pm-tag-badge">{patient.TagName}</span>
                                        ) : (
                                            <span className="pm-empty-value">-</span>
                                        )}
                                    </td>
                                    <td data-label="Actions">
                                        <div className="pm-action-buttons">
                                            <button
                                                type="button"
                                                onClick={(e) => handleQuickCheckin(e, patient)}
                                                className="btn btn-icon btn-outline-success"
                                                title="Add to today's appointments and check in"
                                                disabled={loading}
                                            >
                                                <i className="fas fa-user-check"></i>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => navigate(`/patient/${patient.PersonID}/works`)}
                                                className="btn btn-icon btn-outline-primary"
                                                title="View patient details"
                                            >
                                                <i className="fas fa-eye"></i>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => navigate(`/patient/${patient.PersonID}/edit-patient`)}
                                                className="btn btn-icon btn-outline-warning"
                                                title="Edit patient"
                                            >
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteClick(patient)}
                                                className="btn btn-icon btn-outline-danger"
                                                title="Delete patient"
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {patients.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="no-data">
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
                                type="button"
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
                                    type="button"
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleDeleteConfirm}
                                    className="btn btn-danger"
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
