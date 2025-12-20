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
        return date.toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
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

    // Get lab status from the database LabStatus field
    const getBatchState = (set) => {
        switch (set.LabStatus) {
            case 'no_batches': return 'no-batches';
            case 'in_lab': return 'pending-delivery';
            case 'needs_mfg': return 'pending-manufacture';
            case 'all_delivered': return 'delivered';
            default: return 'no-batches';
        }
    };

    // Render batch state badge
    const renderBatchStateBadge = (set) => {
        const state = getBatchState(set);
        switch (state) {
            case 'no-batches':
                return <span className="allsets-badge allsets-badge-no-batch">No Batches</span>;
            case 'pending-manufacture':
                return <span className="allsets-badge allsets-badge-pending-mfg">Needs Mfg</span>;
            case 'pending-delivery':
                return <span className="allsets-badge allsets-badge-pending-del">In Lab</span>;
            case 'delivered':
                return <span className="allsets-badge allsets-badge-delivered">Delivered</span>;
            default:
                return null;
        }
    };

    // Render next batch ready status badge
    const renderNextBatchReadyBadge = (set) => {
        // No batches exist at all - use LabStatus which checks all batches
        if (set.LabStatus === 'no_batches') {
            return <span className="allsets-badge allsets-badge-na">N/A</span>;
        }

        // Check if next batch is manufactured and ready (check this BEFORE IsLast)
        if (set.NextBatchPresent === 'True') {
            return (
                <span className="allsets-badge allsets-badge-next-ready">
                    <i className="fas fa-check-circle"></i> Ready
                </span>
            );
        }

        // Final batch - no next needed
        if (set.IsLast === true || set.IsLast === 1) {
            return (
                <span className="allsets-badge allsets-badge-final">
                    <i className="fas fa-flag-checkered"></i> Final
                </span>
            );
        }

        // Not the last batch but no next batch ready - WARNING
        return (
            <span className="allsets-badge allsets-badge-next-warning">
                <i className="fas fa-exclamation-triangle"></i> Not Ready
            </span>
        );
    };

    const getFilteredSets = () => {
        let filtered = sets;

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

    const filteredSets = getFilteredSets();
    const uniqueDoctors = getUniqueDoctors();

    // Count different patient categories (excluding finished/discontinued if hidden)
    const activeSets = showFinished ? sets : sets.filter(s => s.WorkStatus !== 2 && s.WorkStatus !== 3);

    // Use LabStatus directly for accurate counts
    const noBatchesCount = activeSets.filter(s => s.LabStatus === 'no_batches').length;
    const pendingManufactureCount = activeSets.filter(s => s.LabStatus === 'needs_mfg').length;
    const pendingDeliveryCount = activeSets.filter(s => s.LabStatus === 'in_lab').length;
    const deliveredCount = activeSets.filter(s => s.LabStatus === 'all_delivered').length;
    const lastBatchCount = activeSets.filter(s => s.IsLast === true || s.IsLast === 1).length;
    const finishedCount = sets.filter(s => s.WorkStatus === 2 || s.WorkStatus === 3).length;
    // Count sets needing next batch manufactured (not last batch, but no manufactured next batch)
    const notReadyCount = activeSets.filter(s =>
        s.BatchSequence &&
        !(s.IsLast === true || s.IsLast === 1) &&
        s.NextBatchPresent === 'False'
    ).length;

    return (
        <>
            {/* Breadcrumb */}
            <div className="breadcrumb">
                <button onClick={() => navigate('/aligner')} className="breadcrumb-link">
                    <i className="fas fa-arrow-left"></i>
                    Back to Doctors
                </button>
            </div>

            <div className="section-header">
                <h2>
                    <i className="fas fa-list-ul"></i>
                    All Aligner Sets
                </h2>
                <div className="section-info">
                    <span>{activeSets.length} active sets</span>
                    {!showFinished && finishedCount > 0 && (
                        <span style={{ color: 'var(--gray-500)', fontSize: '0.9rem' }}>
                            ({finishedCount} finished/discontinued hidden)
                        </span>
                    )}
                </div>
            </div>

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
                        <span>Finished</span>
                    </label>

                    {/* No Next Batch Toggle */}
                    <label className={`no-batch-toggle ${showOnlyNoNextBatch ? 'active' : ''}`}>
                        <input
                            type="checkbox"
                            checked={showOnlyNoNextBatch}
                            onChange={(e) => setShowOnlyNoNextBatch(e.target.checked)}
                        />
                        <i className="fas fa-exclamation-triangle"></i>
                        <span>No Next</span>
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
                <span className="legend-title">Lab Status:</span>
                <span className="legend-item">
                    <span className="legend-dot gray"></span> No Batches ({noBatchesCount})
                </span>
                <span className="legend-item">
                    <span className="legend-dot cyan"></span> Needs Mfg ({pendingManufactureCount})
                </span>
                <span className="legend-item">
                    <span className="legend-dot orange"></span> In Lab ({pendingDeliveryCount})
                </span>
                <span className="legend-item">
                    <span className="legend-dot green"></span> Delivered ({deliveredCount})
                </span>
                <span className="legend-item">
                    <i className="fas fa-flag-checkered" style={{ color: '#7c3aed' }}></i> Final Batch ({lastBatchCount})
                </span>
                <span className="legend-item">
                    <span className="legend-dot red"></span> Not Ready ({notReadyCount})
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
                                <th>Patient</th>
                                <th>Doctor</th>
                                <th>Active Set</th>
                                <th>Active Batch</th>
                                <th>Latest Batch Status</th>
                                <th>Next Batch Ready</th>
                                <th>Notes</th>
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
                                    if (set.BatchSequence == null) {
                                        return <span className="allsets-badge allsets-badge-no-batch">—</span>;
                                    }
                                    const deliveryInfo = set.DeliveredToPatientDate
                                        ? formatDate(set.DeliveredToPatientDate)
                                        : 'Pending';
                                    return (
                                        <span className="allsets-badge allsets-badge-batch">
                                            Batch {set.BatchSequence} · {deliveryInfo}
                                        </span>
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
                                    <td data-label="Next">{renderNextBatchReadyBadge(set)}</td>
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
