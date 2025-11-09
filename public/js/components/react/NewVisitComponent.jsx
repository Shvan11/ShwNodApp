/**
 * NewVisitComponent - Standalone form for adding/editing visits
 *
 * Compact, space-efficient form with dental chart integration
 * Optimized with React hooks (useCallback, useMemo) for performance
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DentalChart from './DentalChart.jsx';

const NewVisitComponent = ({ workId, visitId = null, onSave, onCancel }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [wires, setWires] = useState([]);
    const [operators, setOperators] = useState([]);
    const [latestWires, setLatestWires] = useState({
        UpperWireID: null,
        UpperWireName: null,
        LowerWireID: null,
        LowerWireName: null
    });
    const othersTextareaRef = useRef(null);
    const nextVisitTextareaRef = useRef(null);
    const [lastFocusedField, setLastFocusedField] = useState('Others');
    const [activeTab, setActiveTab] = useState('basic');

    // Form state
    const [formData, setFormData] = useState({
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

    // Derive selected teeth from formData using useMemo (prevents unnecessary recalculations)
    const selectedTeeth = useMemo(() => {
        const toothPattern = /(UR|UL|LR|LL)[1-8]/g;
        const othersMatches = (formData.Others || '').match(toothPattern) || [];
        const nextVisitMatches = (formData.NextVisit || '').match(toothPattern) || [];
        // Combine and remove duplicates
        return [...new Set([...othersMatches, ...nextVisitMatches])];
    }, [formData.Others, formData.NextVisit]);

    // Memoized function to load dropdown data
    const loadDropdownData = useCallback(async () => {
        try {
            const [wiresRes, operatorsRes, latestWiresRes] = await Promise.all([
                fetch('/api/getWires'),
                fetch('/api/operators'),
                fetch(`/api/getlatestwires?workId=${workId}`)
            ]);

            if (wiresRes.ok) {
                const wiresData = await wiresRes.json();
                setWires(wiresData);
            }
            if (operatorsRes.ok) {
                const operatorsData = await operatorsRes.json();
                setOperators(operatorsData);
            }
            if (latestWiresRes.ok) {
                const latestWiresData = await latestWiresRes.json();
                setLatestWires(latestWiresData);
            }
        } catch (err) {
            console.error('Error loading dropdown data:', err);
        }
    }, [workId]);

    // Memoized function to load visit data
    const loadVisitData = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch(`/api/getvisitbyid?visitId=${visitId}`);
            if (!response.ok) throw new Error('Failed to fetch visit data');
            const visit = await response.json();

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
            // selectedTeeth is now automatically derived via useMemo
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [visitId]);

    // useEffect with proper dependencies
    useEffect(() => {
        loadDropdownData();
        if (visitId) {
            loadVisitData();
        }
    }, [loadDropdownData, loadVisitData, visitId]);

    // Memoized form submit handler
    const handleFormSubmit = useCallback(async (e) => {
        e.preventDefault();
        setError(null);

        try {
            setLoading(true);
            let response;

            if (visitId) {
                // Update existing visit
                response = await fetch('/api/updatevisitbywork', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ visitId, ...formData })
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

            const result = await response.json();
            if (onSave) {
                onSave(result);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [visitId, formData, onSave]);

    // Memoized tooth click handler - prevents DentalChart re-renders
    const handleToothClick = useCallback((palmerNotation) => {
        setFormData(prevData => {
            const targetField = lastFocusedField;
            const currentValue = prevData[targetField] || '';
            const newValue = currentValue
                ? `${currentValue} ${palmerNotation}`
                : palmerNotation;

            return { ...prevData, [targetField]: newValue };
        });

        // selectedTeeth is automatically updated via useMemo when formData changes

        const targetRef = lastFocusedField === 'Others' ? othersTextareaRef : nextVisitTextareaRef;
        if (targetRef.current) {
            targetRef.current.focus();
        }
    }, [lastFocusedField]);

    // Generic memoized field change handler
    const handleFieldChange = useCallback((field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    }, []);

    // Memoized tab change handler
    const handleTabChange = useCallback((tab) => {
        setActiveTab(tab);
    }, []);

    // Memoized focus handler
    const handleFieldFocus = useCallback((field) => {
        setLastFocusedField(field);
    }, []);

    // Memoized error clear handler
    const handleClearError = useCallback(() => {
        setError(null);
    }, []);

    if (loading && visitId) {
        return (
            <div className="new-visit-loading">
                <i className="fas fa-spinner fa-spin"></i> Loading visit data...
            </div>
        );
    }

    return (
        <div className="new-visit-component">
            {/* Header */}
            <div className="new-visit-header">
                <h3>
                    <i className="fas fa-calendar-plus"></i> {visitId ? 'Edit Visit' : 'Add New Visit'}
                </h3>
            </div>

            {/* Error Display */}
            {error && (
                <div className="new-visit-error">
                    <i className="fas fa-exclamation-circle"></i> {error}
                    <button onClick={handleClearError} className="error-close">×</button>
                </div>
            )}

            {/* Form */}
            <form onSubmit={handleFormSubmit} className="new-visit-form">
                {/* Top Action Buttons */}
                <div className="form-actions top-actions">
                    <button type="submit" className="btn-primary" disabled={loading}>
                        <i className="fas fa-save"></i> {loading ? 'Saving...' : (visitId ? 'Update' : 'Add Visit')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn-secondary">
                            <i className="fas fa-times"></i> Cancel
                        </button>
                    )}
                </div>

                {/* Tabs */}
                <div className="visit-tabs">
                    <button
                        type="button"
                        className={`visit-tab ${activeTab === 'basic' ? 'active' : ''}`}
                        onClick={() => handleTabChange('basic')}
                    >
                        <i className="fas fa-calendar"></i> Basic Info
                    </button>
                    <button
                        type="button"
                        className={`visit-tab ${activeTab === 'treatment' ? 'active' : ''}`}
                        onClick={() => handleTabChange('treatment')}
                    >
                        <i className="fas fa-teeth"></i> Treatment Details
                    </button>
                </div>

                {/* Tab 1: Basic Information */}
                <div className={`tab-content ${activeTab === 'basic' ? 'active' : ''}`}>
                    {/* Basic Information */}
                    <div className="form-row">
                    <div className="form-group">
                        <label>Visit Date <span className="required">*</span></label>
                        <input
                            type="date"
                            value={formData.VisitDate}
                            onChange={(e) => handleFieldChange('VisitDate', e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>Operator</label>
                        <select
                            value={formData.OperatorID}
                            onChange={(e) => handleFieldChange('OperatorID', e.target.value)}
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

                {/* Latest Wires - Quick Select (only for new visits) */}
                {!visitId && (latestWires.UpperWireName || latestWires.LowerWireName) && (
                    <div className="latest-wires-section">
                        <div className="section-label">
                            <i className="fas fa-info-circle"></i> Most Recent Wires:
                        </div>
                        <div className="wires-grid">
                            {latestWires.UpperWireName && (
                                <button
                                    type="button"
                                    onClick={() => handleFieldChange('UpperWireID', latestWires.UpperWireID)}
                                    className={`wire-btn ${formData.UpperWireID === latestWires.UpperWireID ? 'active upper' : 'upper'}`}
                                >
                                    <div className="wire-label">Upper:</div>
                                    <div className="wire-name">{latestWires.UpperWireName}</div>
                                </button>
                            )}
                            {latestWires.LowerWireName && (
                                <button
                                    type="button"
                                    onClick={() => handleFieldChange('LowerWireID', latestWires.LowerWireID)}
                                    className={`wire-btn ${formData.LowerWireID === latestWires.LowerWireID ? 'active lower' : 'lower'}`}
                                >
                                    <div className="wire-label">Lower:</div>
                                    <div className="wire-name">{latestWires.LowerWireName}</div>
                                </button>
                            )}
                        </div>
                    </div>
                )}

                    {/* Wire Information */}
                    <div className="form-row">
                        <div className="form-group">
                            <label>Upper Wire</label>
                            <select
                                value={formData.UpperWireID}
                                onChange={(e) => handleFieldChange('UpperWireID', e.target.value)}
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
                                onChange={(e) => handleFieldChange('LowerWireID', e.target.value)}
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
                </div>

                {/* Tab 2: Treatment Details */}
                <div className={`tab-content ${activeTab === 'treatment' ? 'active' : ''}`}>
                    {/* Treatment Details */}
                    <div className="form-group">
                        <label>Bracket Change</label>
                        <input
                            type="text"
                            value={formData.BracketChange}
                            onChange={(e) => handleFieldChange('BracketChange', e.target.value)}
                            placeholder="e.g., Replaced upper left bracket"
                        />
                    </div>

                    <div className="form-group">
                        <label>Wire Bending</label>
                        <input
                            type="text"
                            value={formData.WireBending}
                            onChange={(e) => handleFieldChange('WireBending', e.target.value)}
                            placeholder="e.g., Omega loop on upper wire"
                        />
                    </div>

                    <div className="form-group">
                        <label>Elastics</label>
                        <input
                            type="text"
                            value={formData.Elastics}
                            onChange={(e) => handleFieldChange('Elastics', e.target.value)}
                            placeholder="e.g., Class II elastics"
                        />
                    </div>
                </div>

                {/* Dental Chart */}
                <div className="dental-chart-section">
                    <label className="chart-label">
                        <span>
                            <i className="fas fa-tooth"></i> Select Teeth
                        </span>
                        <span className="chart-hint">
                            <i className="fas fa-arrow-down"></i> Appends to: <strong>{lastFocusedField === 'Others' ? 'Other Notes' : 'Next Visit'}</strong>
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
                            <span className="active-indicator">
                                <i className="fas fa-tooth"></i> Active
                            </span>
                        )}
                    </label>
                    <textarea
                        ref={othersTextareaRef}
                        value={formData.Others}
                        onChange={(e) => handleFieldChange('Others', e.target.value)}
                        onFocus={() => handleFieldFocus('Others')}
                        rows="2"
                        placeholder="Any additional notes about this visit..."
                        className={lastFocusedField === 'Others' ? 'active' : ''}
                    />
                </div>

                {/* Next Visit Instructions */}
                <div className="form-group full-width">
                    <label>
                        Next Visit Instructions
                        {lastFocusedField === 'NextVisit' && (
                            <span className="active-indicator">
                                <i className="fas fa-tooth"></i> Active
                            </span>
                        )}
                    </label>
                    <textarea
                        ref={nextVisitTextareaRef}
                        value={formData.NextVisit}
                        onChange={(e) => handleFieldChange('NextVisit', e.target.value)}
                        onFocus={() => handleFieldFocus('NextVisit')}
                        rows="2"
                        placeholder="Instructions or notes for the next visit..."
                        className={lastFocusedField === 'NextVisit' ? 'active' : ''}
                    />
                </div>

                {/* Checkboxes - Moved to bottom */}
                <div className="checkboxes-grid">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={formData.OPG}
                            onChange={(e) => handleFieldChange('OPG', e.target.checked)}
                        />
                        <span>OPG Taken</span>
                    </label>
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={formData.IPhoto}
                            onChange={(e) => handleFieldChange('IPhoto', e.target.checked)}
                        />
                        <span>Initial Photo</span>
                    </label>
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={formData.PPhoto}
                            onChange={(e) => handleFieldChange('PPhoto', e.target.checked)}
                        />
                        <span>Progress Photo</span>
                    </label>
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={formData.FPhoto}
                            onChange={(e) => handleFieldChange('FPhoto', e.target.checked)}
                        />
                        <span>Final Photo</span>
                    </label>
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={formData.ApplianceRemoved}
                            onChange={(e) => handleFieldChange('ApplianceRemoved', e.target.checked)}
                        />
                        <span>Appliance Removed</span>
                    </label>
                </div>

                {/* Bottom Form Actions */}
                <div className="form-actions">
                    <button type="submit" className="btn-primary" disabled={loading}>
                        <i className="fas fa-save"></i> {loading ? 'Saving...' : (visitId ? 'Update Visit' : 'Add Visit')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn-secondary">
                            <i className="fas fa-times"></i> Cancel
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
};

export default NewVisitComponent;
