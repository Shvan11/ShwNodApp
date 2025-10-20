/**
 * VisitsComponent - Work-based visit history display and management
 *
 * Provides full CRUD operations for visits tied to specific work IDs
 */

import React, { useState, useEffect, useRef } from 'react';
import DentalChart from './DentalChart.jsx';

const VisitsComponent = ({ workId, patientId }) => {
    const [visits, setVisits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showModal, setShowModal] = useState(false);
    const [editingVisit, setEditingVisit] = useState(null);
    const [wires, setWires] = useState([]);
    const [operators, setOperators] = useState([]);
    const [selectedTeeth, setSelectedTeeth] = useState([]);
    const othersTextareaRef = useRef(null);
    const nextVisitTextareaRef = useRef(null);
    const [lastFocusedField, setLastFocusedField] = useState('Others'); // Track which field has focus

    // Form state
    const [formData, setFormData] = useState({
        WorkID: workId,
        VisitDate: '',
        UpperWireID: '',
        LowerWireID: '',
        BracketChange: '',
        WireBending: '',
        Elastics: '',
        OPG: false,
        PPhoto: false,
        IPhoto: false,
        FPhoto: false,
        Others: '',
        NextVisit: '',
        ApplianceRemoved: false,
        OperatorID: ''
    });

    useEffect(() => {
        if (workId) {
            loadVisits();
            loadDropdownData();
        }
    }, [workId]);

    const loadVisits = async () => {
        try {
            setLoading(true);
            const response = await fetch(`/api/getvisitsbywork?workId=${workId}`);
            if (!response.ok) throw new Error('Failed to fetch visits');
            const data = await response.json();
            // Sort by visit date ascending (oldest first)
            const sortedData = data.sort((a, b) => new Date(a.VisitDate) - new Date(b.VisitDate));
            setVisits(sortedData);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadDropdownData = async () => {
        try {
            const [wiresRes, operatorsRes] = await Promise.all([
                fetch('/api/getWires'),
                fetch('/api/operators')
            ]);

            if (wiresRes.ok) {
                const wiresData = await wiresRes.json();
                setWires(wiresData);
            }
            if (operatorsRes.ok) {
                const operatorsData = await operatorsRes.json();
                setOperators(operatorsData);
            }
        } catch (err) {
            console.error('Error loading dropdown data:', err);
        }
    };

    const handleAddVisit = () => {
        setEditingVisit(null);
        setFormData({
            WorkID: workId,
            VisitDate: new Date().toISOString().split('T')[0],
            UpperWireID: '',
            LowerWireID: '',
            BracketChange: '',
            WireBending: '',
            Elastics: '',
            OPG: false,
            PPhoto: false,
            IPhoto: false,
            FPhoto: false,
            Others: '',
            NextVisit: '',
            ApplianceRemoved: false,
            OperatorID: ''
        });
        setSelectedTeeth([]);
        setShowModal(true);
    };

    const handleEditVisit = (visit) => {
        setEditingVisit(visit);
        setFormData({
            WorkID: visit.WorkID,
            VisitDate: visit.VisitDate ? new Date(visit.VisitDate).toISOString().split('T')[0] : '',
            UpperWireID: visit.UpperWireID || '',
            LowerWireID: visit.LowerWireID || '',
            BracketChange: visit.BracketChange || '',
            WireBending: visit.WireBending || '',
            Elastics: visit.Elastics || '',
            OPG: visit.OPG || false,
            PPhoto: visit.PPhoto || false,
            IPhoto: visit.IPhoto || false,
            FPhoto: visit.FPhoto || false,
            Others: visit.Others || '',
            NextVisit: visit.NextVisit || '',
            ApplianceRemoved: visit.ApplianceRemoved || false,
            OperatorID: visit.OperatorID || ''
        });
        // Extract tooth notations from Others field if present
        const toothPattern = /(UR|UL|LR|LL)[1-8]/g;
        const matches = (visit.Others || '').match(toothPattern);
        setSelectedTeeth(matches || []);
        setShowModal(true);
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();

        try {
            let response;

            if (editingVisit) {
                // Update existing visit
                response = await fetch('/api/updatevisitbywork', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ visitId: editingVisit.ID, ...formData })
                });
            } else {
                // Add new visit
                response = await fetch('/api/addvisitbywork', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save visit');
            }

            await loadVisits();
            setShowModal(false);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDeleteVisit = async (visitId) => {
        if (!confirm('Are you sure you want to delete this visit? This action cannot be undone.')) return;

        try {
            const response = await fetch('/api/deletevisitbywork', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visitId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete visit');
            }

            await loadVisits();
        } catch (err) {
            setError(err.message);
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Not set';
        return new Date(dateString).toLocaleDateString();
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'Not set';
        return new Date(dateString).toLocaleString();
    };

    // Handle tooth selection from dental chart
    const handleToothClick = (palmerNotation) => {
        // Determine which field to append to based on last focused field
        const targetField = lastFocusedField;
        const currentValue = formData[targetField] || '';
        const newValue = currentValue
            ? `${currentValue} ${palmerNotation}`
            : palmerNotation;

        // Update the appropriate field
        setFormData({ ...formData, [targetField]: newValue });

        // Update selected teeth for visual feedback
        setSelectedTeeth(prev =>
            prev.includes(palmerNotation)
                ? prev.filter(t => t !== palmerNotation)
                : [...prev, palmerNotation]
        );

        // Keep focus on the textarea that was focused
        const targetRef = targetField === 'Others' ? othersTextareaRef : nextVisitTextareaRef;
        if (targetRef.current) {
            targetRef.current.focus();
        }
    };

    if (loading) return <div className="work-loading">Loading visits...</div>;

    return (
        <div className="work-component">
            <div className="work-header">
                <h2>Visit History</h2>
                <div className="work-controls">
                    {patientId && (
                        <button
                            onClick={() => window.location.href = `/views/patient/react-shell.html?patient=${patientId}&page=works`}
                            className="btn btn-secondary"
                        >
                            <i className="fas fa-arrow-left"></i> Back to Work
                        </button>
                    )}
                    <button onClick={handleAddVisit} className="btn btn-primary">
                        <i className="fas fa-plus"></i> Add New Visit
                    </button>
                </div>
            </div>

            {error && (
                <div className="work-error">
                    {error}
                    <button onClick={() => setError(null)} className="error-close">×</button>
                </div>
            )}

            <div className="work-summary" style={{ marginBottom: '2rem' }}>
                <div className="summary-card">
                    <h3>Total Visits</h3>
                    <span className="summary-value">{visits.length}</span>
                </div>
                <div className="summary-card">
                    <h3>OPG Taken</h3>
                    <span className="summary-value">{visits.filter(v => v.OPG).length}</span>
                </div>
                <div className="summary-card">
                    <h3>Photos Taken</h3>
                    <span className="summary-value">{visits.filter(v => v.IPhoto || v.PPhoto || v.FPhoto).length}</span>
                </div>
            </div>

            {/* Visit Cards View - Shows all details including Others and NextVisit */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {visits.map((visit) => (
                    <div key={visit.ID} style={{
                        backgroundColor: 'white',
                        padding: '1.5rem',
                        borderRadius: '8px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                        border: '1px solid #e5e7eb'
                    }}>
                        {/* Header Row */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '1rem',
                            paddingBottom: '1rem',
                            borderBottom: '2px solid #e5e7eb'
                        }}>
                            <div>
                                <h3 style={{
                                    margin: '0 0 0.5rem 0',
                                    color: '#4f46e5',
                                    fontSize: '1.25rem'
                                }}>
                                    <i className="fas fa-calendar-check"></i> {formatDateTime(visit.VisitDate)}
                                </h3>
                                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
                                    {visit.OperatorName && (
                                        <span><i className="fas fa-user-md"></i> {visit.OperatorName}</span>
                                    )}
                                    {visit.OPG && (
                                        <span style={{ color: '#059669' }}><i className="fas fa-x-ray"></i> OPG Taken</span>
                                    )}
                                    {visit.ApplianceRemoved && (
                                        <span style={{ color: '#dc2626' }}><i className="fas fa-times-circle"></i> Appliance Removed</span>
                                    )}
                                </div>
                            </div>
                            <div className="action-buttons">
                                <button
                                    onClick={() => handleEditVisit(visit)}
                                    className="btn btn-sm btn-secondary"
                                    title="Edit visit"
                                >
                                    <i className="fas fa-edit"></i> Edit
                                </button>
                                <button
                                    onClick={() => handleDeleteVisit(visit.ID)}
                                    className="btn btn-sm btn-danger"
                                    title="Delete visit"
                                >
                                    <i className="fas fa-trash"></i> Delete
                                </button>
                            </div>
                        </div>

                        {/* Wire and Treatment Info */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: '1rem',
                            marginBottom: '1rem'
                        }}>
                            <div>
                                <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Upper Wire:</strong>
                                <div style={{ fontSize: '1rem', marginTop: '0.25rem' }}>
                                    {visit.UpperWireName || '-'}
                                </div>
                            </div>
                            <div>
                                <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Lower Wire:</strong>
                                <div style={{ fontSize: '1rem', marginTop: '0.25rem' }}>
                                    {visit.LowerWireName || '-'}
                                </div>
                            </div>
                            {visit.BracketChange && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Bracket Change:</strong>
                                    <div style={{ fontSize: '1rem', marginTop: '0.25rem' }}>
                                        {visit.BracketChange}
                                    </div>
                                </div>
                            )}
                            {visit.WireBending && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Wire Bending:</strong>
                                    <div style={{ fontSize: '1rem', marginTop: '0.25rem' }}>
                                        {visit.WireBending}
                                    </div>
                                </div>
                            )}
                            {visit.Elastics && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Elastics:</strong>
                                    <div style={{ fontSize: '1rem', marginTop: '0.25rem' }}>
                                        {visit.Elastics}
                                    </div>
                                </div>
                            )}
                            <div>
                                <strong style={{ color: '#6b7280', fontSize: '0.875rem' }}>Photos Taken:</strong>
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                                    {visit.IPhoto && (
                                        <span style={{
                                            backgroundColor: '#d1fae5',
                                            color: '#065f46',
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '9999px',
                                            fontSize: '0.875rem',
                                            fontWeight: '500'
                                        }}>
                                            Initial
                                        </span>
                                    )}
                                    {visit.PPhoto && (
                                        <span style={{
                                            backgroundColor: '#dbeafe',
                                            color: '#1e40af',
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '9999px',
                                            fontSize: '0.875rem',
                                            fontWeight: '500'
                                        }}>
                                            Progress
                                        </span>
                                    )}
                                    {visit.FPhoto && (
                                        <span style={{
                                            backgroundColor: '#ede9fe',
                                            color: '#6b21a8',
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '9999px',
                                            fontSize: '0.875rem',
                                            fontWeight: '500'
                                        }}>
                                            Final
                                        </span>
                                    )}
                                    {!visit.IPhoto && !visit.PPhoto && !visit.FPhoto && (
                                        <span style={{ color: '#9ca3af' }}>None</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* IMPORTANT: Others (Notes) Section */}
                        {visit.Others && (
                            <div style={{
                                backgroundColor: '#fff7ed',
                                padding: '1rem',
                                borderRadius: '8px',
                                borderLeft: '4px solid #f59e0b',
                                marginBottom: '1rem'
                            }}>
                                <strong style={{
                                    color: '#92400e',
                                    fontSize: '0.875rem',
                                    display: 'block',
                                    marginBottom: '0.5rem'
                                }}>
                                    <i className="fas fa-sticky-note"></i> Visit Notes:
                                </strong>
                                <div style={{
                                    color: '#78350f',
                                    whiteSpace: 'pre-wrap',
                                    lineHeight: '1.6'
                                }}>
                                    {visit.Others}
                                </div>
                            </div>
                        )}

                        {/* IMPORTANT: Next Visit Instructions Section */}
                        {visit.NextVisit && (
                            <div style={{
                                backgroundColor: '#f0fdf4',
                                padding: '1rem',
                                borderRadius: '8px',
                                borderLeft: '4px solid #059669'
                            }}>
                                <strong style={{
                                    color: '#065f46',
                                    fontSize: '0.875rem',
                                    display: 'block',
                                    marginBottom: '0.5rem'
                                }}>
                                    <i className="fas fa-arrow-circle-right"></i> Next Visit Instructions:
                                </strong>
                                <div style={{
                                    color: '#064e3b',
                                    whiteSpace: 'pre-wrap',
                                    lineHeight: '1.6'
                                }}>
                                    {visit.NextVisit}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
                {visits.length === 0 && (
                    <div style={{
                        textAlign: 'center',
                        padding: '3rem',
                        backgroundColor: '#f9fafb',
                        borderRadius: '8px',
                        border: '2px dashed #d1d5db'
                    }}>
                        <i className="fas fa-calendar-times" style={{ fontSize: '3rem', color: '#9ca3af', marginBottom: '1rem' }}></i>
                        <p style={{ color: '#6b7280', fontSize: '1.1rem', margin: 0 }}>
                            No visits recorded yet. Click "Add New Visit" to create one.
                        </p>
                    </div>
                )}
            </div>

            {/* Visit Form Modal */}
            {showModal && (
                <div className="modal-overlay">
                    <div className="work-modal" style={{ maxWidth: '95%', width: '1400px', maxHeight: '90vh', overflow: 'auto' }}>
                        <div className="modal-header">
                            <h3>{editingVisit ? 'Edit Visit' : 'Add New Visit'}</h3>
                            <button
                                onClick={() => setShowModal(false)}
                                className="modal-close"
                            >
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleFormSubmit} className="work-form">
                            {/* Basic Information */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Visit Date <span style={{ color: '#dc2626' }}>*</span></label>
                                    <input
                                        type="date"
                                        value={formData.VisitDate}
                                        onChange={(e) => setFormData({...formData, VisitDate: e.target.value})}
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Operator</label>
                                    <select
                                        value={formData.OperatorID}
                                        onChange={(e) => setFormData({...formData, OperatorID: e.target.value})}
                                    >
                                        <option value="">Select Operator</option>
                                        {operators.map(op => (
                                            <option key={op.ID} value={op.ID}>
                                                {op.employeeName}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Wire Information */}
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Upper Wire</label>
                                    <select
                                        value={formData.UpperWireID}
                                        onChange={(e) => setFormData({...formData, UpperWireID: e.target.value})}
                                    >
                                        <option value="">Select Wire</option>
                                        {wires.map(wire => (
                                            <option key={wire.id} value={wire.id}>
                                                {wire.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Lower Wire</label>
                                    <select
                                        value={formData.LowerWireID}
                                        onChange={(e) => setFormData({...formData, LowerWireID: e.target.value})}
                                    >
                                        <option value="">Select Wire</option>
                                        {wires.map(wire => (
                                            <option key={wire.id} value={wire.id}>
                                                {wire.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Treatment Details */}
                            <div className="form-group full-width">
                                <label>Bracket Change</label>
                                <input
                                    type="text"
                                    value={formData.BracketChange}
                                    onChange={(e) => setFormData({...formData, BracketChange: e.target.value})}
                                    placeholder="e.g., Replaced upper left bracket"
                                />
                            </div>

                            <div className="form-group full-width">
                                <label>Wire Bending</label>
                                <input
                                    type="text"
                                    value={formData.WireBending}
                                    onChange={(e) => setFormData({...formData, WireBending: e.target.value})}
                                    placeholder="e.g., Omega loop on upper wire"
                                />
                            </div>

                            <div className="form-group full-width">
                                <label>Elastics</label>
                                <input
                                    type="text"
                                    value={formData.Elastics}
                                    onChange={(e) => setFormData({...formData, Elastics: e.target.value})}
                                    placeholder="e.g., Class II elastics"
                                />
                            </div>

                            {/* Checkboxes */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                                gap: '1rem',
                                padding: '1rem',
                                backgroundColor: '#f9fafb',
                                borderRadius: '8px',
                                marginBottom: '1rem'
                            }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.OPG}
                                        onChange={(e) => setFormData({...formData, OPG: e.target.checked})}
                                    />
                                    <span>OPG Taken</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.IPhoto}
                                        onChange={(e) => setFormData({...formData, IPhoto: e.target.checked})}
                                    />
                                    <span>Initial Photo</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.PPhoto}
                                        onChange={(e) => setFormData({...formData, PPhoto: e.target.checked})}
                                    />
                                    <span>Progress Photo</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.FPhoto}
                                        onChange={(e) => setFormData({...formData, FPhoto: e.target.checked})}
                                    />
                                    <span>Final Photo</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={formData.ApplianceRemoved}
                                        onChange={(e) => setFormData({...formData, ApplianceRemoved: e.target.checked})}
                                    />
                                    <span>Appliance Removed</span>
                                </label>
                            </div>

                            {/* Dental Chart for tooth selection */}
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: '0.5rem',
                                    fontWeight: '600',
                                    color: '#4a5568'
                                }}>
                                    <span>
                                        <i className="fas fa-tooth"></i> Select Teeth (Palmer Notation)
                                    </span>
                                    <span style={{
                                        fontSize: '0.875rem',
                                        fontWeight: '500',
                                        color: '#4f46e5',
                                        backgroundColor: '#eef2ff',
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '4px'
                                    }}>
                                        <i className="fas fa-arrow-down"></i> Will append to: <strong>{lastFocusedField === 'Others' ? 'Other Notes' : 'Next Visit Instructions'}</strong>
                                    </span>
                                </label>
                                <DentalChart
                                    onToothClick={handleToothClick}
                                    selectedTeeth={selectedTeeth}
                                />
                            </div>

                            {/* Notes */}
                            <div className="form-group full-width">
                                <label>
                                    Other Notes
                                    {lastFocusedField === 'Others' && (
                                        <span style={{
                                            marginLeft: '0.5rem',
                                            fontSize: '0.875rem',
                                            color: '#4f46e5',
                                            fontWeight: '500'
                                        }}>
                                            <i className="fas fa-tooth"></i> Active
                                        </span>
                                    )}
                                </label>
                                <textarea
                                    ref={othersTextareaRef}
                                    value={formData.Others}
                                    onChange={(e) => setFormData({...formData, Others: e.target.value})}
                                    onFocus={() => setLastFocusedField('Others')}
                                    rows="3"
                                    placeholder="Any additional notes about this visit... (Click here then select teeth from chart above)"
                                    style={{
                                        borderColor: lastFocusedField === 'Others' ? '#4f46e5' : undefined,
                                        borderWidth: lastFocusedField === 'Others' ? '2px' : undefined
                                    }}
                                />
                            </div>

                            {/* Next Visit Instructions */}
                            <div className="form-group full-width">
                                <label>
                                    Next Visit Instructions
                                    {lastFocusedField === 'NextVisit' && (
                                        <span style={{
                                            marginLeft: '0.5rem',
                                            fontSize: '0.875rem',
                                            color: '#4f46e5',
                                            fontWeight: '500'
                                        }}>
                                            <i className="fas fa-tooth"></i> Active
                                        </span>
                                    )}
                                </label>
                                <textarea
                                    ref={nextVisitTextareaRef}
                                    value={formData.NextVisit}
                                    onChange={(e) => setFormData({...formData, NextVisit: e.target.value})}
                                    onFocus={() => setLastFocusedField('NextVisit')}
                                    rows="2"
                                    placeholder="Instructions or notes for the next visit... (Click here then select teeth from chart above)"
                                    style={{
                                        borderColor: lastFocusedField === 'NextVisit' ? '#4f46e5' : undefined,
                                        borderWidth: lastFocusedField === 'NextVisit' ? '2px' : undefined
                                    }}
                                />
                            </div>

                            <div className="form-actions">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {editingVisit ? 'Update Visit' : 'Add Visit'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VisitsComponent;
