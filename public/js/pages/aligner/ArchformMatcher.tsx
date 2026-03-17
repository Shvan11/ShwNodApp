// ArchformMatcher.tsx - Match Archform patients to aligner sets
import { useState, useEffect, useCallback, type ChangeEvent, type ReactNode } from 'react';
import { useToast } from '../../contexts/ToastContext';
import ConfirmDialog from '../../components/react/ConfirmDialog';
import type { ArchformPatient, AlignerSetForMatch } from './aligner.types';
import styles from './ArchformMatcher.module.css';

type FilterMode = 'all' | 'unmatched' | 'matched';
type SortColumn = 'Name' | 'CreatedDate' | 'LastModifiedDate';
type SortDirection = 'asc' | 'desc';

const ArchformMatcher: React.FC = () => {
    const toast = useToast();
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

            const [patientsRes, matchesRes] = await Promise.all([
                fetch('/api/aligner/archform/patients'),
                fetch('/api/aligner/archform/matches'),
            ]);

            const patientsData = await patientsRes.json();
            const matchesData = await matchesRes.json();

            // Handle Archform DB unavailable
            if (patientsData.unavailable) {
                setUnavailable(true);
                setDbPath(patientsData.path || '');
                return;
            }

            if (!patientsData.success) {
                throw new Error(patientsData.error || 'Failed to fetch Archform patients');
            }
            if (!matchesData.success) {
                throw new Error(matchesData.error || 'Failed to fetch aligner sets');
            }

            setArchformPatients(patientsData.patients || []);
            setAlignerSets(matchesData.sets || []);
        } catch (err) {
            const msg = (err as Error).message;
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
            if (set.ArchformID != null) {
                map.set(set.ArchformID, set.AlignerSetID);
            }
        }
        return map;
    };

    // Build a set of setIds that are already matched to any archform patient
    const getMatchedSetIds = (): Set<number> => {
        const matched = new Set<number>();
        for (const set of alignerSets) {
            if (set.ArchformID != null) {
                matched.add(set.AlignerSetID);
            }
        }
        return matched;
    };

    const formatSetLabel = (set: AlignerSetForMatch): string => {
        const parts = [set.PatientName];
        if (set.SetSequence != null) parts.push(`Set ${set.SetSequence}`);
        if (set.DoctorName) parts.push(`Dr. ${set.DoctorName}`);
        return parts.join(' - ');
    };

    const formatDate = (dateString: string | null): string => {
        if (!dateString) return '';
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    };

    const handleSelectionChange = (archformId: number, value: string): void => {
        const numVal = value === '' ? 0 : parseInt(value, 10);
        setSelections((prev) => ({
            ...prev,
            [archformId]: numVal,
        }));
    };

    const handleSave = async (archformId: number): Promise<void> => {
        const selectedSetId = selections[archformId];
        if (!selectedSetId) return;

        setSavingRows((prev) => new Set(prev).add(archformId));

        try {
            const res = await fetch(
                `/api/aligner/sets/${selectedSetId}/archform`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ archformId }),
                }
            );
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to save match');
            }

            toast.success('Match saved');
            setAlignerSets((prev) =>
                prev.map((s) =>
                    s.AlignerSetID === selectedSetId
                        ? { ...s, ArchformID: archformId }
                        : s
                )
            );
            setSelections((prev) => {
                const next = { ...prev };
                delete next[archformId];
                return next;
            });
        } catch (err) {
            toast.error((err as Error).message);
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
            const res = await fetch(`/api/aligner/sets/${setId}/archform`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ archformId: null }),
            });
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to remove match');
            }

            toast.success('Match removed');
            setAlignerSets((prev) =>
                prev.map((s) =>
                    s.AlignerSetID === setId ? { ...s, ArchformID: null } : s
                )
            );
        } catch (err) {
            toast.error((err as Error).message);
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
            const res = await fetch(`/api/aligner/archform/patients/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editName.trim(), lastName: editLastName.trim() }),
            });
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to update patient');
            }

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
            toast.error((err as Error).message);
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
        const firstName = set.FirstName?.trim();
        const lastName = set.LastName?.trim();

        // Validate English name fields exist and contain Latin characters
        if (!isEnglishName(firstName) && !isEnglishName(lastName)) {
            toast.warning(
                `Cannot auto-rename: "${set.PatientName}" has no English first/last name in the database. Use the edit button to rename manually.`
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
        const doctorName = set.DoctorName?.trim() || 'Unknown';
        const newLastName = `Dr_${doctorName}_${set.SetSequence ?? 0}`;

        setEditSaving(true);
        try {
            const res = await fetch(`/api/aligner/archform/patients/${patient.Id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName, lastName: newLastName }),
            });
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to auto-rename patient');
            }

            toast.success(`Renamed to ${newName} ${newLastName}`);
            setArchformPatients((prev) =>
                prev.map((p) =>
                    p.Id === patient.Id
                        ? { ...p, Name: newName, LastName: newLastName }
                        : p
                )
            );
        } catch (err) {
            toast.error((err as Error).message);
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
            const res = await fetch(`/api/aligner/archform/patients/${deleteTarget.Id}`, {
                method: 'DELETE',
            });
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to delete patient');
            }

            toast.success(`Deleted ${deleteTarget.Name} ${deleteTarget.LastName}`);

            // Remove patient from local state
            setArchformPatients((prev) => prev.filter((p) => p.Id !== deleteTarget.Id));

            // Clear any ArchformID matches referencing this patient
            setAlignerSets((prev) =>
                prev.map((s) =>
                    s.ArchformID === deleteTarget.Id ? { ...s, ArchformID: null } : s
                )
            );

            setDeleteTarget(null);
        } catch (err) {
            toast.error((err as Error).message);
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
                    `${p.Name} ${p.LastName}`.toLowerCase();
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
    const matchedSetIds = getMatchedSetIds();
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
                                              s.AlignerSetID === matchedSetId
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
                                                        {patient.Name} {patient.LastName}
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
                                                                isEnglishName(matchedSet.FirstName) && isEnglishName(matchedSet.LastName)
                                                                    ? `Auto-rename to: ${matchedSet.FirstName} ${matchedSet.LastName} | Dr_${matchedSet.DoctorName}_${matchedSet.SetSequence ?? 0}`
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
                                                <select
                                                    className={
                                                        styles.matchSelect
                                                    }
                                                    value={
                                                        currentSelection || ''
                                                    }
                                                    onChange={(e) =>
                                                        handleSelectionChange(
                                                            patient.Id,
                                                            e.target.value
                                                        )
                                                    }
                                                    disabled={isSaving}
                                                >
                                                    <option value="">
                                                        -- Select set --
                                                    </option>
                                                    {alignerSets.map(
                                                        (set) => {
                                                            const isUsed =
                                                                matchedSetIds.has(
                                                                    set.AlignerSetID
                                                                );
                                                            return (
                                                                <option
                                                                    key={
                                                                        set.AlignerSetID
                                                                    }
                                                                    value={
                                                                        set.AlignerSetID
                                                                    }
                                                                    disabled={
                                                                        isUsed
                                                                    }
                                                                >
                                                                    {formatSetLabel(
                                                                        set
                                                                    )}
                                                                    {isUsed
                                                                        ? ' (matched)'
                                                                        : ''}
                                                                </option>
                                                            );
                                                        }
                                                    )}
                                                </select>
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
                            <strong>{deleteTarget.Name} {deleteTarget.LastName}</strong>?
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
