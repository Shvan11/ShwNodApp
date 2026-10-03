import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import Select, { MultiValue } from 'react-select';
import cn from 'classnames';
import type { z } from 'zod';
import { useToast } from '../../contexts/ToastContext';
import PatientSearchCombobox from './PatientSearchCombobox';
import PhoneDisplay from './PhoneDisplay';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJSON, postJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { formatDate } from '@/core/utils';
import { qk } from '@/query/keys';
import {
    patientPhonesQuery,
    workTypesQuery,
    workKeywordsQuery,
    tagOptionsQuery,
    patientTypesQuery,
} from '@/query/queries';
import { invalidateApprovals } from '@/services/approvals';
import { patientSearch as patientSearchContract, deletePatient as deletePatientContract } from '@shared/contracts/patient.contract';
import * as appointmentContract from '@shared/contracts/appointment.contract';
import styles from './PatientManagement.module.css';

/** One search-result row, as the contract parses it. */
type Patient = z.infer<typeof patientSearchContract.response>['patients'][number];

interface SelectOption {
    value: string | number;
    label: string;
}

interface SortConfig {
    key: string;
    direction: 'asc' | 'desc';
}

const LAST_APPOINTMENT_OPTIONS: SelectOption[] = [
    { value: '', label: 'Any time' },
    { value: '1month', label: 'More than 1 month ago' },
    { value: '3months', label: 'More than 3 months ago' },
    { value: '6months', label: 'More than 6 months ago' },
    { value: '1year', label: 'More than 1 year ago' },
    { value: 'custom', label: 'Custom date range...' },
];

type PhotoPresenceFilter = '' | 'has' | 'none';

const FINAL_PHOTOS_OPTIONS: { value: PhotoPresenceFilter; label: string }[] = [
    { value: '', label: 'Any' },
    { value: 'has', label: 'Has final photos' },
    { value: 'none', label: 'No final photos' },
];

const PROGRESS_PHOTOS_OPTIONS: { value: PhotoPresenceFilter; label: string }[] = [
    { value: '', label: 'Any' },
    { value: 'has', label: 'Has progress photos' },
    { value: 'none', label: 'No progress photos' },
];

/**
 * Everything the search narrows by. One object, because the fields are always
 * read, saved, reset and cleared together — as 17 `useState`s each of those was
 * written out by hand, and "is there any criterion" three times (FE-F6-13).
 */
interface Criteria {
    patientName: string;
    firstName: string;
    lastName: string;
    term: string;
    /** Prefix instead of substring match — modifies the name fields, narrows nothing alone. */
    nameStartsWith: boolean;
    workTypes: SelectOption[];
    keywords: SelectOption[];
    tags: SelectOption[];
    patientTypes: SelectOption[];
    lastAppointment: string;
    lastAppointmentFrom: string;
    lastAppointmentTo: string;
    finalPhotos: PhotoPresenceFilter;
    progressPhotos: PhotoPresenceFilter;
    hasDebt: boolean;
}

const EMPTY_CRITERIA: Criteria = {
    patientName: '', firstName: '', lastName: '', term: '', nameStartsWith: false,
    workTypes: [], keywords: [], tags: [], patientTypes: [],
    lastAppointment: '', lastAppointmentFrom: '', lastAppointmentTo: '',
    finalPhotos: '', progressPhotos: '', hasDebt: false,
};

const DEFAULT_SORT: SortConfig = { key: 'name', direction: 'asc' };
const PAGE_SIZE = 100;
/** The server's per-request cap (`patient-search-queries.ts` MAX_PAGE_SIZE). */
const MAX_PAGE = 500;

/** The advanced filters (the badge and chips count these; the name/phone fields are not filters). */
const filterCount = (c: Criteria): number =>
    c.workTypes.length + c.keywords.length + c.tags.length + c.patientTypes.length +
    (c.lastAppointment ? 1 : 0) + (c.finalPhotos ? 1 : 0) + (c.progressPhotos ? 1 : 0) + (c.hasDebt ? 1 : 0);

/** Does anything narrow the list? */
const hasCriteria = (c: Criteria): boolean =>
    !!(c.patientName || c.firstName || c.lastName || c.term) || filterCount(c) > 0;

