import React, { useState, useEffect } from 'react';

const BatchFormDrawer = ({ isOpen, onClose, onSave, batch, set, existingBatches = [] }) => {
    const [formData, setFormData] = useState({
        BatchSequence: '',
        UpperAlignerCount: '',
        LowerAlignerCount: '',
        Days: '',
        ManufactureDate: '',
        DeliveredToPatientDate: '',
        Notes: '',
        IsActive: true
    });

    const [computedFields, setComputedFields] = useState({
        UpperAlignerStartSequence: 1,
        LowerAlignerStartSequence: 1,
        UpperAlignerEndSequence: null,
        LowerAlignerEndSequence: null
    });

    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen && batch) {
            // Edit mode - populate form
            setFormData({
                BatchSequence: batch.BatchSequence || '',
                UpperAlignerCount: batch.UpperAlignerCount || '',
                LowerAlignerCount: batch.LowerAlignerCount || '',
                Days: batch.Days || '',
                ManufactureDate: batch.ManufactureDate ? batch.ManufactureDate.split('T')[0] : '',
                DeliveredToPatientDate: batch.DeliveredToPatientDate ? batch.DeliveredToPatientDate.split('T')[0] : '',
                Notes: batch.Notes || '',
                IsActive: batch.IsActive !== undefined ? batch.IsActive : true
            });
            setComputedFields({
                UpperAlignerStartSequence: batch.UpperAlignerStartSequence || 1,
                LowerAlignerStartSequence: batch.LowerAlignerStartSequence || 1,
                UpperAlignerEndSequence: batch.UpperAlignerEndSequence,
                LowerAlignerEndSequence: batch.LowerAlignerEndSequence
            });
        } else if (isOpen) {
            // Add mode - calculate next batch sequence and start sequences
            const nextBatchSequence = existingBatches.length > 0
                ? Math.max(...existingBatches.map(b => b.BatchSequence || 0)) + 1
                : 1;

            // Calculate start sequences based on last batch's end sequences
            let upperStart = 1;
            let lowerStart = 1;

            if (existingBatches.length > 0) {
                const lastBatch = existingBatches.reduce((latest, batch) =>
                    (batch.BatchSequence > latest.BatchSequence) ? batch : latest
                );

                upperStart = (lastBatch.UpperAlignerEndSequence || 0) + 1;
                lowerStart = (lastBatch.LowerAlignerEndSequence || 0) + 1;
            }

            setFormData({
                BatchSequence: nextBatchSequence,
                UpperAlignerCount: '',
                LowerAlignerCount: '',
                Days: '',
                ManufactureDate: '',
                DeliveredToPatientDate: '',
                Notes: '',
                IsActive: true
            });

            setComputedFields({
                UpperAlignerStartSequence: upperStart,
                LowerAlignerStartSequence: lowerStart,
                UpperAlignerEndSequence: null,
                LowerAlignerEndSequence: null
            });
        }
        setErrors({});
    }, [isOpen, batch, existingBatches]);

    // Auto-calculate end sequences when counts change
    useEffect(() => {
        const upperCount = parseInt(formData.UpperAlignerCount);
        const lowerCount = parseInt(formData.LowerAlignerCount);

        setComputedFields(prev => ({
            ...prev,
            UpperAlignerEndSequence: !isNaN(upperCount) && upperCount > 0
                ? prev.UpperAlignerStartSequence + upperCount - 1
                : null,
            LowerAlignerEndSequence: !isNaN(lowerCount) && lowerCount > 0
                ? prev.LowerAlignerStartSequence + lowerCount - 1
                : null
        }));
    }, [formData.UpperAlignerCount, formData.LowerAlignerCount]);

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

        if (!formData.BatchSequence || formData.BatchSequence === '') {
            newErrors.BatchSequence = 'Batch sequence is required';
        }

        // Validate upper aligner count doesn't exceed remaining
        if (set && formData.UpperAlignerCount) {
            const upperCount = parseInt(formData.UpperAlignerCount);
            if (!isNaN(upperCount) && upperCount > set.RemainingUpperAligners) {
                newErrors.UpperAlignerCount = `Cannot exceed ${set.RemainingUpperAligners} remaining upper aligners`;
            }
        }

        // Validate lower aligner count doesn't exceed remaining
        if (set && formData.LowerAlignerCount) {
            const lowerCount = parseInt(formData.LowerAlignerCount);
            if (!isNaN(lowerCount) && lowerCount > set.RemainingLowerAligners) {
                newErrors.LowerAlignerCount = `Cannot exceed ${set.RemainingLowerAligners} remaining lower aligners`;
            }
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
                AlignerSetID: set?.AlignerSetID,
                UpperAlignerStartSequence: computedFields.UpperAlignerStartSequence,
                LowerAlignerStartSequence: computedFields.LowerAlignerStartSequence
            };

            const url = batch
                ? `/api/aligner/batches/${batch.AlignerBatchID}`
                : '/api/aligner/batches';

            const method = batch ? 'PUT' : 'POST';

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
                alert('Error: ' + (result.error || 'Failed to save batch'));
            }
        } catch (error) {
            console.error('Error saving batch:', error);
            alert('Error saving batch: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-container" onClick={(e) => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>{batch ? 'Edit Batch' : 'Add New Batch'}</h2>
                    <button className="close-btn" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="drawer-body">
                    <form onSubmit={handleSubmit} style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        {/* Action Buttons - Top */}
                        <div className="drawer-footer" style={{ borderTop: 'none', borderBottom: '1px solid #e0e0e0', marginTop: 0 }}>
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
                                        <i className="fas fa-save"></i> {batch ? 'Update Batch' : 'Create Batch'}
                                    </>
                                )}
                            </button>
                            </h3>

                            <div className="form-row">
                                <div className="form-field">
                                    <label htmlFor="UpperAlignerStartSequence">Start Sequence (Auto)</label>
                                    <input
                                        type="number"
                                        id="UpperAlignerStartSequence"
                                        value={computedFields.UpperAlignerStartSequence}
                                        readOnly
                                        className="readonly"
                                    />
                                </div>

                                <div className="form-field">
                                    <label htmlFor="UpperAlignerCount">Count</label>
                                    <input
                                        type="number"
                                        id="UpperAlignerCount"
                                        name="UpperAlignerCount"
                                        value={formData.UpperAlignerCount}
                                        onChange={handleChange}
                                        className={errors.UpperAlignerCount ? 'error' : ''}
                                        min="0"
                                        placeholder="Number of aligners"
                                    />
                                    {errors.UpperAlignerCount && (
                                        <span className="error-message">{errors.UpperAlignerCount}</span>
                                    )}
                                </div>

                                <div className="form-field">
                                    <label htmlFor="UpperAlignerEndSequence">End Sequence (Auto)</label>
                                    <input
                                        type="number"
                                        id="UpperAlignerEndSequence"
                                        value={computedFields.UpperAlignerEndSequence || ''}
                                        readOnly
                                        className="readonly"
                                        placeholder="Auto-calculated"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Two-Column Layout Container */}
                        <div className="form-two-column-container">
                            {/* Left Column */}
                            <div className="form-column">
                                {/* Basic Info Section */}
                                <div className="form-section">
                                    <h3>Basic Information</h3>
                                    <div className="form-field">
                                        <label htmlFor="BatchSequence">
                                            Batch Sequence <span className="required">*</span>
                                        </label>
                                        <input
                                            type="number"
                                            id="BatchSequence"
                                            name="BatchSequence"
                                            value={formData.BatchSequence}
                                            onChange={handleChange}
                                            className={errors.BatchSequence ? 'error' : ''}
                                            min="1"
                                        />
                                        {errors.BatchSequence && (
                                            <span className="error-message">{errors.BatchSequence}</span>
                                        )}
                                    </div>
                                </div>

                                {/* Upper Aligners Section */}
                                <div className="form-section">
                                    <h3>Upper Aligners
                                        {set && (
                                            <span style={{ marginLeft: '1rem', fontSize: '0.9rem', fontWeight: 'normal', color: '#6b7280' }}>
                                                (Remaining: <strong style={{ color: set.RemainingUpperAligners > 0 ? '#059669' : '#dc2626' }}>{set.RemainingUpperAligners}</strong>)
                                            </span>
                                        )}
                                    </h3>

                                    <div className="form-field">
                                        <label htmlFor="UpperAlignerStartSequence">Start Sequence (Auto)</label>
                                        <input
                                            type="number"
                                            id="UpperAlignerStartSequence"
                                            value={computedFields.UpperAlignerStartSequence}
                                            readOnly
                                            className="readonly"
                                        />
                                    </div>

                                    <div className="form-field">
                                        <label htmlFor="UpperAlignerCount">Count</label>
                                        <input
                                            type="number"
                                            id="UpperAlignerCount"
                                            name="UpperAlignerCount"
                                            value={formData.UpperAlignerCount}
                                            onChange={handleChange}
                                            className={errors.UpperAlignerCount ? 'error' : ''}
                                            min="0"
                                            max={set?.RemainingUpperAligners}
                                            placeholder="Number of aligners"
                                        />
                                        {errors.UpperAlignerCount && (
                                            <span className="error-message">{errors.UpperAlignerCount}</span>
                                        )}
                                    </div>

                                    <div className="form-field">
                                        <label htmlFor="UpperAlignerEndSequence">End Sequence (Auto)</label>
                                        <input
                                            type="number"
                                            id="UpperAlignerEndSequence"
                                            value={computedFields.UpperAlignerEndSequence || ''}
                                            readOnly
                                            className="readonly"
                                            placeholder="Auto-calculated"
                                        />
                                    </div>
                                <div className="form-field">
                                    <label htmlFor="LowerAlignerCount">Count</label>
                                    <input
                                        type="number"
                                        id="LowerAlignerCount"
                                        name="LowerAlignerCount"
                                        value={formData.LowerAlignerCount}
                                        onChange={handleChange}
                                        className={errors.LowerAlignerCount ? 'error' : ''}
                                        min="0"
                                        placeholder="Number of aligners"
                                    />
                                    {errors.LowerAlignerCount && (
                                        <span className="error-message">{errors.LowerAlignerCount}</span>
                                    )}
                                </div>

                                <div className="form-field">
                                    <label htmlFor="LowerAlignerEndSequence">End Sequence (Auto)</label>
                                    <input
                                        type="number"
                                        id="LowerAlignerEndSequence"
                                        value={computedFields.LowerAlignerEndSequence || ''}
                                        readOnly
                                        className="readonly"
                                        placeholder="Auto-calculated"
                                    />
                                </div>
                            </div>

                            {/* Right Column */}
                            <div className="form-column">
                                {/* Lower Aligners Section */}
                                <div className="form-section">
                                    <h3>Lower Aligners
                                        {set && (
                                            <span style={{ marginLeft: '1rem', fontSize: '0.9rem', fontWeight: 'normal', color: '#6b7280' }}>
                                                (Remaining: <strong style={{ color: set.RemainingLowerAligners > 0 ? '#059669' : '#dc2626' }}>{set.RemainingLowerAligners}</strong>)
                                            </span>
                                        )}
                                    </h3>

                                    <div className="form-field">
                                        <label htmlFor="LowerAlignerStartSequence">Start Sequence (Auto)</label>
                                        <input
                                            type="number"
                                            id="LowerAlignerStartSequence"
                                            value={computedFields.LowerAlignerStartSequence}
                                            readOnly
                                            className="readonly"
                                        />
                                    </div>

                                    <div className="form-field">
                                        <label htmlFor="LowerAlignerCount">Count</label>
                                        <input
                                            type="number"
                                            id="LowerAlignerCount"
                                            name="LowerAlignerCount"
                                            value={formData.LowerAlignerCount}
                                            onChange={handleChange}
                                            className={errors.LowerAlignerCount ? 'error' : ''}
                                            min="0"
                                            max={set?.RemainingLowerAligners}
                                            placeholder="Number of aligners"
                                        />
                                        {errors.LowerAlignerCount && (
                                            <span className="error-message">{errors.LowerAlignerCount}</span>
                                        )}
                                    </div>

                                    <div className="form-field">
                                        <label htmlFor="LowerAlignerEndSequence">End Sequence (Auto)</label>
                                        <input
                                            type="number"
                                            id="LowerAlignerEndSequence"
                                            value={computedFields.LowerAlignerEndSequence || ''}
                                            readOnly
                                            className="readonly"
                                            placeholder="Auto-calculated"
                                        />
                                    </div>
                                </div>

                                {/* Dates Section */}
                                <div className="form-section">
                                    <h3>Dates & Timing</h3>

                                    <div className="form-field">
                                        <label htmlFor="ManufactureDate">Manufacture Date</label>
                                        <input
                                            type="date"
                                            id="ManufactureDate"
                                            name="ManufactureDate"
                                            value={formData.ManufactureDate}
                                            onChange={handleChange}
                                        />
                                    </div>

                                    <div className="form-field">
                                        <label htmlFor="DeliveredToPatientDate">Delivered Date</label>
                                        <input
                                            type="date"
                                            id="DeliveredToPatientDate"
                                            name="DeliveredToPatientDate"
                                            value={formData.DeliveredToPatientDate}
                                            onChange={handleChange}
                                        />
                                    </div>

                                    <div className="form-field">
                                        <label htmlFor="Days">Days per Aligner</label>
                                        <input
                                            type="number"
                                            id="Days"
                                            name="Days"
                                            value={formData.Days}
                                            onChange={handleChange}
                                            min="1"
                                            placeholder="Days to wear each aligner"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Notes Section - Full Width */}
                        <div className="form-section" style={{ padding: '0 1.5rem' }}>
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
                                <input
                                    type="checkbox"
                                    id="IsActive"
                                    name="IsActive"
                                    checked={formData.IsActive}
                                    onChange={handleChange}
                                />
                                <label htmlFor="IsActive">Active Batch</label>
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
                                        <i className="fas fa-save"></i> {batch ? 'Update Batch' : 'Create Batch'}
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

export default BatchFormDrawer;
