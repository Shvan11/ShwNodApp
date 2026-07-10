import React, { useState, useMemo, ChangeEvent, FormEvent, MouseEvent } from 'react';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { AlignerBatch, AlignerSetForBatch } from '../../pages/aligner/aligner.types';
import { formatISODate } from '../../core/utils';
import { postJSON, putJSON, patchJSON, httpErrorMessage, type HttpError } from '@/core/http';

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
    // The drawer is mounted fresh each time it opens (parent renders it only while
    // open), so the initial state IS the on-open reset — seed it lazily here
    // instead of syncing it in an effect.
    const [formData, setFormData] = useState<BatchFormData>(() => {
        if (batch) {
            // Edit mode — populate from the existing batch (dates are handled
            // separately via status endpoints)
            return {
                batch_sequence: batch.batch_sequence ?? '',
                upper_aligner_count: batch.upper_aligner_count ?? '',
                lower_aligner_count: batch.lower_aligner_count ?? '',
                days: batch.days ?? '',
                notes: batch.notes || '',
                is_active: batch.is_active ?? false,
                is_last: batch.is_last ?? false
            };
        }
        // Add mode — next batch sequence
        const nextBatchSequence = existingBatches.length > 0
            ? Math.max(...existingBatches.map(b => b.batch_sequence || 0)) + 1
            : 1;
        return {
            batch_sequence: nextBatchSequence,
            upper_aligner_count: '',
            lower_aligner_count: '',
            days: set?.days || '',
            notes: '',
            is_active: false,
            is_last: false
        };
    });

    // State for date editing
    const [editingManufactureDate, setEditingManufactureDate] = useState<boolean>(false);
    const [editingDeliveryDate, setEditingDeliveryDate] = useState<boolean>(false);
    const [tempManufactureDate, setTempManufactureDate] = useState<string>('');
    const [tempDeliveryDate, setTempDeliveryDate] = useState<string>('');
    const [savingDate, setSavingDate] = useState<boolean>(false);

    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState<boolean>(false);

    // Template option — only the first batch (adding the first, or editing it) can
    // carry a template; later batches ignore the flag. Separate upper/lower controls.
    const isFirstBatch = existingBatches.length === 0;
    // When editing, this is the first batch if no other batch has a lower sequence.
    const isEditingFirstBatch = batch && !existingBatches.some(b =>
        b.aligner_batch_id !== batch.aligner_batch_id && b.batch_sequence < batch.batch_sequence
    );
    const canChangeTemplateOption = isFirstBatch || isEditingFirstBatch;

    // Seed from the batch when editing the first one, else default off.
    const [hasUpperTemplate, setHasUpperTemplate] = useState<boolean>(() =>
        isEditingFirstBatch ? (batch?.has_upper_template ?? false) : false
    );
    const [hasLowerTemplate, setHasLowerTemplate] = useState<boolean>(() =>
        isEditingFirstBatch ? (batch?.has_lower_template ?? false) : false
    );

    // Start/end sequences are fully derived: start from the template flags (first
    // batch), the batch's stored start (editing a later batch), or the previous
    // batch's end + 1 (adding a later batch); end from start + count.
    const computedFields = useMemo<ComputedFields>(() => {
        let upperStart: number;
        let lowerStart: number;
        if (canChangeTemplateOption) {
            upperStart = hasUpperTemplate ? 0 : 1;
            lowerStart = hasLowerTemplate ? 0 : 1;
        } else if (batch) {
            upperStart = batch.upper_aligner_start_sequence ?? 1;
            lowerStart = batch.lower_aligner_start_sequence ?? 1;
        } else if (existingBatches.length > 0) {
            // Mirror the server (createBatch): next start = MAX(end) over ALL
            // batches + 1, per arch — the latest batch alone won't do, it may
            // have no aligners for one arch (null end) while an earlier one does.
            const upperEnds = existingBatches
                .map(b => b.upper_aligner_end_sequence)
                .filter((v): v is number => v != null);
            const lowerEnds = existingBatches
                .map(b => b.lower_aligner_end_sequence)
                .filter((v): v is number => v != null);
            upperStart = (upperEnds.length > 0 ? Math.max(...upperEnds) : 0) + 1;
            lowerStart = (lowerEnds.length > 0 ? Math.max(...lowerEnds) : 0) + 1;
        } else {
            upperStart = 1;
            lowerStart = 1;
        }

        const upperCount = parseInt(String(formData.upper_aligner_count));
        const lowerCount = parseInt(String(formData.lower_aligner_count));
        return {
            upper_aligner_start_sequence: upperStart,
            lower_aligner_start_sequence: lowerStart,
            upper_aligner_end_sequence: !isNaN(upperCount) && upperCount > 0 ? upperStart + upperCount - 1 : null,
            lower_aligner_end_sequence: !isNaN(lowerCount) && lowerCount > 0 ? lowerStart + lowerCount - 1 : null
        };
    }, [canChangeTemplateOption, hasUpperTemplate, hasLowerTemplate, batch, existingBatches, formData.upper_aligner_count, formData.lower_aligner_count]);

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

            // Flat { success, …, deactivatedBatch? } (no `data` key) → passthrough; a
            // non-2xx (400/500) now throws and is handled in the catch.
            const result = batch
                ? await putJSON<{ deactivatedBatch?: { batchSequence: number } }>(url, dataToSend)
                : await postJSON<{ deactivatedBatch?: { batchSequence: number } }>(url, dataToSend);

            // Show success message
            toast.success(batch ? 'Batch updated successfully!' : 'Batch created successfully!');

            // If a batch was automatically deactivated, inform the user
            if (result.deactivatedBatch && formData.is_active) {
                toast.info(`Batch #${result.deactivatedBatch.batchSequence} was automatically deactivated (only one batch can be active at a time)`);
            }

            await onSave();
            onClose();
        } catch (error) {
            console.error('Error saving batch:', error);
            // Preserve the old precedence: details.message → error → message → fallback,
            // now read off the thrown HttpError's parsed body.
            const data = (error as HttpError).data as
                | { error?: string; message?: string; details?: { message?: string } }
                | undefined;
            const errorMessage = data?.details?.message || data?.error || data?.message || 'Failed to save batch';
            toast.error(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    const getTodayDateString = (): string => {
        return formatISODate();
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
        // A batch can't be manufactured after it was delivered. Catch it here for
        // instant feedback; the server enforces the same rule authoritatively.
        const deliveryDate = batch.delivered_to_patient_date?.split('T')[0];
        if (deliveryDate && dateStr > deliveryDate) {
            toast.error('Manufacture date cannot be later than the delivery date');
            return;
        }
        setSavingDate(true);
        try {
            // Route returns { success, message, data } — fetchJSON unwraps to `data`, so the
            // envelope message isn't available; the static success text covers it.
            await patchJSON(`/api/aligner/batches/${batch.aligner_batch_id}/manufacture`, { targetDate: dateStr });
            toast.success('Manufacture date updated');
            setEditingManufactureDate(false);
            setTempManufactureDate('');
            await onSave(); // Refresh data
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to update manufacture date'));
        } finally {
            setSavingDate(false);
        }
    };

    const handleSetDeliveryDate = async (dateStr: string): Promise<void> => {
        if (!batch) return;
        // Delivery can't predate manufacture. Catch it here for instant feedback;
        // the server enforces the same rule authoritatively.
        const manufactureDate = batch.manufacture_date?.split('T')[0];
        if (manufactureDate && dateStr < manufactureDate) {
            toast.error('Delivery date cannot be earlier than the manufacture date');
            return;
        }
        setSavingDate(true);
        try {
            // Route returns { success, message, data } — fetchJSON unwraps to `data`, so the
            // envelope message isn't available; the static success text covers it.
            await patchJSON(`/api/aligner/batches/${batch.aligner_batch_id}/deliver`, { targetDate: dateStr });
            toast.success('Delivery date updated');
            setEditingDeliveryDate(false);
            setTempDeliveryDate('');
            await onSave(); // Refresh data
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to update delivery date'));
        } finally {
            setSavingDate(false);
        }
    };

    // Block dismissal (backdrop / X / Cancel) while a save or date-apply is in
    // flight so the batch edit can't be abandoned mid-request.
    const handleClose = () => {
        if (!saving && !savingDate) onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            overlayClassName="drawer-overlay"
            contentClassName="drawer-container"
            ariaLabelledBy="batch-form-drawer-title"
        >
            <ModalHeader
                title={batch ? 'Edit Batch' : 'Add New Batch'}
                titleId="batch-form-drawer-title"
                onClose={handleClose}
            />

            <div className="drawer-body">
                <form onSubmit={handleSubmit} className="drawer-form-flex">
                    {/* Action Buttons - Top */}
                    <div className="drawer-footer drawer-footer-top">
                        <button type="button" className="btn btn-secondary" onClick={handleClose} disabled={saving}>
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
                        {/* Read-only: the server numbers batches itself (MAX+1 on create,
                            resequenced on edit/delete) and ignores any client value. */}
                        <div className="form-field">
                            <label htmlFor="BatchSequence">Batch Sequence (Auto)</label>
                            <input
                                type="number"
                                id="BatchSequence"
                                name="batch_sequence"
                                value={formData.batch_sequence}
                                readOnly
                                className="readonly"
                            />
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
                                    <label htmlFor="batch-created-on">Created On</label>
                                    <input
                                        id="batch-created-on"
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
                                <label htmlFor="batch-manufacture-date">
                                    Manufacture Date
                                    <span className="field-optional-text">(when manufacturing completed)</span>
                                </label>
                                {batch ? (
                                    editingManufactureDate ? (
                                        <div className="date-edit-inline">
                                            <input
                                                id="batch-manufacture-date"
                                                type="date"
                                                value={tempManufactureDate}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => setTempManufactureDate(e.target.value)}
                                                // Can't be manufactured after it was delivered
                                                max={batch.delivered_to_patient_date?.split('T')[0] || undefined}
                                                // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
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
                                                id="batch-manufacture-date"
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
                                        id="batch-manufacture-date"
                                        type="text"
                                        value="Set after creating batch"
                                        readOnly
                                        className="readonly"
                                    />
                                )}
                            </div>

                            {/* Delivery Date - Read-only with edit */}
                            <div className="form-field">
                                <label htmlFor="batch-delivered-date">
                                    Delivered Date
                                    <span className="field-optional-text">(when given to patient)</span>
                                </label>
                                {batch ? (
                                    editingDeliveryDate ? (
                                        <div className="date-edit-inline">
                                            <input
                                                id="batch-delivered-date"
                                                type="date"
                                                value={tempDeliveryDate}
                                                onChange={(e: ChangeEvent<HTMLInputElement>) => setTempDeliveryDate(e.target.value)}
                                                // Can't be delivered before it was manufactured
                                                min={batch.manufacture_date?.split('T')[0] || undefined}
                                                // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
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
                                                id="batch-delivered-date"
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
                                        id="batch-delivered-date"
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
                        <button type="button" className="btn btn-secondary" onClick={handleClose} disabled={saving}>
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
        </Modal>
    );
};

export default BatchFormDrawer;