function searchParams(c: Criteria, sort: SortConfig, offset: number, limit: number): URLSearchParams {
    const params = new URLSearchParams();
    if (c.patientName.trim()) params.append('patientName', c.patientName.trim());
    if (c.firstName.trim()) params.append('firstName', c.firstName.trim());
    if (c.lastName.trim()) params.append('lastName', c.lastName.trim());
    if (c.term.trim()) params.append('q', c.term.trim());
    if (c.nameStartsWith) params.append('nameStartsWith', 'true');
    if (c.workTypes.length > 0) params.append('workTypes', c.workTypes.map(o => o.value).join(','));
    if (c.keywords.length > 0) params.append('keywords', c.keywords.map(o => o.value).join(','));
    if (c.tags.length > 0) params.append('tags', c.tags.map(o => o.value).join(','));
    if (c.patientTypes.length > 0) params.append('patientTypes', c.patientTypes.map(o => o.value).join(','));
    if (c.lastAppointment === 'custom') {
        if (c.lastAppointmentFrom) params.append('lastAppointmentFrom', c.lastAppointmentFrom);
        if (c.lastAppointmentTo) params.append('lastAppointmentTo', c.lastAppointmentTo);
    } else if (c.lastAppointment) {
        params.append('lastAppointment', c.lastAppointment);
    }
    if (c.finalPhotos) params.append('finalPhotos', c.finalPhotos);
    if (c.progressPhotos) params.append('progressPhotos', c.progressPhotos);
    if (c.hasDebt) params.append('hasDebt', 'true');
    params.append('sortBy', sort.key);
    params.append('order', sort.direction);
    params.append('offset', String(offset));
    params.append('limit', String(limit));
    return params;
}

const STORAGE_KEY = 'pm_search_state';

interface SavedState {
    patients: Patient[];
    hasSearched: boolean;
    totalCount: number;
    hasMore: boolean;
    criteria: Criteria;
    showFilters: boolean;
    sortConfig: SortConfig;
}

function readSavedState(): SavedState | null {
    try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (!saved) return null;
        const parsed = JSON.parse(saved) as Partial<SavedState>;
        // A snapshot from an older build (flat fields, no `criteria`) is dropped, not migrated.
        if (!Array.isArray(parsed.patients) || !parsed.criteria) {
            sessionStorage.removeItem(STORAGE_KEY);
            return null;
        }
        return {
            patients: parsed.patients,
            hasSearched: !!parsed.hasSearched,
            totalCount: parsed.totalCount ?? parsed.patients.length,
            hasMore: !!parsed.hasMore,
            criteria: { ...EMPTY_CRITERIA, ...parsed.criteria },
            showFilters: !!parsed.showFilters,
            sortConfig: parsed.sortConfig ?? DEFAULT_SORT,
        };
    } catch {
        try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
        return null;
    }
}

interface RunOptions {
    criteria: Criteria;
    sort: SortConfig;
    /** Append the next page instead of replacing the list. */
    loadMore?: boolean;
    /**
     * Re-read the restored snapshot to the depth it was left at, without a
     * loading state: the snapshot paints at once (scroll restoration needs the
     * rows on first paint) and is then brought up to date (FE-F6-3).
     */
    revalidateTo?: number;
}

/**
 * Patient Management Component
 * * Architecture Note:
 * This component uses a "Synchronous Restoration" pattern to support React Router's <ScrollRestoration />.
 * 1. State is initialized from sessionStorage BEFORE the first render.
 * 2. This ensures the table is fully populated immediately on mount.
 * 3. React Router then handles the scroll position automatically.
 * 4. The restored rows are then revalidated in the background, so the snapshot is
 *    never the source of truth — an edit or a delete made elsewhere shows on return.
 */
