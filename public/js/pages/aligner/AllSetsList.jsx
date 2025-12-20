// AllSetsList.jsx - Simple list view of all aligner sets from v_allsets
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const AllSetsList = () => {
    const navigate = useNavigate();
    const [sets, setSets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [showOnlyNoNextBatch, setShowOnlyNoNextBatch] = useState(false);
    const [showOnlyInLab, setShowOnlyInLab] = useState(false);
    const [showOnlyNeedsMfg, setShowOnlyNeedsMfg] = useState(false);
    const [selectedDoctor, setSelectedDoctor] = useState('all');
    const [showFinished, setShowFinished] = useState(false);
    const [showInactiveSets, setShowInactiveSets] = useState(false);
    const [sortColumn, setSortColumn] = useState('NextBatchReadyDate');
    const [sortDirection, setSortDirection] = useState('asc');

    useEffect(() => {
        loadAllSets();
    }, []);

    const loadAllSets = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/aligner/all-sets');
            const data = await response.json();

            if (data.success) {
                setSets(data.sets || []);
            }
        } catch (error) {
            console.error('Error loading aligner sets:', error);
        } finally {
            setLoading(false);
        }
    };

    const handlePatientClick = (set) => {
        // Navigate to patient's aligner management page
        navigate(`/aligner/patient/${set.WorkID}`);
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    };

    // Get unique doctors from sets
    const getUniqueDoctors = () => {
        const doctorMap = new Map();
        sets.forEach(set => {
            if (!doctorMap.has(set.AlignerDrID)) {
                doctorMap.set(set.AlignerDrID, set.DoctorName);
            }
        });
        return Array.from(doctorMap.entries()).map(([id, name]) => ({ id, name }));
    };

    // Check if patient is waiting for next batch (previously delivered, but no next batch)
    const isWaitingForNextBatch = (set) => {
        return set.NextBatchPresent === 'False' && set.DeliveredToPatientDate;
    };

    // Render next batch status badge (combined status + readiness)
    const renderBatchStateBadge = (set) => {
        const isFinal = set.IsLast === true || set.IsLast === 1;

        // No batches exist
        if (set.LabStatus === 'no_batches') {
            return <span className="allsets-badge allsets-badge-no-batch">No Batches</span>;
        }

        // Final batch delivered = treatment complete (flag shown in Active Batch column)
        if (isFinal && set.DeliveredToPatientDate) {
            return <span className="allsets-badge allsets-badge-na">—</span>;
        }

        // Next batch is manufactured and ready in lab
        if (set.NextBatchPresent === 'True') {
            return (
                <span className="allsets-badge allsets-badge-next-ready">
                    <i className="fas fa-check-circle"></i> Ready (In Lab)
                </span>
            );
        }

        // Next batch needs manufacturing
        if (set.LabStatus === 'needs_mfg') {
            return (
                <span className="allsets-badge allsets-badge-pending-mfg">
                    Pending (Needs Mfg)
                </span>
            );
        }

        // All batches delivered but not final = next batch not created yet
        return (
            <span className="allsets-badge allsets-badge-next-warning">
                <i className="fas fa-exclamation-triangle"></i> Not Created
            </span>
        );
    };

    const getFilteredSets = () => {
        let filtered = sets;

        // Filter by inactive sets (hide by default)
        if (!showInactiveSets) {
            filtered = filtered.filter(s => s.SetIsActive === true || s.SetIsActive === 1);
        }

        // Filter by finished/discontinued status (hide by default)
        if (!showFinished) {
            filtered = filtered.filter(s => s.WorkStatus !== 2 && s.WorkStatus !== 3);
        }

        // Filter by doctor
        if (selectedDoctor !== 'all') {
            filtered = filtered.filter(s => s.AlignerDrID === parseInt(selectedDoctor));
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
                const name = (s.PatientName || '').toLowerCase();
                const doctor = (s.DoctorName || '').toLowerCase();
                return name.includes(query) || doctor.includes(query);
            });
        }

        return filtered;
    };

    // Handle column header click for sorting
    const handleSort = (column) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    // Sort the filtered sets
    const sortSets = (setsToSort) => {
        return [...setsToSort].sort((a, b) => {
            let aVal = a[sortColumn];
            let bVal = b[sortColumn];

            // Handle null/undefined values - push them to the end
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            // Handle date columns
            if (sortColumn === 'NextBatchReadyDate' || sortColumn === 'DeliveredToPatientDate') {
                aVal = new Date(aVal).getTime();
                bVal = new Date(bVal).getTime();
            }
            // Handle string columns
            else if (typeof aVal === 'string') {
                aVal = aVal.toLowerCase();
                bVal = (bVal || '').toLowerCase();
            }
            // Handle numeric columns
            else if (typeof aVal === 'number') {
                aVal = aVal || 0;
                bVal = bVal || 0;
            }

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    };

    // Render sortable header
    const renderSortableHeader = (label, column) => (
        <th
            onClick={() => handleSort(column)}
            className="sortable-header"
        >
            <span>{label}</span>
            <span className="sort-icon">
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
            <div className="aligner-container">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Loading aligner sets...</p>
                </div>
            </div>
        );
    }

    const filteredSets = sortSets(getFilteredSets());
    const uniqueDoctors = getUniqueDoctors();

    // Count different patient categories (excluding inactive sets and finished/discontinued if hidden)
    const baseSets = showInactiveSets ? sets : sets.filter(s => s.SetIsActive === true || s.SetIsActive === 1);
    const activeSets = showFinished ? baseSets : baseSets.filter(s => s.WorkStatus !== 2 && s.WorkStatus !== 3);

    // Count by next batch status
    const noBatchesCount = activeSets.filter(s => s.LabStatus === 'no_batches').length;
    const pendingManufactureCount = activeSets.filter(s => s.LabStatus === 'needs_mfg').length;
    const pendingDeliveryCount = activeSets.filter(s => s.LabStatus === 'in_lab').length;
    const lastBatchCount = activeSets.filter(s => s.IsLast === true || s.IsLast === 1).length;
    const finishedCount = baseSets.filter(s => s.WorkStatus === 2 || s.WorkStatus === 3).length;
    const inactiveSetsCount = sets.filter(s => s.SetIsActive !== true && s.SetIsActive !== 1).length;
    const noNextBatchCount = activeSets.filter(s => s.NextBatchPresent === 'False' && s.DeliveredToPatientDate).length;
    // Count sets that are "Not Created" - all batches delivered but not marked as final
    const notCreatedCount = activeSets.filter(s =>
        s.BatchSequence &&
        !(s.IsLast === true || s.IsLast === 1) &&
        s.NextBatchPresent === 'False' &&
        s.LabStatus === 'all_delivered'
    ).length;
    // Count sets with next batch ready in lab
    const readyInLabCount = activeSets.filter(s => s.NextBatchPresent === 'True').length;

    return (
        <>
            {/* Filter Controls */}
            <div className="allsets-filter-container">
                <div className="patient-filter-box">
                    <i className="fas fa-filter filter-icon"></i>
                    <input
                        type="text"
                        placeholder="Filter by patient or doctor..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                    />
                    {filter && (
                        <button
                            className="clear-filter-btn"
                            onClick={() => setFilter('')}
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>

                {/* Doctor Filter Dropdown */}
                <div className="doctor-filter">
                    <select
                        value={selectedDoctor}
                        onChange={(e) => setSelectedDoctor(e.target.value)}
                        className="doctor-filter-select"
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
                <div className="allsets-filter-toggles">
                    {/* Show Finished Toggle */}
                    <label className={`no-batch-toggle ${showFinished ? 'active' : ''}`}>
                        <input
                            type="checkbox"
                            checked={showFinished}
                            onChange={(e) => setShowFinished(e.target.checked)}
                        />
                        <i className="fas fa-check-circle"></i>
                        <span>Finished ({finishedCount})</span>
                    </label>

                    {/* No Next Batch Toggle */}
                    <label className={`no-batch-toggle ${showOnlyNoNextBatch ? 'active' : ''}`}>
                        <input
                            type="checkbox"
                            checked={showOnlyNoNextBatch}
                            onChange={(e) => setShowOnlyNoNextBatch(e.target.checked)}
                        />
                        <i className="fas fa-exclamation-triangle"></i>
                        <span>No Next ({noNextBatchCount})</span>
                    </label>

                    {/* In Lab Filter */}
                    <label className={`no-batch-toggle ${showOnlyInLab ? 'active' : ''}`}>
                        <input
                            type="checkbox"
                            checked={showOnlyInLab}
                            onChange={(e) => {
                                setShowOnlyInLab(e.target.checked);
                                if (e.target.checked) setShowOnlyNeedsMfg(false);
                            }}
                        />
                        <i className="fas fa-box"></i>
                        <span>In Lab ({pendingDeliveryCount})</span>
                    </label>

                    {/* Needs Mfg Filter */}
                    <label className={`no-batch-toggle ${showOnlyNeedsMfg ? 'active' : ''}`}>
                        <input
                            type="checkbox"
                            checked={showOnlyNeedsMfg}
                            onChange={(e) => {
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
            <div className="batch-status-legend">
                <span className="legend-title">Next Batch:</span>
                <span className="legend-item">
                    <span className="legend-dot gray"></span> No Batches ({noBatchesCount})
                </span>
                <span className="legend-item">
                    <span className="legend-dot green"></span> Ready ({readyInLabCount})
                </span>
                <span className="legend-item">
                    <span className="legend-dot amber"></span> Pending ({pendingManufactureCount})
                </span>
                <span className="legend-item">
                    <i className="fas fa-flag-checkered" style={{ color: '#7c3aed' }}></i> Final ({lastBatchCount})
                </span>
                <span className="legend-item">
                    <span className="legend-dot red"></span> Not Created ({notCreatedCount})
                </span>
                {inactiveSetsCount > 0 && (
                    <label className="inactive-sets-toggle">
                        <input
                            type="checkbox"
                            checked={showInactiveSets}
                            onChange={(e) => setShowInactiveSets(e.target.checked)}
                        />
                        <span>Include inactive sets ({inactiveSetsCount})</span>
                    </label>
                )}
                <span className="allsets-info">
                    {activeSets.length} active
                    {!showFinished && finishedCount > 0 && (
                        <span className="allsets-info-hidden"> ({finishedCount} hidden)</span>
                    )}
                </span>
            </div>

            {/* Table View */}
            {filteredSets.length === 0 ? (
                <div className="empty-patients">
                    <i className="fas fa-inbox"></i>
                    <h3>{filter || showOnlyNoNextBatch || showOnlyInLab || showOnlyNeedsMfg || selectedDoctor !== 'all' ? 'No matching sets found' : 'No aligner sets'}</h3>
                    {(filter || showOnlyNoNextBatch || showOnlyInLab || showOnlyNeedsMfg || selectedDoctor !== 'all') && (
                        <button
                            className="btn-clear btn-clear-filters"
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
                <div className="allsets-table-container">
                    <table className="allsets-table">
                        <thead>
                            <tr>
                                {renderSortableHeader('Patient', 'PatientName')}
                                {renderSortableHeader('Doctor', 'DoctorName')}
                                {renderSortableHeader('Active Set', 'SetSequence')}
                                {renderSortableHeader('Active Batch', 'BatchSequence')}
                                {renderSortableHeader('Next Batch Status', 'LabStatus')}
                                {renderSortableHeader('Next Due', 'NextBatchReadyDate')}
                                {renderSortableHeader('Notes', 'Notes')}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredSets.map((set) => {
                                // Simplified row styling - only special cases get colored rows
                                let rowClass = '';

                                // Keep green tint for finished/discontinued patients
                                if (set.WorkStatus === 2 || set.WorkStatus === 3) {
                                    rowClass = 'completed-work-row';
                                }
                                // Gray muted for sets without any batches
                                else if (set.LabStatus === 'no_batches') {
                                    rowClass = 'no-batches-row';
                                }
                                // All other rows remain neutral - status shown via badge only

                                // Format active batch with delivery date
                                const renderActiveBatch = () => {
                                    // No batch delivered yet = no active batch
                                    if (!set.DeliveredToPatientDate) {
                                        return <span className="allsets-badge allsets-badge-no-batch">No active batch</span>;
                                    }
                                    // Has delivered batch - show batch number and delivery date
                                    const isFinal = set.IsLast === true || set.IsLast === 1;
                                    return (
                                        <>
                                            <span className="allsets-badge allsets-badge-batch">
                                                Batch {set.BatchSequence} · {formatDate(set.DeliveredToPatientDate)}
                                            </span>
                                            {isFinal && (
                                                <span className="allsets-badge allsets-badge-final" style={{ marginLeft: '4px' }}>
                                                    <i className="fas fa-flag-checkered"></i>
                                                </span>
                                            )}
                                        </>
                                    );
                                };

                                return (
                                <tr
                                    key={`${set.PersonID}-${set.AlignerSetID}`}
                                    onClick={() => handlePatientClick(set)}
                                    className={rowClass}
                                >
                                    <td data-label="Patient">
                                        <div className="allsets-patient-name">
                                            {set.PatientName}
                                        </div>
                                    </td>
                                    <td data-label="Doctor">{set.DoctorName === 'Admin' ? set.DoctorName : `Dr. ${set.DoctorName}`}</td>
                                    <td data-label="Set">
                                        {set.SetSequence != null ? (
                                            <span className="allsets-badge allsets-badge-set">
                                                Set {set.SetSequence}
                                            </span>
                                        ) : (
                                            <span className="allsets-badge allsets-badge-no-set">
                                                No active set
                                            </span>
                                        )}
                                    </td>
                                    <td data-label="Batch">{renderActiveBatch()}</td>
                                    <td data-label="Status">{renderBatchStateBadge(set)}</td>
                                    <td data-label="Next Due">
                                        {set.NextBatchReadyDate ? formatDate(set.NextBatchReadyDate) : '—'}
                                    </td>
                                    <td data-label="Notes">
                                        {set.Notes ? (
                                            <span className="allsets-notes">
                                                {set.Notes}
                                            </span>
                                        ) : (
                                            <span className="allsets-notes-empty">—</span>
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
