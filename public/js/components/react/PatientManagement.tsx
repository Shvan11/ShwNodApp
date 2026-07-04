import React, { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import { useNavigate, useLoaderData, Link } from 'react-router-dom';
import Select, { MultiValue } from 'react-select';
import cn from 'classnames';
import { useToast } from '../../contexts/ToastContext';
import type { PatientOption } from './PatientQuickSearch';
import PatientSearchCombobox from './PatientSearchCombobox';
import PhoneDisplay from './PhoneDisplay';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import { useQueryClient } from '@tanstack/react-query';
import { fetchJSON, postJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { formatDate } from '@/core/utils';
import { qk } from '@/query/keys';
import { patientSearch as patientSearchContract, deletePatient as deletePatientContract } from '@shared/contracts/patient.contract';
import * as appointmentContract from '@shared/contracts/appointment.contract';
import styles from './PatientManagement.module.css';

interface Patient {
    person_id: number;
    patient_name: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    date_added?: string;
    last_visit?: string;
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
    const queryClient = useQueryClient();
    const loaderData = useLoaderData() as LoaderData | undefined;

    // --- 1. Synchronous State Initialization ---
    // We read storage ONCE via an IIFE. By passing this result to the useState
    // initializers below, React seeds state with data available on the first paint.
    const savedState = ((): SavedState | null => {
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
    })();

    // URL Params (deep-linking) have priority over saved storage. Read ONCE here
    // (stable across the mount) and fold into the state/ref initializers below, so
    // there's no mount effect mutating state/refs after the first paint.
    const urlSearchParam = new URLSearchParams(window.location.search).get('search') || '';

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
    const [searchPatientName, setSearchPatientName] = useState(urlSearchParam || savedState?.searchPatientName || '');
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
    const [deleting, setDeleting] = useState(false);

    // -- Dropdown Data (from loader, no state needed) --
    const allPatients = loaderData?.allPatients || [];
    const workTypes = loaderData?.workTypes || [];
    const keywords = loaderData?.keywords || [];
    const tags = loaderData?.tags || [];
    const patientTypes = loaderData?.patientTypes || [];

    // -- Refs --
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    // Flag to skip the initial auto-search if we just restored valid data. A URL
    // `?search=` deep-link takes priority over restore and forces a fresh search,
    // so it suppresses the restore flag.
    const isRestoring = useRef(!!savedState && !urlSearchParam);
    // One-shot suppressor for the debounced auto-search: Show All clears the
    // criteria itself and fetches explicitly, so the clearing must not ALSO
    // schedule a debounced fetch (double request + loading flicker).
    const skipAutoSearchRef = useRef(false);
    // Non-reactive mirror of hasSearched: lets the auto-search effect refresh to
    // "all patients" when the last criterion is cleared, without adding
    // hasSearched to its deps (which would echo an extra search after the first).
    const hasSearchedRef = useRef(!!savedState?.hasSearched);
    // Latest executeSearch for the debounce timer. Keeping the callback out of
    // the effect deps means a completed search (which recreates executeSearch via
    // currentOffset) can't re-trigger the effect and fire a duplicate request.
    const executeSearchRef = useRef<(overrideSort?: SortConfig | null, loadMore?: boolean) => Promise<void>>(async () => {});
    // Results block, for the scroll-into-view after an explicit search on mobile.
    const resultsRef = useRef<HTMLDivElement | null>(null);

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

            const data = await fetchJSON<{ patients: Patient[]; totalCount?: number; hasMore?: boolean }>(
                `/api/patients/search?${params.toString()}`,
                { signal: abortController.signal, schema: patientSearchContract.response }
            );

            const patientsArray = data.patients;

            if (loadMore) {
                // Append to existing results
                setPatients(prev => [...prev, ...patientsArray]);
            } else {
                // Replace results
                setPatients(patientsArray);
            }

            setTotalCount(data.totalCount ?? patientsArray.length);
            setHasMore(data.hasMore ?? false);
            setCurrentOffset(offset + patientsArray.length);
            setHasSearched(true);
            hasSearchedRef.current = true;
        } catch (err) {
            if (err instanceof Error && err.name !== 'AbortError') {
                toast.error(httpErrorMessage(err, 'Failed to search patients'));
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

    // Keep the ref pointing at the latest executeSearch so the debounce timer
    // below always calls the current closure without depending on its identity.
    useEffect(() => {
        executeSearchRef.current = executeSearch;
    });

    // --- Auto-Search Effect ---
    // Deps are the search criteria ONLY (not executeSearch): a completed search
    // recreates executeSearch (currentOffset dep), and having it here used to
    // fire a second, identical request 500ms after every search.
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

        // SKIP the run caused by Show All clearing the criteria — it fetches itself.
        if (skipAutoSearchRef.current) {
            skipAutoSearchRef.current = false;
            return;
        }

        // With criteria: debounced re-search. Without criteria but with results
        // showing (last chip/field just cleared): refresh to the unfiltered list
        // instead of leaving a stale filtered table behind.
        if (hasInputs || hasSearchedRef.current) {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
            searchDebounceRef.current = setTimeout(() => {
                executeSearchRef.current();
            }, 500);
        }

        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [searchPatientName, searchFirstName, searchLastName, searchTerm, nameStartsWith, selectedWorkTypes, selectedKeywords, selectedTags, selectedPatientTypes, lastAppointmentFilter, lastAppointmentCustomDate, hasFinalPhotos]);

    // --- Handlers ---

    // After an explicit search on a phone, the results render below the long
    // search form — bring them into view. Double rAF waits out the re-render
    // so the results block exists before we scroll. No-op on desktop.
    const scrollToResultsOnMobile = () => {
        if (!window.matchMedia('(max-width: 768px)').matches) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
    };

    const handleSearchBtnClick = async () => {
        await executeSearch();
        scrollToResultsOnMobile();
    };

    const handleReset = () => {
        // Kill any pending debounce / in-flight search — its response must not
        // repopulate the page we just emptied. The abort skips that search's
        // loading cleanup, so clear the flag here.
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        abortControllerRef.current?.abort();
        setLoading(false); setLoadingMore(false);
        sessionStorage.removeItem('pm_search_state');
        setSearchPatientName(''); setSearchFirstName(''); setSearchLastName(''); setSearchTerm('');
        setNameStartsWith(false);
        setSelectedWorkTypes([]); setSelectedKeywords([]); setSelectedTags([]);
        setSelectedPatientTypes([]); setLastAppointmentFilter(''); setLastAppointmentCustomDate('');
        setHasFinalPhotos(false);
        setPatients([]); setHasSearched(false); setShowFilters(false);
        setSortConfig({ key: 'name', direction: 'asc' });
        // Reset means "back to the empty page" — the criteria clearing above must
        // not read as "last filter removed → refresh all patients".
        hasSearchedRef.current = false;
    };

    const handleSortToggle = (key: string) => {
        // Clicking the active column flips direction; switching columns picks a
        // sensible default — date-like columns start newest-first (desc), name asc.
        const dateLike = key === 'date' || key === 'lastVisit';
        const direction: 'asc' | 'desc' =
            sortConfig.key === key
                ? (sortConfig.direction === 'asc' ? 'desc' : 'asc')
                : (dateLike ? 'desc' : 'asc');

        const newSort: SortConfig = { key, direction };
        setSortConfig(newSort);
        executeSearch(newSort);
    };

    const handleShowAll = async () => {
        // Clearing criteria re-runs the auto-search effect; suppress that run
        // (this handler fetches explicitly). Only arm the flag when something
        // actually changes, or it would linger and swallow the next real search.
        const hadCriteria = !!(searchPatientName || searchFirstName || searchLastName || searchTerm ||
            selectedWorkTypes.length || selectedKeywords.length || selectedTags.length ||
            selectedPatientTypes.length || lastAppointmentFilter || hasFinalPhotos || nameStartsWith);
        if (hadCriteria) skipAutoSearchRef.current = true;

        // Clear inputs and filters, reset pagination AND sort — the fetch below is
        // name-ascending, so sortConfig must match or the sort toggle lies and a
        // subsequent Load More would paginate with the stale sort (duplicate rows).
        setSearchPatientName(''); setSearchFirstName(''); setSearchLastName(''); setSearchTerm('');
        setNameStartsWith(false);
        setSelectedWorkTypes([]); setSelectedKeywords([]); setSelectedTags([]); setSelectedPatientTypes([]);
        setLastAppointmentFilter(''); setLastAppointmentCustomDate(''); setHasFinalPhotos(false);
        setCurrentOffset(0);
        setSortConfig({ key: 'name', direction: 'asc' });
        // Kill any pending debounce / in-flight filtered search — a late response
        // would overwrite the unfiltered list this handler is about to fetch.
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        abortControllerRef.current?.abort();
        setLoading(true);
        try {
            const data = await fetchJSON<{ patients: Patient[]; totalCount?: number; hasMore?: boolean }>(
                `/api/patients/search?sortBy=name&order=asc&limit=100&offset=0`,
                { schema: patientSearchContract.response }
            );
            setPatients(data.patients);
            setTotalCount(data.totalCount ?? data.patients.length);
            setHasMore(data.hasMore ?? false);
            setCurrentOffset(data.patients.length);
            setHasSearched(true);
            hasSearchedRef.current = true;
            scrollToResultsOnMobile();
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to load all patients'));
        } finally {
            setLoading(false);
        }
    };

    const handleQuickCheckin = async (e: React.MouseEvent<HTMLButtonElement>, patient: Patient) => {
        e.preventDefault(); e.stopPropagation();
        try {
            setLoading(true);
            const data = await postJSON<{ alreadyCheckedIn?: boolean }>('/api/appointments/quick-checkin', { person_id: patient.person_id }, { schema: appointmentContract.quickCheckin.response });
            toast.success(data.alreadyCheckedIn ? 'Already checked in' : 'Checked in successfully');
        } catch(err) {
            toast.error(httpErrorMessage(err, 'Check-in failed'));
        }
        finally { setLoading(false); }
    };

    const handleDeleteClick = (patient: Patient) => { setSelectedPatient(patient); setShowDeleteConfirm(true); };

    const handleDeleteConfirm = async () => {
        if (!selectedPatient || deleting) return;
        setDeleting(true);
        try {
            const data = await deleteJSON<{ outcome: string; folderRemoved?: boolean }>(`/api/patients/${selectedPatient.person_id}`, { schema: deletePatientContract.response });
            setShowDeleteConfirm(false);
            if (data.outcome === 'pending') {
                toast.success('Submitted for admin approval');
                return;
            }
            queryClient.invalidateQueries({ queryKey: qk.patient.all(selectedPatient.person_id) });
            executeSearch();
            if (data.folderRemoved === false) {
                toast.warning('Patient deleted, but its photo folder could not be removed.');
            } else {
                toast.success('Patient and photo folder deleted');
            }
        } catch(err) {
            toast.error(httpErrorMessage(err, 'Delete failed'));
        } finally {
            setDeleting(false);
        }
    };

    const handleJumpToPatient = (personId: number) => navigate(`/patient/${personId}/works`);

    const activeFilterCount = selectedWorkTypes.length + selectedKeywords.length + selectedTags.length +
        selectedPatientTypes.length + (lastAppointmentFilter ? 1 : 0) + (hasFinalPhotos ? 1 : 0);

    const lastAppointmentChipLabel = lastAppointmentFilter === 'custom'
        ? `Before ${lastAppointmentCustomDate || '…'}`
        : (LAST_APPOINTMENT_OPTIONS.find(o => o.value === lastAppointmentFilter)?.label ?? lastAppointmentFilter);

    // Sortable column header: click toggles/flips the sort, aria-sort reflects it.
    const renderSortableTh = (colKey: string, label: string) => {
        const active = sortConfig.key === colKey;
        return (
            <th aria-sort={active ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button type="button" className={styles.thSortBtn} onClick={() => handleSortToggle(colKey)}>
                    {label}
                    <i
                        className={cn('fas', active ? (sortConfig.direction === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down') : cn('fa-sort', styles.thSortIdle), styles.sortIcon)}
                        aria-hidden="true"
                    ></i>
                </button>
            </th>
        );
    };

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <h2>Patient Management</h2>
                <div className={styles.headerActions}>
                    <button type="button" onClick={() => navigate('/patient/new/add')} className="btn btn-primary">
                        <i className={cn('fas fa-plus', styles.iconGap)}></i> Add New Patient
                    </button>
                </div>
            </div>

            <div className={styles.searchSectionHeader}>
                <h3><i className="fas fa-search"></i>Search Patients</h3>
                <p>Pick a suggestion to open the patient directly, or press Enter / use filters to build the results list below.</p>
            </div>

            <div className={styles.nameSearchGrid}>
                <div>
                    <label htmlFor="pm-search-name">Name (Arabic)</label>
                    <PatientSearchCombobox
                        id="pm-search-name"
                        value={searchPatientName}
                        onChange={setSearchPatientName}
                        onJump={handleJumpToPatient}
                        onSubmit={() => executeSearch()}
                        patients={allPatients}
                        mode="name"
                        rtl
                        placeholder="اكتب للبحث..."
                    />
                </div>
                <div><label htmlFor="pm-search-first-name">First Name</label><input id="pm-search-first-name" type="text" value={searchFirstName} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchFirstName(e.target.value)} className="form-control"/></div>
                <div><label htmlFor="pm-search-last-name">Last Name</label><input id="pm-search-last-name" type="text" value={searchLastName} onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchLastName(e.target.value)} className="form-control"/></div>
                <div>
                    <label htmlFor="pm-search-phone-id">Phone/ID</label>
                    <PatientSearchCombobox
                        id="pm-search-phone-id"
                        value={searchTerm}
                        onChange={setSearchTerm}
                        onJump={handleJumpToPatient}
                        onSubmit={() => executeSearch()}
                        patients={allPatients}
                        mode="phoneId"
                        placeholder="Phone or ID..."
                    />
                </div>
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
                <button type="button" onClick={handleShowAll} className="btn btn-light" disabled={loading}><i className={cn('fas fa-list', styles.iconGap)}></i>Show All</button>
                <button type="button" onClick={handleReset} className="btn btn-light" disabled={loading}><i className={cn('fas fa-redo', styles.iconGap)}></i>Reset</button>
            </div>

            <div className={styles.advancedFilters}>
                <div className={styles.advancedFiltersHeader} role="button" tabIndex={0} onClick={() => setShowFilters(!showFilters)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowFilters(!showFilters); } }}>
                    <h4><i className={cn('fas fa-filter', styles.iconGap)}></i>Filters {activeFilterCount > 0 && <span className={styles.filterBadge}>{activeFilterCount}</span>}</h4>
                    <i className={`fas fa-chevron-${showFilters ? 'up' : 'down'}`}></i>
                </div>
                {!showFilters && activeFilterCount > 0 && (
                    <div className={styles.filterChips}>
                        {selectedWorkTypes.map(o => (
                            <span key={`wt-${o.value}`} className={styles.filterChip}>
                                {o.label}
                                <button type="button" className={styles.filterChipRemove} aria-label={`Remove work type filter: ${o.label}`} onClick={() => setSelectedWorkTypes(prev => prev.filter(x => x.value !== o.value))}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        ))}
                        {selectedKeywords.map(o => (
                            <span key={`kw-${o.value}`} className={styles.filterChip}>
                                {o.label}
                                <button type="button" className={styles.filterChipRemove} aria-label={`Remove keyword filter: ${o.label}`} onClick={() => setSelectedKeywords(prev => prev.filter(x => x.value !== o.value))}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        ))}
                        {selectedTags.map(o => (
                            <span key={`tag-${o.value}`} className={styles.filterChip}>
                                {o.label}
                                <button type="button" className={styles.filterChipRemove} aria-label={`Remove tag filter: ${o.label}`} onClick={() => setSelectedTags(prev => prev.filter(x => x.value !== o.value))}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        ))}
                        {selectedPatientTypes.map(o => (
                            <span key={`pt-${o.value}`} className={styles.filterChip}>
                                {o.label}
                                <button type="button" className={styles.filterChipRemove} aria-label={`Remove patient type filter: ${o.label}`} onClick={() => setSelectedPatientTypes(prev => prev.filter(x => x.value !== o.value))}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        ))}
                        {lastAppointmentFilter && (
                            <span className={styles.filterChip}>
                                {lastAppointmentChipLabel}
                                <button type="button" className={styles.filterChipRemove} aria-label="Remove last appointment filter" onClick={() => { setLastAppointmentFilter(''); setLastAppointmentCustomDate(''); }}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        )}
                        {hasFinalPhotos && (
                            <span className={styles.filterChip}>
                                Has Final Photos
                                <button type="button" className={styles.filterChipRemove} aria-label="Remove has final photos filter" onClick={() => setHasFinalPhotos(false)}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        )}
                    </div>
                )}
                {showFilters && (
                    <div className={styles.advancedFiltersContent}>
                        <div className={styles.advancedFiltersGrid}>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-work-type">Work Type</label>
                                <Select
                                    inputId="pm-filter-work-type"
                                    isMulti
                                    options={workTypes}
                                    value={selectedWorkTypes}
                                    onChange={(newValue: MultiValue<SelectOption>) => setSelectedWorkTypes([...newValue])}
                                    classNamePrefix="react-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-keywords">Keywords</label>
                                <Select
                                    inputId="pm-filter-keywords"
                                    isMulti
                                    options={keywords}
                                    value={selectedKeywords}
                                    onChange={(newValue: MultiValue<SelectOption>) => setSelectedKeywords([...newValue])}
                                    classNamePrefix="react-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-tags">Tags</label>
                                <Select
                                    inputId="pm-filter-tags"
                                    isMulti
                                    options={tags}
                                    value={selectedTags}
                                    onChange={(newValue: MultiValue<SelectOption>) => setSelectedTags([...newValue])}
                                    classNamePrefix="react-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-patient-type">Patient Type</label>
                                <Select
                                    inputId="pm-filter-patient-type"
                                    isMulti
                                    options={patientTypes}
                                    value={selectedPatientTypes}
                                    onChange={(newValue: MultiValue<SelectOption>) => setSelectedPatientTypes([...newValue])}
                                    classNamePrefix="react-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-last-appointment">Last Appointment</label>
                                <Select
                                    inputId="pm-filter-last-appointment"
                                    options={LAST_APPOINTMENT_OPTIONS}
                                    value={LAST_APPOINTMENT_OPTIONS.find(o => o.value === lastAppointmentFilter) || LAST_APPOINTMENT_OPTIONS[0]}
                                    onChange={(option) => setLastAppointmentFilter(option?.value || '')}
                                    classNamePrefix="react-select"
                                    isClearable
                                />
                                {lastAppointmentFilter === 'custom' && (
                                    <input
                                        type="date"
                                        value={lastAppointmentCustomDate}
                                        onChange={(e) => setLastAppointmentCustomDate(e.target.value)}
                                        className={`form-control ${styles.customDateInput}`}
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
                <div className={styles.resultsSummary} ref={resultsRef}>
                    <div className={styles.summaryCard}>
                        <h3>Results</h3>
                        <span className={styles.summaryValue}>
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
                            <button className={cn(styles.sortBtn, sortConfig.key === 'lastVisit' && styles.sortBtnActive)} onClick={() => handleSortToggle('lastVisit')}>
                                Last Visit
                                {sortConfig.key === 'lastVisit' && (
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
                        <thead>
                            <tr>
                                {renderSortableTh('id', 'ID')}
                                {renderSortableTh('name', 'Name')}
                                <th>Phone</th>
                                {renderSortableTh('date', 'Added')}
                                {renderSortableTh('lastVisit', 'Last Visit')}
                                <th>Tag</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {patients.map(p => (
                                <tr key={p.person_id}>
                                    <td data-label="ID">{p.person_id}</td>
                                    <td data-label="Name">
                                        <Link
                                            to={`/patient/${p.person_id}/works`}
                                            className={styles.patientNameLink}
                                            title="View Patient"
                                        >
                                            {p.patient_name}
                                        </Link>
                                        {p.first_name && <div>{p.first_name} {p.last_name}</div>}
                                    </td>
                                    <td data-label="Phone"><PhoneDisplay phone={p.phone} /> {!p.phone && '-'}</td>
                                    <td data-label="Added">{p.date_added ? formatDate(p.date_added) : '-'}</td>
                                    <td data-label="Last Visit">{p.last_visit ? formatDate(p.last_visit) : '-'}</td>
                                    <td data-label="Tag">{p.TagName ? <span className={styles.tagBadge}>{p.TagName}</span> : '-'}</td>
                                    <td data-label="Actions">
                                        <div className={styles.actionButtons}>
                                            <button onClick={(e) => handleQuickCheckin(e, p)} className={cn('btn btn-icon', styles.rowActionBtn, styles.rowActionSuccess)} title="Quick Check-in" aria-label={`Quick check-in ${p.patient_name}`}><i className="fas fa-user-check" aria-hidden="true"></i></button>
                                            <button onClick={() => navigate(`/patient/${p.person_id}/works`)} className={cn('btn btn-icon', styles.rowActionBtn, styles.rowActionPrimary)} title="View Patient" aria-label={`View ${p.patient_name}`}><i className="fas fa-eye" aria-hidden="true"></i></button>
                                            <button onClick={() => navigate(`/patient/${p.person_id}/edit-patient`)} className={cn('btn btn-icon', styles.rowActionBtn, styles.rowActionWarning)} title="Edit Patient" aria-label={`Edit ${p.patient_name}`}><i className="fas fa-edit" aria-hidden="true"></i></button>
                                            <button onClick={() => handleDeleteClick(p)} className={cn('btn btn-icon', styles.rowActionBtn, styles.rowActionDanger)} title="Delete Patient" aria-label={`Delete ${p.patient_name}`}><i className="fas fa-trash" aria-hidden="true"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {patients.length === 0 && <tr><td colSpan={7} className={styles.noData}>No results</td></tr>}
                        </tbody>
                    </table>

                    {hasMore && (
                        <div className={styles.loadMoreContainer}>
                            <button
                                onClick={handleLoadMore}
                                className={cn('btn btn-light', styles.loadMoreBtn)}
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

            <Modal
                isOpen={showDeleteConfirm && !!selectedPatient}
                onClose={() => setShowDeleteConfirm(false)}
                contentClassName={styles.deleteModal}
                ariaLabelledBy="patient-delete-modal-title"
            >
                {selectedPatient && (
                    <>
                        <ModalHeader
                            variant="danger"
                            title="Confirm Delete"
                            titleId="patient-delete-modal-title"
                            onClose={() => setShowDeleteConfirm(false)}
                        />
                        <div className={styles.deleteModalContent}>
                            <p>Are you sure you want to delete <strong>{selectedPatient.patient_name}</strong>?</p>
                            <p className={styles.deleteModalWarning}>
                                <i className="fas fa-exclamation-triangle"></i> This permanently deletes the patient record
                                <strong> and the patient's entire photo folder on the share</strong> (all photos and files).
                                This cannot be undone.
                            </p>
                            <div className={styles.deleteModalActions}>
                                <button onClick={() => setShowDeleteConfirm(false)} className="btn btn-light" disabled={deleting}>Cancel</button>
                                <button onClick={handleDeleteConfirm} className="btn btn-danger" disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
                            </div>
                        </div>
                    </>
                )}
            </Modal>
        </div>
    );
};

export default React.memo(PatientManagement);
