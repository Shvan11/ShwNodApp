import React, { useState, useEffect } from 'react';

const SetFormDrawer = ({ isOpen, onClose, onSave, set, workId, doctors, allSets = [] }) => {
    const [formData, setFormData] = useState({
        SetSequence: '',
        Type: '',
        UpperAlignersCount: '',
        LowerAlignersCount: '',
        Days: '',
        AlignerDrID: '',
        SetUrl: '',
        SetPdfUrl: '',
        SetCost: '',
        Currency: 'USD',
        Notes: '',
        IsActive: true
    });

    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);

    // Check if an inactive set can be reactivated
    const cannotReactivate = () => {
        if (!set || set.IsActive) {
            return false; // New sets or already active sets can be changed
        }

        // Get the creation date of current set
        const currentSetDate = new Date(set.CreationDate);

        // Check if there's a newer set (created after this one) with at least one batch
        const hasNewerSetWithBatches = allSets.some(otherSet => {
            // Must be a different set
            if (otherSet.AlignerSetID === set.AlignerSetID) {
                return false;
            }

            const otherSetDate = new Date(otherSet.CreationDate);

            // Must be created after the current set and have at least one batch
            return otherSetDate > currentSetDate && otherSet.TotalBatches > 0;
        });

        return hasNewerSetWithBatches;
    };

    useEffect(() => {
        if (isOpen && set) {
            // Edit mode - populate form
            setFormData({
                SetSequence: set.SetSequence || '',
                Type: set.Type || '',
                UpperAlignersCount: set.UpperAlignersCount || '',
                LowerAlignersCount: set.LowerAlignersCount || '',
                Days: set.Days || '',
                AlignerDrID: set.AlignerDrID || '',
                SetUrl: set.SetUrl || '',
                SetPdfUrl: set.SetPdfUrl || '',
                SetCost: set.SetCost || '',
                Currency: set.Currency || 'USD',
                Notes: set.Notes || '',
                IsActive: set.IsActive !== undefined ? set.IsActive : true
            });
        } else if (isOpen) {
            // Add mode - reset form
            setFormData({
                SetSequence: '',
                Type: '',
                UpperAlignersCount: '',
                LowerAlignersCount: '',
                Days: '',
                AlignerDrID: doctors && doctors.length > 0 ? doctors[0].DrID : '',
                SetUrl: '',
                SetPdfUrl: '',
                SetCost: '',
                Currency: 'USD',
                Notes: '',
                IsActive: true
            });
        }
        setErrors({});
    }, [isOpen, set, doctors]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
        // Clear error for this field
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: null }));
        }
    };

    const validate = () => {
        const newErrors = {};

        if (!formData.SetSequence || formData.SetSequence === '') {
            newErrors.SetSequence = 'Set sequence is required';
        }

        if (!formData.AlignerDrID) {
            newErrors.AlignerDrID = 'Doctor is required';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validate()) {
            return;
        }

        setSaving(true);

        try {
            const dataToSend = {
                ...formData,
                WorkID: workId
            };

            const url = set
                ? `/api/aligner/sets/${set.AlignerSetID}`
                : '/api/aligner/sets';

            const method = set ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataToSend)
            });

            const result = await response.json();

            if (result.success) {
                onSave();
                onClose();
            } else {
                alert('Error: ' + (result.error || 'Failed to save set'));
            }
        } catch (error) {
            console.error('Error saving set:', error);
            alert('Error saving set: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-container" onClick={(e) => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>{set ? 'Edit Aligner Set' : 'Add New Aligner Set'}</h2>
                    <button className="close-btn" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="drawer-body">
                    <form onSubmit={handleSubmit} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        {/* Basic Info Section */}
                        <div className="form-section">
                            <h3>Basic Information</h3>

                            <div className="form-row">
                                <div className="form-field">
                                    <label htmlFor="SetSequence">
                                        Set Sequence <span className="required">*</span>
                                    </label>
                                    <input
                                        type="number"
                                        id="SetSequence"
                                        name="SetSequence"
                                        value={formData.SetSequence}
                                        onChange={handleChange}
                                        className={errors.SetSequence ? 'error' : ''}
                                        min="1"
                                    />
                                    {errors.SetSequence && (
                                        <span className="error-message">{errors.SetSequence}</span>
                                    )}
                                </div>

                                <div className="form-field">
                                    <label htmlFor="Type">Type</label>
                                    <select
                                        id="Type"
                                        name="Type"
                                        value={formData.Type}
                                        onChange={handleChange}
                                    >
                                        <option value="">Select Type</option>
                                        <option value="Initial">Initial</option>
                                        <option value="Refinement">Refinement</option>
                                        <option value="Revision">Revision</option>
                                    </select>
                                </div>
                            </div>

                            <div className="form-field">
                                <label htmlFor="AlignerDrID">
                                    Aligner Doctor <span className="required">*</span>
                                </label>
                                <select
                                    id="AlignerDrID"
                                    name="AlignerDrID"
                                    value={formData.AlignerDrID}
                                    onChange={handleChange}
                                    className={errors.AlignerDrID ? 'error' : ''}
                                >
                                    <option value="">Select Doctor</option>
                                    {doctors && doctors.map(doctor => (
                                        <option key={doctor.DrID} value={doctor.DrID}>
                                            {doctor.DoctorName}
                                        </option>
                                    ))}
                                </select>
                                {errors.AlignerDrID && (
                                    <span className="error-message">{errors.AlignerDrID}</span>
                                )}
                            </div>
                        </div>

                        {/* Aligner Counts Section */}
                        <div className="form-section">
                            <h3>Aligner Counts</h3>

                            <div className="form-row">
                                <div className="form-field">
                                    <label htmlFor="UpperAlignersCount">Upper Aligners</label>
                                    <input
                                        type="number"
                                        id="UpperAlignersCount"
                                        name="UpperAlignersCount"
                                        value={formData.UpperAlignersCount}
                                        onChange={handleChange}
                                        min="0"
                                    />
                                </div>

                                <div className="form-field">
                                    <label htmlFor="LowerAlignersCount">Lower Aligners</label>
                                    <input
                                        type="number"
                                        id="LowerAlignersCount"
                                        name="LowerAlignersCount"
                                        value={formData.LowerAlignersCount}
                                        onChange={handleChange}
                                        min="0"
                                    />
                                </div>
                            </div>

                            <div className="form-field">
                                <label htmlFor="Days">Treatment Days</label>
                                <input
                                    type="number"
                                    id="Days"
                                    name="Days"
                                    value={formData.Days}
                                    onChange={handleChange}
                                    min="0"
                                />
                            </div>
                        </div>

                        {/* URLs Section */}
                        <div className="form-section">
                            <h3>Links & Resources</h3>

                            <div className="form-field">
                                <label htmlFor="SetUrl">Set URL</label>
                                <input
                                    type="url"
                                    id="SetUrl"
                                    name="SetUrl"
                                    value={formData.SetUrl}
                                    onChange={handleChange}
                                    placeholder="https://..."
                                />
                            </div>

                            <div className="form-field">
                                <label htmlFor="SetPdfUrl">PDF URL (Google Drive)</label>
                                <input
                                    type="url"
                                    id="SetPdfUrl"
                                    name="SetPdfUrl"
                                    value={formData.SetPdfUrl}
                                    onChange={handleChange}
                                    placeholder="https://drive.google.com/..."
                                />
                            </div>
                        </div>

                        {/* Cost Section */}
                        <div className="form-section">
                            <h3>Cost Information</h3>
                            <div className="form-row">
                                <div className="form-field">
                                    <label htmlFor="SetCost">Set Cost</label>
                                    <input
                                        type="number"
                                        id="SetCost"
                                        name="SetCost"
                                        value={formData.SetCost}
                                        onChange={handleChange}
                                        step="0.01"
                                        min="0"
                                        placeholder="0.00"
                                    />
                                </div>
                                <div className="form-field">
                                    <label htmlFor="Currency">Currency</label>
                                    <select
                                        id="Currency"
                                        name="Currency"
                                        value={formData.Currency}
                                        onChange={handleChange}
                                    >
                                        <option value="USD">USD</option>
                                        <option value="IQD">IQD</option>
                                        <option value="EUR">EUR</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Notes Section */}
                        <div className="form-section">
                            <div className="form-field">
                                <label htmlFor="Notes">Notes</label>
                                <textarea
                                    id="Notes"
                                    name="Notes"
                                    value={formData.Notes}
                                    onChange={handleChange}
                                    rows="3"
                                    placeholder="Additional notes..."
                                />
                            </div>

                            <div className="form-field-checkbox">
                                {cannotReactivate() ? (
                                    <div style={{
                                        padding: '0.75rem',
                                        background: '#fff3cd',
                                        border: '1px solid #ffc107',
                                        borderRadius: '6px',
                                        color: '#856404'
                                    }}>
                                        <i className="fas fa-info-circle" style={{ marginRight: '0.5rem' }}></i>
                                        <strong>Old Inactive Set:</strong> This set cannot be reactivated because there are newer sets with batches.
                                    </div>
                                ) : (
                                    <>
                                        <input
                                            type="checkbox"
                                            id="IsActive"
                                            name="IsActive"
                                            checked={formData.IsActive}
                                            onChange={handleChange}
                                        />
                                        <label htmlFor="IsActive">Active Set</label>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="drawer-footer">
                            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={saving}>
                                {saving ? (
                                    <>
                                        <i className="fas fa-spinner fa-spin"></i> Saving...
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-save"></i> {set ? 'Update Set' : 'Create Set'}
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default SetFormDrawer;
