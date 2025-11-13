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
                const phone = (s.Phone || '').toLowerCase();
                const id = (s.patientID || '').toLowerCase();
                return name.includes(query) || doctor.includes(query) ||
                       phone.includes(query) || id.includes(query);
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
                    <span style={{
                        marginLeft: '1rem',
                        color: '#f59e0b',
                        fontWeight: 'bold'
                    }}>
                        <i className="fas fa-exclamation-triangle"></i> {noNextBatchCount} without next batch
                    </span>
                </div>
            </div>

            {/* Filter Controls */}
            <div style={{
                display: 'flex',
                gap: '1rem',
                marginBottom: '1.5rem',
                alignItems: 'center'
            }}>
                <div className="patient-filter-box" style={{ flex: 1 }}>
                    <i className="fas fa-filter filter-icon"></i>
                    <input
                        type="text"
                        placeholder="Filter by patient name, doctor, phone, or ID..."
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
                <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    backgroundColor: showOnlyNoNextBatch ? '#fef3c7' : '#f3f4f6',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: showOnlyNoNextBatch ? '2px solid #f59e0b' : '2px solid transparent',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap'
                }}>
                    <input
                        type="checkbox"
                        checked={showOnlyNoNextBatch}
                        onChange={(e) => setShowOnlyNoNextBatch(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                    />
                    <i className="fas fa-exclamation-triangle" style={{ color: '#f59e0b' }}></i>
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
                            className="btn-clear"
                            onClick={() => {
                                setFilter('');
                                setShowOnlyNoNextBatch(false);
                            }}
                            style={{ marginTop: '1rem' }}
                        >
                            Clear Filters
                        </button>
                    )}
                </div>
            ) : (
                <div style={{
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}>
                    <table style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '0.875rem'
                    }}>
                        <thead style={{
                            backgroundColor: '#f9fafb',
                            borderBottom: '2px solid #e5e7eb'
                        }}>
                            <tr>
                                <th style={headerStyle}>Patient</th>
                                <th style={headerStyle}>Doctor</th>
                                <th style={headerStyle}>Set</th>
                                <th style={headerStyle}>Batch</th>
                                <th style={headerStyle}>Delivered</th>
                                <th style={headerStyle}>Next Batch Ready</th>
                                <th style={headerStyle}>Status</th>
                                <th style={headerStyle}>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredSets.map((set, index) => (
                                <tr
                                    key={`${set.PersonID}-${set.AlignerSetID}`}
                                    onClick={() => handlePatientClick(set)}
                                    style={{
                                        backgroundColor: set.NextBatchPresent === 'False'
                                            ? '#fef3c7'
                                            : index % 2 === 0 ? 'white' : '#f9fafb',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid #e5e7eb',
                                        transition: 'background-color 0.15s'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = set.NextBatchPresent === 'False'
                                            ? '#fde68a'
                                            : '#eff6ff';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = set.NextBatchPresent === 'False'
                                            ? '#fef3c7'
                                            : index % 2 === 0 ? 'white' : '#f9fafb';
                                    }}
                                >
                                    <td style={cellStyle}>
                                        <div style={{ fontWeight: '600', color: '#1f2937' }}>
                                            {set.PatientName}
                                        </div>
                                        {set.patientID && (
                                            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                                                ID: {set.patientID}
                                            </div>
                                        )}
                                    </td>
                                    <td style={cellStyle}>{set.DoctorName === 'Admin' ? set.DoctorName : `Dr. ${set.DoctorName}`}</td>
                                    <td style={cellStyle}>
                                        <span style={{
                                            backgroundColor: '#e0e7ff',
                                            color: '#3730a3',
                                            padding: '0.25rem 0.5rem',
                                            borderRadius: '4px',
                                            fontWeight: '600'
                                        }}>
                                            Set {set.SetSequence}
                                        </span>
                                    </td>
                                    <td style={cellStyle}>
                                        <span style={{
                                            backgroundColor: '#ddd6fe',
                                            color: '#5b21b6',
                                            padding: '0.25rem 0.5rem',
                                            borderRadius: '4px',
                                            fontWeight: '600'
                                        }}>
                                            Batch {set.BatchSequence}
                                        </span>
                                    </td>
                                    <td style={cellStyle}>{formatDate(set.DeliveredToPatientDate)}</td>
                                    <td style={cellStyle}>{formatDate(set.NextBatchReadyDate)}</td>
                                    <td style={cellStyle}>
                                        {set.NextBatchPresent === 'False' ? (
                                            <span style={{
                                                backgroundColor: '#fee2e2',
                                                color: '#991b1b',
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: '4px',
                                                fontWeight: '600',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '0.25rem'
                                            }}>
                                                <i className="fas fa-exclamation-circle"></i>
                                                No Next Batch
                                            </span>
                                        ) : (
                                            <span style={{
                                                backgroundColor: '#d1fae5',
                                                color: '#065f46',
                                                padding: '0.25rem 0.5rem',
                                                borderRadius: '4px',
                                                fontWeight: '600',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '0.25rem'
                                            }}>
                                                <i className="fas fa-check-circle"></i>
                                                Ready
                                            </span>
                                        )}
                                    </td>
                                    <td style={cellStyle}>
                                        {set.Notes ? (
                                            <span style={{
                                                color: '#6b7280',
                                                fontSize: '0.8125rem'
                                            }}>
                                                {set.Notes}
                                            </span>
                                        ) : (
                                            <span style={{ color: '#9ca3af' }}>—</span>
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

const headerStyle = {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontWeight: '600',
    color: '#374151',
    textTransform: 'uppercase',
    fontSize: '0.75rem',
    letterSpacing: '0.05em'
};

const cellStyle = {
    padding: '0.75rem 1rem',
    color: '#1f2937'
};

export default AllSetsList;
