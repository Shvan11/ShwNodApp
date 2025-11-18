// AllSetsList.jsx - Simple list view of all aligner sets from v_allsets
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const AllSetsList = () => {
    const navigate = useNavigate();
    const [sets, setSets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [showOnlyNoNextBatch, setShowOnlyNoNextBatch] = useState(false);

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

    const getFilteredSets = () => {
        let filtered = sets;

        // Filter by no next batch if toggle is on
        if (showOnlyNoNextBatch) {
            filtered = filtered.filter(s => s.NextBatchPresent === 'False');
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
    const noNextBatchCount = sets.filter(s => s.NextBatchPresent === 'False').length;

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
                    <span>{sets.length} total sets</span>
                    <span className="section-info-warning">
                        <i className="fas fa-exclamation-triangle"></i> {noNextBatchCount} without next batch
                    </span>
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
                    <h3>{filter || showOnlyNoNextBatch ? 'No matching sets found' : 'No aligner sets'}</h3>
                    {(filter || showOnlyNoNextBatch) && (
                        <button
                            className="btn-clear btn-clear-filters"
                            onClick={() => {
                                setFilter('');
                                setShowOnlyNoNextBatch(false);
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
                            {filteredSets.map((set, index) => (
                                <tr
                                    key={`${set.PersonID}-${set.AlignerSetID}`}
                                    onClick={() => handlePatientClick(set)}
                                    className={set.NextBatchPresent === 'False' ? 'warning-row' : ''}
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
                                        {set.NextBatchPresent === 'False' ? (
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
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
};

export default AllSetsList;
