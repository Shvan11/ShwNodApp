import React, { useState, useEffect, useRef, ChangeEvent, FormEvent, MouseEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { AlignerBatch, AlignerSetForBatch } from '../../pages/aligner/aligner.types';

interface BatchFormData {
    batch_sequence: number | string;
    upper_aligner_count: number | string;
    lower_aligner_count: number | string;
    days: number | string;
    notes: string;
    is_active: boolean;
    is_last: boolean;
}

interface ComputedFields {
    upper_aligner_start_sequence: number;
    lower_aligner_start_sequence: number;
    upper_aligner_end_sequence: number | null;
    lower_aligner_end_sequence: number | null;
}

interface FormErrors {
    batch_sequence?: string;
    upper_aligner_count?: string;
    lower_aligner_count?: string;
    is_active?: string;
    is_last?: string;
    [key: string]: string | undefined;
}

interface BatchFormDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => Promise<void>;
    batch?: AlignerBatch | null;
    set?: AlignerSetForBatch | null;
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
    const confirm = useConfirm();
    const [formData, setFormData] = useState<BatchFormData>({
        batch_sequence: '',
        upper_aligner_count: '',
        lower_aligner_count: '',
        days: '',
        notes: '',
        is_active: false,
        is_last: false
    });

    // State for date editing
    const [editingManufactureDate, setEditingManufactureDate] = useState<boolean>(false);
    const [editingDeliveryDate, setEditingDeliveryDate] = useState<boolean>(false);
    const [tempManufactureDate, setTempManufactureDate] = useState<string>('');
    const [tempDeliveryDate, setTempDeliveryDate] = useState<string>('');
    const [savingDate, setSavingDate] = useState<boolean>(false);

    const [computedFields, setComputedFields] = useState<ComputedFields>({
        upper_aligner_start_sequence: 1,
        lower_aligner_start_sequence: 1,
        upper_aligner_end_sequence: null,
        lower_aligner_end_sequence: null
    });

    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState<boolean>(false);
    const previousIsOpenRef = useRef<boolean>(false);

    // Template option - only for first batch (when no existing batches OR editing the first batch)
    // Separate controls for upper and lower
    const [hasUpperTemplate, setHasUpperTemplate] = useState<boolean>(true);
    const [hasLowerTemplate, setHasLowerTemplate] = useState<boolean>(true);
    const isFirstBatch = existingBatches.length === 0;
    // When editing, check if this batch is the first one (no other batch has a lower sequence)
    const isEditingFirstBatch = batch && !existingBatches.some(b =>
        b.aligner_batch_id !== batch.aligner_batch_id && b.batch_sequence < batch.batch_sequence
    );
    const canChangeTemplateOption = isFirstBatch || isEditingFirstBatch;

    useEffect(() => {
        // Only run when drawer opens (isOpen transitions from false to true)
        if (isOpen && !previousIsOpenRef.current) {
            if (batch) {
                // Edit mode - populate form (dates are handled separately via status endpoints)
                setFormData({
                    batch_sequence: batch.batch_sequence ?? '',
                    upper_aligner_count: batch.upper_aligner_count ?? '',
                    lower_aligner_count: batch.lower_aligner_count ?? '',
                    days: batch.days ?? '',
                    notes: batch.notes || '',
                    is_active: batch.is_active !== undefined ? batch.is_active : false,
                    is_last: batch.is_last !== undefined ? batch.is_last : false
                });
                // Reset date editing state
                setEditingManufactureDate(false);
                setEditingDeliveryDate(false);
                setTempManufactureDate('');
                setTempDeliveryDate('');
                setComputedFields({
                    upper_aligner_start_sequence: batch.upper_aligner_start_sequence ?? 1,
                    lower_aligner_start_sequence: batch.lower_aligner_start_sequence ?? 1,
                    upper_aligner_end_sequence: batch.upper_aligner_end_sequence ?? null,
                    lower_aligner_end_sequence: batch.lower_aligner_end_sequence ?? null
                });
                // When editing first batch, read template flags directly from the batch
                const isFirstBatchEdit = !existingBatches.some(b =>
                    b.aligner_batch_id !== batch.aligner_batch_id && b.batch_sequence < batch.batch_sequence
                );
                if (isFirstBatchEdit) {
                    setHasUpperTemplate(batch.has_upper_template ?? false);
                    setHasLowerTemplate(batch.has_lower_template ?? false);
                }
            } else {
                // Add mode - calculate next batch sequence and start sequences
                const nextBatchSequence = existingBatches.length > 0
                    ? Math.max(...existingBatches.map(b => b.batch_sequence || 0)) + 1
                    : 1;

                // Calculate start sequences based on last batch's end sequences
                let upperStart = 1;
                let lowerStart = 1;

                if (existingBatches.length > 0) {
                    const lastBatch = existingBatches.reduce((latest, b) =>
                        (b.batch_sequence > latest.batch_sequence) ? b : latest
                    );

                    upperStart = (lastBatch.upper_aligner_end_sequence || 0) + 1;
                    lowerStart = (lastBatch.lower_aligner_end_sequence || 0) + 1;
                }
                // First batch defaults to start=1 (no template); the template effect below
                // shifts it to 0 if the user enables HasUpperTemplate/HasLowerTemplate.

                setFormData({
                    batch_sequence: nextBatchSequence,
                    upper_aligner_count: '',
                    lower_aligner_count: '',
                    days: set?.days || '',
                    notes: '',
                    is_active: false,
                    is_last: false
                });
                // Reset date editing state for add mode
                setEditingManufactureDate(false);
                setEditingDeliveryDate(false);
                setTempManufactureDate('');
                setTempDeliveryDate('');

                setComputedFields({
                    upper_aligner_start_sequence: upperStart,
                    lower_aligner_start_sequence: lowerStart,
                    upper_aligner_end_sequence: null,
                    lower_aligner_end_sequence: null
                });

                // Default template flags to false for new batches (user can opt in on first batch)
                setHasUpperTemplate(false);
                setHasLowerTemplate(false);
            }
            setErrors({});
        }

        previousIsOpenRef.current = isOpen;
    }, [isOpen, batch, existingBatches, set?.days]);

    // Update start sequences when template flag checkboxes change (for first batch - add or edit)
    useEffect(() => {
        if (canChangeTemplateOption) {
            setComputedFields(prev => ({
                ...prev,
                upper_aligner_start_sequence: hasUpperTemplate ? 0 : 1,
                lower_aligner_start_sequence: hasLowerTemplate ? 0 : 1
            }));
        }
    }, [hasUpperTemplate, hasLowerTemplate, canChangeTemplateOption]);

    // Auto-calculate end sequences when counts change
    useEffect(() => {
        const upperCount = parseInt(String(formData.upper_aligner_count));
        const lowerCount = parseInt(String(formData.lower_aligner_count));

        setComputedFields(prev => ({
            ...prev,
            upper_aligner_end_sequence: !isNaN(upperCount) && upperCount > 0
                ? prev.upper_aligner_start_sequence + upperCount - 1
                : null,
            lower_aligner_end_sequence: !isNaN(lowerCount) && lowerCount > 0
                ? prev.lower_aligner_start_sequence + lowerCount - 1
                : null
        }));
    }, [formData.upper_aligner_count, formData.lower_aligner_count]);

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

        if (!formData.batch_sequence || formData.batch_sequence === '') {
            newErrors.batch_sequence = 'Batch sequence is required';
        }

        // Validate active batch must have delivery date (check batch prop, not formData)
        if (formData.is_active && !batch?.delivered_to_patient_date) {
            newErrors.is_active = 'Cannot mark as active: batch must be delivered first';
        }

        // Real aligners consumed = total slots in batch minus the template slot (if any).
        // Only the first batch can carry a template; non-first batches ignore the flag.
        const newHasUpperTpl = canChangeTemplateOption && hasUpperTemplate;
        const newHasLowerTpl = canChangeTemplateOption && hasLowerTemplate;

        // Validate upper aligner consumption doesn't exceed remaining
        if (set && formData.upper_aligner_count) {
            const upperCount = parseInt(String(formData.upper_aligner_count));
            const upperConsumed = upperCount - (newHasUpperTpl ? 1 : 0);
            // When editing, add back this batch's prior real consumption to get available total
            const oldUpperCount = batch ? (parseInt(String(batch.upper_aligner_count)) || 0) : 0;
            const oldUpperConsumed = batch ? oldUpperCount - (batch.has_upper_template ? 1 : 0) : 0;
            const availableUpper = (set.remaining_upper_aligners || 0) + oldUpperConsumed;

            if (!isNaN(upperCount) && upperConsumed > availableUpper) {
                newErrors.upper_aligner_count = `Cannot exceed ${availableUpper} available upper aligners (${set.remaining_upper_aligners} remaining + ${oldUpperConsumed} from this batch)`;
            }
        }

        // Validate lower aligner consumption doesn't exceed remaining
        if (set && formData.lower_aligner_count) {
            const lowerCount = parseInt(String(formData.lower_aligner_count));
            const lowerConsumed = lowerCount - (newHasLowerTpl ? 1 : 0);
            const oldLowerCount = batch ? (parseInt(String(batch.lower_aligner_count)) || 0) : 0;
            const oldLowerConsumed = batch ? oldLowerCount - (batch.has_lower_template ? 1 : 0) : 0;
            const availableLower = (set.remaining_lower_aligners || 0) + oldLowerConsumed;

            if (!isNaN(lowerCount) && lowerConsumed > availableLower) {
                newErrors.lower_aligner_count = `Cannot exceed ${availableLower} available lower aligners (${set.remaining_lower_aligners} remaining + ${oldLowerConsumed} from this batch)`;
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

        // Check if remaining aligners would hit 0 after this save.
        // Use real aligner consumption (total slots minus template slot), not raw counts.
        const newHasUpperTpl = canChangeTemplateOption && hasUpperTemplate;
        const newHasLowerTpl = canChangeTemplateOption && hasLowerTemplate;

        const upperCount = parseInt(String(formData.upper_aligner_count)) || 0;
        const lowerCount = parseInt(String(formData.lower_aligner_count)) || 0;
        const newUpperConsumed = upperCount - (newHasUpperTpl ? 1 : 0);
        const newLowerConsumed = lowerCount - (newHasLowerTpl ? 1 : 0);

        const oldUpperCount = batch ? (parseInt(String(batch.upper_aligner_count)) || 0) : 0;
        const oldLowerCount = batch ? (parseInt(String(batch.lower_aligner_count)) || 0) : 0;
        const oldUpperConsumed = batch ? oldUpperCount - (batch.has_upper_template ? 1 : 0) : 0;
        const oldLowerConsumed = batch ? oldLowerCount - (batch.has_lower_template ? 1 : 0) : 0;

        const newRemainingUpper = (set?.remaining_upper_aligners ?? 0) + oldUpperConsumed - newUpperConsumed;
        const newRemainingLower = (set?.remaining_lower_aligners ?? 0) + oldLowerConsumed - newLowerConsumed;

        let markAsLast = false;
        if (newRemainingUpper === 0 && newRemainingLower === 0 && !formData.is_last) {
            markAsLast = await confirm(
                'Both remaining upper and lower aligners will be 0. Do you want to mark this as the last batch?',
                { title: 'Mark as Last Batch', confirmText: 'Mark as Last', cancelText: 'No' }
            );
        }

        setSaving(true);

        try {
            const dataToSend = {
                ...formData,
                ...(markAsLast && { is_last: true }),
                aligner_set_id: set?.aligner_set_id,
                upper_aligner_start_sequence: computedFields.upper_aligner_start_sequence,
                lower_aligner_start_sequence: computedFields.lower_aligner_start_sequence,
                has_upper_template: canChangeTemplateOption ? hasUpperTemplate : undefined,
                has_lower_template: canChangeTemplateOption ? hasLowerTemplate : undefined
            };

            const url = batch
                ? `/api/aligner/batches/${batch.aligner_batch_id}`
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
                if (result.deactivatedBatch && formData.is_active) {
                    toast.info(`Batch #${result.deactivatedBatch.batchSequence} was automatically deactivated (only one batch can be active at a time)`);
                }

                await onSave();
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
            const response = await fetch(`/api/aligner/batches/${batch.aligner_batch_id}/manufacture`, {
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
            await onSave(); // Refresh data
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
            const response = await fetch(`/api/aligner/batches/${batch.aligner_batch_id}/deliver`, {
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
            await onSave(); // Refresh data
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
                                    name="batch_sequence"
                                    value={formData.batch_sequence}
                                    onChange={handleChange}
                                    className={errors.batch_sequence ? 'error' : ''}
                                    min="1"
                                />
                                {errors.batch_sequence && (
                                    <span className="error-message">{errors.batch_sequence}</span>
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
                                                (Remaining: <strong className={(set.remaining_upper_aligners || 0) > 0 ? 'positive' : 'negative'}>{set.remaining_upper_aligners}</strong>)
                                            </span>
                                        )}
                                    </h3>

                                    {canChangeTemplateOption && (
                                        <div className="form-field-checkbox form-field-checkbox-compact">
                                            <input
                                                type="checkbox"
                                                id="HasUpperTemplate"
                                                checked={hasUpperTemplate}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => setHasUpperTemplate(e.target.checked)}
                                            />
                                            <label htmlFor="HasUpperTemplate">
                                                Include Template (Start from 0)
                                            </label>
                                        </div>
                                    )}

                                    <div className="form-field">
                                        <label htmlFor="UpperAlignerStartSequence">Start Sequence (Auto)</label>
                                        <input
                                            type="number"
                                            id="UpperAlignerStartSequence"
                                            value={computedFields.upper_aligner_start_sequence}
                                            readOnly
                                            className="readonly"
                                        />
                                    </div>

                                    <div className="form-field">
                                        <label htmlFor="UpperAlignerCount">Count</label>
                                        <input
                                            type="number"
                                            id="UpperAlignerCount"
                                            name="upper_aligner_count"
                                            value={formData.upper_aligner_count}
                                            onChange={handleChange}
                                            className={errors.upper_aligner_count ? 'error' : ''}
                                            min="0"
                                            placeholder="Number of aligners"
                                        />
                                        {errors.upper_aligner_count && (
                                            <span className="error-message">{errors.upper_aligner_count}</span>
                                        )}
                                    </div>

                                    <div className="form-field">
                                        <label htmlFor="UpperAlignerEndSequence">End Sequence (Auto)</label>
                                        <input
                                            type="number"
                                            id="UpperAlignerEndSequence"
                                            value={computedFields.upper_aligner_end_sequence || ''}
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
                                                (Remaining: <strong className={(set.remaining_lower_aligners || 0) > 0 ? 'positive' : 'negative'}>{set.remaining_lower_aligners}</strong>)
                                            </span>
                                        )}
                                    </h3>

                                    {canChangeTemplateOption && (
                                        <div className="form-field-checkbox form-field-checkbox-compact">
                                            <input
                                                type="checkbox"
                                                id="HasLowerTemplate"
                                                checked={hasLowerTemplate}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => setHasLowerTemplate(e.target.checked)}
                                            />
                                            <label htmlFor="HasLowerTemplate">
                                                Include Template (Start from 0)
                                            </label>
                                        </div>
                                    )}

                                    <div className="form-field">
                                        <label htmlFor="LowerAlignerStartSequence">Start Sequence (Auto)</label>
                                        <input
                                            type="number"
                                            id="LowerAlignerStartSequence"
                                            value={computedFields.lower_aligner_start_sequence}
                                            readOnly
                                            className="readonly"
                                        />
                                    </div>

                                    <div className="form-field">
                                        <label htmlFor="LowerAlignerCount">Count</label>
                                        <input
                                            type="number"
                                            id="LowerAlignerCount"
                                            name="lower_aligner_count"
                                            value={formData.lower_aligner_count}
                                            onChange={handleChange}
                                            className={errors.lower_aligner_count ? 'error' : ''}
                                            min="0"
                                            placeholder="Number of aligners"
                                        />
                                        {errors.lower_aligner_count && (
                                            <span className="error-message">{errors.lower_aligner_count}</span>
                                        )}
                                    </div>

                                    <div className="form-field">
                                        <label htmlFor="LowerAlignerEndSequence">End Sequence (Auto)</label>
                                        <input
                                            type="number"
                                            id="LowerAlignerEndSequence"
                                            value={computedFields.lower_aligner_end_sequence || ''}
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
                            {batch && batch.creation_date && (
                                <div className="form-row">
                                    <div className="form-field">
                                        <label>Created On</label>
                                        <input
                                            type="text"
                                            value={new Date(batch.creation_date).toLocaleDateString('en-GB', {
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
                                                    value={formatDisplayDate(batch.manufacture_date)}
                                                    readOnly
                                                    className="readonly"
                                                />
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-outline"
                                                    onClick={() => {
                                                        setTempManufactureDate(batch.manufacture_date?.split('T')[0] || getTodayDateString());
                                                        setEditingManufactureDate(true);
                                                    }}
                                                    title={batch.manufacture_date ? 'Change date' : 'Set manufacture date'}
                                                >
                                                    <i className="fas fa-calendar-alt"></i> {batch.manufacture_date ? 'Edit' : 'Set'}
                                                </button>
                                                {batch.manufacture_date && !batch.delivered_to_patient_date && onUndoManufacture && (
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
                                                    value={formatDisplayDate(batch.delivered_to_patient_date)}
                                                    readOnly
                                                    className="readonly"
                                                />
                                                {batch.manufacture_date ? (
                                                    <button
                                                        type="button"
                                                        className="btn btn-sm btn-outline"
                                                        onClick={() => {
                                                            setTempDeliveryDate(batch.delivered_to_patient_date?.split('T')[0] || getTodayDateString());
                                                            setEditingDeliveryDate(true);
                                                        }}
                                                        title={batch.delivered_to_patient_date ? 'Change date' : 'Set delivery date'}
                                                    >
                                                        <i className="fas fa-calendar-alt"></i> {batch.delivered_to_patient_date ? 'Edit' : 'Set'}
                                                    </button>
                                                ) : (
                                                    <span className="field-hint">Requires manufacture date</span>
                                                )}
                                                {batch.delivered_to_patient_date && onUndoDelivery && (
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
                                        name="days"
                                        value={formData.days}
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
                                    name="notes"
                                    value={formData.notes}
                                    onChange={handleChange}
                                    rows={3}
                                    placeholder="Additional notes..."
                                />
                            </div>

                            <div className="form-field-checkbox">
                                <input
                                    type="checkbox"
                                    id="IsActive"
                                    name="is_active"
                                    checked={formData.is_active}
                                    onChange={handleChange}
                                />
                                <label htmlFor="IsActive">Active (Being used by patient)</label>
                                {errors.is_active && (
                                    <span className="error-message">{errors.is_active}</span>
                                )}
                            </div>

                            <div className="form-field-checkbox">
                                <input
                                    type="checkbox"
                                    id="IsLast"
                                    name="is_last"
                                    checked={formData.is_last}
                                    onChange={handleChange}
                                />
                                <label htmlFor="IsLast">
                                    Last Batch (Final batch before new scan or treatment completion)
                                </label>
                                {errors.is_last && (
                                    <span className="error-message">{errors.is_last}</span>
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
