import React, { useState, useEffect, useRef, ChangeEvent, FormEvent, MouseEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';

interface AlignerSet {
    AlignerSetID: number;
    Days?: number;
    RemainingUpperAligners?: number;
    RemainingLowerAligners?: number;
}

interface AlignerBatch {
    AlignerBatchID: number;
    AlignerSetID: number;
    BatchSequence: number;
    UpperAlignerCount?: number;
    LowerAlignerCount?: number;
    UpperAlignerStartSequence?: number;
    LowerAlignerStartSequence?: number;
    UpperAlignerEndSequence?: number;
    LowerAlignerEndSequence?: number;
    Days?: number;
    ManufactureDate?: string | null;
    DeliveredToPatientDate?: string | null;
    Notes?: string;
    IsActive?: boolean;
    IsLast?: boolean;
    CreationDate?: string;
}

interface BatchFormData {
    BatchSequence: number | string;
    UpperAlignerCount: number | string;
    LowerAlignerCount: number | string;
    Days: number | string;
    Notes: string;
    IsActive: boolean;
    IsLast: boolean;
}

interface ComputedFields {
    UpperAlignerStartSequence: number;
    LowerAlignerStartSequence: number;
    UpperAlignerEndSequence: number | null;
    LowerAlignerEndSequence: number | null;
}

interface FormErrors {
    BatchSequence?: string;
    UpperAlignerCount?: string;
    LowerAlignerCount?: string;
    IsActive?: string;
    IsLast?: string;
    [key: string]: string | undefined;
}

interface BatchFormDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    batch?: AlignerBatch | null;
    set?: AlignerSet | null;
    existingBatches?: AlignerBatch[];
    onUndoManufacture?: (batch: AlignerBatch, e: MouseEvent<HTMLButtonElement>) => void;
    onUndoDelivery?: (batch: AlignerBatch, e: MouseEvent<HTMLButtonElement>) => void;
}

