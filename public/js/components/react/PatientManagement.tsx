import React, { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import { useNavigate, useLoaderData } from 'react-router-dom';
import AsyncSelect from 'react-select/async';
import Select, { MultiValue, StylesConfig } from 'react-select';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import styles from './PatientManagement.module.css';

interface Patient {
    PersonID: number;
    PatientName: string;
    FirstName?: string;
    LastName?: string;
    Phone?: string;
    DateAdded?: string;
    TagName?: string;
}

interface PatientOption {
    id: number;
    name?: string;
    phone?: string;
}

interface SelectOption {
    value: string | number;
    label: string;
}

interface SortConfig {
    key: string;
    direction: 'asc' | 'desc';
}

interface SavedState {
    patients: Patient[];
    hasSearched: boolean;
    searchPatientName: string;
    searchFirstName: string;
    searchLastName: string;
    searchTerm: string;
    selectedWorkTypes: SelectOption[];
    selectedKeywords: SelectOption[];
    selectedTags: SelectOption[];
    showFilters: boolean;
    sortConfig: SortConfig;
}

interface LoaderData {
    allPatients?: PatientOption[];
    workTypes?: SelectOption[];
    keywords?: SelectOption[];
    tags?: SelectOption[];
}

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
    const loaderData = useLoaderData() as LoaderData | undefined;

    // --- 1. Synchronous State Initialization ---
    // We read storage ONCE via a ref/function. By passing this result to useState,
    // React initializes the state with data available on the very first paint.
    const savedState = useRef(() => {
        try {
            const saved = sessionStorage.getItem('pm_search_state');
            return saved ? JSON.parse(saved) as SavedState : null;
        } catch (e) {
            console.error('Failed to load saved state', e);
            return null;
        }
    }).current();

    // -- Data State --
    const [patients, setPatients] = useState<Patient[]>(savedState?.patients || []);
    const [hasSearched, setHasSearched] = useState(savedState?.hasSearched || false);
    const [loading, setLoading] = useState(false);

    // -- Search Inputs --
    const [searchPatientName, setSearchPatientName] = useState(savedState?.searchPatientName || '');
    const [searchFirstName, setSearchFirstName] = useState(savedState?.searchFirstName || '');
    const [searchLastName, setSearchLastName] = useState(savedState?.searchLastName || '');
    const [searchTerm, setSearchTerm] = useState(savedState?.searchTerm || '');

    // -- Filters & Sorting --
    const [selectedWorkTypes, setSelectedWorkTypes] = useState<SelectOption[]>(savedState?.selectedWorkTypes || []);
    const [selectedKeywords, setSelectedKeywords] = useState<SelectOption[]>(savedState?.selectedKeywords || []);
    const [selectedTags, setSelectedTags] = useState<SelectOption[]>(savedState?.selectedTags || []);
    const [showFilters, setShowFilters] = useState(savedState?.showFilters || false);
    const [sortConfig, setSortConfig] = useState<SortConfig>(savedState?.sortConfig || { key: 'name', direction: 'asc' });

    // -- UI State (Non-persistent) --
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [showQuickSearch, setShowQuickSearch] = useState(true);

    // -- Dropdown Data (from loader, no state needed) --
    const allPatients = loaderData?.allPatients || [];
    const workTypes = loaderData?.workTypes || [];
    const keywords = loaderData?.keywords || [];
    const tags = loaderData?.tags || [];

    // -- Refs --
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
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
            const stateToSave: SavedState = {
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
    const executeSearch = useCallback(async (overrideSort: SortConfig | null = null) => {
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
            if (err instanceof Error && err.name !== 'AbortError') {
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

    const handleSortToggle = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        else if (key === 'date') direction = sortConfig.key === key && sortConfig.direction === 'desc' ? 'asc' : 'desc';

        const newSort: SortConfig = { key, direction };
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

    const handleQuickCheckin = async (e: React.MouseEvent<HTMLButtonElement>, patient: Patient) => {
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
        } catch(err) {
            toast.error(err instanceof Error ? err.message : 'Check-in failed');
        }
        finally { setLoading(false); }
    };

    const handleDeleteClick = (patient: Patient) => { setSelectedPatient(patient); setShowDeleteConfirm(true); };

    const handleDeleteConfirm = async () => {
        if (!selectedPatient) return;
        try {
            const res = await fetch(`/api/patients/${selectedPatient.PersonID}`, { method: 'DELETE' });
            if(!res.ok) throw new Error('Delete failed');
            executeSearch();
            setShowDeleteConfirm(false);
            toast.success('Patient deleted');
        } catch(err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
        }
    };

    const handleQuickSearchSelect = (opt: SelectOption | null) => opt?.value && navigate(`/patient/${opt.value}/works`);

    // Select Loaders
    const loadNameOptions = (input: string, cb: (options: SelectOption[]) => void) =>
        cb(input.length < 2 ? [] : allPatients.filter(p => p.name?.startsWith(input)).slice(0, 50).map(p => ({value: p.id, label: p.name || ''})));

    const loadPhoneOptions = (input: string, cb: (options: SelectOption[]) => void) =>
        cb(input.length < 2 ? [] : allPatients.filter(p => p.phone?.includes(input)).slice(0, 50).map(p => ({value: p.id, label: p.phone || ''})));

    const loadIdOptions = (input: string, cb: (options: SelectOption[]) => void) =>
        cb(input.length < 1 ? [] : allPatients.filter(p => p.id?.toString().includes(input)).slice(0, 50).map(p => ({value: p.id, label: p.id.toString()})));

    const selectStylesRTL: StylesConfig<SelectOption, false> = {
        input: (provided) => ({ ...provided, direction: 'rtl' as const, textAlign: 'right' as const }),
        singleValue: (provided) => ({ ...provided, direction: 'rtl' as const, textAlign: 'right' as const }),
        placeholder: (provided) => ({ ...provided, direction: 'rtl' as const, textAlign: 'right' as const })
    };

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <h2>Patient Management</h2>
                <div className={styles.headerActions}>
                    <button type="button" onClick={() => setShowQuickSearch(!showQuickSearch)} className="btn btn-secondary whitespace-nowrap">
                        <i className={cn('fas', showQuickSearch ? 'fa-chevron-up' : 'fa-chevron-down', styles.iconGap)}></i>
                        {showQuickSearch ? 'Hide' : 'Show'} Quick Search
                    </button>
                    <button type="button" onClick={() => navigate('/patient/new/edit-patient')} className="btn btn-primary">
                        <i className={cn('fas fa-plus', styles.iconGap)}></i> Add New Patient
                    </button>
                </div>
            </div>

            {showQuickSearch && (
                <div className={styles.quickSearchContainer}>
                    <div className={styles.quickSearchHeader}><i className="fas fa-bolt"></i><h3>Quick Search - Select & Go</h3></div>
                    <div className={styles.quickSearchGrid}>
                        <div className={styles.quickSearchField}>
                            <label><i className={cn('fas fa-user', styles.iconGap)}></i>Search by Name (Arabic)</label>
                            <AsyncSelect cacheOptions defaultOptions={false} loadOptions={loadNameOptions} onChange={handleQuickSearchSelect} placeholder="اكتب للبحث..." isClearable classNamePrefix="pm-select" styles={selectStylesRTL} />
                        </div>
                        <div className={styles.quickSearchField}>
                            <label><i className={cn('fas fa-phone', styles.iconGap)}></i>Search by Phone</label>
                            <AsyncSelect cacheOptions defaultOptions={false} loadOptions={loadPhoneOptions} onChange={handleQuickSearchSelect} placeholder="Search phone..." isClearable classNamePrefix="pm-select" />
                        </div>
                        <div className={styles.quickSearchField}>
                            <label><i className={cn('fas fa-id-card', styles.iconGap)}></i>Search by ID</label>
                            <AsyncSelect cacheOptions defaultOptions={false} loadOptions={loadIdOptions} onChange={handleQuickSearchSelect} placeholder="Search ID..." isClearable classNamePrefix="pm-select" />
                        </div>
                    </div>
                </div>
            )}

            <hr className={styles.sectionDivider} />
            <div className={styles.searchSectionHeader}><h3><i className="fas fa-search"></i>Advanced Search</h3></div>

            <div className={styles.nameSearchGrid}>
                <div><label>Name (Arabic)</label><input type="text" value={searchPatientName} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchPatientName(e.target.value)} className="form-control text-rtl" dir="rtl"/></div>
                <div><label>First Name</label><input type="text" value={searchFirstName} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchFirstName(e.target.value)} className="form-control"/></div>
                <div><label>Last Name</label><input type="text" value={searchLastName} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchLastName(e.target.value)} className="form-control"/></div>
                <div><label>Phone/ID</label><input type="text" value={searchTerm} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && executeSearch()} className="form-control"/></div>
            </div>

            <div className={styles.searchForm}>
                <button type="button" onClick={handleSearchBtnClick} className="btn btn-primary" disabled={loading}><i className={cn('fas fa-search', styles.iconGap)}></i>Search</button>
                <button type="button" onClick={handleShowAll} className="btn btn-secondary" disabled={loading}><i className={cn('fas fa-list', styles.iconGap)}></i>Show All</button>
                <button type="button" onClick={handleReset} className="btn btn-secondary" disabled={loading}><i className={cn('fas fa-redo', styles.iconGap)}></i>Reset</button>
            </div>

            <div className={styles.advancedFilters}>
                <div className={styles.advancedFiltersHeader} onClick={() => setShowFilters(!showFilters)}>
                    <h4><i className={cn('fas fa-filter', styles.iconGap)}></i>Filters {(selectedWorkTypes.length + selectedKeywords.length + selectedTags.length > 0) && <span className={styles.filterBadge}>{selectedWorkTypes.length + selectedKeywords.length + selectedTags.length}</span>}</h4>
                    <i className={`fas fa-chevron-${showFilters ? 'up' : 'down'}`}></i>
                </div>
                {showFilters && (
                    <div className={styles.advancedFiltersContent}>
                        <div className={styles.advancedFiltersGrid}>
                            <div className={styles.filterGroup}>
                                <label>Work Type</label>
                                <Select
                                    isMulti
                                    options={workTypes}
                                    value={selectedWorkTypes}
                                    onChange={(newValue: MultiValue<SelectOption>) => setSelectedWorkTypes([...newValue])}
                                    classNamePrefix="pm-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label>Keywords</label>
                                <Select
                                    isMulti
                                    options={keywords}
                                    value={selectedKeywords}
                                    onChange={(newValue: MultiValue<SelectOption>) => setSelectedKeywords([...newValue])}
                                    classNamePrefix="pm-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label>Tags</label>
                                <Select
                                    isMulti
                                    options={tags}
                                    value={selectedTags}
                                    onChange={(newValue: MultiValue<SelectOption>) => setSelectedTags([...newValue])}
                                    classNamePrefix="pm-select"
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {hasSearched && (
                <div className={styles.resultsSummary}>
                    <div className="summary-card"><h3>Results</h3><span className="summary-value">{patients.length}</span>{loading && <span className={styles.refreshingBadge}><i className="fas fa-spinner fa-spin"></i></span>}</div>
                    <div className={styles.sortControls}>
                        <span className={styles.sortLabel}>Sort:</span>
                        <div className={styles.sortToggle}>
                            <button className={cn(styles.sortBtn, sortConfig.key === 'name' && styles.sortBtnActive)} onClick={() => handleSortToggle('name')}>Name</button>
                            <button className={cn(styles.sortBtn, sortConfig.key === 'date' && styles.sortBtnActive)} onClick={() => handleSortToggle('date')}>Date</button>
                        </div>
                    </div>
                </div>
            )}

            {!hasSearched && !loading && <div className={styles.emptyState}><i className="fas fa-search"></i><h3>Start Typing to Search</h3></div>}
            {loading && !hasSearched && <div className={styles.loadingContainer}><i className={cn('fas fa-spinner fa-spin', styles.loadingSpinner)}></i></div>}

            {hasSearched && (
                <div className={cn(styles.tableContainer, loading && styles.tableLoadingOverlay)}>
                    <table className={styles.table}>
                        <thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Date</th><th>Tag</th><th>Actions</th></tr></thead>
                        <tbody>
                            {patients.map(p => (
                                <tr key={p.PersonID}>
                                    <td data-label="ID">{p.PersonID}</td>
                                    <td data-label="Name"><strong>{p.PatientName}</strong>{p.FirstName && <div>{p.FirstName} {p.LastName}</div>}</td>
                                    <td data-label="Phone">{p.Phone || '-'}</td>
                                    <td data-label="Date">{p.DateAdded ? new Date(p.DateAdded).toLocaleDateString() : '-'}</td>
                                    <td data-label="Tag">{p.TagName ? <span className={styles.tagBadge}>{p.TagName}</span> : '-'}</td>
                                    <td data-label="Actions">
                                        <div className={styles.actionButtons}>
                                            <button onClick={(e) => handleQuickCheckin(e, p)} className="btn btn-icon btn-outline-success"><i className="fas fa-user-check"></i></button>
                                            <button onClick={() => navigate(`/patient/${p.PersonID}/works`)} className="btn btn-icon btn-outline-primary"><i className="fas fa-eye"></i></button>
                                            <button onClick={() => navigate(`/patient/${p.PersonID}/edit-patient`)} className="btn btn-icon btn-outline-warning"><i className="fas fa-edit"></i></button>
                                            <button onClick={() => handleDeleteClick(p)} className="btn btn-icon btn-outline-danger"><i className="fas fa-trash"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {patients.length === 0 && <tr><td colSpan={6} className={styles.noData}>No results</td></tr>}
                        </tbody>
                    </table>
                </div>
            )}

            {showDeleteConfirm && selectedPatient && (
                <div className="modal-overlay">
                    <div className={cn('work-modal', styles.modalNarrow)}>
                        <div className="modal-header"><h3>Confirm Delete</h3><button onClick={() => setShowDeleteConfirm(false)} className="modal-close">×</button></div>
                        <div className={styles.deleteModalContent}>
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