const PatientManagement = () => {
    const navigate = useNavigate();
    const location = useLocation();
    // Patient edit + delete are FINANCE_ROLES on the server (FE-F6-6).
    const user = useAuthUser();
    const caps = roleCaps(user?.role as UserRole | undefined);
    const toast = useToast();
    const queryClient = useQueryClient();

    // --- 1. Synchronous State Initialization ---
    // Storage and the `?search=` deep link are read once, in initializers, so the
    // first paint already carries the restored table. The deep link wins over the
    // snapshot and forces a fresh search.
    const [initial] = useState(() => {
        const saved = readSavedState();
        const urlSearch = new URLSearchParams(location.search).get('search') || '';
        return { saved: urlSearch ? null : saved, urlSearch };
    });
    const savedState = initial.saved;

    // -- Data State --
    const [patients, setPatients] = useState<Patient[]>(savedState?.patients ?? []);
    const [hasSearched, setHasSearched] = useState(savedState?.hasSearched ?? false);
    const [totalCount, setTotalCount] = useState(savedState?.totalCount ?? 0);
    const [hasMore, setHasMore] = useState(savedState?.hasMore ?? false);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    // Its own flag: sharing `loading` with the search let a check-in that finished
    // mid-search end the search's spinner early (FE-F6-13).
    const [checkingInId, setCheckingInId] = useState<number | null>(null);

    // -- Criteria, sort and panel --
    const [criteria, setCriteria] = useState<Criteria>(
        initial.urlSearch ? { ...EMPTY_CRITERIA, patientName: initial.urlSearch } : savedState?.criteria ?? EMPTY_CRITERIA
    );
    const [showFilters, setShowFilters] = useState(savedState?.showFilters ?? false);
    const [sortConfig, setSortConfig] = useState<SortConfig>(savedState?.sortConfig ?? DEFAULT_SORT);
    const setCriterion = <K extends keyof Criteria>(key: K, value: Criteria[K]) =>
        setCriteria(prev => ({ ...prev, [key]: value }));

    // -- UI State (Non-persistent) --
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [deleting, setDeleting] = useState(false);

    // -- Dropdown Data --
    // Read straight from the React Query cache, which `patientManagementLoader`
    // has already filled (so these paint filled on the first render, no flash).
    const { data: allPatients = [] } = useQuery(patientPhonesQuery());
    const { data: workTypeRows = [] } = useQuery(workTypesQuery());
    const { data: keywordRows = [] } = useQuery(workKeywordsQuery());
    const { data: tagRows = [] } = useQuery(tagOptionsQuery());
    const { data: patientTypeRows = [] } = useQuery(patientTypesQuery());

    // `key_word` and the type `name` are nullable in the DB (and in the contracts);
    // `?? ''` keeps the rendering identical (react-select renders nothing for a null label).
    const workTypes: SelectOption[] = workTypeRows.map((wt) => ({ value: wt.id, label: wt.work_type }));
    const keywords: SelectOption[] = keywordRows.map((kw) => ({ value: kw.id, label: kw.key_word ?? '' }));
    const tags: SelectOption[] = tagRows.map((tag) => ({ value: tag.id, label: tag.tag }));
    const patientTypes: SelectOption[] = patientTypeRows.map((pt) => ({ value: pt.id, label: pt.name ?? '' }));

    // -- Refs --
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    // The criteria the auto-search last saw, by value: a mount with restored or
    // deep-linked criteria is not a change, and Show All/Reset set this to the
    // empty criteria themselves so their clearing schedules no second fetch.
    const lastCriteriaKeyRef = useRef(JSON.stringify(criteria));
    // Results block, for the scroll-into-view after an explicit search on mobile.
    const resultsRef = useRef<HTMLDivElement | null>(null);

    // --- 3. Persistence ---
    // Saved from the effect BODY on every change. It used to be saved from the
    // cleanup, which runs with the PREVIOUS render's values, so storage was always
    // one change behind and a reload showed the previous search's rows (FE-F6-3).
    useEffect(() => {
        const stateToSave: SavedState = { patients, hasSearched, totalCount, hasMore, criteria, showFilters, sortConfig };
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
        } catch {
            // Quota or private mode: the page just won't restore.
        }
    }, [patients, hasSearched, totalCount, hasMore, criteria, showFilters, sortConfig]);

    // --- Search ---
    const runSearch = async ({ criteria: c, sort, loadMore = false, revalidateTo }: RunOptions): Promise<void> => {
        abortControllerRef.current?.abort();
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        const background = revalidateTo !== undefined;

        try {
            if (loadMore) setLoadingMore(true);
            else if (!background) setLoading(true);

            const fetchPage = (offset: number, limit: number) =>
                fetchJSON<z.infer<typeof patientSearchContract.response>>(
                    `/api/patients/search?${searchParams(c, sort, offset, limit).toString()}`,
                    { signal: abortController.signal, schema: patientSearchContract.response }
                );

            if (loadMore) {
                const data = await fetchPage(patients.length, PAGE_SIZE);
                setPatients(prev => [...prev, ...data.patients]);
                setTotalCount(data.totalCount ?? patients.length + data.patients.length);
                setHasMore(data.hasMore ?? false);
            } else {
                // A revalidation re-reads as deep as the restored list went (in
                // server-sized pages), so Load More's depth and the scroll survive.
                const target = Math.max(PAGE_SIZE, revalidateTo ?? 0);
                const rows: Patient[] = [];
                let data = await fetchPage(0, Math.min(target, MAX_PAGE));
                rows.push(...data.patients);
                while (rows.length < target && data.hasMore) {
                    data = await fetchPage(rows.length, Math.min(target - rows.length, MAX_PAGE));
                    rows.push(...data.patients);
                }
                setPatients(rows);
                setTotalCount(data.totalCount ?? rows.length);
                setHasMore(data.hasMore ?? false);
            }
            setHasSearched(true);
        } catch (err) {
            if (err instanceof Error && err.name !== 'AbortError' && !background) {
                toast.error(httpErrorMessage(err, 'Failed to search patients'));
            }
        } finally {
            if (!abortController.signal.aborted) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    };

    const executeSearch = (sort: SortConfig = sortConfig) => runSearch({ criteria, sort });
    const handleLoadMore = () => void runSearch({ criteria, sort: sortConfig, loadMore: true });

    // Latest runSearch for timers and the mount revalidation, without making the
    // effects depend on a function that is new every render.
    const runSearchRef = useRef(runSearch);
    useEffect(() => {
        runSearchRef.current = runSearch;
    });

    // --- Restore → revalidate (once) ---
    useEffect(() => {
        if (savedState?.hasSearched) {
            void runSearchRef.current({
                criteria: savedState.criteria,
                sort: savedState.sortConfig,
                revalidateTo: savedState.patients.length,
            });
        } else if (initial.urlSearch) {
            void runSearchRef.current({ criteria, sort: sortConfig });
        }
        return () => abortControllerRef.current?.abort();
        // Mount only: the inputs are the first render's restored values.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Auto-Search ---
    // Debounced on any change to the criteria's VALUES. Without criteria but with
    // results showing (the last chip/field just cleared), it refreshes to the
    // unfiltered list instead of leaving a stale filtered table behind.
    const criteriaKey = JSON.stringify(criteria);
    useEffect(() => {
        if (criteriaKey === lastCriteriaKeyRef.current) return;
        lastCriteriaKeyRef.current = criteriaKey;
        const current = JSON.parse(criteriaKey) as Criteria;
        if (!hasCriteria(current) && !hasSearched) return;

        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = setTimeout(() => {
            void runSearchRef.current({ criteria: current, sort: sortConfig });
        }, 500);
        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
        // The sort and hasSearched are read at the time of the change only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [criteriaKey]);

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

    /** Empty the criteria without the auto-search reacting to it. */
    const clearCriteria = () => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        lastCriteriaKeyRef.current = JSON.stringify(EMPTY_CRITERIA);
        setCriteria(EMPTY_CRITERIA);
        setSortConfig(DEFAULT_SORT);
    };

    const handleReset = () => {
        // Kill the in-flight search too — its response must not repopulate the
        // page we just emptied.
        abortControllerRef.current?.abort();
        setLoading(false); setLoadingMore(false);
        clearCriteria();
        setPatients([]); setHasSearched(false); setShowFilters(false);
        setTotalCount(0); setHasMore(false);
        try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
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
        void executeSearch(newSort);
    };

    const handleShowAll = async () => {
        // Same abortable path as every other search, so a slow Show All can no
        // longer land on top of a newer filtered search (FE-F6-13).
        clearCriteria();
        await runSearch({ criteria: EMPTY_CRITERIA, sort: DEFAULT_SORT });
        scrollToResultsOnMobile();
    };

    const handleQuickCheckin = async (e: React.MouseEvent<HTMLButtonElement>, patient: Patient) => {
        e.preventDefault(); e.stopPropagation();
        try {
            setCheckingInId(patient.person_id);
            const data = await postJSON<{ alreadyCheckedIn?: boolean }>('/api/appointments/quick-checkin', { person_id: patient.person_id }, { schema: appointmentContract.quickCheckin.response });
            toast.success(data.alreadyCheckedIn ? 'Already checked in' : 'Checked in successfully');
            // Quick check-in CREATES a same-day appointment when none exists — refresh
            // the patient's appointment-backed reads and the calendar/slot reads.
            queryClient.invalidateQueries({ queryKey: qk.patient.all(patient.person_id) });
            queryClient.invalidateQueries({ queryKey: qk.calendar.all() });
            // …and today's daily board, so a return to it shows the walk-in (FE-F11-17).
            queryClient.invalidateQueries({ queryKey: qk.appointments.all() });
        } catch(err) {
            toast.error(httpErrorMessage(err, 'Check-in failed'));
        }
        finally { setCheckingInId(null); }
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
                // A request was created but no row changed — tell the approval bells
                // (they only hear about a RESOLVED request otherwise, and poll every 5 min).
                void invalidateApprovals();
                return;
            }
            queryClient.invalidateQueries({ queryKey: qk.patient.all(selectedPatient.person_id) });
            // The jump comboboxes and the message pickers read the phone book; it
            // kept offering the deleted patient until a stale refetch (FE-F6-9).
            queryClient.invalidateQueries({ queryKey: qk.lookups.patientPhones() });
            void executeSearch();
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

    const activeFilterCount = filterCount(criteria);

    const lastAppointmentChipLabel = criteria.lastAppointment === 'custom'
        ? (criteria.lastAppointmentFrom && criteria.lastAppointmentTo ? `Last visit ${criteria.lastAppointmentFrom} – ${criteria.lastAppointmentTo}`
            : criteria.lastAppointmentFrom ? `Last visit after ${criteria.lastAppointmentFrom}`
            : criteria.lastAppointmentTo ? `Last visit before ${criteria.lastAppointmentTo}`
            : 'Last visit range…')
        : (LAST_APPOINTMENT_OPTIONS.find(o => o.value === criteria.lastAppointment)?.label ?? criteria.lastAppointment);

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
                        value={criteria.patientName}
                        onChange={(v) => setCriterion('patientName', v)}
                        onJump={handleJumpToPatient}
                        onSubmit={() => void executeSearch()}
                        patients={allPatients}
                        mode="name"
                        nameStartsWith={criteria.nameStartsWith}
                        rtl
                        placeholder="اكتب للبحث..."
                    />
                </div>
                <div><label htmlFor="pm-search-first-name">First Name</label><input id="pm-search-first-name" type="text" value={criteria.firstName} onChange={(e: ChangeEvent<HTMLInputElement>) => setCriterion('firstName', e.target.value)} className="form-control"/></div>
                <div><label htmlFor="pm-search-last-name">Last Name</label><input id="pm-search-last-name" type="text" value={criteria.lastName} onChange={(e: ChangeEvent<HTMLInputElement>) => setCriterion('lastName', e.target.value)} className="form-control"/></div>
                <div>
                    <label htmlFor="pm-search-phone-id">Phone/ID</label>
                    <PatientSearchCombobox
                        id="pm-search-phone-id"
                        value={criteria.term}
                        onChange={(v) => setCriterion('term', v)}
                        onJump={handleJumpToPatient}
                        onSubmit={() => void executeSearch()}
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
                        checked={criteria.nameStartsWith}
                        onChange={(e) => setCriterion('nameStartsWith', e.target.checked)}
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
                        {criteria.workTypes.map(o => (
                            <span key={`wt-${o.value}`} className={styles.filterChip}>
                                {o.label}
                                <button type="button" className={styles.filterChipRemove} aria-label={`Remove work type filter: ${o.label}`} onClick={() => setCriterion('workTypes', criteria.workTypes.filter(x => x.value !== o.value))}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        ))}
                        {criteria.keywords.map(o => (
                            <span key={`kw-${o.value}`} className={styles.filterChip}>
                                {o.label}
                                <button type="button" className={styles.filterChipRemove} aria-label={`Remove keyword filter: ${o.label}`} onClick={() => setCriterion('keywords', criteria.keywords.filter(x => x.value !== o.value))}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        ))}
                        {criteria.tags.map(o => (
                            <span key={`tag-${o.value}`} className={styles.filterChip}>
                                {o.label}
                                <button type="button" className={styles.filterChipRemove} aria-label={`Remove tag filter: ${o.label}`} onClick={() => setCriterion('tags', criteria.tags.filter(x => x.value !== o.value))}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        ))}
                        {criteria.patientTypes.map(o => (
                            <span key={`pt-${o.value}`} className={styles.filterChip}>
                                {o.label}
                                <button type="button" className={styles.filterChipRemove} aria-label={`Remove patient type filter: ${o.label}`} onClick={() => setCriterion('patientTypes', criteria.patientTypes.filter(x => x.value !== o.value))}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        ))}
                        {criteria.lastAppointment && (
                            <span className={styles.filterChip}>
                                {lastAppointmentChipLabel}
                                <button type="button" className={styles.filterChipRemove} aria-label="Remove last appointment filter" onClick={() => setCriteria(prev => ({ ...prev, lastAppointment: '', lastAppointmentFrom: '', lastAppointmentTo: '' }))}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        )}
                        {criteria.finalPhotos && (
                            <span className={styles.filterChip}>
                                {criteria.finalPhotos === 'has' ? 'Has Final Photos' : 'No Final Photos'}
                                <button type="button" className={styles.filterChipRemove} aria-label="Remove final photos filter" onClick={() => setCriterion('finalPhotos', '')}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        )}
                        {criteria.progressPhotos && (
                            <span className={styles.filterChip}>
                                {criteria.progressPhotos === 'has' ? 'Has Progress Photos' : 'No Progress Photos'}
                                <button type="button" className={styles.filterChipRemove} aria-label="Remove progress photos filter" onClick={() => setCriterion('progressPhotos', '')}>
                                    <i className="fas fa-times" aria-hidden="true"></i>
                                </button>
                            </span>
                        )}
                        {criteria.hasDebt && (
                            <span className={styles.filterChip}>
                                Has Unpaid Balance
                                <button type="button" className={styles.filterChipRemove} aria-label="Remove unpaid balance filter" onClick={() => setCriterion('hasDebt', false)}>
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
                                    value={criteria.workTypes}
                                    onChange={(newValue: MultiValue<SelectOption>) => setCriterion('workTypes', [...newValue])}
                                    classNamePrefix="react-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-keywords">Keywords</label>
                                <Select
                                    inputId="pm-filter-keywords"
                                    isMulti
                                    options={keywords}
                                    value={criteria.keywords}
                                    onChange={(newValue: MultiValue<SelectOption>) => setCriterion('keywords', [...newValue])}
                                    classNamePrefix="react-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-tags">Tags</label>
                                <Select
                                    inputId="pm-filter-tags"
                                    isMulti
                                    options={tags}
                                    value={criteria.tags}
                                    onChange={(newValue: MultiValue<SelectOption>) => setCriterion('tags', [...newValue])}
                                    classNamePrefix="react-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-patient-type">Patient Type</label>
                                <Select
                                    inputId="pm-filter-patient-type"
                                    isMulti
                                    options={patientTypes}
                                    value={criteria.patientTypes}
                                    onChange={(newValue: MultiValue<SelectOption>) => setCriterion('patientTypes', [...newValue])}
                                    classNamePrefix="react-select"
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-last-appointment">Last Appointment</label>
                                <Select
                                    inputId="pm-filter-last-appointment"
                                    options={LAST_APPOINTMENT_OPTIONS}
                                    value={LAST_APPOINTMENT_OPTIONS.find(o => o.value === criteria.lastAppointment) || LAST_APPOINTMENT_OPTIONS[0]}
                                    onChange={(option) => setCriterion('lastAppointment', String(option?.value ?? ''))}
                                    classNamePrefix="react-select"
                                    isClearable
                                />
                                {criteria.lastAppointment === 'custom' && (
                                    <div className={styles.dateRangeInputs}>
                                        <input
                                            type="date"
                                            aria-label="Last appointment from"
                                            value={criteria.lastAppointmentFrom}
                                            onChange={(e) => setCriterion('lastAppointmentFrom', e.target.value)}
                                            className={`form-control ${styles.customDateInput}`}
                                        />
                                        <span className={styles.dateRangeSeparator}>to</span>
                                        <input
                                            type="date"
                                            aria-label="Last appointment to"
                                            value={criteria.lastAppointmentTo}
                                            onChange={(e) => setCriterion('lastAppointmentTo', e.target.value)}
                                            className={`form-control ${styles.customDateInput}`}
                                        />
                                    </div>
                                )}
                            </div>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-final-photos">Final Photos</label>
                                <Select
                                    inputId="pm-filter-final-photos"
                                    options={FINAL_PHOTOS_OPTIONS}
                                    value={FINAL_PHOTOS_OPTIONS.find(o => o.value === criteria.finalPhotos) || FINAL_PHOTOS_OPTIONS[0]}
                                    onChange={(option) => setCriterion('finalPhotos', option?.value ?? '')}
                                    classNamePrefix="react-select"
                                    isClearable
                                />
                            </div>
                            <div className={styles.filterGroup}>
                                <label htmlFor="pm-filter-progress-photos">Progress Photos</label>
                                <Select
                                    inputId="pm-filter-progress-photos"
                                    options={PROGRESS_PHOTOS_OPTIONS}
                                    value={PROGRESS_PHOTOS_OPTIONS.find(o => o.value === criteria.progressPhotos) || PROGRESS_PHOTOS_OPTIONS[0]}
                                    onChange={(option) => setCriterion('progressPhotos', option?.value ?? '')}
                                    classNamePrefix="react-select"
                                    isClearable
                                />
                            </div>
                        </div>
                        <div className={styles.checkboxFilters}>
                            <label className={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={criteria.hasDebt}
                                    onChange={(e) => setCriterion('hasDebt', e.target.checked)}
                                />
                                <span>Has unpaid balance</span>
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
                                        {p.first_name && <div>{p.first_name} {p.last_name ?? ''}</div>}
                                    </td>
                                    <td data-label="Phone"><PhoneDisplay phone={p.phone ?? undefined} /> {!p.phone && '-'}</td>
                                    <td data-label="Added">{p.date_added ? formatDate(p.date_added) : '-'}</td>
                                    <td data-label="Last Visit">{p.last_visit ? formatDate(p.last_visit) : '-'}</td>
                                    <td data-label="Tag">{p.TagName ? <span className={styles.tagBadge}>{p.TagName}</span> : '-'}</td>
                                    <td data-label="Actions">
                                        <div className={styles.actionButtons}>
                                            <button onClick={(e) => handleQuickCheckin(e, p)} disabled={checkingInId === p.person_id} className={cn('btn btn-icon', styles.rowActionBtn, styles.rowActionSuccess)} title="Quick Check-in" aria-label={`Quick check-in ${p.patient_name}`}><i className="fas fa-user-check" aria-hidden="true"></i></button>
                                            <button onClick={() => navigate(`/patient/${p.person_id}/works`)} className={cn('btn btn-icon', styles.rowActionBtn, styles.rowActionPrimary)} title="View Patient" aria-label={`View ${p.patient_name}`}><i className="fas fa-eye" aria-hidden="true"></i></button>
                                            {/* Patient edit + delete are FINANCE_ROLES on the server (FE-F6-6). */}
                                            {caps.editRecords && (
                                                <>
                                                    <button onClick={() => navigate(`/patient/${p.person_id}/edit-patient`, { state: { from: `${location.pathname}${location.search}` } })} className={cn('btn btn-icon', styles.rowActionBtn, styles.rowActionWarning)} title="Edit Patient" aria-label={`Edit ${p.patient_name}`}><i className="fas fa-edit" aria-hidden="true"></i></button>
                                                    <button onClick={() => handleDeleteClick(p)} className={cn('btn btn-icon', styles.rowActionBtn, styles.rowActionDanger)} title="Delete Patient" aria-label={`Delete ${p.patient_name}`}><i className="fas fa-trash" aria-hidden="true"></i></button>
                                                </>
                                            )}
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
