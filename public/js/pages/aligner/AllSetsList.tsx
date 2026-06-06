// AllSetsList.tsx - Simple list view of all aligner sets from v_allsets
import React, { useState, useEffect, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import * as alignerContract from '@shared/contracts/aligner.contract';
import styles from './AllSetsList.module.css';

// Row shape comes from the shared contract (single source of truth, drift-checked
// against the schema the all-sets read validates with). The validated read
// guarantees `is_last`/`SetIsActive` are booleans, so the numeric (0/1) fallbacks
// the old local copy carried are gone.
type AlignerSetView = alignerContract.AlignerSetView;

type SortColumn = 'patient_name' | 'doctor_name' | 'set_sequence' | 'batch_sequence' | 'LabStatus' | 'NextDueDate' | 'notes';
type SortDirection = 'asc' | 'desc';

const AllSetsList: React.FC = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [sets, setSets] = useState<AlignerSetView[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [filter, setFilter] = useState<string>('');
    const [showOnlyNoNextBatch, setShowOnlyNoNextBatch] = useState<boolean>(false);
    const [showOnlyInLab, setShowOnlyInLab] = useState<boolean>(false);
    const [showOnlyNeedsMfg, setShowOnlyNeedsMfg] = useState<boolean>(false);
    const [selectedDoctor, setSelectedDoctor] = useState<string>('all');
    const [showFinished, setShowFinished] = useState<boolean>(false);
    const [showInactiveSets, setShowInactiveSets] = useState<boolean>(false);
    const [sortColumn, setSortColumn] = useState<SortColumn>('NextDueDate');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

    useEffect(() => {
        loadAllSets();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadAllSets = async (): Promise<void> => {
        try {
            setLoading(true);
            const data = await fetchJSON<{ sets?: AlignerSetView[] }>(
                '/api/aligner/all-sets',
                { schema: alignerContract.allSets.response }
            );

            setSets(data.sets || []);
        } catch (error) {
            console.error('Error loading aligner sets:', error);
            toast.error(httpErrorMessage(error, 'Failed to load aligner sets'));
        } finally {
            setLoading(false);
        }
    };

    const handlePatientClick = (set: AlignerSetView): void => {
        // Navigate to patient's aligner management page
        navigate(`/aligner/patient/${set.work_id}`);
    };

    const formatDate = (dateString: string | null): string => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    };

    // Get unique doctors from sets
    const getUniqueDoctors = (): { id: number; name: string }[] => {
        const doctorMap = new Map<number, string>();
        sets.forEach(set => {
            if (!doctorMap.has(set.aligner_dr_id)) {
                doctorMap.set(set.aligner_dr_id, set.doctor_name);
            }
        });
        return Array.from(doctorMap.entries()).map(([id, name]) => ({ id, name }));
    };

    // Check if patient is waiting for next batch (previously delivered, but no next batch)
    const isWaitingForNextBatch = (set: AlignerSetView): boolean => {
        return set.NextBatchPresent === 'False' && !!set.delivered_to_patient_date;
    };

    // Render next batch status badge (combined status + readiness)
    const renderBatchStateBadge = (set: AlignerSetView): ReactNode => {
        const isFinal = set.is_last === true;

        // No batches exist
        if (set.LabStatus === 'no_batches') {
            return <span className={`${styles.badge} ${styles.badgeNoBatch}`}>No Batches</span>;
        }

        // Final batch delivered = treatment complete (flag shown in Active Batch column)
        if (isFinal && set.delivered_to_patient_date) {
            return <span className={`${styles.badge} ${styles.badgeNa}`}>—</span>;
        }

        // Next batch is manufactured and ready in lab
        if (set.NextBatchPresent === 'True') {
            return (
                <span className={`${styles.badge} ${styles.badgeNextReady}`}>
                    <i className="fas fa-check-circle"></i> Ready (In Lab)
                </span>
            );
        }

        // Next batch needs manufacturing
        if (set.LabStatus === 'needs_mfg') {
            return (
                <span className={`${styles.badge} ${styles.badgePendingMfg}`}>
                    Pending (Needs Mfg)
                </span>
            );
        }

        // All batches delivered but not final = next batch not created yet
        return (
            <span className={`${styles.badge} ${styles.badgeNextWarning}`}>
                <i className="fas fa-exclamation-triangle"></i> Not Created
            </span>
        );
    };

    const getFilteredSets = (): AlignerSetView[] => {
        let filtered = sets;

        // Filter by inactive sets (hide by default)
        if (!showInactiveSets) {
            filtered = filtered.filter(s => s.SetIsActive === true);
        }

        // Filter by finished/discontinued status (hide by default)
        if (!showFinished) {
            filtered = filtered.filter(s => s.WorkStatus !== 2 && s.WorkStatus !== 3);
        }

        // Filter by doctor
        if (selectedDoctor !== 'all') {
            filtered = filtered.filter(s => s.aligner_dr_id === parseInt(selectedDoctor));
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
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
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
            if (sortColumn === 'NextDueDate') {
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

    // Render sortable header
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

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <p>Loading aligner sets...</p>
            </div>
        );
    }

    const filteredSets = sortSets(getFilteredSets());
    const uniqueDoctors = getUniqueDoctors();

    // Count different patient categories (excluding inactive sets and finished/discontinued if hidden)
    const baseSets = showInactiveSets ? sets : sets.filter(s => s.SetIsActive === true);
    const activeSets = showFinished ? baseSets : baseSets.filter(s => s.WorkStatus !== 2 && s.WorkStatus !== 3);

    // Count by next batch status
    const noBatchesCount = activeSets.filter(s => s.LabStatus === 'no_batches').length;
    const pendingManufactureCount = activeSets.filter(s => s.LabStatus === 'needs_mfg').length;
    const pendingDeliveryCount = activeSets.filter(s => s.LabStatus === 'in_lab').length;
    const lastBatchCount = activeSets.filter(s => s.is_last === true).length;
    const finishedCount = baseSets.filter(s => s.WorkStatus === 2 || s.WorkStatus === 3).length;
    const inactiveSetsCount = sets.filter(s => s.SetIsActive !== true).length;
    const noNextBatchCount = activeSets.filter(s => s.NextBatchPresent === 'False' && s.delivered_to_patient_date).length;
    // Count sets that are "Not Created" - all batches delivered but not marked as final
    const notCreatedCount = activeSets.filter(s =>
        s.batch_sequence &&
        !(s.is_last === true) &&
        s.NextBatchPresent === 'False' &&
        s.LabStatus === 'all_delivered'
    ).length;
    // Count sets with next batch ready in lab
    const readyInLabCount = activeSets.filter(s => s.NextBatchPresent === 'True').length;

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
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
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

                {/* Doctor Filter Dropdown */}
                <div className={styles.doctorFilter}>
                    <select
                        value={selectedDoctor}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedDoctor(e.target.value)}
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
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setShowFinished(e.target.checked)}
                        />
                        <i className="fas fa-check-circle"></i>
                        <span>Finished ({finishedCount})</span>
                    </label>

                    {/* No Next Batch Toggle */}
                    <label className={`${styles.filterToggle} ${showOnlyNoNextBatch ? styles.active : ''}`}>
                        <input
                            type="checkbox"
                            checked={showOnlyNoNextBatch}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setShowOnlyNoNextBatch(e.target.checked)}
                        />
                        <i className="fas fa-exclamation-triangle"></i>
                        <span>No Next ({noNextBatchCount})</span>
                    </label>

                    {/* In Lab Filter */}
                    <label className={`${styles.filterToggle} ${showOnlyInLab ? styles.active : ''}`}>
                        <input
                            type="checkbox"
                            checked={showOnlyInLab}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                setShowOnlyInLab(e.target.checked);
                                if (e.target.checked) setShowOnlyNeedsMfg(false);
                            }}
                        />
                        <i className="fas fa-box"></i>
                        <span>In Lab ({pendingDeliveryCount})</span>
                    </label>

                    {/* Needs Mfg Filter */}
                    <label className={`${styles.filterToggle} ${showOnlyNeedsMfg ? styles.active : ''}`}>
                        <input
                            type="checkbox"
                            checked={showOnlyNeedsMfg}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                setShowOnlyNeedsMfg(e.target.checked);
                                if (e.target.checked) setShowOnlyInLab(false);
                            }}
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
                    <span className={`${styles.legendDot} ${styles.gray}`}></span> No Batches ({noBatchesCount})
                </span>
                <span className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles.green}`}></span> Ready ({readyInLabCount})
                </span>
                <span className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles.amber}`}></span> Pending ({pendingManufactureCount})
                </span>
                <span className={styles.legendItem}>
                    <i className={`fas fa-flag-checkered ${styles.legendFlagFinal}`}></i> Final ({lastBatchCount})
                </span>
                <span className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles.red}`}></span> Not Created ({notCreatedCount})
                </span>
                {inactiveSetsCount > 0 && (
                    <label className={styles.inactiveSetsToggle}>
                        <input
                            type="checkbox"
                            checked={showInactiveSets}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setShowInactiveSets(e.target.checked)}
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
                            onClick={() => {
                                setFilter('');
                                setShowOnlyNoNextBatch(false);
                                setShowOnlyInLab(false);
                                setShowOnlyNeedsMfg(false);
                                setSelectedDoctor('all');
                            }}
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
                                {renderSortableHeader('notes', 'notes')}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredSets.map((set) => {
                                // Simplified row styling - only special cases get colored rows
                                let rowClass = '';

                                // Keep green tint for finished/discontinued patients
                                if (set.WorkStatus === 2 || set.WorkStatus === 3) {
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
