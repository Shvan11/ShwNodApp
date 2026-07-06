// AllSetsList.tsx - Simple list view of all aligner sets from v_allsets
import React, { useEffect, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import { alignerAllSetsQuery } from '@/query/queries';
import { isClosedWorkStatus } from '@shared/contracts/aligner.contract';
import type * as alignerContract from '@shared/contracts/aligner.contract';
import styles from './AllSetsList.module.css';

// Row shape comes from the shared contract (single source of truth, drift-checked
// against the schema the all-sets read validates with). The validated read
// guarantees `is_last`/`SetIsActive`/`NextBatchPresent` are booleans.
type AlignerSetView = alignerContract.AlignerSetView;

const SORT_COLUMNS = [
    'patient_name',
    'doctor_name',
    'set_sequence',
    'batch_sequence',
    'LabStatus',
    'NextDueDate',
    'NextAppointment',
    'notes',
] as const;
type SortColumn = (typeof SORT_COLUMNS)[number];
type SortDirection = 'asc' | 'desc';

/** One place decides what the "Next Batch Status" badge means, so the badge and
 *  the legend counts can never disagree. */
type NextBatchState = 'no_batches' | 'final' | 'ready' | 'pending' | 'not_created';
const getNextBatchState = (set: AlignerSetView): NextBatchState => {
    if (set.LabStatus === 'no_batches') return 'no_batches';
    // Final batch delivered = treatment complete (flag shown in Active Batch column)
    if (set.is_last === true && set.delivered_to_patient_date) return 'final';
    if (set.NextBatchPresent) return 'ready';
    if (set.LabStatus === 'needs_mfg') return 'pending';
    return 'not_created';
};

const formatDate = (dateString: string): string => {
    // Date-only strings must not round-trip through Date: new Date('YYYY-MM-DD')
    // parses as UTC midnight, so local getters render a day early west of UTC.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
    if (dateOnly) return `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`;
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}-${month}-${date.getFullYear()}`;
};

const AllSetsList: React.FC = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const { data, isLoading: loading, error, refetch } = useQuery(alignerAllSetsQuery());
    const sets: AlignerSetView[] = data?.sets ?? [];

    // Filters + sort live in the URL so they survive navigating to a patient and
    // back, and a filtered view can be bookmarked. Defaults are unset params.
    const [searchParams, setSearchParams] = useSearchParams();
    const filter = searchParams.get('q') ?? '';
    const selectedDoctor = searchParams.get('dr') ?? 'all';
    const showOnlyNoNextBatch = searchParams.get('noNext') === '1';
    const showOnlyInLab = searchParams.get('lab') === '1';
    const showOnlyNeedsMfg = searchParams.get('mfg') === '1';
    const showFinished = searchParams.get('finished') === '1';
    const showInactiveSets = searchParams.get('inactive') === '1';
    const rawSort = searchParams.get('sort') as SortColumn | null;
    const sortColumn: SortColumn = rawSort && SORT_COLUMNS.includes(rawSort) ? rawSort : 'NextDueDate';
    const sortDirection: SortDirection = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';

    const updateParams = (updates: Record<string, string | null>): void => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                for (const [key, value] of Object.entries(updates)) {
                    if (value === null || value === '') next.delete(key);
                    else next.set(key, value);
                }
                return next;
            },
            { replace: true }
        );
    };

    // Surface a load failure as a toast (preserves the previous on-error UX).
    useEffect(() => {
        if (error) {
            toast.error(httpErrorMessage(error, 'Failed to load aligner sets'));
        }
    }, [error, toast]);

    const handlePatientClick = (set: AlignerSetView): void => {
        // Navigate to patient's aligner management page
        navigate(`/aligner/patient/${set.work_id}`);
    };

    // Render the patient's next scheduled appointment (highlights today's)
    const renderNextAppointment = (set: AlignerSetView): ReactNode => {
        if (!set.NextAppointment) {
            return <span className={styles.notesEmpty}>—</span>;
        }
        const appt = new Date(set.NextAppointment);
        const now = new Date();
        const isToday =
            appt.getFullYear() === now.getFullYear() &&
            appt.getMonth() === now.getMonth() &&
            appt.getDate() === now.getDate();
        if (isToday) {
            const time = appt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            return (
                <span className={`${styles.badge} ${styles.badgeApptToday}`}>
                    <i className="fas fa-calendar-day"></i> Today {time}
                </span>
            );
        }
        return <span>{formatDate(set.NextAppointment)}</span>;
    };

    // Check if patient is waiting for next batch (previously delivered, but no next batch)
    const isWaitingForNextBatch = (set: AlignerSetView): boolean => {
        return !set.NextBatchPresent && !!set.delivered_to_patient_date;
    };

    // Render next batch status badge (combined status + readiness)
    const renderBatchStateBadge = (set: AlignerSetView): ReactNode => {
        switch (getNextBatchState(set)) {
            case 'no_batches':
                return <span className={`${styles.badge} ${styles.badgeNoBatch}`}>No Batches</span>;
            case 'final':
                return <span className={`${styles.badge} ${styles.badgeNa}`}>—</span>;
            case 'ready':
                return (
                    <span className={`${styles.badge} ${styles.badgeNextReady}`}>
                        <i className="fas fa-check-circle"></i> Ready (In Lab)
                    </span>
                );
            case 'pending':
                return (
                    <span className={`${styles.badge} ${styles.badgePendingMfg}`}>
                        Pending (Needs Mfg)
                    </span>
                );
            case 'not_created':
                return (
                    <span className={`${styles.badge} ${styles.badgeNextWarning}`}>
                        <i className="fas fa-exclamation-triangle"></i> Not Created
                    </span>
                );
        }
    };

    const getFilteredSets = (): AlignerSetView[] => {
        let filtered = sets;

        // Filter by inactive sets (hide by default)
        if (!showInactiveSets) {
            filtered = filtered.filter(s => s.SetIsActive === true);
        }

        // Filter by finished/discontinued status (hide by default)
        if (!showFinished) {
            filtered = filtered.filter(s => !isClosedWorkStatus(s.WorkStatus));
        }

        // Filter by doctor
        if (selectedDoctor !== 'all') {
            filtered = filtered.filter(s => s.aligner_dr_id === Number(selectedDoctor));
        }

        // Filter by no next batch if toggle is on
        // IMPORTANT: Only include patients who are waiting for next batch (not initial phase)
        if (showOnlyNoNextBatch) {
            filtered = filtered.filter(s => isWaitingForNextBatch(s));
        }

        // Filter by "In Lab" (manufactured but not delivered) - use LabStatus directly
        if (showOnlyInLab) {
            filtered = filtered.filter(s => s.LabStatus === 'in_lab');
        }

        // Filter by "Needs Mfg" (needs manufacturing) - use LabStatus directly
        if (showOnlyNeedsMfg) {
            filtered = filtered.filter(s => s.LabStatus === 'needs_mfg');
        }

        // Filter by search text
        if (filter.trim()) {
            const query = filter.toLowerCase();
            filtered = filtered.filter(s => {
                const name = (s.patient_name || '').toLowerCase();
                const doctor = (s.doctor_name || '').toLowerCase();
                return name.includes(query) || doctor.includes(query);
            });
        }

        return filtered;
    };

    // Handle column header click for sorting
    const handleSort = (column: SortColumn): void => {
        if (sortColumn === column) {
            updateParams({ sort: column, dir: sortDirection === 'asc' ? 'desc' : 'asc' });
        } else {
            updateParams({ sort: column, dir: null });
        }
    };

    // Sort the filtered sets
    const sortSets = (setsToSort: AlignerSetView[]): AlignerSetView[] => {
        return [...setsToSort].sort((a, b) => {
            let aVal: string | number | null = a[sortColumn] as string | number | null;
            let bVal: string | number | null = b[sortColumn] as string | number | null;

            // Handle null/undefined values - push them to the end
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            // Handle date columns
            if (sortColumn === 'NextDueDate' || sortColumn === 'NextAppointment') {
                aVal = new Date(aVal as string).getTime();
                bVal = new Date(bVal as string).getTime();
            }
            // Handle string columns
            else if (typeof aVal === 'string') {
                aVal = aVal.toLowerCase();
                bVal = (bVal || '').toString().toLowerCase();
            }
            // Handle numeric columns
            else if (typeof aVal === 'number') {
                aVal = aVal || 0;
                bVal = (bVal as number) || 0;
            }

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    };

    // Render sortable header (keyboard-operable, announces sort state)
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

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <p>Loading aligner sets...</p>
            </div>
        );
    }

    // A failed load with nothing cached must not masquerade as an empty clinic.
    if (error && !data) {
        return (
            <div className={styles.emptyPatients}>
                <i className="fas fa-exclamation-triangle"></i>
                <h3>Failed to load aligner sets</h3>
                <p>{httpErrorMessage(error, 'Please check your connection and try again.')}</p>
                <button className={styles.btnClearFilters} onClick={() => void refetch()}>
                    Retry
                </button>
            </div>
        );
    }

    const filteredSets = sortSets(getFilteredSets());

    // Count different patient categories (excluding inactive sets and finished/discontinued if hidden)
    const baseSets = showInactiveSets ? sets : sets.filter(s => s.SetIsActive === true);
    const activeSets = showFinished ? baseSets : baseSets.filter(s => !isClosedWorkStatus(s.WorkStatus));

    // Doctor dropdown: only doctors with currently visible sets, alphabetical.
    // Keep the active selection listed even if its rows are filtered out, so the
    // select never silently shows a blank value.
    const doctorMap = new Map<number, string>();
    activeSets.forEach(set => {
        if (!doctorMap.has(set.aligner_dr_id)) {
            doctorMap.set(set.aligner_dr_id, set.doctor_name);
        }
    });
    if (selectedDoctor !== 'all' && !doctorMap.has(Number(selectedDoctor))) {
        const sel = sets.find(s => s.aligner_dr_id === Number(selectedDoctor));
        if (sel) doctorMap.set(sel.aligner_dr_id, sel.doctor_name);
    }
    const uniqueDoctors = Array.from(doctorMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    // Legend counts derive from the same state machine as the badges.
    const stateCounts: Record<NextBatchState, number> = {
        no_batches: 0, final: 0, ready: 0, pending: 0, not_created: 0,
    };
    activeSets.forEach(s => { stateCounts[getNextBatchState(s)]++; });
    const lastBatchCount = activeSets.filter(s => s.is_last === true).length;
    const finishedCount = baseSets.filter(s => isClosedWorkStatus(s.WorkStatus)).length;
    const inactiveSetsCount = sets.filter(s => s.SetIsActive !== true).length;
    const noNextBatchCount = activeSets.filter(isWaitingForNextBatch).length;
    // Toggle counts mirror their filter predicates (LabStatus), not the badge state.
    const pendingManufactureCount = activeSets.filter(s => s.LabStatus === 'needs_mfg').length;
    const pendingDeliveryCount = activeSets.filter(s => s.LabStatus === 'in_lab').length;

    return (
        <>
            {/* Filter Controls */}
            <div className={styles.filterContainer}>
                <div className={styles.patientFilterBox}>
                    <i className={`fas fa-filter ${styles.filterIcon}`}></i>
                    <input
                        type="text"
                        placeholder="Filter by patient or doctor..."
                        value={filter}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateParams({ q: e.target.value || null })}
                    />
                    {filter && (
                        <button
                            className={styles.clearFilterBtn}
                            aria-label="Clear filter"
                            onClick={() => updateParams({ q: null })}
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>

                {/* Doctor Filter Dropdown */}
                <div className={styles.doctorFilter}>
                    <select
                        value={selectedDoctor}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                            updateParams({ dr: e.target.value === 'all' ? null : e.target.value })}
                        className={styles.doctorFilterSelect}
                    >
                        <option value="all">All Doctors</option>
                        {uniqueDoctors.map(doctor => (
                            <option key={doctor.id} value={doctor.id}>
                                {doctor.name === 'Admin' ? doctor.name : `Dr. ${doctor.name}`}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Filter Toggles - wrapped for mobile grid */}
                <div className={styles.filterToggles}>
                    {/* Show Finished Toggle */}
                    <label className={`${styles.filterToggle} ${showFinished ? styles.active : ''}`}>
                        <input
                            type="checkbox"
                            checked={showFinished}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                updateParams({ finished: e.target.checked ? '1' : null })}
                        />
                        <i className="fas fa-check-circle"></i>
                        <span>Finished ({finishedCount})</span>
                    </label>

                    {/* No Next Batch Toggle */}
                    <label className={`${styles.filterToggle} ${showOnlyNoNextBatch ? styles.active : ''}`}>
                        <input
                            type="checkbox"
                            checked={showOnlyNoNextBatch}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                updateParams({ noNext: e.target.checked ? '1' : null })}
                        />
                        <i className="fas fa-exclamation-triangle"></i>
                        <span>No Next ({noNextBatchCount})</span>
                    </label>

                    {/* In Lab Filter */}
                    <label className={`${styles.filterToggle} ${showOnlyInLab ? styles.active : ''}`}>
                        <input
                            type="checkbox"
                            checked={showOnlyInLab}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                updateParams(e.target.checked ? { lab: '1', mfg: null } : { lab: null })}
                        />
                        <i className="fas fa-box"></i>
                        <span>In Lab ({pendingDeliveryCount})</span>
                    </label>

                    {/* Needs Mfg Filter */}
                    <label className={`${styles.filterToggle} ${showOnlyNeedsMfg ? styles.active : ''}`}>
                        <input
                            type="checkbox"
                            checked={showOnlyNeedsMfg}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                updateParams(e.target.checked ? { mfg: '1', lab: null } : { mfg: null })}
                        />
                        <i className="fas fa-cog"></i>
                        <span>Needs Mfg ({pendingManufactureCount})</span>
                    </label>
                </div>
            </div>

            {/* Status Legend */}
            <div className={styles.statusLegend}>
                <span className={styles.legendTitle}>Next Batch:</span>
                <span className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles.gray}`}></span> No Batches ({stateCounts.no_batches})
                </span>
                <span className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles.green}`}></span> Ready ({stateCounts.ready})
                </span>
                <span className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles.amber}`}></span> Pending ({stateCounts.pending})
                </span>
                <span className={styles.legendItem}>
                    <i className={`fas fa-flag-checkered ${styles.legendFlagFinal}`}></i> Final ({lastBatchCount})
                </span>
                <span className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles.red}`}></span> Not Created ({stateCounts.not_created})
                </span>
                {inactiveSetsCount > 0 && (
                    <label className={styles.inactiveSetsToggle}>
                        <input
                            type="checkbox"
                            checked={showInactiveSets}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                updateParams({ inactive: e.target.checked ? '1' : null })}
                        />
                        <span>Include inactive sets ({inactiveSetsCount})</span>
                    </label>
                )}
                <span className={styles.info}>
                    {activeSets.length} active
                    {!showFinished && finishedCount > 0 && (
                        <span className={styles.infoHidden}> ({finishedCount} hidden)</span>
                    )}
                </span>
            </div>

            {/* Table View */}
            {filteredSets.length === 0 ? (
                <div className={styles.emptyPatients}>
                    <i className="fas fa-inbox"></i>
                    <h3>{filter || showOnlyNoNextBatch || showOnlyInLab || showOnlyNeedsMfg || selectedDoctor !== 'all' ? 'No matching sets found' : 'No aligner sets'}</h3>
                    {(filter || showOnlyNoNextBatch || showOnlyInLab || showOnlyNeedsMfg || selectedDoctor !== 'all') && (
                        <button
                            className={styles.btnClearFilters}
                            onClick={() => updateParams({ q: null, noNext: null, lab: null, mfg: null, dr: null })}
                        >
                            Clear Filters
                        </button>
                    )}
                </div>
            ) : (
                <div className={styles.tableContainer}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                {renderSortableHeader('Patient', 'patient_name')}
                                {renderSortableHeader('Doctor', 'doctor_name')}
                                {renderSortableHeader('Active Set', 'set_sequence')}
                                {renderSortableHeader('Active Batch', 'batch_sequence')}
                                {renderSortableHeader('Next Batch Status', 'LabStatus')}
                                {renderSortableHeader('Next Due', 'NextDueDate')}
                                {renderSortableHeader('Next Appt', 'NextAppointment')}
                                {renderSortableHeader('Notes', 'notes')}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredSets.map((set) => {
                                // Simplified row styling - only special cases get colored rows
                                let rowClass = '';

                                // Keep green tint for finished/discontinued patients
                                if (isClosedWorkStatus(set.WorkStatus)) {
                                    rowClass = styles.completedWorkRow;
                                }
                                // Gray muted for sets without any batches
                                else if (set.LabStatus === 'no_batches') {
                                    rowClass = styles.noBatchesRow;
                                }
                                // All other rows remain neutral - status shown via badge only

                                // Format active batch with delivery date
                                const renderActiveBatch = (): ReactNode => {
                                    // No batch delivered yet = no active batch
                                    if (!set.delivered_to_patient_date) {
                                        return <span className={`${styles.badge} ${styles.badgeNoBatch}`}>No active batch</span>;
                                    }
                                    // Has delivered batch - show batch number and delivery date
                                    const isFinal = set.is_last === true;
                                    return (
                                        <>
                                            <span className={`${styles.badge} ${styles.badgeBatch}`}>
                                                Batch {set.batch_sequence} · {formatDate(set.delivered_to_patient_date)}
                                            </span>
                                            {isFinal && (
                                                <span className={`${styles.badge} ${styles.badgeFinal}`}>
                                                    <i className="fas fa-flag-checkered"></i>
                                                </span>
                                            )}
                                        </>
                                    );
                                };

                                return (
                                <tr
                                    key={`${set.person_id}-${set.aligner_set_id}`}
                                    onClick={() => handlePatientClick(set)}
                                    onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
                                        if (e.key === 'Enter') handlePatientClick(set);
                                    }}
                                    tabIndex={0}
                                    className={rowClass}
                                >
                                    <td data-label="Patient">
                                        <div className={styles.patientName}>
                                            {set.patient_name}
                                        </div>
                                    </td>
                                    <td data-label="Doctor">{set.doctor_name === 'Admin' ? set.doctor_name : `Dr. ${set.doctor_name}`}</td>
                                    <td data-label="Set">
                                        {set.set_sequence != null ? (
                                            <span className={`${styles.badge} ${styles.badgeSet}`}>
                                                Set {set.set_sequence}
                                            </span>
                                        ) : (
                                            <span className={`${styles.badge} ${styles.badgeNoSet}`}>
                                                No active set
                                            </span>
                                        )}
                                    </td>
                                    <td data-label="Batch">{renderActiveBatch()}</td>
                                    <td data-label="Status">{renderBatchStateBadge(set)}</td>
                                    <td data-label="Next Due">
                                        {set.NextDueDate ? formatDate(set.NextDueDate) : '—'}
                                    </td>
                                    <td data-label="Next Appt">
                                        {renderNextAppointment(set)}
                                    </td>
                                    <td data-label="Notes">
                                        {set.notes ? (
                                            <span className={styles.notes}>
                                                {set.notes}
                                            </span>
                                        ) : (
                                            <span className={styles.notesEmpty}>—</span>
                                        )}
                                    </td>
                                </tr>
                            );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
};

export default AllSetsList;
