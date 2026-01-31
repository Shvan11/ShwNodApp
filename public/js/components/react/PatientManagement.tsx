import React, { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import { useNavigate, useLoaderData } from 'react-router-dom';
import Select, { MultiValue } from 'react-select';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import PatientQuickSearch, { type SelectedPatient, type PatientOption } from './PatientQuickSearch';
import PhoneDisplay from './PhoneDisplay';
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

interface SelectOption {
    value: string | number;
    label: string;
}

interface SortConfig {
    key: string;
    direction: 'asc' | 'desc';
}

interface LastAppointmentOption {
    value: string;
    label: string;
}

const LAST_APPOINTMENT_OPTIONS: LastAppointmentOption[] = [
    { value: '', label: 'Any time' },
    { value: '1month', label: 'More than 1 month ago' },
    { value: '3months', label: 'More than 3 months ago' },
    { value: '6months', label: 'More than 6 months ago' },
    { value: '1year', label: 'More than 1 year ago' },
    { value: 'custom', label: 'Before specific date...' },
];

interface SearchResponse {
    patients: Patient[];
    totalCount: number;
    hasMore: boolean;
}

interface SavedState {
    patients: Patient[];
    hasSearched: boolean;
    totalCount: number;
    hasMore: boolean;
    currentOffset: number;
    searchPatientName: string;
    searchFirstName: string;
    searchLastName: string;
    searchTerm: string;
    nameStartsWith: boolean;
    selectedWorkTypes: SelectOption[];
    selectedKeywords: SelectOption[];
    selectedTags: SelectOption[];
    selectedPatientTypes: SelectOption[];
    lastAppointmentFilter: string;
    lastAppointmentCustomDate: string;
    hasFinalPhotos: boolean;
    showFilters: boolean;
    sortConfig: SortConfig;
}

interface LoaderData {
    allPatients?: PatientOption[];
    workTypes?: SelectOption[];
    keywords?: SelectOption[];
    tags?: SelectOption[];
    patientTypes?: SelectOption[];
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
            if (!saved) return null;
            const parsed = JSON.parse(saved) as SavedState;
            // Validate that patients is an array (handle old/corrupted state)
            if (parsed.patients && !Array.isArray(parsed.patients)) {
                console.warn('Invalid patients data in sessionStorage, clearing...');
                sessionStorage.removeItem('pm_search_state');
                return null;
            }
            return parsed;
        } catch (e) {
            console.error('Failed to load saved state', e);
            sessionStorage.removeItem('pm_search_state');
            return null;
        }
    }).current();

    // -- Data State --
    const [patients, setPatients] = useState<Patient[]>(
        Array.isArray(savedState?.patients) ? savedState.patients : []
    );
    const [hasSearched, setHasSearched] = useState(savedState?.hasSearched || false);
    const [totalCount, setTotalCount] = useState(savedState?.totalCount || 0);
    const [hasMore, setHasMore] = useState(savedState?.hasMore || false);
    const [currentOffset, setCurrentOffset] = useState(savedState?.currentOffset || 0);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);

    // -- Search Inputs --
    const [searchPatientName, setSearchPatientName] = useState(savedState?.searchPatientName || '');
    const [searchFirstName, setSearchFirstName] = useState(savedState?.searchFirstName || '');
    const [searchLastName, setSearchLastName] = useState(savedState?.searchLastName || '');
    const [searchTerm, setSearchTerm] = useState(savedState?.searchTerm || '');
    const [nameStartsWith, setNameStartsWith] = useState(savedState?.nameStartsWith || false);

    // -- Filters & Sorting --
    const [selectedWorkTypes, setSelectedWorkTypes] = useState<SelectOption[]>(savedState?.selectedWorkTypes || []);
    const [selectedKeywords, setSelectedKeywords] = useState<SelectOption[]>(savedState?.selectedKeywords || []);
    const [selectedTags, setSelectedTags] = useState<SelectOption[]>(savedState?.selectedTags || []);
    const [selectedPatientTypes, setSelectedPatientTypes] = useState<SelectOption[]>(savedState?.selectedPatientTypes || []);
    const [lastAppointmentFilter, setLastAppointmentFilter] = useState(savedState?.lastAppointmentFilter || '');
    const [lastAppointmentCustomDate, setLastAppointmentCustomDate] = useState(savedState?.lastAppointmentCustomDate || '');
    const [hasFinalPhotos, setHasFinalPhotos] = useState(savedState?.hasFinalPhotos || false);
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
    const patientTypes = loaderData?.patientTypes || [];

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
                totalCount,
                hasMore,
                currentOffset,
                searchPatientName,
                searchFirstName,
                searchLastName,
                searchTerm,
                nameStartsWith,
                selectedWorkTypes,
                selectedKeywords,
                selectedTags,
                selectedPatientTypes,
                lastAppointmentFilter,
                lastAppointmentCustomDate,
                hasFinalPhotos,
                showFilters,
                sortConfig
            };
            sessionStorage.setItem('pm_search_state', JSON.stringify(stateToSave));
        };

        // Save on unmount (navigation)
        return () => handleSaveState();
    }, [
        patients, hasSearched, totalCount, hasMore, currentOffset, searchPatientName, searchFirstName, searchLastName, searchTerm,
        nameStartsWith, selectedWorkTypes, selectedKeywords, selectedTags, selectedPatientTypes,
        lastAppointmentFilter, lastAppointmentCustomDate, hasFinalPhotos, showFilters, sortConfig
    ]);

    // --- Search Logic ---
    const executeSearch = useCallback(async (overrideSort: SortConfig | null = null, loadMore = false) => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const currentSort = overrideSort || sortConfig;
        const offset = loadMore ? currentOffset : 0;

        try {
            if (loadMore) {
                setLoadingMore(true);
            } else {
                setLoading(true);
            }

            const params = new URLSearchParams();
            if (searchPatientName.trim()) params.append('patientName', searchPatientName.trim());
            if (searchFirstName.trim()) params.append('firstName', searchFirstName.trim());
            if (searchLastName.trim()) params.append('lastName', searchLastName.trim());
            if (searchTerm.trim()) params.append('q', searchTerm.trim());
            if (nameStartsWith) params.append('nameStartsWith', 'true');

            if (selectedWorkTypes.length > 0) params.append('workTypes', selectedWorkTypes.map(wt => wt.value).join(','));
            if (selectedKeywords.length > 0) params.append('keywords', selectedKeywords.map(kw => kw.value).join(','));
            if (selectedTags.length > 0) params.append('tags', selectedTags.map(tag => tag.value).join(','));
            if (selectedPatientTypes.length > 0) params.append('patientTypes', selectedPatientTypes.map(pt => pt.value).join(','));
            if (lastAppointmentFilter) {
                if (lastAppointmentFilter === 'custom' && lastAppointmentCustomDate) {
                    params.append('lastAppointment', lastAppointmentCustomDate);
                } else if (lastAppointmentFilter !== 'custom') {
                    params.append('lastAppointment', lastAppointmentFilter);
                }
            }
            if (hasFinalPhotos) params.append('hasFinalPhotos', 'true');

            params.append('sortBy', currentSort.key);
            params.append('order', currentSort.direction);
            params.append('offset', offset.toString());
            params.append('limit', '100');

            const response = await fetch(`/api/patients/search?${params.toString()}`, {
                signal: abortController.signal
            });

            if (!response.ok) throw new Error('Failed to search patients');

            const data = await response.json();

            // Handle both new format {patients, totalCount, hasMore} and legacy array format
            const patientsArray: Patient[] = Array.isArray(data) ? data : (data.patients || []);
            const total = Array.isArray(data) ? patientsArray.length : (data.totalCount || patientsArray.length);
            const more = Array.isArray(data) ? false : (data.hasMore || false);

            if (loadMore) {
                // Append to existing results
                setPatients(prev => [...prev, ...patientsArray]);
            } else {
                // Replace results
                setPatients(patientsArray);
            }

            setTotalCount(total);
            setHasMore(more);
            setCurrentOffset(offset + patientsArray.length);
            setHasSearched(true);
        } catch (err) {
            if (err instanceof Error && err.name !== 'AbortError') {
                toast.error(err.message || 'Failed to search patients');
            }
        } finally {
            if (!abortController.signal.aborted) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [searchPatientName, searchFirstName, searchLastName, searchTerm, nameStartsWith, selectedWorkTypes, selectedKeywords, selectedTags, selectedPatientTypes, lastAppointmentFilter, lastAppointmentCustomDate, hasFinalPhotos, sortConfig, currentOffset, toast]);

    // --- Load More Handler ---
    const handleLoadMore = useCallback(() => {
        executeSearch(null, true);
    }, [executeSearch]);

    // --- Auto-Search Effect ---
    useEffect(() => {
        const hasInputs = searchPatientName || searchFirstName || searchLastName || searchTerm ||
                          selectedWorkTypes.length > 0 || selectedKeywords.length > 0 || selectedTags.length > 0 ||
                          selectedPatientTypes.length > 0 || lastAppointmentFilter || hasFinalPhotos;

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
    }, [searchPatientName, searchFirstName, searchLastName, searchTerm, nameStartsWith, selectedWorkTypes, selectedKeywords, selectedTags, selectedPatientTypes, lastAppointmentFilter, lastAppointmentCustomDate, hasFinalPhotos, executeSearch]);

    // --- Handlers ---

    const handleSearchBtnClick = () => executeSearch();

    const handleReset = () => {
        sessionStorage.removeItem('pm_search_state');
        setSearchPatientName(''); setSearchFirstName(''); setSearchLastName(''); setSearchTerm('');
        setNameStartsWith(false);
        setSelectedWorkTypes([]); setSelectedKeywords([]); setSelectedTags([]);
        setSelectedPatientTypes([]); setLastAppointmentFilter(''); setLastAppointmentCustomDate('');
        setHasFinalPhotos(false);
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
        // Clear inputs and filters, reset pagination
        setSearchPatientName(''); setSearchFirstName(''); setSearchLastName(''); setSearchTerm('');
        setNameStartsWith(false);
        setSelectedWorkTypes([]); setSelectedKeywords([]); setSelectedTags([]); setSelectedPatientTypes([]);
        setLastAppointmentFilter(''); setLastAppointmentCustomDate(''); setHasFinalPhotos(false);
        setCurrentOffset(0);
        setLoading(true);
        fetch(`/api/patients/search?q=&sortBy=name&order=asc&limit=100&offset=0`)
            .then(res => res.json())
            .then(data => {
                // Handle both new format {patients, totalCount, hasMore} and legacy array format
                const patientsArray: Patient[] = Array.isArray(data) ? data : (data.patients || []);
                const total = Array.isArray(data) ? patientsArray.length : (data.totalCount || patientsArray.length);
                const more = Array.isArray(data) ? false : (data.hasMore || false);

                setPatients(patientsArray);
                setTotalCount(total);
                setHasMore(more);
                setCurrentOffset(patientsArray.length);
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

    const handleQuickSearchSelect = (patient: SelectedPatient) => navigate(`/patient/${patient.PersonID}/works`);

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
                <PatientQuickSearch
                    onSelect={handleQuickSearchSelect}
                    allPatients={allPatients}
                    showHeader={true}
                    layout="horizontal"
                />
            )}

            <hr className={styles.sectionDivider} />
            <div className={styles.searchSectionHeader}><h3><i className="fas fa-search"></i>Advanced Search</h3></div>

            <div className={styles.nameSearchGrid}>
                <div><label>Name (Arabic)</label><input type="text" value={searchPatientName} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchPatientName(e.target.value)} className="form-control text-rtl" dir="rtl"/></div>
                <div><label>First Name</label><input type="text" value={searchFirstName} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchFirstName(e.target.value)} className="form-control"/></div>
                <div><label>Last Name</label><input type="text" value={searchLastName} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchLastName(e.target.value)} className="form-control"/></div>
                <div><label>Phone/ID</label><input type="text" value={searchTerm} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && executeSearch()} className="form-control"/></div>
            </div>

            <div className={styles.nameSearchOptions}>
                <label className={styles.checkboxLabel}>
                    <input
                        type="checkbox"
                        checked={nameStartsWith}
                        onChange={(e) => setNameStartsWith(e.target.checked)}
                    />
                    <span>Match from beginning of name only</span>
                </label>
            </div>

            <div className={styles.searchForm}>
                <button type="button" onClick={handleSearchBtnClick} className="btn btn-primary" disabled={loading}><i className={cn('fas fa-search', styles.iconGap)}></i>Search</button>
                <button type="button" onClick={handleShowAll} className="btn btn-secondary" disabled={loading}><i className={cn('fas fa-list', styles.iconGap)}></i>Show All</button>
                <button type="button" onClick={handleReset} className="btn btn-secondary" disabled={loading}><i className={cn('fas fa-redo', styles.iconGap)}></i>Reset</button>
            </div>

            <div className={styles.advancedFilters}>
                <div className={styles.advancedFiltersHeader} onClick={() => setShowFilters(!showFilters)}>
                    <h4><i className={cn('fas fa-filter', styles.iconGap)}></i>Filters {(selectedWorkTypes.length + selectedKeywords.length + selectedTags.length + selectedPatientTypes.length + (lastAppointmentFilter ? 1 : 0) + (hasFinalPhotos ? 1 : 0) > 0) && <span className={styles.filterBadge}>{selectedWorkTypes.length + selectedKeywords.length + selectedTags.length + selectedPatientTypes.length + (lastAppointmentFilter ? 1 : 0) + (hasFinalPhotos ? 1 : 0)}</span>}</h4>
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
                            <div className={styles.filterGroup}>
                                <label>Patient Type</label>
                                <Select
                                    isMulti
                                    options={patientTypes}
                                    value={selectedPatientTypes}
                                    onChange={(newValue: MultiValue<SelectOption>) => setSelectedPatientTypes([...newValue])}
                                    classNamePrefix="pm-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label>Last Appointment</label>
                                <Select
                                    options={LAST_APPOINTMENT_OPTIONS}
                                    value={LAST_APPOINTMENT_OPTIONS.find(o => o.value === lastAppointmentFilter) || LAST_APPOINTMENT_OPTIONS[0]}
                                    onChange={(option) => setLastAppointmentFilter(option?.value || '')}
                                    classNamePrefix="pm-select"
                                    isClearable
                                />
                                {lastAppointmentFilter === 'custom' && (
                                    <input
                                        type="date"
                                        value={lastAppointmentCustomDate}
                                        onChange={(e) => setLastAppointmentCustomDate(e.target.value)}
                                        className="form-control"
                                        style={{ marginTop: 'var(--spacing-sm)' }}
                                    />
                                )}
                            </div>
                        </div>
                        <div className={styles.checkboxFilters}>
                            <label className={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={hasFinalPhotos}
                                    onChange={(e) => setHasFinalPhotos(e.target.checked)}
                                />
                                <span>Has Final Photos</span>
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {hasSearched && (
                <div className={styles.resultsSummary}>
                    <div className="summary-card">
                        <h3>Results</h3>
                        <span className="summary-value">
                            {patients.length}
                            {totalCount > patients.length && <span className={styles.totalCountLabel}> of {totalCount}</span>}
                        </span>
                        {loading && <span className={styles.refreshingBadge}><i className="fas fa-spinner fa-spin"></i></span>}
                    </div>
                    <div className={styles.sortControls}>
                        <span className={styles.sortLabel}>Sort:</span>
                        <div className={styles.sortToggle}>
                            <button className={cn(styles.sortBtn, sortConfig.key === 'name' && styles.sortBtnActive)} onClick={() => handleSortToggle('name')}>
                                Name
                                {sortConfig.key === 'name' && (
                                    <i className={cn('fas', sortConfig.direction === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down', styles.sortIcon)}></i>
                                )}
                            </button>
                            <button className={cn(styles.sortBtn, sortConfig.key === 'date' && styles.sortBtnActive)} onClick={() => handleSortToggle('date')}>
                                Date
                                {sortConfig.key === 'date' && (
                                    <i className={cn('fas', sortConfig.direction === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down', styles.sortIcon)}></i>
                                )}
                            </button>
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
                                    <td data-label="Name">
                                        <strong
                                            className={styles.patientNameLink}
                                            onClick={() => navigate(`/patient/${p.PersonID}/works`)}
                                            title="View Patient"
                                        >
                                            {p.PatientName}
                                        </strong>
                                        {p.FirstName && <div>{p.FirstName} {p.LastName}</div>}
                                    </td>
                                    <td data-label="Phone"><PhoneDisplay phone={p.Phone} /> {!p.Phone && '-'}</td>
                                    <td data-label="Date">{p.DateAdded ? new Date(p.DateAdded).toLocaleDateString() : '-'}</td>
                                    <td data-label="Tag">{p.TagName ? <span className={styles.tagBadge}>{p.TagName}</span> : '-'}</td>
                                    <td data-label="Actions">
                                        <div className={styles.actionButtons}>
                                            <button onClick={(e) => handleQuickCheckin(e, p)} className="btn btn-icon btn-outline-success" title="Quick Check-in"><i className="fas fa-user-check"></i></button>
                                            <button onClick={() => navigate(`/patient/${p.PersonID}/works`)} className="btn btn-icon btn-outline-primary" title="View Patient"><i className="fas fa-eye"></i></button>
                                            <button onClick={() => navigate(`/patient/${p.PersonID}/edit-patient`)} className="btn btn-icon btn-outline-warning" title="Edit Patient"><i className="fas fa-edit"></i></button>
                                            <button onClick={() => handleDeleteClick(p)} className="btn btn-icon btn-outline-danger" title="Delete Patient"><i className="fas fa-trash"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {patients.length === 0 && <tr><td colSpan={6} className={styles.noData}>No results</td></tr>}
                        </tbody>
                    </table>

                    {hasMore && (
                        <div className={styles.loadMoreContainer}>
                            <button
                                onClick={handleLoadMore}
                                className={cn('btn btn-secondary', styles.loadMoreBtn)}
                                disabled={loadingMore}
                            >
                                {loadingMore ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin"></i>
                                        Loading...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-plus"></i>
                                        Load More ({totalCount - patients.length} remaining)
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {showDeleteConfirm && selectedPatient && (
                <div className="modal-overlay">
                    <div className={styles.deleteModal}>
                        <div className={styles.deleteModalHeader}>
                            <h3>Confirm Delete</h3>
                            <button onClick={() => setShowDeleteConfirm(false)} className={styles.deleteModalClose}>×</button>
                        </div>
                        <div className={styles.deleteModalContent}>
                            <p>Are you sure you want to delete <strong>{selectedPatient.PatientName}</strong>?</p>
                            <div className={styles.deleteModalActions}>
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
