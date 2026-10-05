// ArchformMatcher.tsx - Match Archform patients to aligner sets
import { useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Select, { type SingleValue, type StylesConfig } from 'react-select';
import { useToast } from '../../contexts/ToastContext';
import ConfirmDialog from '../../components/react/ConfirmDialog';
import { putJSON, patchJSON, deleteJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { archformPatientsQuery, archformMatchesQuery } from '@/query/queries';
import { invalidateAligner } from '@/query/aligner';
import { formatDate } from '@/core/utils';
import { doctorLabel } from '../../utils/aligner-labels';
import type { ArchformPatient, AlignerSetForMatch } from './aligner.types';
import styles from './ArchformMatcher.module.css';

interface SetOption {
    value: number;
    label: string;
    isDisabled: boolean;
}

// Layout only: colours come from the global react-select theme (classNamePrefix),
// which already won in dark mode over the literal colours this used to carry
// (FE-F18-14); the menu portal sits on the dropdown layer.
const setSelectStyles: StylesConfig<SetOption, false> = {
    control: (provided) => ({ ...provided, minHeight: '34px', fontSize: '0.85rem', minWidth: '240px' }),
    menu: (provided) => ({ ...provided, fontSize: '0.85rem' }),
    menuPortal: (provided) => ({ ...provided, zIndex: 'var(--z-index-dropdown)' }),
    option: (provided) => ({ ...provided, padding: '6px 10px' }),
};

type FilterMode = 'all' | 'unmatched' | 'matched';
type SortColumn = 'Name' | 'CreatedDate' | 'LastModifiedDate';
type SortDirection = 'asc' | 'desc';

/** "Ahmad Ali - Set 2 - Dr. Sara" (or "… - Admin"); "(finished)" for a closed work. */
function formatSetLabel(set: AlignerSetForMatch): string {
    const parts = [set.patient_name];
    if (set.set_sequence != null) parts.push(`Set ${set.set_sequence}`);
    if (set.doctor_name) parts.push(doctorLabel(set.doctor_name));
    return parts.join(' - ') + (set.work_closed ? ' (finished)' : '');
}

/** Archform's last-name convention for a matched set: `Dr_Sara_2`, or `Admin_2` (FE-F18-14). */
function archformLastName(set: AlignerSetForMatch): string {
    const doctor = doctorLabel(set.doctor_name?.trim() || 'Unknown').replace(/^Dr\. /, 'Dr_').replace(/\s+/g, '_');
    return `${doctor}_${set.set_sequence ?? 0}`;
}

/** Does a string contain at least one Latin letter? */
const isEnglishName = (str: string | null | undefined): boolean => !!str && /[a-zA-Z]/.test(str);

const ArchformMatcher: React.FC = () => {
    const toast = useToast();
    const navigate = useNavigate();
    const location = useLocation();

    // /archform/matches reads Postgres; only /archform/patients can answer 503
    // { unavailable } (the file isn't reachable) or 409 { notConfigured } (this
    // install has no ARCHFORM_DB_PATH, FE-F18-4).
    const patientsQ = useQuery(archformPatientsQuery());
    const matchesQ = useQuery(archformMatchesQuery());

    const archformPatients: ArchformPatient[] = patientsQ.data?.patients ?? [];
    const alignerSets: AlignerSetForMatch[] = matchesQ.data?.sets ?? [];
    const loading = patientsQ.isLoading || matchesQ.isLoading;

    const unavailableData = (patientsQ.error as HttpError | null)?.data as
        | { unavailable?: boolean; notConfigured?: boolean; path?: string }
        | undefined;
    const notConfigured = !!unavailableData?.notConfigured;
    const unavailable = !!unavailableData?.unavailable;
    const dbPath = unavailableData?.path || '';
    const error =
        !unavailable && (patientsQ.isError || matchesQ.isError)
            ? httpErrorMessage(patientsQ.error ?? matchesQ.error, 'Failed to load Archform data')
            : null;

    const reload = (): void => {
        void patientsQ.refetch();
        void matchesQ.refetch();
    };

    const [filter, setFilter] = useState('');
    const [filterMode, setFilterMode] = useState<FilterMode>('all');
    // The one row whose set picker is open, and what it has picked (FE-F18-13: a
    // react-select per unmatched row took seconds to mount at a busy center's size).
    const [pickingFor, setPickingFor] = useState<number | null>(null);
    const [pickedSetId, setPickedSetId] = useState<number | null>(null);
    const [savingRows, setSavingRows] = useState<Set<number>>(new Set());

    const [sortColumn, setSortColumn] = useState<SortColumn>('Name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

    const [editingPatientId, setEditingPatientId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editLastName, setEditLastName] = useState('');
    const [editSaving, setEditSaving] = useState(false);

    const [deleteTarget, setDeleteTarget] = useState<ArchformPatient | null>(null);

    // ---- One pass over the sets (was two identical map builders and a `find` per row).
    const setById = new Map<number, AlignerSetForMatch>();
    const archformToSet = new Map<number, AlignerSetForMatch>();
    for (const set of alignerSets) {
        setById.set(set.aligner_set_id, set);
        if (set.archform_id != null) archformToSet.set(set.archform_id, set);
    }
    const archformIds = new Set(archformPatients.map((p) => p.Id));
    // Sets linked to an Archform patient that no longer exists in Archform (deleted
    // or merged THERE). They had no row, so no Unmatch, and showed as disabled in
    // every dropdown — unreachable from any screen (FE-F18-3).
    const danglingSets = patientsQ.isSuccess
        ? alignerSets.filter((s) => s.archform_id != null && !archformIds.has(s.archform_id))
        : [];

    // Open works first, then finished ones; a linked set can't be picked again.
    const setOptions: SetOption[] = [...alignerSets]
        .sort((a, b) => Number(a.work_closed) - Number(b.work_closed))
        .map((set) => ({
            value: set.aligner_set_id,
            label: formatSetLabel(set),
            isDisabled: set.archform_id != null,
        }));

    const withRowBusy = async (rowId: number, work: () => Promise<void>): Promise<void> => {
        setSavingRows((prev) => new Set(prev).add(rowId));
        try {
            await work();
        } finally {
            setSavingRows((prev) => {
                const next = new Set(prev);
                next.delete(rowId);
                return next;
            });
        }
    };

    const handleSave = (archformId: number): Promise<void> =>
        withRowBusy(archformId, async () => {
            if (!pickedSetId) return;
            try {
                await patchJSON(`/api/aligner/sets/${pickedSetId}/archform`, { archformId });
                toast.success('Match saved');
                setPickingFor(null);
                setPickedSetId(null);
            } catch (err) {
                // A 409 says the set or the Archform patient was linked meanwhile —
                // the server no longer overwrites a colleague's match (FE-F18-3).
                toast.error(httpErrorMessage(err, 'Failed to save match'));
            } finally {
                await invalidateAligner();
            }
        });

    const handleUnmatch = (rowId: number, setId: number): Promise<void> =>
        withRowBusy(rowId, async () => {
            try {
                await patchJSON(`/api/aligner/sets/${setId}/archform`, { archformId: null });
                toast.success('Match removed');
            } catch (err) {
                toast.error(httpErrorMessage(err, 'Failed to remove match'));
            } finally {
                await invalidateAligner();
            }
        });

    // ========== SORTING ==========

    const handleSort = (column: SortColumn): void => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const sortPatients = (patients: ArchformPatient[]): ArchformPatient[] =>
        [...patients].sort((a, b) => {
            let aVal: string | number | null;
            let bVal: string | number | null;
            if (sortColumn === 'Name') {
                aVal = `${a.Name} ${a.LastName}`.toLowerCase();
                bVal = `${b.Name} ${b.LastName}`.toLowerCase();
            } else if (sortColumn === 'CreatedDate') {
                aVal = a.CreatedDate ? new Date(a.CreatedDate).getTime() : null;
                bVal = b.CreatedDate ? new Date(b.CreatedDate).getTime() : null;
            } else {
                aVal = a.LastModifiedDate ? new Date(a.LastModifiedDate).getTime() : null;
                bVal = b.LastModifiedDate ? new Date(b.LastModifiedDate).getTime() : null;
            }
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;
            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

    // Keyboard-operable and announces its sort, like All Sets' headers (FE-F18-14).
    const renderSortableHeader = (label: string, column: SortColumn): ReactNode => (
        <th
            onClick={() => handleSort(column)}
            onKeyDown={(e: KeyboardEvent<HTMLTableCellElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSort(column);
                }
            }}
            tabIndex={0}
            scope="col"
            aria-sort={sortColumn === column ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={styles.sortableHeader}
        >
            <span>{label}</span>
            <span className={styles.sortIcon} aria-hidden="true">
                <i className={`fas ${sortColumn !== column ? 'fa-sort' : sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down'}`}></i>
            </span>
        </th>
    );

    // ========== EDIT ==========

    const handleStartEdit = (patient: ArchformPatient): void => {
        setEditingPatientId(patient.Id);
        setEditName(patient.Name);
        setEditLastName(patient.LastName);
    };

    const handleCancelEdit = (): void => {
        setEditingPatientId(null);
        setEditName('');
        setEditLastName('');
    };

    const renamePatient = async (id: number, name: string, lastName: string, done: string): Promise<boolean> => {
        setEditSaving(true);
        try {
            await putJSON(`/api/aligner/archform/patients/${id}`, { name, lastName });
            toast.success(done);
            return true;
        } catch (err) {
            // A patient deleted in Archform meanwhile is a 404 now, not a false success.
            toast.error(httpErrorMessage(err, 'Failed to update patient'));
            return false;
        } finally {
            setEditSaving(false);
            await invalidateAligner();
        }
    };

    const handleSaveEdit = async (id: number): Promise<void> => {
        if (editSaving) return;
        if (!editName.trim() || !editLastName.trim()) {
            toast.warning('Name and last name are required');
            return;
        }
        if (await renamePatient(id, editName.trim(), editLastName.trim(), 'Patient name updated')) handleCancelEdit();
    };

    const editKeys = (id: number) => (e: KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'Enter') void handleSaveEdit(id);
        if (e.key === 'Escape') handleCancelEdit();
    };

    const handleAutoRename = async (patient: ArchformPatient, set: AlignerSetForMatch): Promise<void> => {
        if (editSaving) return;
        const firstName = set.first_name?.trim();
        const lastName = set.last_name?.trim();
        if (!isEnglishName(firstName) && !isEnglishName(lastName)) {
            toast.warning(
                `Cannot auto-rename: "${set.patient_name}" has no English first/last name in the database. Use the edit button to rename manually.`
            );
            return;
        }
        if (!isEnglishName(firstName)) {
            toast.warning(`Cannot auto-rename: English first name is missing or not in English (found: "${firstName || 'empty'}").`);
            return;
        }
        if (!isEnglishName(lastName)) {
            toast.warning(`Cannot auto-rename: English last name is missing or not in English (found: "${lastName || 'empty'}").`);
            return;
        }
        // Archform Name = "FirstName LastName", Archform LastName = "Dr_DoctorName_SetSequence"
        const newName = `${firstName} ${lastName}`;
        const newLastName = archformLastName(set);
        await renamePatient(patient.Id, newName, newLastName, `Renamed to ${newName} ${newLastName}`);
    };

    // ========== DELETE ==========

    // Async, so ConfirmDialog holds its buttons until it settles — a double click
    // sent two DELETEs, the second toasting "not found" after the success (FE-F18-9).
    const handleDeleteConfirm = async (): Promise<void> => {
        if (!deleteTarget) return;
        try {
            await deleteJSON(`/api/aligner/archform/patients/${deleteTarget.Id}`);
            toast.success(`Deleted ${deleteTarget.Name} ${deleteTarget.LastName}`);
            setDeleteTarget(null);
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to delete patient'));
        } finally {
            await invalidateAligner();
        }
    };

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <p>Loading Archform data...</p>
            </div>
        );
    }

    if (notConfigured) {
        return (
            <div className={styles.unavailableState}>
                <i className="fas fa-database" aria-hidden="true"></i>
                <h3>Archform is not set up on this install</h3>
                <p>
                    To match Archform patients to aligner sets, enter the path of the Archform database file in
                    Settings → General (<code>ARCHFORM_DB_PATH</code>).
                </p>
                <Link to="/settings/general" className={styles.btnRetry}>
                    <i className="fas fa-cog" aria-hidden="true"></i> Open General Settings
                </Link>
            </div>
        );
    }

    if (unavailable) {
        return (
            <div className={styles.unavailableState}>
                <i className="fas fa-database" aria-hidden="true"></i>
                <h3>Archform Database Unavailable</h3>
                <p>Cannot access the Archform database at:</p>
                <code className={styles.dbPathCode}>{dbPath}</code>
                <p>
                    Ensure the file is shared and accessible from the server, or correct the path in Settings → General
                    (<code>ARCHFORM_DB_PATH</code>).
                </p>
                <button type="button" className={styles.btnRetry} onClick={reload}>
                    <i className="fas fa-redo" aria-hidden="true"></i> Retry
                </button>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorState}>
                <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                <h3>Failed to load data</h3>
                <p>{error}</p>
                <button type="button" className={styles.btnRetry} onClick={reload}>
                    <i className="fas fa-redo" aria-hidden="true"></i> Retry
                </button>
            </div>
        );
    }

    const query = filter.trim().toLowerCase();
    const filteredPatients = sortPatients(
        archformPatients.filter((p) => {
            const matched = archformToSet.has(p.Id);
            if (filterMode === 'matched' && !matched) return false;
            if (filterMode === 'unmatched' && matched) return false;
            return !query || `${p.Name} ${p.LastName}`.toLowerCase().includes(query);
        })
    );
    const matchedCount = archformPatients.filter((p) => archformToSet.has(p.Id)).length;
    const unmatchedCount = archformPatients.length - matchedCount;

    return (
        <>
            {/* Filter Controls */}
            <div className={styles.filterContainer}>
                <div className={styles.searchBox}>
                    <i className={`fas fa-filter ${styles.filterIcon}`} aria-hidden="true"></i>
                    <input
                        type="text"
                        aria-label="Filter by Archform patient name"
                        placeholder="Filter by Archform patient name..."
                        value={filter}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
                    />
                    {filter && (
                        <button type="button" className={styles.clearFilterBtn} onClick={() => setFilter('')} aria-label="Clear the filter">
                            <i className="fas fa-times" aria-hidden="true"></i>
                        </button>
                    )}
                </div>

                <div className={styles.filterToggles}>
                    <label className={`${styles.filterToggle} ${filterMode === 'unmatched' ? styles.active : ''}`}>
                        <input
                            type="checkbox"
                            checked={filterMode === 'unmatched'}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFilterMode(e.target.checked ? 'unmatched' : 'all')}
                        />
                        <i className="fas fa-unlink" aria-hidden="true"></i>
                        <span>Unmatched ({unmatchedCount})</span>
                    </label>
                    <label className={`${styles.filterToggle} ${filterMode === 'matched' ? styles.active : ''}`}>
                        <input
                            type="checkbox"
                            checked={filterMode === 'matched'}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFilterMode(e.target.checked ? 'matched' : 'all')}
                        />
                        <i className="fas fa-link" aria-hidden="true"></i>
                        <span>Matched ({matchedCount})</span>
                    </label>
                </div>
            </div>

            {/* Stats */}
            <div className={styles.statsBar}>
                <strong>{archformPatients.length}</strong> Archform patients &middot;
                <strong>{matchedCount}</strong> matched &middot;
                <strong>{unmatchedCount}</strong> unmatched &middot;
                <strong>{alignerSets.length}</strong> aligner sets
                {danglingSets.length > 0 && (
                    <>
                        {' '}&middot; <strong>{danglingSets.length}</strong> linked to a missing patient
                    </>
                )}{' '}
                &middot; Showing <strong>{filteredPatients.length}</strong>
            </div>

            {danglingSets.length > 0 && (
                <section className={styles.danglingSection} aria-labelledby="archform-dangling-title">
                    <h3 id="archform-dangling-title">
                        <i className="fas fa-link-slash" aria-hidden="true"></i> Linked to an Archform patient that no longer exists
                    </h3>
                    <p>
                        These sets point at an Archform patient deleted or merged in Archform itself. Unmatch them, then match
                        the right Archform patient below.
                    </p>
                    <ul>
                        {danglingSets.map((set) => (
                            <li key={set.aligner_set_id}>
                                <span>
                                    {formatSetLabel(set)} <span className={styles.dateText}>(Archform #{set.archform_id})</span>
                                </span>
                                <button
                                    type="button"
                                    className={styles.btnUnmatch}
                                    onClick={() => void handleUnmatch(-set.aligner_set_id, set.aligner_set_id)}
                                    disabled={savingRows.has(-set.aligner_set_id)}
                                >
                                    <i
                                        className={savingRows.has(-set.aligner_set_id) ? 'fas fa-spinner fa-spin' : 'fas fa-unlink'}
                                        aria-hidden="true"
                                    ></i>{' '}
                                    Unmatch
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* Table */}
            {filteredPatients.length === 0 ? (
                <div className={styles.emptyState}>
                    <i className="fas fa-inbox" aria-hidden="true"></i>
                    <h3>{filter || filterMode !== 'all' ? 'No matching patients found' : 'No Archform patients'}</h3>
                </div>
            ) : (
                <div className={styles.tableContainer}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">ID</th>
                                {renderSortableHeader('Name', 'Name')}
                                {renderSortableHeader('Created', 'CreatedDate')}
                                {renderSortableHeader('Modified', 'LastModifiedDate')}
                                <th scope="col">Matched Set</th>
                                <th scope="col">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPatients.map((patient) => {
                                const matchedSet = archformToSet.get(patient.Id) ?? null;
                                const isSaving = savingRows.has(patient.Id);
                                const isEditing = editingPatientId === patient.Id;
                                const isPicking = pickingFor === patient.Id;

                                return (
                                    <tr key={patient.Id} className={matchedSet ? styles.matchedRow : undefined}>
                                        <td data-label="ID">{patient.Id}</td>
                                        <td data-label="Name">
                                            {isEditing ? (
                                                <div className={styles.editInputGroup}>
                                                    <input
                                                        type="text"
                                                        className={styles.editInput}
                                                        value={editName}
                                                        onChange={(e) => setEditName(e.target.value)}
                                                        onKeyDown={editKeys(patient.Id)}
                                                        aria-label="First name"
                                                        placeholder="First name"
                                                        disabled={editSaving}
                                                    />
                                                    <input
                                                        type="text"
                                                        className={styles.editInput}
                                                        value={editLastName}
                                                        onChange={(e) => setEditLastName(e.target.value)}
                                                        onKeyDown={editKeys(patient.Id)}
                                                        aria-label="Last name"
                                                        placeholder="Last name"
                                                        disabled={editSaving}
                                                    />
                                                    <button
                                                        type="button"
                                                        className={styles.btnSaveEdit}
                                                        onClick={() => void handleSaveEdit(patient.Id)}
                                                        disabled={editSaving}
                                                        aria-label="Save the name"
                                                    >
                                                        <i className={editSaving ? 'fas fa-spinner fa-spin' : 'fas fa-check'} aria-hidden="true"></i>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.btnCancelEdit}
                                                        onClick={handleCancelEdit}
                                                        disabled={editSaving}
                                                        aria-label="Cancel"
                                                    >
                                                        <i className="fas fa-times" aria-hidden="true"></i>
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className={styles.nameCell}>
                                                    <span className={styles.archformName}>
                                                        {patient.Name} {patient.LastName}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className={styles.btnEdit}
                                                        onClick={() => handleStartEdit(patient)}
                                                        title="Edit name"
                                                        aria-label={`Edit the name of ${patient.Name} ${patient.LastName}`}
                                                    >
                                                        <i className="fas fa-pencil-alt" aria-hidden="true"></i>
                                                    </button>
                                                    {matchedSet && (
                                                        <button
                                                            type="button"
                                                            className={styles.btnAutoRename}
                                                            onClick={() => void handleAutoRename(patient, matchedSet)}
                                                            disabled={editSaving}
                                                            title={
                                                                isEnglishName(matchedSet.first_name) && isEnglishName(matchedSet.last_name)
                                                                    ? `Auto-rename to: ${matchedSet.first_name} ${matchedSet.last_name} | ${archformLastName(matchedSet)}`
                                                                    : 'No English name available'
                                                            }
                                                            aria-label="Rename from the matched patient"
                                                        >
                                                            <i className="fas fa-magic" aria-hidden="true"></i>
                                                        </button>
                                                    )}
                                                </span>
                                            )}
                                        </td>
                                        <td data-label="Created">
                                            <span className={styles.dateText}>{formatDate(patient.CreatedDate)}</span>
                                        </td>
                                        <td data-label="Modified">
                                            <span className={styles.dateText}>{formatDate(patient.LastModifiedDate)}</span>
                                        </td>
                                        <td data-label="Matched Set">
                                            {matchedSet ? (
                                                <span className={styles.matchedLabel}>
                                                    <i className="fas fa-check-circle" aria-hidden="true"></i> {formatSetLabel(matchedSet)}
                                                </span>
                                            ) : isPicking ? (
                                                <Select<SetOption, false>
                                                    aria-label={`Aligner set for ${patient.Name} ${patient.LastName}`}
                                                    value={(pickedSetId && setOptions.find((o) => o.value === pickedSetId)) || null}
                                                    onChange={(option: SingleValue<SetOption>) => setPickedSetId(option ? option.value : null)}
                                                    options={setOptions}
                                                    isSearchable
                                                    isClearable
                                                    isDisabled={isSaving}
                                                    // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the row's own "Choose set…" button; focus moves to the picker it opened
                                                    autoFocus
                                                    openMenuOnFocus
                                                    placeholder="Search set..."
                                                    noOptionsMessage={() => 'No sets found'}
                                                    classNamePrefix="react-select"
                                                    styles={setSelectStyles}
                                                    menuPortalTarget={document.body}
                                                    menuPlacement="auto"
                                                />
                                            ) : (
                                                <button
                                                    type="button"
                                                    className={styles.btnSave}
                                                    onClick={() => {
                                                        setPickingFor(patient.Id);
                                                        setPickedSetId(null);
                                                    }}
                                                >
                                                    <i className="fas fa-search" aria-hidden="true"></i> Choose set…
                                                </button>
                                            )}
                                        </td>
                                        <td data-label="Action">
                                            <div className={styles.actions}>
                                                {matchedSet ? (
                                                    <button
                                                        type="button"
                                                        className={styles.btnUnmatch}
                                                        onClick={() => void handleUnmatch(patient.Id, matchedSet.aligner_set_id)}
                                                        disabled={isSaving}
                                                    >
                                                        <i className={isSaving ? 'fas fa-spinner fa-spin' : 'fas fa-unlink'} aria-hidden="true"></i> Unmatch
                                                    </button>
                                                ) : isPicking ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            className={styles.btnSave}
                                                            onClick={() => void handleSave(patient.Id)}
                                                            disabled={!pickedSetId || isSaving}
                                                        >
                                                            <i className={isSaving ? 'fas fa-spinner fa-spin' : 'fas fa-link'} aria-hidden="true"></i> Match
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={styles.btnCancelEdit}
                                                            onClick={() => setPickingFor(null)}
                                                            disabled={isSaving}
                                                            aria-label="Cancel"
                                                        >
                                                            <i className="fas fa-times" aria-hidden="true"></i>
                                                        </button>
                                                    </>
                                                ) : null}
                                                {matchedSet && (
                                                    <button
                                                        type="button"
                                                        className={styles.btnEditPatient}
                                                        onClick={() =>
                                                            navigate(`/patient/${matchedSet.person_id}/edit-patient`, {
                                                                state: { from: `${location.pathname}${location.search}` },
                                                            })
                                                        }
                                                        title="Edit patient info"
                                                        aria-label="Edit the matched patient"
                                                    >
                                                        <i className="fas fa-user-edit" aria-hidden="true"></i>
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    className={styles.btnDelete}
                                                    onClick={() => setDeleteTarget(patient)}
                                                    title="Delete patient"
                                                    aria-label={`Delete ${patient.Name} ${patient.LastName} from Archform`}
                                                >
                                                    <i className="fas fa-trash-alt" aria-hidden="true"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <ConfirmDialog
                isOpen={deleteTarget !== null}
                title="Delete Archform Patient"
                message={
                    deleteTarget ? (
                        <>
                            Are you sure you want to permanently delete{' '}
                            <strong>
                                {deleteTarget.Name} {deleteTarget.LastName}
                            </strong>
                            ? This will remove the patient from Archform and clear any aligner set matches. This action cannot be
                            undone.
                        </>
                    ) : (
                        ''
                    )
                }
                confirmText="Delete"
                onConfirm={handleDeleteConfirm}
                onCancel={() => setDeleteTarget(null)}
                isDangerous
            />
        </>
    );
};

export default ArchformMatcher;
