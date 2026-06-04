// ArchformMatcher.tsx - Match Archform patients to aligner sets
import { useState, useEffect, useCallback, useMemo, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Select, { type SingleValue, type StylesConfig } from 'react-select';
import { useToast } from '../../contexts/ToastContext';
import ConfirmDialog from '../../components/react/ConfirmDialog';
import { fetchJSON, putJSON, patchJSON, deleteJSON, httpErrorMessage, type HttpError } from '@/core/http';
import type { ArchformPatient, AlignerSetForMatch } from './aligner.types';
import styles from './ArchformMatcher.module.css';

interface SetOption {
    value: number;
    label: string;
    isDisabled: boolean;
}

const setSelectStyles: StylesConfig<SetOption, false> = {
    control: (provided) => ({
        ...provided,
        minHeight: '34px',
        fontSize: '0.85rem',
        minWidth: '220px',
    }),
    menu: (provided) => ({
        ...provided,
        zIndex: 9999,
        fontSize: '0.85rem',
    }),
    option: (provided, state) => ({
        ...provided,
        backgroundColor: state.isDisabled
            ? '#f5f5f5'
            : state.isSelected
              ? 'var(--primary-color)'
              : state.isFocused
                ? 'var(--primary-100)'
                : 'white',
        color: state.isDisabled ? '#aaa' : state.isSelected ? 'white' : '#333',
        padding: '6px 10px',
    }),
    placeholder: (provided) => ({
        ...provided,
        color: '#999',
    }),
};

type FilterMode = 'all' | 'unmatched' | 'matched';
type SortColumn = 'Name' | 'CreatedDate' | 'LastModifiedDate';
type SortDirection = 'asc' | 'desc';

const ArchformMatcher: React.FC = () => {
    const toast = useToast();
    const navigate = useNavigate();
    const [archformPatients, setArchformPatients] = useState<ArchformPatient[]>([]);
    const [alignerSets, setAlignerSets] = useState<AlignerSetForMatch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const [dbPath, setDbPath] = useState('');
    const [filter, setFilter] = useState('');
    const [filterMode, setFilterMode] = useState<FilterMode>('all');
    // Track per-row dropdown selections: archformId -> setId (0 = no selection)
    const [selections, setSelections] = useState<Record<number, number>>({});
    const [savingRows, setSavingRows] = useState<Set<number>>(new Set());

    // Sorting state
    const [sortColumn, setSortColumn] = useState<SortColumn>('Name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

    // Edit state
    const [editingPatientId, setEditingPatientId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editLastName, setEditLastName] = useState('');
    const [editSaving, setEditSaving] = useState(false);

    // Delete state
    const [deleteTarget, setDeleteTarget] = useState<ArchformPatient | null>(null);
    const [deleting, setDeleting] = useState(false);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            setUnavailable(false);

            // /archform/matches reads Postgres, so only /archform/patients can return
            // 503 { unavailable: true } when the Archform SQLite DB is offline. That
            // rejection is now caught below (the detection moved from a body-read to the
            // catch — see audit N18). Both bodies are flat { success, patients|sets }
            // with no `data` key, so fetchJSON is a passthrough.
            const [patientsData, matchesData] = await Promise.all([
                fetchJSON<{ patients?: ArchformPatient[] }>('/api/aligner/archform/patients'),
                fetchJSON<{ sets?: AlignerSetForMatch[] }>('/api/aligner/archform/matches'),
            ]);

            setArchformPatients(patientsData.patients || []);
            setAlignerSets(matchesData.sets || []);
        } catch (err) {
            // 503 { unavailable: true } = Archform DB offline (a normal, expected state).
            const data = (err as HttpError).data as
                | { unavailable?: boolean; path?: string }
                | undefined;
            if (data?.unavailable) {
                setUnavailable(true);
                setDbPath(data.path || '');
                return;
            }
            const msg = httpErrorMessage(err, 'Failed to load Archform data');
            setError(msg);
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Build a map of archformId -> setId from current aligner set data
    const getArchformToSetMap = (): Map<number, number> => {
        const map = new Map<number, number>();
        for (const set of alignerSets) {
            if (set.archform_id != null) {
                map.set(set.archform_id, set.aligner_set_id);
            }
        }
        return map;
    };

    // Build a set of setIds that are already matched to any archform patient
    const getMatchedSetIds = (): Set<number> => {
        const matched = new Set<number>();
        for (const set of alignerSets) {
            if (set.archform_id != null) {
                matched.add(set.aligner_set_id);
            }
        }
        return matched;
    };

    const formatSetLabel = (set: AlignerSetForMatch): string => {
        const parts = [set.patient_name];
        if (set.set_sequence != null) parts.push(`Set ${set.set_sequence}`);
        if (set.doctor_name) parts.push(`Dr. ${set.doctor_name}`);
        return parts.join(' - ');
    };

    const setOptions = useMemo((): SetOption[] => {
        const matched = getMatchedSetIds();
        return alignerSets.map((set) => ({
            value: set.aligner_set_id,
            label: formatSetLabel(set),
            isDisabled: matched.has(set.aligner_set_id),
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [alignerSets]);

    const formatDate = (dateString: string | null): string => {
        if (!dateString) return '';
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    };

    const handleSelectionChange = (archformId: number, option: SingleValue<SetOption>): void => {
        setSelections((prev) => ({
            ...prev,
            [archformId]: option ? option.value : 0,
        }));
    };

    const handleSave = async (archformId: number): Promise<void> => {
        const selectedSetId = selections[archformId];
        if (!selectedSetId) return;

        setSavingRows((prev) => new Set(prev).add(archformId));

        try {
            // Non-2xx throws; success body is { success:true, message }.
            await patchJSON(`/api/aligner/sets/${selectedSetId}/archform`, { archformId });

            toast.success('Match saved');
            setAlignerSets((prev) =>
                prev.map((s) =>
                    s.aligner_set_id === selectedSetId
                        ? { ...s, archform_id: archformId }
                        : s
                )
            );
            setSelections((prev) => {
                const next = { ...prev };
                delete next[archformId];
                return next;
            });
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to save match'));
        } finally {
            setSavingRows((prev) => {
                const next = new Set(prev);
                next.delete(archformId);
                return next;
            });
        }
    };

    const handleUnmatch = async (
        archformId: number,
        setId: number
    ): Promise<void> => {
        setSavingRows((prev) => new Set(prev).add(archformId));

        try {
            // Non-2xx throws; success body is { success:true, message }.
            await patchJSON(`/api/aligner/sets/${setId}/archform`, { archformId: null });

            toast.success('Match removed');
            setAlignerSets((prev) =>
                prev.map((s) =>
                    s.aligner_set_id === setId ? { ...s, archform_id: null } : s
                )
            );
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to remove match'));
        } finally {
            setSavingRows((prev) => {
                const next = new Set(prev);
                next.delete(archformId);
                return next;
            });
        }
    };

    // ========== SORTING ==========

    const handleSort = (column: SortColumn): void => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const sortPatients = (patients: ArchformPatient[]): ArchformPatient[] => {
        return [...patients].sort((a, b) => {
            let aVal: string | number | null;
            let bVal: string | number | null;

            if (sortColumn === 'Name') {
                aVal = `${a.LastName}`.toLowerCase();
                bVal = `${b.LastName}`.toLowerCase();
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
    };

    const renderSortableHeader = (label: string, column: SortColumn): ReactNode => (
        <th
            onClick={() => handleSort(column)}
            className={styles.sortableHeader}
        >
            <span>{label}</span>
            <span className={styles.sortIcon}>
                {sortColumn === column ? (
                    sortDirection === 'asc' ? (
                        <i className="fas fa-sort-up"></i>
                    ) : (
                        <i className="fas fa-sort-down"></i>
                    )
                ) : (
                    <i className="fas fa-sort"></i>
                )}
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

    const handleSaveEdit = async (id: number): Promise<void> => {
        if (!editName.trim() || !editLastName.trim()) {
            toast.warning('Name and last name are required');
            return;
        }

        setEditSaving(true);
        try {
            // Non-2xx throws; success body is { success:true, message }.
            await putJSON(`/api/aligner/archform/patients/${id}`, {
                name: editName.trim(),
                lastName: editLastName.trim(),
            });

            toast.success('Patient name updated');
            setArchformPatients((prev) =>
                prev.map((p) =>
                    p.Id === id
                        ? { ...p, Name: editName.trim(), LastName: editLastName.trim() }
                        : p
                )
            );
            handleCancelEdit();
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to update patient'));
        } finally {
            setEditSaving(false);
        }
    };

    // ========== AUTO-RENAME ==========

    /** Check if a string contains at least one Latin/English letter */
    const isEnglishName = (str: string | null | undefined): boolean => {
        if (!str || !str.trim()) return false;
        return /[a-zA-Z]/.test(str);
    };

    const handleAutoRename = async (patient: ArchformPatient, set: AlignerSetForMatch): Promise<void> => {
        const firstName = set.first_name?.trim();
        const lastName = set.last_name?.trim();

        // Validate English name fields exist and contain Latin characters
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
        const doctorName = set.doctor_name?.trim() || 'Unknown';
        const newLastName = `Dr_${doctorName}_${set.set_sequence ?? 0}`;

        setEditSaving(true);
        try {
            // Non-2xx throws; success body is { success:true, message }.
            await putJSON(`/api/aligner/archform/patients/${patient.Id}`, {
                name: newName,
                lastName: newLastName,
            });

            toast.success(`Renamed to ${newName} ${newLastName}`);
            setArchformPatients((prev) =>
                prev.map((p) =>
                    p.Id === patient.Id
                        ? { ...p, Name: newName, LastName: newLastName }
                        : p
                )
            );
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to auto-rename patient'));
        } finally {
            setEditSaving(false);
        }
    };

    // ========== DELETE ==========

    const handleDeleteClick = (patient: ArchformPatient): void => {
        setDeleteTarget(patient);
    };

    const handleDeleteConfirm = async (): Promise<void> => {
        if (!deleteTarget) return;

        setDeleting(true);
        try {
            // Non-2xx throws; success body is { success:true, message }.
            await deleteJSON(`/api/aligner/archform/patients/${deleteTarget.Id}`);

            toast.success(`Deleted ${deleteTarget.LastName}`);

            // Remove patient from local state
            setArchformPatients((prev) => prev.filter((p) => p.Id !== deleteTarget.Id));

            // Clear any ArchformID matches referencing this patient
            setAlignerSets((prev) =>
                prev.map((s) =>
                    s.archform_id === deleteTarget.Id ? { ...s, archform_id: null } : s
                )
            );

            setDeleteTarget(null);
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to delete patient'));
        } finally {
            setDeleting(false);
        }
    };

    // Filter patients
    const getFilteredPatients = (): ArchformPatient[] => {
        const archformToSet = getArchformToSetMap();
        let filtered = archformPatients;

        // Filter by match status
        if (filterMode === 'matched') {
            filtered = filtered.filter((p) => archformToSet.has(p.Id));
        } else if (filterMode === 'unmatched') {
            filtered = filtered.filter((p) => !archformToSet.has(p.Id));
        }

        // Filter by search text
        if (filter.trim()) {
            const query = filter.toLowerCase();
            filtered = filtered.filter((p) => {
                const fullName =
                    `${p.LastName}`.toLowerCase();
                return fullName.includes(query);
            });
        }

        return filtered;
    };

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <p>Loading Archform data...</p>
            </div>
        );
    }

    if (unavailable) {
        return (
            <div className={styles.unavailableState}>
                <i className="fas fa-database"></i>
                <h3>Archform Database Unavailable</h3>
                <p>Cannot access the Archform database at:</p>
                <code className={styles.dbPathCode}>{dbPath}</code>
                <p>
                    Ensure the file is shared and accessible from the server,
                    or update the path in General Settings (ARCHFORM_DB_PATH).
                </p>
                <button className={styles.btnRetry} onClick={loadData}>
                    <i className="fas fa-redo"></i> Retry
                </button>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorState}>
                <i className="fas fa-exclamation-triangle"></i>
                <h3>Failed to load data</h3>
                <p>{error}</p>
                <button className={styles.btnRetry} onClick={loadData}>
                    <i className="fas fa-redo"></i> Retry
                </button>
            </div>
        );
    }

    const archformToSet = getArchformToSetMap();
    const filteredPatients = sortPatients(getFilteredPatients());
    const matchedCount = archformPatients.filter((p) =>
        archformToSet.has(p.Id)
    ).length;
    const unmatchedCount = archformPatients.length - matchedCount;

    return (
        <>
            {/* Filter Controls */}
            <div className={styles.filterContainer}>
                <div className={styles.searchBox}>
                    <i className={`fas fa-filter ${styles.filterIcon}`}></i>
                    <input
                        type="text"
                        placeholder="Filter by Archform patient name..."
                        value={filter}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            setFilter(e.target.value)
                        }
                    />
                    {filter && (
                        <button
                            className={styles.clearFilterBtn}
                            onClick={() => setFilter('')}
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>

                <div className={styles.filterToggles}>
                    <label
                        className={`${styles.filterToggle} ${filterMode === 'unmatched' ? styles.active : ''}`}
                    >
                        <input
                            type="checkbox"
                            checked={filterMode === 'unmatched'}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                setFilterMode(
                                    e.target.checked ? 'unmatched' : 'all'
                                )
                            }
                        />
                        <i className="fas fa-unlink"></i>
                        <span>Unmatched ({unmatchedCount})</span>
                    </label>
                    <label
                        className={`${styles.filterToggle} ${filterMode === 'matched' ? styles.active : ''}`}
                    >
                        <input
                            type="checkbox"
                            checked={filterMode === 'matched'}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                setFilterMode(
                                    e.target.checked ? 'matched' : 'all'
                                )
                            }
                        />
                        <i className="fas fa-link"></i>
                        <span>Matched ({matchedCount})</span>
                    </label>
                </div>
            </div>

            {/* Stats */}
            <div className={styles.statsBar}>
                <strong>{archformPatients.length}</strong> Archform patients
                &middot;
                <strong>{matchedCount}</strong> matched &middot;
                <strong>{unmatchedCount}</strong> unmatched &middot;
                <strong>{alignerSets.length}</strong> aligner sets &middot;
                Showing <strong>{filteredPatients.length}</strong>
            </div>

            {/* Table */}
            {filteredPatients.length === 0 ? (
                <div className={styles.emptyState}>
                    <i className="fas fa-inbox"></i>
                    <h3>
                        {filter || filterMode !== 'all'
                            ? 'No matching patients found'
                            : 'No Archform patients'}
                    </h3>
                </div>
            ) : (
                <div className={styles.tableContainer}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>ID</th>
                                {renderSortableHeader('Name', 'Name')}
                                {renderSortableHeader('Created', 'CreatedDate')}
                                {renderSortableHeader('Modified', 'LastModifiedDate')}
                                <th>Matched Set</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPatients.map((patient) => {
                                const matchedSetId = archformToSet.get(
                                    patient.Id
                                );
                                const isMatched = matchedSetId != null;
                                const isSaving = savingRows.has(patient.Id);
                                const currentSelection =
                                    selections[patient.Id];
                                const isEditing = editingPatientId === patient.Id;

                                // Find matched set details for display
                                const matchedSet = isMatched
                                    ? alignerSets.find(
                                          (s) =>
                                              s.aligner_set_id === matchedSetId
                                      )
                                    : null;

                                return (
                                    <tr
                                        key={patient.Id}
                                        className={
                                            isMatched
                                                ? styles.matchedRow
                                                : undefined
                                        }
                                    >
                                        <td data-label="ID">{patient.Id}</td>
                                        <td data-label="Name">
                                            {isEditing ? (
                                                <div className={styles.editInputGroup}>
                                                    <input
                                                        type="text"
                                                        className={styles.editInput}
                                                        value={editName}
                                                        onChange={(e) => setEditName(e.target.value)}
                                                        placeholder="First name"
                                                        disabled={editSaving}
                                                    />
                                                    <input
                                                        type="text"
                                                        className={styles.editInput}
                                                        value={editLastName}
                                                        onChange={(e) => setEditLastName(e.target.value)}
                                                        placeholder="Last name"
                                                        disabled={editSaving}
                                                    />
                                                    <button
                                                        className={styles.btnSaveEdit}
                                                        onClick={() => handleSaveEdit(patient.Id)}
                                                        disabled={editSaving}
                                                    >
                                                        {editSaving ? (
                                                            <i className="fas fa-spinner fa-spin"></i>
                                                        ) : (
                                                            <i className="fas fa-check"></i>
                                                        )}
                                                    </button>
                                                    <button
                                                        className={styles.btnCancelEdit}
                                                        onClick={handleCancelEdit}
                                                        disabled={editSaving}
                                                    >
                                                        <i className="fas fa-times"></i>
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className={styles.nameCell}>
                                                    <span className={styles.archformName}>
                                                        {patient.LastName}
                                                    </span>
                                                    <button
                                                        className={styles.btnEdit}
                                                        onClick={() => handleStartEdit(patient)}
                                                        title="Edit name"
                                                    >
                                                        <i className="fas fa-pencil-alt"></i>
                                                    </button>
                                                    {matchedSet && (
                                                        <button
                                                            className={styles.btnAutoRename}
                                                            onClick={() => handleAutoRename(patient, matchedSet)}
                                                            disabled={editSaving}
                                                            title={
                                                                isEnglishName(matchedSet.first_name) && isEnglishName(matchedSet.last_name)
                                                                    ? `Auto-rename to: ${matchedSet.first_name} ${matchedSet.last_name} | Dr_${matchedSet.doctor_name}_${matchedSet.set_sequence ?? 0}`
                                                                    : 'No English name available'
                                                            }
                                                        >
                                                            <i className="fas fa-magic"></i>
                                                        </button>
                                                    )}
                                                </span>
                                            )}
                                        </td>
                                        <td data-label="Created">
                                            <span className={styles.dateText}>
                                                {formatDate(patient.CreatedDate)}
                                            </span>
                                        </td>
                                        <td data-label="Modified">
                                            <span className={styles.dateText}>
                                                {formatDate(patient.LastModifiedDate)}
                                            </span>
                                        </td>
                                        <td data-label="Matched Set">
                                            {isMatched && matchedSet ? (
                                                <span
                                                    className={
                                                        styles.matchedLabel
                                                    }
                                                >
                                                    <i className="fas fa-check-circle"></i>{' '}
                                                    {formatSetLabel(
                                                        matchedSet
                                                    )}
                                                </span>
                                            ) : (
                                                <Select<SetOption, false>
                                                    value={setOptions.find((o) => o.value === currentSelection) || null}
                                                    onChange={(option) => handleSelectionChange(patient.Id, option)}
                                                    options={setOptions}
                                                    isSearchable={true}
                                                    isClearable={true}
                                                    isDisabled={isSaving}
                                                    placeholder="Search set..."
                                                    noOptionsMessage={() => 'No sets found'}
                                                    styles={setSelectStyles}
                                                    menuPortalTarget={document.body}
                                                    menuPlacement="auto"
                                                />
                                            )}
                                        </td>
                                        <td data-label="Action">
                                            <div className={styles.actions}>
                                                {isMatched ? (
                                                    <button
                                                        className={
                                                            styles.btnUnmatch
                                                        }
                                                        onClick={() =>
                                                            handleUnmatch(
                                                                patient.Id,
                                                                matchedSetId!
                                                            )
                                                        }
                                                        disabled={isSaving}
                                                    >
                                                        {isSaving ? (
                                                            <i className="fas fa-spinner fa-spin"></i>
                                                        ) : (
                                                            <>
                                                                <i className="fas fa-unlink"></i>{' '}
                                                                Unmatch
                                                            </>
                                                        )}
                                                    </button>
                                                ) : (
                                                    <button
                                                        className={
                                                            styles.btnSave
                                                        }
                                                        onClick={() =>
                                                            handleSave(
                                                                patient.Id
                                                            )
                                                        }
                                                        disabled={
                                                            !currentSelection ||
                                                            isSaving
                                                        }
                                                    >
                                                        {isSaving ? (
                                                            <i className="fas fa-spinner fa-spin"></i>
                                                        ) : (
                                                            <>
                                                                <i className="fas fa-link"></i>{' '}
                                                                Match
                                                            </>
                                                        )}
                                                    </button>
                                                )}
                                                {matchedSet && (
                                                    <button
                                                        className={styles.btnEditPatient}
                                                        onClick={() => navigate(`/patient/${matchedSet.person_id}/edit-patient`)}
                                                        title="Edit patient info"
                                                    >
                                                        <i className="fas fa-user-edit"></i>
                                                    </button>
                                                )}
                                                <button
                                                    className={styles.btnDelete}
                                                    onClick={() => handleDeleteClick(patient)}
                                                    title="Delete patient"
                                                >
                                                    <i className="fas fa-trash-alt"></i>
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

            {/* Delete Confirmation Dialog */}
            <ConfirmDialog
                isOpen={deleteTarget !== null}
                title="Delete Archform Patient"
                message={
                    deleteTarget ? (
                        <>
                            Are you sure you want to permanently delete{' '}
                            <strong>{deleteTarget.LastName}</strong>?
                            This will remove the patient from Archform and clear any aligner set matches.
                            This action cannot be undone.
                        </>
                    ) : ''
                }
                confirmText={deleting ? 'Deleting...' : 'Delete'}
                onConfirm={handleDeleteConfirm}
                onCancel={() => setDeleteTarget(null)}
                isDangerous
            />
        </>
    );
};

export default ArchformMatcher;
