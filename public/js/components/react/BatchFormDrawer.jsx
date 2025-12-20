import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';

const BatchFormDrawer = ({ isOpen, onClose, onSave, batch, set, existingBatches = [], onUndoManufacture, onUndoDelivery }) => {
    const toast = useToast();
    const [formData, setFormData] = useState({
        BatchSequence: '',
        UpperAlignerCount: '',
        LowerAlignerCount: '',
        Days: '',
        ManufactureDate: '',
        DeliveredToPatientDate: '',
        Notes: '',
        IsActive: true,
        IsLast: false
    });

    const [computedFields, setComputedFields] = useState({
        UpperAlignerStartSequence: 1,
        LowerAlignerStartSequence: 1,
        UpperAlignerEndSequence: null,
        LowerAlignerEndSequence: null
    });

    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const previousIsOpenRef = useRef(false);

    // Template option - only for first batch (when no existing batches OR editing the first batch)
    // Separate controls for upper and lower
    const [includeUpperTemplate, setIncludeUpperTemplate] = useState(true);
    const [includeLowerTemplate, setIncludeLowerTemplate] = useState(true);
    const isFirstBatch = existingBatches.length === 0;
    // When editing, check if this batch is the first one (no other batch has a lower sequence)
    const isEditingFirstBatch = batch && !existingBatches.some(b =>
        b.AlignerBatchID !== batch.AlignerBatchID && b.BatchSequence < batch.BatchSequence
    );
    const canChangeTemplateOption = isFirstBatch || isEditingFirstBatch;

    useEffect(() => {
        // Only run when drawer opens (isOpen transitions from false to true)
        if (isOpen && !previousIsOpenRef.current) {
            if (batch) {
                // Edit mode - populate form
                setFormData({
                    BatchSequence: batch.BatchSequence || '',
                    UpperAlignerCount: batch.UpperAlignerCount || '',
                    LowerAlignerCount: batch.LowerAlignerCount || '',
                    Days: batch.Days || '',
                    ManufactureDate: batch.ManufactureDate ? batch.ManufactureDate.split('T')[0] : '',
                    DeliveredToPatientDate: batch.DeliveredToPatientDate ? batch.DeliveredToPatientDate.split('T')[0] : '',
                    Notes: batch.Notes || '',
                    IsActive: batch.IsActive !== undefined ? batch.IsActive : true,
                    IsLast: batch.IsLast !== undefined ? batch.IsLast : false
                });
                setComputedFields({
                    UpperAlignerStartSequence: batch.UpperAlignerStartSequence ?? 1,
                    LowerAlignerStartSequence: batch.LowerAlignerStartSequence ?? 1,
                    UpperAlignerEndSequence: batch.UpperAlignerEndSequence,
                    LowerAlignerEndSequence: batch.LowerAlignerEndSequence
                });
                // When editing first batch, determine includeTemplate from current start sequence
                // Start sequence of 0 means template was included
                const isFirstBatchEdit = !existingBatches.some(b =>
                    b.AlignerBatchID !== batch.AlignerBatchID && b.BatchSequence < batch.BatchSequence
                );
                if (isFirstBatchEdit) {
                    setIncludeUpperTemplate(batch.UpperAlignerStartSequence === 0);
                    setIncludeLowerTemplate(batch.LowerAlignerStartSequence === 0);
                }
            } else {
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
                } else {
                    // First batch - start from 0 if includeTemplate is true (default)
                    upperStart = 0;
                    lowerStart = 0;
                }

                setFormData({
                    BatchSequence: nextBatchSequence,
                    UpperAlignerCount: '',
                    LowerAlignerCount: '',
                    Days: set?.Days || '',
                    ManufactureDate: '',  // Empty initially - set when manufacturing complete
                    DeliveredToPatientDate: '',
                    Notes: '',
                    IsActive: false,
                    IsLast: false
                });

                setComputedFields({
                    UpperAlignerStartSequence: upperStart,
                    LowerAlignerStartSequence: lowerStart,
                    UpperAlignerEndSequence: null,
                    LowerAlignerEndSequence: null
                });

                // Reset includeTemplate to true for first batch
                setIncludeUpperTemplate(true);
                setIncludeLowerTemplate(true);
            }
            setErrors({});
        }

        previousIsOpenRef.current = isOpen;
    }, [isOpen, batch, existingBatches]);

    // Update start sequences when includeTemplate checkboxes change (for first batch - add or edit)
    useEffect(() => {
        if (canChangeTemplateOption) {
            setComputedFields(prev => ({
                ...prev,
                UpperAlignerStartSequence: includeUpperTemplate ? 0 : 1,
                LowerAlignerStartSequence: includeLowerTemplate ? 0 : 1
            }));
        }
    }, [includeUpperTemplate, includeLowerTemplate, canChangeTemplateOption]);

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

        // Validate active batch must have delivery date
        if (formData.IsActive && !formData.DeliveredToPatientDate) {
            newErrors.DeliveredToPatientDate = 'Delivery date is required when batch is active (being used by patient)';
            newErrors.IsActive = 'Cannot mark as active without delivery date';
        }

        // Validate upper aligner count doesn't exceed remaining
        if (set && formData.UpperAlignerCount) {
            const upperCount = parseInt(formData.UpperAlignerCount);
            // When editing, add back the current batch's count to get available total
            const currentUpperCount = batch ? (parseInt(batch.UpperAlignerCount) || 0) : 0;
            const availableUpper = set.RemainingUpperAligners + currentUpperCount;

            if (!isNaN(upperCount) && upperCount > availableUpper) {
                newErrors.UpperAlignerCount = `Cannot exceed ${availableUpper} available upper aligners (${set.RemainingUpperAligners} remaining + ${currentUpperCount} from this batch)`;
            }
        }

        // Validate lower aligner count doesn't exceed remaining
        if (set && formData.LowerAlignerCount) {
            const lowerCount = parseInt(formData.LowerAlignerCount);
            // When editing, add back the current batch's count to get available total
            const currentLowerCount = batch ? (parseInt(batch.LowerAlignerCount) || 0) : 0;
            const availableLower = set.RemainingLowerAligners + currentLowerCount;

            if (!isNaN(lowerCount) && lowerCount > availableLower) {
                newErrors.LowerAlignerCount = `Cannot exceed ${availableLower} available lower aligners (${set.RemainingLowerAligners} remaining + ${currentLowerCount} from this batch)`;
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
                LowerAlignerStartSequence: computedFields.LowerAlignerStartSequence,
                IncludeUpperTemplate: canChangeTemplateOption ? includeUpperTemplate : undefined,
                IncludeLowerTemplate: canChangeTemplateOption ? includeLowerTemplate : undefined
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

            // Check for HTTP errors (400, 500, etc.)
            if (!response.ok) {
                // Get the most specific error message available
                const errorMessage = result.details?.message || result.error || result.message || 'Failed to save batch';
                toast.error(errorMessage);
                return;
            }

            if (result.success) {
                // Show success message
                toast.success(batch ? 'Batch updated successfully!' : 'Batch created successfully!');

                // If a batch was automatically deactivated, inform the user
                if (result.deactivatedBatch && formData.IsActive) {
                    toast.info(`Batch #${result.deactivatedBatch.batchSequence} was automatically deactivated (only one batch can be active at a time)`);
                }

                onSave();
                onClose();
            } else {
                toast.error('Error: ' + (result.error || 'Failed to save batch'));
            }
        } catch (error) {
            console.error('Error saving batch:', error);
            toast.error('Error saving batch: ' + error.message);
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
                    <form onSubmit={handleSubmit} className="drawer-form-flex">
                        {/* Action Buttons - Top */}
                        <div className="drawer-footer drawer-footer-top">
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

                        {/* Basic Info Section - Full Width */}
                        <div className="form-section form-section-compact">
                            <h3 className="section-heading-tight">Basic Information</h3>
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

                        {/* Two-Column Layout Container - Upper and Lower Aligners */}
                        <div className="form-two-column-container">
                            {/* Left Column - Upper Aligners */}
                            <div className="form-column">
                                <div className="form-section form-section-compact-top">
                                    <h3 className="section-heading-no-top">Upper Aligners
                                        {set && (
                                            <span className="remaining-count">
                                                (Remaining: <strong className={set.RemainingUpperAligners > 0 ? 'positive' : 'negative'}>{set.RemainingUpperAligners}</strong>)
                                            </span>
                                        )}
                                    </h3>

                                    {canChangeTemplateOption && (
                                        <div className="form-field-checkbox form-field-checkbox-compact">
                                            <input
                                                type="checkbox"
                                                id="IncludeUpperTemplate"
                                                checked={includeUpperTemplate}
                                                onChange={(e) => setIncludeUpperTemplate(e.target.checked)}
                                            />
                                            <label htmlFor="IncludeUpperTemplate">
                                                Include Template (Start from 0)
                                            </label>
                                        </div>
                                    )}

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

                            {/* Right Column - Lower Aligners */}
                            <div className="form-column">
                                <div className="form-section form-section-compact-top">
                                    <h3 className="section-heading-no-top">Lower Aligners
                                        {set && (
                                            <span className="remaining-count">
                                                (Remaining: <strong className={set.RemainingLowerAligners > 0 ? 'positive' : 'negative'}>{set.RemainingLowerAligners}</strong>)
                                            </span>
                                        )}
                                    </h3>

                                    {canChangeTemplateOption && (
                                        <div className="form-field-checkbox form-field-checkbox-compact">
                                            <input
                                                type="checkbox"
                                                id="IncludeLowerTemplate"
                                                checked={includeLowerTemplate}
                                                onChange={(e) => setIncludeLowerTemplate(e.target.checked)}
                                            />
                                            <label htmlFor="IncludeLowerTemplate">
                                                Include Template (Start from 0)
                                            </label>
                                        </div>
                                    )}

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
                            </div>
                        </div>

                        {/* Dates Section - Full Width */}
                        <div className="form-section form-section-dates">
                            <h3 className="section-heading-no-top">Dates & Timing</h3>


                            {/* Show CreationDate when editing (read-only) */}
                            {batch && batch.CreationDate && (
                                <div className="form-row">
                                    <div className="form-field">
                                        <label>Created On</label>
                                        <input
                                            type="text"
                                            value={new Date(batch.CreationDate).toLocaleDateString('en-GB', {
                                                year: 'numeric', month: 'short', day: 'numeric',
                                                hour: '2-digit', minute: '2-digit'
                                            })}
                                            readOnly
                                            className="readonly"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="form-row form-row-three-col">
                                <div className="form-field">
                                    <label htmlFor="ManufactureDate">
                                        Manufacture Date
                                        <span className="field-optional-text">(when manufacturing completed)</span>
                                    </label>
                                    <div className="date-with-checkbox">
                                        <input
                                            type="date"
                                            id="ManufactureDate"
                                            name="ManufactureDate"
                                            value={formData.ManufactureDate}
                                            onChange={handleChange}
                                        />
                                        <label className="checkbox-inline" title="Set to today's date">
                                            <input
                                                type="checkbox"
                                                checked={formData.ManufactureDate === new Date().toISOString().split('T')[0]}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setFormData(prev => ({
                                                            ...prev,
                                                            ManufactureDate: new Date().toISOString().split('T')[0]
                                                        }));
                                                    } else {
                                                        setFormData(prev => ({
                                                            ...prev,
                                                            ManufactureDate: ''
                                                        }));
                                                    }
                                                }}
                                            />
                                            Today
                                        </label>
                                        {/* Undo Manufacture - only if manufactured AND NOT delivered */}
                                        {batch && batch.ManufactureDate && !batch.DeliveredToPatientDate && onUndoManufacture && (
                                            <button
                                                type="button"
                                                className="undo-link"
                                                onClick={(e) => {
                                                    onUndoManufacture(batch, e);
                                                    onClose();
                                                }}
                                                title="Undo manufacture date"
                                            >
                                                <i className="fas fa-undo"></i> undo
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="form-field">
                                    <label htmlFor="DeliveredToPatientDate">
                                        Delivered Date <span className="field-optional-text">(when given to patient)</span>
                                    </label>
                                    <div className="date-with-checkbox">
                                        <input
                                            type="date"
                                            id="DeliveredToPatientDate"
                                            name="DeliveredToPatientDate"
                                            value={formData.DeliveredToPatientDate}
                                            onChange={handleChange}
                                            className={errors.DeliveredToPatientDate ? 'error' : ''}
                                        />
                                        <label className="checkbox-inline" title="Set to today's date">
                                            <input
                                                type="checkbox"
                                                checked={formData.DeliveredToPatientDate === new Date().toISOString().split('T')[0]}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setFormData(prev => ({
                                                            ...prev,
                                                            DeliveredToPatientDate: new Date().toISOString().split('T')[0]
                                                        }));
                                                    } else {
                                                        setFormData(prev => ({
                                                            ...prev,
                                                            DeliveredToPatientDate: ''
                                                        }));
                                                    }
                                                }}
                                            />
                                            Today
                                        </label>
                                        {/* Undo Delivery - only if delivered */}
                                        {batch && batch.DeliveredToPatientDate && onUndoDelivery && (
                                            <button
                                                type="button"
                                                className="undo-link"
                                                onClick={(e) => {
                                                    onUndoDelivery(batch, e);
                                                    onClose();
                                                }}
                                                title="Undo delivery date"
                                            >
                                                <i className="fas fa-undo"></i> undo
                                            </button>
                                        )}
                                    </div>
                                    {errors.DeliveredToPatientDate && (
                                        <span className="error-message">{errors.DeliveredToPatientDate}</span>
                                    )}
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

                        {/* Notes Section - Full Width */}
                        <div className="form-section form-section-dates">
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
                                <label htmlFor="IsActive">Active (Being used by patient)</label>
                                {errors.IsActive && (
                                    <span className="error-message">{errors.IsActive}</span>
                                )}
                            </div>

                            <div className="form-field-checkbox">
                                <input
                                    type="checkbox"
                                    id="IsLast"
                                    name="IsLast"
                                    checked={formData.IsLast}
                                    onChange={handleChange}
                                />
                                <label htmlFor="IsLast">
                                    Last Batch (Final batch before new scan or treatment completion)
                                </label>
                                <small className="field-hint">
                                    Marking as last batch will automatically activate this batch
                                </small>
                                {errors.IsLast && (
                                    <span className="error-message">{errors.IsLast}</span>
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
