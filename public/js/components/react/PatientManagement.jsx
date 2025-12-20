import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLoaderData } from 'react-router-dom';
import AsyncSelect from 'react-select/async';
import Select from 'react-select';
import { useToast } from '../../contexts/ToastContext.jsx';

/**
 * Patient Management Component
 * * Architecture Note:
 * This component uses a "Synchronous Restoration" pattern to support React Router's <ScrollRestoration />.
 * 1. State is initialized from sessionStorage BEFORE the first render.
 * 2. This ensures the table is fully populated immediately on mount.
 * 3. React Router then handles the scroll position automatically.
 */
const PatientManagement = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const loaderData = useLoaderData();

    // --- 1. Synchronous State Initialization ---
    // We read storage ONCE via a ref/function. By passing this result to useState,
    // React initializes the state with data available on the very first paint.
    const savedState = useRef(() => {
        try {
            const saved = sessionStorage.getItem('pm_search_state');
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            console.error('Failed to load saved state', e);
            return null;
        }
    }).current();

    // -- Data State --
    const [patients, setPatients] = useState(savedState?.patients || []);
    const [hasSearched, setHasSearched] = useState(savedState?.hasSearched || false);
    const [loading, setLoading] = useState(false);

    // -- Search Inputs --
    const [searchPatientName, setSearchPatientName] = useState(savedState?.searchPatientName || '');
    const [searchFirstName, setSearchFirstName] = useState(savedState?.searchFirstName || '');
    const [searchLastName, setSearchLastName] = useState(savedState?.searchLastName || '');
    const [searchTerm, setSearchTerm] = useState(savedState?.searchTerm || '');

    // -- Filters & Sorting --
    const [selectedWorkTypes, setSelectedWorkTypes] = useState(savedState?.selectedWorkTypes || []);
    const [selectedKeywords, setSelectedKeywords] = useState(savedState?.selectedKeywords || []);
    const [selectedTags, setSelectedTags] = useState(savedState?.selectedTags || []);
    const [showFilters, setShowFilters] = useState(savedState?.showFilters || false);
    const [sortConfig, setSortConfig] = useState(savedState?.sortConfig || { key: 'name', direction: 'asc' });

    // -- UI State (Non-persistent) --
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [showQuickSearch, setShowQuickSearch] = useState(true);

    // -- Dropdown Data (from loader, no state needed) --
    const allPatients = loaderData?.allPatients || [];
    const workTypes = loaderData?.workTypes || [];
    const keywords = loaderData?.keywords || [];
    const tags = loaderData?.tags || [];

    // -- Refs --
    const searchDebounceRef = useRef(null);
    const abortControllerRef = useRef(null);
    // Flag to skip the initial auto-search if we just restored valid data
    const isRestoring = useRef(!!savedState); 

    // --- 2. URL Param Handling ---
    useEffect(() => {
        // Handle URL Params (Deep linking has priority over Storage)
        const urlParams = new URLSearchParams(window.location.search);
        const urlSearch = urlParams.get('search');
        if (urlSearch) {
            setSearchPatientName(urlSearch);
            isRestoring.current = false; // Force auto-search for URL param
        }
    }, []);

    // --- 3. Persistence Logic ---
    // Save state whenever relevant data changes
    useEffect(() => {
        const handleSaveState = () => {
            const stateToSave = {
                patients,
                hasSearched,
                searchPatientName,
                searchFirstName,
                searchLastName,
                searchTerm,
                selectedWorkTypes,
                selectedKeywords,
                selectedTags,
                showFilters,
                sortConfig
            };
            sessionStorage.setItem('pm_search_state', JSON.stringify(stateToSave));
        };

        // Save on unmount (navigation)
        return () => handleSaveState();
    }, [
        patients, hasSearched, searchPatientName, searchFirstName, searchLastName, searchTerm,
        selectedWorkTypes, selectedKeywords, selectedTags, showFilters, sortConfig
    ]);

    // --- Search Logic ---
    const executeSearch = useCallback(async (overrideSort = null) => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const currentSort = overrideSort || sortConfig;

        try {
            setLoading(true);

            const params = new URLSearchParams();
            if (searchPatientName.trim()) params.append('patientName', searchPatientName.trim());
            if (searchFirstName.trim()) params.append('firstName', searchFirstName.trim());
            if (searchLastName.trim()) params.append('lastName', searchLastName.trim());
            if (searchTerm.trim()) params.append('q', searchTerm.trim());

            if (selectedWorkTypes.length > 0) params.append('workTypes', selectedWorkTypes.map(wt => wt.value).join(','));
            if (selectedKeywords.length > 0) params.append('keywords', selectedKeywords.map(kw => kw.value).join(','));
            if (selectedTags.length > 0) params.append('tags', selectedTags.map(tag => tag.value).join(','));

            params.append('sortBy', currentSort.key);
            params.append('order', currentSort.direction);

            const response = await fetch(`/api/patients/search?${params.toString()}`, {
                signal: abortController.signal
            });

            if (!response.ok) throw new Error('Failed to search patients');

            const data = await response.json();
            setPatients(data);
            setHasSearched(true);
        } catch (err) {
            if (err.name !== 'AbortError') {
                toast.error(err.message || 'Failed to search patients');
            }
        } finally {
            if (!abortController.signal.aborted) {
                setLoading(false);
            }
        }
    }, [searchPatientName, searchFirstName, searchLastName, searchTerm, selectedWorkTypes, selectedKeywords, selectedTags, sortConfig, toast]);

    // --- Auto-Search Effect ---
    useEffect(() => {
        const hasInputs = searchPatientName || searchFirstName || searchLastName || searchTerm || 
                          selectedWorkTypes.length > 0 || selectedKeywords.length > 0 || selectedTags.length > 0;

        // SKIP search if we just restored data from storage
        // This ensures the "cached view" remains stable and we don't flash a loading spinner unnecessarily
        if (isRestoring.current) {
            isRestoring.current = false; // Next change will trigger search normally
            return;
        }

        if (hasInputs) {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
            searchDebounceRef.current = setTimeout(() => {
                executeSearch();
            }, 500);
        }

        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [searchPatientName, searchFirstName, searchLastName, searchTerm, selectedWorkTypes, selectedKeywords, selectedTags, executeSearch]);

    // --- Handlers ---

    const handleSearchBtnClick = () => executeSearch();

    const handleReset = () => {
        sessionStorage.removeItem('pm_search_state');
        setSearchPatientName(''); setSearchFirstName(''); setSearchLastName(''); setSearchTerm('');
        setSelectedWorkTypes([]); setSelectedKeywords([]); setSelectedTags([]);
        setPatients([]); setHasSearched(false); setShowFilters(false);
        setSortConfig({ key: 'name', direction: 'asc' });
    };

    const handleSortToggle = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        else if (key === 'date') direction = sortConfig.key === key && sortConfig.direction === 'desc' ? 'asc' : 'desc';
        
        const newSort = { key, direction };
        setSortConfig(newSort);
        executeSearch(newSort);
    };

    const handleShowAll = () => {
        // Clear inputs and force search
        setSearchPatientName(''); setSearchFirstName(''); setSearchLastName(''); setSearchTerm('');
        setLoading(true);
        fetch(`/api/patients/search?q=&sortBy=name&order=asc`)
            .then(res => res.json())
            .then(data => {
                setPatients(data);
                setHasSearched(true);
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
                toast.error('Failed to load all patients');
            });
    };

    const handleQuickCheckin = async (e, patient) => {
        e.preventDefault(); e.stopPropagation();
        try {
            setLoading(true);
            const res = await fetch('/api/appointments/quick-checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ PersonID: patient.PersonID })
            });
            if(!res.ok) throw new Error((await res.json()).error);
            const data = await res.json();
            toast.success(data.alreadyCheckedIn ? 'Already checked in' : 'Checked in successfully');
        } catch(err) { toast.error(err.message); } 
        finally { setLoading(false); }
    };

    const handleDeleteClick = (patient) => { setSelectedPatient(patient); setShowDeleteConfirm(true); };
    
    const handleDeleteConfirm = async () => {
        try {
            const res = await fetch(`/api/patients/${selectedPatient.PersonID}`, { method: 'DELETE' });
            if(!res.ok) throw new Error('Delete failed');
            executeSearch();
            setShowDeleteConfirm(false);
            toast.success('Patient deleted');
        } catch(err) { toast.error(err.message); }
    };

    const handleQuickSearchSelect = (opt) => opt?.value && navigate(`/patient/${opt.value}/works`);
    
    // Select Loaders
    const loadNameOptions = (input, cb) => cb(input.length < 2 ? [] : allPatients.filter(p => p.name?.startsWith(input)).slice(0, 50).map(p => ({value: p.id, label: p.name})));
    const loadPhoneOptions = (input, cb) => cb(input.length < 2 ? [] : allPatients.filter(p => p.phone?.includes(input)).slice(0, 50).map(p => ({value: p.id, label: p.phone})));
    const loadIdOptions = (input, cb) => cb(input.length < 1 ? [] : allPatients.filter(p => p.id?.toString().includes(input)).slice(0, 50).map(p => ({value: p.id, label: p.id.toString()})));

    const selectStylesRTL = {
        input: (provided) => ({ ...provided, direction: 'rtl', textAlign: 'right' }),
        singleValue: (provided) => ({ ...provided, direction: 'rtl', textAlign: 'right' }),
        placeholder: (provided) => ({ ...provided, direction: 'rtl', textAlign: 'right' })
    };

    return (
        <div className="page-patient-management">
            <div className="patient-management-header">
                <h2>Patient Management</h2>
                <div className="patient-management-header-actions">
                    <button type="button" onClick={() => setShowQuickSearch(!showQuickSearch)} className="btn btn-secondary whitespace-nowrap">
                        <i className={`fas fa-${showQuickSearch ? 'chevron-up' : 'chevron-down'} pm-icon-gap`}></i>
                        {showQuickSearch ? 'Hide' : 'Show'} Quick Search
                    </button>
                    <button type="button" onClick={() => navigate('/patient/new/edit-patient')} className="btn btn-primary">
                        <i className="fas fa-plus pm-icon-gap"></i> Add New Patient
                    </button>
                </div>
            </div>

            {showQuickSearch && (
                <div className="pm-quick-search-container">
                    <div className="pm-quick-search-header"><i className="fas fa-bolt"></i><h3>Quick Search - Select & Go</h3></div>
                    <div className="pm-quick-search-grid">
                        <div className="pm-quick-search-field">
                            <label><i className="fas fa-user pm-icon-gap"></i>Search by Name (Arabic)</label>
                            <AsyncSelect cacheOptions defaultOptions={false} loadOptions={loadNameOptions} onChange={handleQuickSearchSelect} placeholder="اكتب للبحث..." isClearable classNamePrefix="pm-select" styles={selectStylesRTL} />
                        </div>
                        <div className="pm-quick-search-field">
                            <label><i className="fas fa-phone pm-icon-gap"></i>Search by Phone</label>
                            <AsyncSelect cacheOptions defaultOptions={false} loadOptions={loadPhoneOptions} onChange={handleQuickSearchSelect} placeholder="Search phone..." isClearable classNamePrefix="pm-select" />
                        </div>
                        <div className="pm-quick-search-field">
                            <label><i className="fas fa-id-card pm-icon-gap"></i>Search by ID</label>
                            <AsyncSelect cacheOptions defaultOptions={false} loadOptions={loadIdOptions} onChange={handleQuickSearchSelect} placeholder="Search ID..." isClearable classNamePrefix="pm-select" />
                        </div>
                    </div>
                </div>
            )}

            <hr className="pm-section-divider" />
            <div className="pm-search-section-header"><h3><i className="fas fa-search"></i>Advanced Search</h3></div>

            <div className="pm-name-search-grid">
                <div><label>Name (Arabic)</label><input type="text" value={searchPatientName} onChange={e => setSearchPatientName(e.target.value)} className="form-control text-rtl" dir="rtl"/></div>
                <div><label>First Name</label><input type="text" value={searchFirstName} onChange={e => setSearchFirstName(e.target.value)} className="form-control"/></div>
                <div><label>Last Name</label><input type="text" value={searchLastName} onChange={e => setSearchLastName(e.target.value)} className="form-control"/></div>
                <div><label>Phone/ID</label><input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} onKeyDown={e => e.key === 'Enter' && executeSearch()} className="form-control"/></div>
            </div>

            <div className="pm-search-form">
                <button type="button" onClick={handleSearchBtnClick} className="btn btn-primary" disabled={loading}><i className="fas fa-search pm-icon-gap"></i>Search</button>
                <button type="button" onClick={handleShowAll} className="btn btn-secondary" disabled={loading}><i className="fas fa-list pm-icon-gap"></i>Show All</button>
                <button type="button" onClick={handleReset} className="btn btn-secondary" disabled={loading}><i className="fas fa-redo pm-icon-gap"></i>Reset</button>
            </div>

            <div className="pm-advanced-filters">
                <div className="pm-advanced-filters__header" onClick={() => setShowFilters(!showFilters)}>
                    <h4><i className="fas fa-filter pm-icon-gap"></i>Filters {(selectedWorkTypes.length + selectedKeywords.length + selectedTags.length > 0) && <span className="pm-filter-badge">{selectedWorkTypes.length + selectedKeywords.length + selectedTags.length}</span>}</h4>
                    <i className={`fas fa-chevron-${showFilters ? 'up' : 'down'}`}></i>
                </div>
                {showFilters && (
                    <div className="pm-advanced-filters__content">
                        <div className="pm-advanced-filters__grid">
                            <div className="pm-filter-group"><label>Work Type</label><Select isMulti options={workTypes} value={selectedWorkTypes} onChange={setSelectedWorkTypes} classNamePrefix="pm-select" /></div>
                            <div className="pm-filter-group"><label>Keywords</label><Select isMulti options={keywords} value={selectedKeywords} onChange={setSelectedKeywords} classNamePrefix="pm-select" /></div>
                            <div className="pm-filter-group"><label>Tags</label><Select isMulti options={tags} value={selectedTags} onChange={setSelectedTags} classNamePrefix="pm-select" /></div>
                        </div>
                    </div>
                )}
            </div>

            {hasSearched && (
                <div className="pm-results-summary">
                    <div className="summary-card"><h3>Results</h3><span className="summary-value">{patients.length}</span>{loading && <span className="pm-refreshing-badge"><i className="fas fa-spinner fa-spin"></i></span>}</div>
                    <div className="pm-sort-controls">
                        <span className="pm-sort-label">Sort:</span>
                        <div className="pm-sort-toggle">
                            <button className={`pm-sort-btn ${sortConfig.key === 'name' ? 'active' : ''}`} onClick={() => handleSortToggle('name')}>Name</button>
                            <button className={`pm-sort-btn ${sortConfig.key === 'date' ? 'active' : ''}`} onClick={() => handleSortToggle('date')}>Date</button>
                        </div>
                    </div>
                </div>
            )}

            {!hasSearched && !loading && <div className="pm-empty-state"><i className="fas fa-search"></i><h3>Start Typing to Search</h3></div>}
            {loading && !hasSearched && <div className="pm-loading-container"><i className="fas fa-spinner fa-spin pm-loading-spinner"></i></div>}

            {hasSearched && (
                <div className={`pm-table-container ${loading ? 'pm-table-loading-overlay' : ''}`}>
                    <table className="pm-table">
                        <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Date</th><th>Tag</th><th>Actions</th></tr></thead>
                        <tbody>
                            {patients.map(p => (
                                <tr key={p.PersonID}>
                                    <td data-label="ID">{p.PersonID}</td>
                                    <td data-label="Name"><strong>{p.PatientName}</strong>{p.FirstName && <div>{p.FirstName} {p.LastName}</div>}</td>
                                    <td data-label="Phone">{p.Phone || '-'}</td>
                                    <td data-label="Date">{p.DateAdded ? new Date(p.DateAdded).toLocaleDateString() : '-'}</td>
                                    <td data-label="Tag">{p.TagName ? <span className="pm-tag-badge">{p.TagName}</span> : '-'}</td>
                                    <td data-label="Actions">
                                        <div className="pm-action-buttons">
                                            <button onClick={(e) => handleQuickCheckin(e, p)} className="btn btn-icon btn-outline-success"><i className="fas fa-user-check"></i></button>
                                            <button onClick={() => navigate(`/patient/${p.PersonID}/works`)} className="btn btn-icon btn-outline-primary"><i className="fas fa-eye"></i></button>
                                            <button onClick={() => navigate(`/patient/${p.PersonID}/edit-patient`)} className="btn btn-icon btn-outline-warning"><i className="fas fa-edit"></i></button>
                                            <button onClick={() => handleDeleteClick(p)} className="btn btn-icon btn-outline-danger"><i className="fas fa-trash"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {patients.length === 0 && <tr><td colSpan="6" className="no-data">No results</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}

            {showDeleteConfirm && selectedPatient && (
                <div className="modal-overlay">
                    <div className="work-modal pm-modal-narrow">
                        <div className="modal-header"><h3>Confirm Delete</h3><button onClick={() => setShowDeleteConfirm(false)} className="modal-close">×</button></div>
                        <div className="pm-delete-modal-content">
                            <p>Are you sure you want to delete <strong>{selectedPatient.PatientName}</strong>?</p>
                            <div className="form-actions">
                                <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-secondary">Cancel</button>
                                <button onClick={handleDeleteConfirm} className="btn btn-danger">Delete</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(PatientManagement);