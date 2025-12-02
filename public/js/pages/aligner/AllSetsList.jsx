// AllSetsList.jsx - Simple list view of all aligner sets from v_allsets
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const AllSetsList = () => {
    const navigate = useNavigate();
    const [sets, setSets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [showOnlyNoNextBatch, setShowOnlyNoNextBatch] = useState(false);
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

    // Check if patient is in initial phase (no batch delivered yet)
    const isInitialPhase = (set) => {
        return set.NextBatchPresent === 'False' && !set.DeliveredToPatientDate;
    };

    // Check if patient is waiting for next batch (previously delivered, but no next batch)
    const isWaitingForNextBatch = (set) => {
        return set.NextBatchPresent === 'False' && set.DeliveredToPatientDate;
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

    const initialPhaseCount = activeSets.filter(s => isInitialPhase(s)).length;
    const waitingNextBatchCount = activeSets.filter(s => isWaitingForNextBatch(s)).length;
    const finishedCount = sets.filter(s => s.WorkStatus === 2 || s.WorkStatus === 3).length;

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
                    {initialPhaseCount > 0 && (
                        <span className="section-info-initial">
                            <i className="fas fa-info-circle"></i> {initialPhaseCount} initial phase
                        </span>
                    )}
                    {waitingNextBatchCount > 0 && (
                        <span className="section-info-warning">
                            <i className="fas fa-exclamation-triangle"></i> {waitingNextBatchCount} waiting for next
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
                        placeholder="Filter by patient name or doctor..."
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

                {/* Show Finished Toggle */}
                <label className={`no-batch-toggle ${showFinished ? 'active' : ''}`}>
                    <input
                        type="checkbox"
                        checked={showFinished}
                        onChange={(e) => setShowFinished(e.target.checked)}
                    />
                    <i className="fas fa-check-circle"></i>
                    <span>Show finished/discontinued</span>
                </label>

                {/* No Next Batch Toggle */}
                <label className={`no-batch-toggle ${showOnlyNoNextBatch ? 'active' : ''}`}>
                    <input
                        type="checkbox"
                        checked={showOnlyNoNextBatch}
                        onChange={(e) => setShowOnlyNoNextBatch(e.target.checked)}
                    />
                    <i className="fas fa-exclamation-triangle"></i>
                    <span>Only show without next batch</span>
                </label>
            </div>

            {/* Table View */}
            {filteredSets.length === 0 ? (
                <div className="empty-patients">
                    <i className="fas fa-inbox"></i>
                    <h3>{filter || showOnlyNoNextBatch || selectedDoctor !== 'all' ? 'No matching sets found' : 'No aligner sets'}</h3>
                    {(filter || showOnlyNoNextBatch || selectedDoctor !== 'all') && (
                        <button
                            className="btn-clear btn-clear-filters"
                            onClick={() => {
                                setFilter('');
                                setShowOnlyNoNextBatch(false);
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
                                <th>Set</th>
                                <th>Batch</th>
                                <th>Delivered</th>
                                <th>Next Batch Ready</th>
                                <th>Status</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredSets.map((set) => {
                                // Smart conditional formatting based on delivery status
                                let rowClass = '';

                                // Color code finished and discontinued patients
                                if (set.WorkStatus === 2 || set.WorkStatus === 3) {
                                    rowClass = 'completed-work-row';
                                }
                                // Active patients - check batch status
                                else if (set.NextBatchPresent === 'False') {
                                    if (!set.DeliveredToPatientDate) {
                                        // Initial phase: No batch created OR batch ready but not picked up yet
                                        rowClass = 'info-row';
                                    } else {
                                        // Active patient: Previously delivered, waiting for next batch
                                        rowClass = 'warning-row';
                                    }
                                }

                                return (
                                <tr
                                    key={`${set.PersonID}-${set.AlignerSetID}`}
                                    onClick={() => handlePatientClick(set)}
                                    className={rowClass}
                                >
                                    <td>
                                        <div className="allsets-patient-name">
                                            {set.PatientName}
                                        </div>
                                    </td>
                                    <td>{set.DoctorName === 'Admin' ? set.DoctorName : `Dr. ${set.DoctorName}`}</td>
                                    <td>
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
                                    <td>
                                        {set.BatchSequence != null ? (
                                            <span className="allsets-badge allsets-badge-batch">
                                                Batch {set.BatchSequence}
                                            </span>
                                        ) : (
                                            <span className="allsets-badge allsets-badge-no-batch">
                                                No active batch
                                            </span>
                                        )}
                                    </td>
                                    <td>{formatDate(set.DeliveredToPatientDate)}</td>
                                    <td>{formatDate(set.NextBatchReadyDate)}</td>
                                    <td>
                                        {isInitialPhase(set) ? (
                                            <span className="allsets-badge allsets-badge-na">
                                                N/A
                                            </span>
                                        ) : isWaitingForNextBatch(set) ? (
                                            <span className="allsets-badge allsets-badge-no-next">
                                                <i className="fas fa-exclamation-circle"></i>
                                                No Next Batch
                                            </span>
                                        ) : (
                                            <span className="allsets-badge allsets-badge-ready">
                                                <i className="fas fa-check-circle"></i>
                                                Ready
                                            </span>
                                        )}
                                    </td>
                                    <td>
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
