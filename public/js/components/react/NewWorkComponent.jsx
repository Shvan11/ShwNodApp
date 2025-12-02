/**
 * NewWorkComponent - Standalone form for adding/editing works
 *
 * Compact, space-efficient form with keyword management
 */

import React, { useState, useEffect } from 'react';
import { formatNumber, parseFormattedNumber } from '../../utils/formatters.js';

const NewWorkComponent = ({ patientId, workId = null, onSave, onCancel }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [workTypes, setWorkTypes] = useState([]);
    const [keywords, setKeywords] = useState([]);
    const [doctors, setDoctors] = useState([]);
    const [activeTab, setActiveTab] = useState('basic');
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [existingWorkData, setExistingWorkData] = useState(null);
    const [pendingFormData, setPendingFormData] = useState(null);
    const [showFinishedWorkConfirm, setShowFinishedWorkConfirm] = useState(false);

    // Form state
    const [formData, setFormData] = useState({
        PersonID: patientId,
        TotalRequired: 0, // Default to 0 instead of empty string (matches DB default)
        Currency: 'USD',
        Typeofwork: '',
        Notes: '',
        Status: 1, // 1=Active, 2=Finished, 3=Discontinued
        StartDate: '',
        DebondDate: '',
        FPhotoDate: '',
        IPhotoDate: '',
        EstimatedDuration: '',
        DrID: '',
        NotesDate: '',
        KeyWordID1: '',
        KeyWordID2: '',
        KeywordID3: '',
        KeywordID4: '',
        KeywordID5: '',
        createAsFinished: false
    });

    // Display state for formatted values
    const [displayValues, setDisplayValues] = useState({
        TotalRequired: ''
    });

    useEffect(() => {
        loadDropdownData();
        if (workId) {
            loadWorkData();
        }
    }, [patientId, workId]);

    // Auto-format display value when formData changes
    useEffect(() => {
        setDisplayValues({
            TotalRequired: formatNumber(formData.TotalRequired)
        });
    }, [formData.TotalRequired]);

    const loadDropdownData = async () => {
        try {
            const [typesRes, keywordsRes, employeesRes] = await Promise.all([
                fetch('/api/getworktypes'),
                fetch('/api/getworkkeywords'),
                fetch('/api/employees?percentage=true')
            ]);

            if (typesRes.ok) {
                const types = await typesRes.json();
                setWorkTypes(types);
            }
            if (keywordsRes.ok) {
                const kw = await keywordsRes.json();
                setKeywords(kw);
            }
            if (employeesRes.ok) {
                const data = await employeesRes.json();
                setDoctors(data?.employees || []);
            }
        } catch (err) {
            console.error('Error loading dropdown data:', err);
        }
    };

    const loadWorkData = async () => {
        if (!patientId || patientId === 'new') {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await fetch(`/api/getworks?code=${patientId}`);
            if (!response.ok) throw new Error('Failed to fetch work data');
            const works = await response.json();
            const work = works.find(w => w.workid === workId);

            if (work) {
                setFormData({
                    PersonID: work.PersonID,
                    TotalRequired: work.TotalRequired ?? 0, // Use nullish coalescing to preserve 0
                    Currency: work.Currency || 'USD',
                    Typeofwork: work.Typeofwork || '',
                    Notes: work.Notes || '',
                    Status: work.Status ?? 1, // Use nullish coalescing to preserve 0 if somehow status is 0
                    StartDate: work.StartDate ? new Date(work.StartDate).toISOString().split('T')[0] : '',
                    DebondDate: work.DebondDate ? new Date(work.DebondDate).toISOString().split('T')[0] : '',
                    FPhotoDate: work.FPhotoDate ? new Date(work.FPhotoDate).toISOString().split('T')[0] : '',
                    IPhotoDate: work.IPhotoDate ? new Date(work.IPhotoDate).toISOString().split('T')[0] : '',
                    EstimatedDuration: work.EstimatedDuration || '',
                    DrID: work.DrID || '',
                    NotesDate: work.NotesDate ? new Date(work.NotesDate).toISOString().split('T')[0] : '',
                    KeyWordID1: work.KeyWordID1 || '',
                    KeyWordID2: work.KeyWordID2 || '',
                    KeywordID3: work.KeywordID3 || '',
                    KeywordID4: work.KeywordID4 || '',
                    KeywordID5: work.KeywordID5 || ''
                });
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleFormSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        // If createAsFinished is checked and we're adding a new work, show confirmation dialog
        if (!workId && formData.createAsFinished) {
            // Validate before showing confirmation
            if (!formData.TotalRequired || parseFloat(formData.TotalRequired) <= 0) {
                setError('Cannot create finished work: Total Required must be greater than 0');
                return;
            }
            if (!formData.Currency) {
                setError('Cannot create finished work: Currency must be selected');
                return;
            }
            setShowFinishedWorkConfirm(true);
            return;
        }

        // Continue with normal submission
        await performSubmit();
    };

    const performSubmit = async () => {
        try {
            setLoading(true);
            let response;

            if (workId) {
                // Update existing work
                // Send all fields - backend middleware handles authorization
                // Backend will reject money field updates for old works if user is secretary
                response = await fetch('/api/updatework', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        workId,
                        ...formData
                    })
                });
            } else {
                // Add new work - use special endpoint if createAsFinished is true
                const endpoint = formData.createAsFinished ? '/api/addWorkWithInvoice' : '/api/addwork';
                response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                // Handle specific error cases with detailed messages
                // Check for DUPLICATE_ACTIVE_WORK in details.code or top-level code
                const errorCode = errorData.details?.code || errorData.code;
                if (errorCode === 'DUPLICATE_ACTIVE_WORK') {
                    // Show confirmation dialog instead of error
                    setExistingWorkData(errorData.details?.existingWork || errorData.existingWork);
                    setPendingFormData(formData);
                    setShowConfirmDialog(true);
                    setLoading(false);
                    return;
                }

                // Handle 409 Conflict - Status change conflict (Active work already exists)
                if (response.status === 409 && errorData.existingWork) {
                    const existingWork = errorData.existingWork;
                    const errorMessage = `Cannot activate this work: Patient already has an active work:\n\n` +
                        `Work Type: ${existingWork.type || 'N/A'}\n` +
                        `Doctor: ${existingWork.doctor || 'N/A'}\n` +
                        `Work ID: ${existingWork.workid}\n\n` +
                        `Please finish or discontinue the existing work first.`;
                    throw new Error(errorMessage);
                }

                // Extract error message properly (details.message > message > details > error)
                const errorMessage = errorData.details?.message || errorData.message || errorData.details || errorData.error || 'Failed to save work';
                throw new Error(errorMessage);
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
    };

    const handleFinishExistingAndAddNew = async () => {
        try {
            setLoading(true);
            setShowConfirmDialog(false);

            // First, finish the existing work
            const finishResponse = await fetch('/api/finishwork', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workId: existingWorkData.workId })
            });

            if (!finishResponse.ok) {
                throw new Error('Failed to finish existing work');
            }

            // Now add the new work
            const addResponse = await fetch('/api/addwork', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pendingFormData)
            });

            if (!addResponse.ok) {
                const errorData = await addResponse.json();
                throw new Error(errorData.details || errorData.error || 'Failed to add new work');
            }

            const result = await addResponse.json();
            if (onSave) {
                onSave(result);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
            setExistingWorkData(null);
            setPendingFormData(null);
        }
    };

    const handleCancelConfirmation = () => {
        setShowConfirmDialog(false);
        setExistingWorkData(null);
        setPendingFormData(null);
        setLoading(false);
    };

    const handleConfirmFinishedWork = async () => {
        setShowFinishedWorkConfirm(false);
        await performSubmit();
    };

    const handleCancelFinishedWork = () => {
        setShowFinishedWorkConfirm(false);
    };

    if (loading && workId) {
        return (
            <div className="new-work-loading">
                <i className="fas fa-spinner fa-spin"></i> Loading work data...
            </div>
        );
    }

    return (
        <div className="new-work-component">
            {/* Header */}
            <div className="new-work-header">
                <h3>
                    <i className="fas fa-tooth"></i> {workId ? 'Edit Work' : 'Add New Work'}
                </h3>
            </div>

            {/* Error Display */}
            {error && (
                <div className="new-work-error">
                    <i className="fas fa-exclamation-circle"></i> {error}
                    <button onClick={() => setError(null)} className="error-close">×</button>
                </div>
            )}

            {/* Confirmation Dialog for Duplicate Active Work */}
            {showConfirmDialog && existingWorkData && (
                <div className="confirmation-dialog-overlay">
                    <div className="confirmation-dialog">
                        <div className="confirmation-header">
                            <i className="fas fa-exclamation-triangle"></i>
                            <h3>Active Work Already Exists</h3>
                        </div>
                        <div className="confirmation-body">
                            <p>This patient already has an active work record:</p>
                            <div className="existing-work-details">
                                <div className="detail-row">
                                    <strong>Work Type:</strong> {existingWorkData.typeName || `Type ${existingWorkData.typeOfWork}`}
                                </div>
                                <div className="detail-row">
                                    <strong>Doctor:</strong> {existingWorkData.doctor || 'N/A'}
                                </div>
                                <div className="detail-row">
                                    <strong>Total Required:</strong> {existingWorkData.totalRequired} {existingWorkData.currency}
                                </div>
                                <div className="detail-row">
                                    <strong>Added:</strong> {existingWorkData.additionDate ? new Date(existingWorkData.additionDate).toLocaleDateString() : 'N/A'}
                                </div>
                            </div>
                            <p className="confirmation-question">
                                Would you like to finish the existing work and add this new one?
                            </p>
                        </div>
                        <div className="confirmation-actions">
                            <button
                                onClick={handleFinishExistingAndAddNew}
                                className="btn btn-primary"
                                disabled={loading}
                            >
                                <i className="fas fa-check"></i> Yes, Finish & Add New
                            </button>
                            <button
                                onClick={handleCancelConfirmation}
                                className="btn btn-secondary"
                                disabled={loading}
                            >
                                <i className="fas fa-times"></i> Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmation Dialog for Finished Work with Invoice */}
            {showFinishedWorkConfirm && (
                <div className="confirmation-dialog-overlay">
                    <div className="confirmation-dialog">
                        <div className="confirmation-header">
                            <i className="fas fa-check-circle"></i>
                            <h3>Confirm Completed Work Creation</h3>
                        </div>
                        <div className="confirmation-body">
                            <p>You are about to create:</p>
                            <div className="existing-work-details">
                                <div className="detail-section">
                                    <h4><i className="fas fa-tooth"></i> New Work (FINISHED)</h4>
                                    <div className="detail-row">
                                        <strong>Type:</strong> {workTypes.find(t => t.ID == formData.Typeofwork)?.WorkType || 'N/A'}
                                    </div>
                                    <div className="detail-row">
                                        <strong>Doctor:</strong> {doctors.find(d => d.ID == formData.DrID)?.employeeName || 'N/A'}
                                    </div>
                                    <div className="detail-row">
                                        <strong>Total:</strong> {formData.TotalRequired} {formData.Currency}
                                    </div>
                                    <div className="detail-row">
                                        <strong>Status:</strong> <span className="status-completed">Completed</span>
                                    </div>
                                </div>
                                <div className="detail-section">
                                    <h4><i className="fas fa-file-invoice-dollar"></i> Full Payment Invoice</h4>
                                    <div className="detail-row">
                                        <strong>Amount:</strong> {formData.TotalRequired} {formData.Currency}
                                    </div>
                                    <div className="detail-row">
                                        <strong>Date:</strong> Today ({new Date().toLocaleDateString()})
                                    </div>
                                </div>
                            </div>
                            <p className="confirmation-question">
                                <strong>This work will be marked as fully paid and finished immediately.</strong>
                            </p>
                        </div>
                        <div className="confirmation-actions">
                            <button
                                onClick={handleConfirmFinishedWork}
                                className="btn btn-primary"
                                disabled={loading}
                            >
                                <i className="fas fa-check"></i> Confirm & Create
                            </button>
                            <button
                                onClick={handleCancelFinishedWork}
                                className="btn btn-secondary"
                                disabled={loading}
                            >
                                <i className="fas fa-times"></i> Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Form */}
            <form onSubmit={handleFormSubmit} className="new-work-form">
                {/* Top Action Buttons */}
                <div className="form-actions top-actions">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        <i className="fas fa-save"></i> {loading ? 'Saving...' : (workId ? 'Update' : 'Add Work')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            <i className="fas fa-times"></i> Cancel
                        </button>
                    )}
                </div>

                {/* Tabs */}
                <div className="work-tabs">
                    <button
                        type="button"
                        className={`work-tab ${activeTab === 'basic' ? 'active' : ''}`}
                        onClick={() => setActiveTab('basic')}
                    >
                        <i className="fas fa-info-circle"></i> Basic Info
                    </button>
                    <button
                        type="button"
                        className={`work-tab ${activeTab === 'dates' ? 'active' : ''}`}
                        onClick={() => setActiveTab('dates')}
                    >
                        <i className="fas fa-calendar"></i> Dates
                    </button>
                    <button
                        type="button"
                        className={`work-tab ${activeTab === 'keywords' ? 'active' : ''}`}
                        onClick={() => setActiveTab('keywords')}
                    >
                        <i className="fas fa-tags"></i> Keywords
                    </button>
                </div>

                {/* Tab 1: Basic Information */}
                <div className={`tab-content ${activeTab === 'basic' ? 'active' : ''}`}>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Work Type <span className="required">*</span></label>
                            <select
                                value={formData.Typeofwork}
                                onChange={(e) => setFormData({...formData, Typeofwork: e.target.value})}
                                required
                            >
                                <option value="">Select Type</option>
                                {workTypes.map(type => (
                                    <option key={type.ID} value={type.ID}>
                                        {type.WorkType}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label>Doctor <span className="required">*</span></label>
                            <select
                                value={formData.DrID}
                                onChange={(e) => setFormData({...formData, DrID: e.target.value})}
                                required
                            >
                                <option value="">Select Doctor</option>
                                {doctors.map(doctor => (
                                    <option key={doctor.ID} value={doctor.ID}>
                                        {doctor.employeeName}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {workId && (
                        <div className="form-row">
                            <div className="form-group">
                                <label>Status <span className="required">*</span></label>
                                <select
                                    value={formData.Status}
                                    onChange={(e) => setFormData({...formData, Status: parseInt(e.target.value)})}
                                    required
                                >
                                    <option value={1}>Active</option>
                                    <option value={2}>Finished</option>
                                    <option value={3}>Discontinued</option>
                                </select>
                                {formData.Status === 2 && (
                                    <small className="form-hint text-warning">
                                        <i className="fas fa-exclamation-triangle"></i> Finishing a work marks the treatment as completed
                                    </small>
                                )}
                                {formData.Status === 3 && (
                                    <small className="form-hint text-warning">
                                        <i className="fas fa-exclamation-triangle"></i> Discontinuing a work indicates the patient abandoned treatment
                                    </small>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="form-row">
                        <div className="form-group">
                            <label>Total Required</label>
                            <input
                                type="text"
                                value={displayValues.TotalRequired}
                                onChange={(e) => {
                                    const numericValue = parseFormattedNumber(e.target.value);
                                    setFormData({...formData, TotalRequired: numericValue});
                                    setDisplayValues({TotalRequired: e.target.value});
                                }}
                                onBlur={() => {
                                    setDisplayValues({TotalRequired: formatNumber(formData.TotalRequired)});
                                }}
                                placeholder="Enter amount (defaults to 0)"
                            />
                        </div>

                        <div className="form-group">
                            <label>Currency</label>
                            <select
                                value={formData.Currency}
                                onChange={(e) => setFormData({...formData, Currency: e.target.value})}
                            >
                                <option value="USD">USD</option>
                                <option value="IQD">IQD</option>
                                <option value="EUR">EUR</option>
                            </select>
                        </div>
                    </div>

                    {!workId && (
                        <div className="form-row">
                            <div className="form-group full-width">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={formData.createAsFinished}
                                        onChange={(e) => setFormData({...formData, createAsFinished: e.target.checked})}
                                        disabled={!formData.TotalRequired || parseFloat(formData.TotalRequired) <= 0}
                                    />
                                    <span>
                                        <i className="fas fa-check-circle"></i> Mark as fully paid and finished
                                    </span>
                                </label>
                                <small className="form-hint">
                                    Creates an invoice for the full amount and marks the work as completed
                                </small>
                            </div>
                        </div>
                    )}

                    <div className="form-row">
                        <div className="form-group">
                            <label>Start Date</label>
                            <input
                                type="date"
                                value={formData.StartDate}
                                onChange={(e) => setFormData({...formData, StartDate: e.target.value})}
                            />
                        </div>

                        <div className="form-group">
                            <label>Estimated Duration (months)</label>
                            <input
                                type="number"
                                value={formData.EstimatedDuration}
                                onChange={(e) => setFormData({...formData, EstimatedDuration: e.target.value})}
                                min="1"
                                max="255"
                            />
                        </div>
                    </div>

                    <div className="form-group full-width">
                        <label>Notes</label>
                        <textarea
                            value={formData.Notes}
                            onChange={(e) => setFormData({...formData, Notes: e.target.value})}
                            rows="3"
                            placeholder="Additional notes about this work..."
                        />
                    </div>
                </div>

                {/* Tab 2: Dates */}
                <div className={`tab-content ${activeTab === 'dates' ? 'active' : ''}`}>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Initial Photo Date</label>
                            <input
                                type="date"
                                value={formData.IPhotoDate}
                                onChange={(e) => setFormData({...formData, IPhotoDate: e.target.value})}
                            />
                        </div>

                        <div className="form-group">
                            <label>Final Photo Date</label>
                            <input
                                type="date"
                                value={formData.FPhotoDate}
                                onChange={(e) => setFormData({...formData, FPhotoDate: e.target.value})}
                            />
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>Debond Date</label>
                            <input
                                type="date"
                                value={formData.DebondDate}
                                onChange={(e) => setFormData({...formData, DebondDate: e.target.value})}
                            />
                        </div>

                        <div className="form-group">
                            <label>Notes Date</label>
                            <input
                                type="date"
                                value={formData.NotesDate}
                                onChange={(e) => setFormData({...formData, NotesDate: e.target.value})}
                            />
                        </div>
                    </div>
                </div>

                {/* Tab 3: Keywords */}
                <div className={`tab-content ${activeTab === 'keywords' ? 'active' : ''}`}>
                    <div className="keywords-section">
                        <p className="section-hint">
                            <i className="fas fa-info-circle"></i> Select up to 5 keywords to categorize this work
                        </p>
                        <div className="keywords-grid">
                            {[1, 2, 3, 4, 5].map(num => (
                                <div key={num} className="form-group">
                                    <label>Keyword {num}</label>
                                    <select
                                        value={formData[`KeyWordID${num}`] || formData[`KeywordID${num}`]}
                                        onChange={(e) => {
                                            const field = num === 3 ? 'KeywordID3' : `KeyWordID${num}`;
                                            setFormData({...formData, [field]: e.target.value});
                                        }}
                                    >
                                        <option value="">Select Keyword</option>
                                        {keywords.map(kw => (
                                            <option key={kw.ID} value={kw.ID}>
                                                {kw.KeyWord}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Bottom Form Actions */}
                <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        <i className="fas fa-save"></i> {loading ? 'Saving...' : (workId ? 'Update Work' : 'Add Work')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            <i className="fas fa-times"></i> Cancel
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
};

export default NewWorkComponent;
