/**
 * NewWorkComponent - Standalone form for adding/editing works
 *
 * Compact, space-efficient form with keyword management
 */

import React, { useState, useEffect } from 'react';

const NewWorkComponent = ({ patientId, workId = null, onSave, onCancel }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [workTypes, setWorkTypes] = useState([]);
    const [keywords, setKeywords] = useState([]);
    const [doctors, setDoctors] = useState([]);
    const [activeTab, setActiveTab] = useState('basic');

    // Form state
    const [formData, setFormData] = useState({
        PersonID: patientId,
        TotalRequired: 0,
        Currency: 'USD',
        Typeofwork: '',
        Notes: '',
        Finished: false,
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
        KeywordID5: ''
    });

    useEffect(() => {
        loadDropdownData();
        if (workId) {
            loadWorkData();
        }
    }, [patientId, workId]);

    const loadDropdownData = async () => {
        try {
            const [typesRes, keywordsRes, doctorsRes] = await Promise.all([
                fetch('/api/getworktypes'),
                fetch('/api/getworkkeywords'),
                fetch('/api/doctors')
            ]);

            if (typesRes.ok) {
                const types = await typesRes.json();
                setWorkTypes(types);
            }
            if (keywordsRes.ok) {
                const kw = await keywordsRes.json();
                setKeywords(kw);
            }
            if (doctorsRes.ok) {
                const docs = await doctorsRes.json();
                setDoctors(docs);
            }
        } catch (err) {
            console.error('Error loading dropdown data:', err);
        }
    };

    const loadWorkData = async () => {
        try {
            setLoading(true);
            const response = await fetch(`/api/getworks?code=${patientId}`);
            if (!response.ok) throw new Error('Failed to fetch work data');
            const works = await response.json();
            const work = works.find(w => w.workid === workId);

            if (work) {
                setFormData({
                    PersonID: work.PersonID,
                    TotalRequired: work.TotalRequired || '',
                    Currency: work.Currency || 'USD',
                    Typeofwork: work.Typeofwork || '',
                    Notes: work.Notes || '',
                    Finished: work.Finished || false,
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

        try {
            setLoading(true);
            let response;

            if (workId) {
                // Update existing work
                response = await fetch('/api/updatework', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workId, ...formData })
                });
            } else {
                // Add new work
                response = await fetch('/api/addwork', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save work');
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

            {/* Form */}
            <form onSubmit={handleFormSubmit} className="new-work-form">
                {/* Top Action Buttons */}
                <div className="form-actions top-actions">
                    <button type="submit" className="btn-primary" disabled={loading}>
                        <i className="fas fa-save"></i> {loading ? 'Saving...' : (workId ? 'Update' : 'Add Work')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn-secondary">
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
                                        {type.TypeName}
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

                    <div className="form-row">
                        <div className="form-group">
                            <label>Total Required <span className="required">*</span></label>
                            <input
                                type="number"
                                value={formData.TotalRequired}
                                onChange={(e) => setFormData({...formData, TotalRequired: e.target.value})}
                                min="0"
                                step="0.01"
                                required
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
                    <button type="submit" className="btn-primary" disabled={loading}>
                        <i className="fas fa-save"></i> {loading ? 'Saving...' : (workId ? 'Update Work' : 'Add Work')}
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

export default NewWorkComponent;