const BatchFormDrawer: React.FC<BatchFormDrawerProps> = ({
    isOpen,
    onClose,
    onSave,
    batch,
    set,
    existingBatches = [],
    onUndoManufacture,
    onUndoDelivery
}) => {
    const toast = useToast();
    const [formData, setFormData] = useState<BatchFormData>({
        BatchSequence: '',
        UpperAlignerCount: '',
        LowerAlignerCount: '',
        Days: '',
        Notes: '',
        IsActive: false,
        IsLast: false
    });

    // State for date editing
    const [editingManufactureDate, setEditingManufactureDate] = useState<boolean>(false);
    const [editingDeliveryDate, setEditingDeliveryDate] = useState<boolean>(false);
    const [tempManufactureDate, setTempManufactureDate] = useState<string>('');
    const [tempDeliveryDate, setTempDeliveryDate] = useState<string>('');
    const [savingDate, setSavingDate] = useState<boolean>(false);

    const [computedFields, setComputedFields] = useState<ComputedFields>({
        UpperAlignerStartSequence: 1,
        LowerAlignerStartSequence: 1,
        UpperAlignerEndSequence: null,
        LowerAlignerEndSequence: null
    });

    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState<boolean>(false);
    const previousIsOpenRef = useRef<boolean>(false);

    // Template option - only for first batch (when no existing batches OR editing the first batch)
    // Separate controls for upper and lower
    const [includeUpperTemplate, setIncludeUpperTemplate] = useState<boolean>(true);
    const [includeLowerTemplate, setIncludeLowerTemplate] = useState<boolean>(true);
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
                // Edit mode - populate form (dates are handled separately via status endpoints)
                setFormData({
                    BatchSequence: batch.BatchSequence || '',
                    UpperAlignerCount: batch.UpperAlignerCount || '',
                    LowerAlignerCount: batch.LowerAlignerCount || '',
                    Days: batch.Days || '',
                    Notes: batch.Notes || '',
                    IsActive: batch.IsActive !== undefined ? batch.IsActive : false,
                    IsLast: batch.IsLast !== undefined ? batch.IsLast : false
                });
                // Reset date editing state
                setEditingManufactureDate(false);
                setEditingDeliveryDate(false);
                setTempManufactureDate('');
                setTempDeliveryDate('');
                setComputedFields({
                    UpperAlignerStartSequence: batch.UpperAlignerStartSequence ?? 1,
                    LowerAlignerStartSequence: batch.LowerAlignerStartSequence ?? 1,
                    UpperAlignerEndSequence: batch.UpperAlignerEndSequence ?? null,
                    LowerAlignerEndSequence: batch.LowerAlignerEndSequence ?? null
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
                    const lastBatch = existingBatches.reduce((latest, b) =>
                        (b.BatchSequence > latest.BatchSequence) ? b : latest
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
                    Notes: '',
                    IsActive: false,
                    IsLast: false
                });
                // Reset date editing state for add mode
                setEditingManufactureDate(false);
                setEditingDeliveryDate(false);
                setTempManufactureDate('');
                setTempDeliveryDate('');

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
    }, [isOpen, batch, existingBatches, set?.Days]);

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
        const upperCount = parseInt(String(formData.UpperAlignerCount));
        const lowerCount = parseInt(String(formData.LowerAlignerCount));

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

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
        // Clear error for this field
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: undefined }));
        }
    };

    const validate = (): { valid: boolean; errors: FormErrors } => {
        const newErrors: FormErrors = {};

        if (!formData.BatchSequence || formData.BatchSequence === '') {
            newErrors.BatchSequence = 'Batch sequence is required';
        }

        // Validate active batch must have delivery date (check batch prop, not formData)
        if (formData.IsActive && !batch?.DeliveredToPatientDate) {
            newErrors.IsActive = 'Cannot mark as active: batch must be delivered first';
        }

        // Validate upper aligner count doesn't exceed remaining
        if (set && formData.UpperAlignerCount) {
            const upperCount = parseInt(String(formData.UpperAlignerCount));
            // When editing, add back the current batch's count to get available total
            const currentUpperCount = batch ? (parseInt(String(batch.UpperAlignerCount)) || 0) : 0;
            const availableUpper = (set.RemainingUpperAligners || 0) + currentUpperCount;

            if (!isNaN(upperCount) && upperCount > availableUpper) {
                newErrors.UpperAlignerCount = `Cannot exceed ${availableUpper} available upper aligners (${set.RemainingUpperAligners} remaining + ${currentUpperCount} from this batch)`;
            }
        }

        // Validate lower aligner count doesn't exceed remaining
        if (set && formData.LowerAlignerCount) {
            const lowerCount = parseInt(String(formData.LowerAlignerCount));
            // When editing, add back the current batch's count to get available total
            const currentLowerCount = batch ? (parseInt(String(batch.LowerAlignerCount)) || 0) : 0;
            const availableLower = (set.RemainingLowerAligners || 0) + currentLowerCount;

            if (!isNaN(lowerCount) && lowerCount > availableLower) {
                newErrors.LowerAlignerCount = `Cannot exceed ${availableLower} available lower aligners (${set.RemainingLowerAligners} remaining + ${currentLowerCount} from this batch)`;
            }
        }

        setErrors(newErrors);
        return { valid: Object.keys(newErrors).length === 0, errors: newErrors };
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();

        const validation = validate();
        if (!validation.valid) {
            // Show toast for validation errors so user knows what went wrong
            const errorMessages = Object.values(validation.errors).filter(Boolean);
            if (errorMessages.length > 0) {
                toast.error(errorMessages[0] as string);
            } else {
                toast.error('Please fix the form errors before saving');
            }
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
            toast.error('Error saving batch: ' + (error as Error).message);
        } finally {
            setSaving(false);
        }
    };

    const getTodayDateString = (): string => {
        return new Date().toISOString().split('T')[0];
    };

    const formatDisplayDate = (dateStr: string | null | undefined): string => {
        if (!dateStr) return 'Not set';
        return new Date(dateStr).toLocaleDateString('en-GB', {
            year: 'numeric', month: 'short', day: 'numeric'
        });
    };

    // Handle date changes via status endpoints
    const handleSetManufactureDate = async (dateStr: string): Promise<void> => {
        if (!batch) return;
        setSavingDate(true);
        try {
            const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}/manufacture`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetDate: dateStr })
            });
            const result = await response.json();
            if (!response.ok) {
                toast.error(result.error || result.message || 'Failed to update manufacture date');
                return;
            }
            toast.success(result.message || 'Manufacture date updated');
            setEditingManufactureDate(false);
            setTempManufactureDate('');
            onSave(); // Refresh data
        } catch (error) {
            toast.error('Error updating manufacture date: ' + (error as Error).message);
        } finally {
            setSavingDate(false);
        }
    };

    const handleSetDeliveryDate = async (dateStr: string): Promise<void> => {
        if (!batch) return;
        setSavingDate(true);
        try {
            const response = await fetch(`/api/aligner/batches/${batch.AlignerBatchID}/deliver`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetDate: dateStr })
            });
            const result = await response.json();
            if (!response.ok) {
                toast.error(result.error || result.message || 'Failed to update delivery date');
                return;
            }
            toast.success(result.message || 'Delivery date updated');
            setEditingDeliveryDate(false);
            setTempDeliveryDate('');
            onSave(); // Refresh data
        } catch (error) {
            toast.error('Error updating delivery date: ' + (error as Error).message);
        } finally {
            setSavingDate(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-container" onClick={(e: MouseEvent) => e.stopPropagation()}>
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
                                                (Remaining: <strong className={(set.RemainingUpperAligners || 0) > 0 ? 'positive' : 'negative'}>{set.RemainingUpperAligners}</strong>)
                                            </span>
                                        )}
                                    </h3>

                                    {canChangeTemplateOption && (
                                        <div className="form-field-checkbox form-field-checkbox-compact">
                                            <input
                                                type="checkbox"
                                                id="IncludeUpperTemplate"
                                                checked={includeUpperTemplate}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => setIncludeUpperTemplate(e.target.checked)}
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
                                                (Remaining: <strong className={(set.RemainingLowerAligners || 0) > 0 ? 'positive' : 'negative'}>{set.RemainingLowerAligners}</strong>)
                                            </span>
                                        )}
                                    </h3>

                                    {canChangeTemplateOption && (
                                        <div className="form-field-checkbox form-field-checkbox-compact">
                                            <input
                                                type="checkbox"
                                                id="IncludeLowerTemplate"
                                                checked={includeLowerTemplate}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => setIncludeLowerTemplate(e.target.checked)}
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
                                {/* Manufacture Date - Read-only with edit */}
                                <div className="form-field">
                                    <label>
                                        Manufacture Date
                                        <span className="field-optional-text">(when manufacturing completed)</span>
                                    </label>
                                    {batch ? (
                                        editingManufactureDate ? (
                                            <div className="date-edit-inline">
                                                <input
                                                    type="date"
                                                    value={tempManufactureDate}
                                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setTempManufactureDate(e.target.value)}
                                                    autoFocus
                                                />
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-primary"
                                                    onClick={() => handleSetManufactureDate(tempManufactureDate)}
                                                    disabled={!tempManufactureDate || savingDate}
                                                >
                                                    {savingDate ? <i className="fas fa-spinner fa-spin"></i> : 'Apply'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => { setEditingManufactureDate(false); setTempManufactureDate(''); }}
                                                    disabled={savingDate}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="date-display-with-actions">
                                                <input
                                                    type="text"
                                                    value={formatDisplayDate(batch.ManufactureDate)}
                                                    readOnly
                                                    className="readonly"
                                                />
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-outline"
                                                    onClick={() => {
                                                        setTempManufactureDate(batch.ManufactureDate?.split('T')[0] || getTodayDateString());
                                                        setEditingManufactureDate(true);
                                                    }}
                                                    title={batch.ManufactureDate ? 'Change date' : 'Set manufacture date'}
                                                >
                                                    <i className="fas fa-calendar-alt"></i> {batch.ManufactureDate ? 'Edit' : 'Set'}
                                                </button>
                                                {batch.ManufactureDate && !batch.DeliveredToPatientDate && onUndoManufacture && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-sm btn-outline btn-danger"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            onUndoManufacture(batch, e);
                                                            onClose();
                                                        }}
                                                        title="Clear manufacture date"
                                                    >
                                                        <i className="fas fa-times"></i> Clear
                                                    </button>
                                                )}
                                            </div>
                                        )
                                    ) : (
                                        <input
                                            type="text"
                                            value="Set after creating batch"
                                            readOnly
                                            className="readonly"
                                        />
                                    )}
                                </div>

                                {/* Delivery Date - Read-only with edit */}
                                <div className="form-field">
                                    <label>
                                        Delivered Date
                                        <span className="field-optional-text">(when given to patient)</span>
                                    </label>
                                    {batch ? (
                                        editingDeliveryDate ? (
                                            <div className="date-edit-inline">
                                                <input
                                                    type="date"
                                                    value={tempDeliveryDate}
                                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setTempDeliveryDate(e.target.value)}
                                                    autoFocus
                                                />
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-primary"
                                                    onClick={() => handleSetDeliveryDate(tempDeliveryDate)}
                                                    disabled={!tempDeliveryDate || savingDate}
                                                >
                                                    {savingDate ? <i className="fas fa-spinner fa-spin"></i> : 'Apply'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => { setEditingDeliveryDate(false); setTempDeliveryDate(''); }}
                                                    disabled={savingDate}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="date-display-with-actions">
                                                <input
                                                    type="text"
                                                    value={formatDisplayDate(batch.DeliveredToPatientDate)}
                                                    readOnly
                                                    className="readonly"
                                                />
                                                {batch.ManufactureDate ? (
                                                    <button
                                                        type="button"
                                                        className="btn btn-sm btn-outline"
                                                        onClick={() => {
                                                            setTempDeliveryDate(batch.DeliveredToPatientDate?.split('T')[0] || getTodayDateString());
                                                            setEditingDeliveryDate(true);
                                                        }}
                                                        title={batch.DeliveredToPatientDate ? 'Change date' : 'Set delivery date'}
                                                    >
                                                        <i className="fas fa-calendar-alt"></i> {batch.DeliveredToPatientDate ? 'Edit' : 'Set'}
                                                    </button>
                                                ) : (
                                                    <span className="field-hint">Requires manufacture date</span>
                                                )}
                                                {batch.DeliveredToPatientDate && onUndoDelivery && (
                                                    <button
                                                        type="button"
                                                        className="btn btn-sm btn-outline btn-danger"
                                                        onClick={(e: MouseEvent<HTMLButtonElement>) => {
                                                            onUndoDelivery(batch, e);
                                                            onClose();
                                                        }}
                                                        title="Clear delivery date"
                                                    >
                                                        <i className="fas fa-times"></i> Clear
                                                    </button>
                                                )}
                                            </div>
                                        )
                                    ) : (
                                        <input
                                            type="text"
                                            value="Set after creating batch"
                                            readOnly
                                            className="readonly"
                                        />
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
                                    rows={3}
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
