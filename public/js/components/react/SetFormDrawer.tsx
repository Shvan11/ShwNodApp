import React, { useState, useEffect, ChangeEvent, FormEvent, MouseEvent } from 'react';
import { copyToClipboard } from '../../core/utils';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatNumber } from '../../utils/formatters';
import type { AlignerDoctorMinimal, AlignerSet } from '../../pages/aligner/aligner.types';
import { postJSON, putJSON, deleteJSON, postFormData, httpErrorMessage } from '@/core/http';

interface SetFormData {
    set_sequence: number | string;
    type: string;
    upper_aligners_count: number | string;
    lower_aligners_count: number | string;
    days: number | string;
    aligner_dr_id: number | string;
    set_url: string;
    set_pdf_url: string;
    set_video: string;
    set_cost: number | string;
    currency: string;
    notes: string;
    is_active: boolean;
}

interface FormErrors {
    set_sequence?: string;
    aligner_dr_id?: string;
    [key: string]: string | undefined;
}

interface SetFormDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    set?: AlignerSet | null;
    workId: number;
    doctors?: AlignerDoctorMinimal[];
    allSets?: AlignerSet[];
    defaultDoctorId?: string | number;
    folderPath?: string | null;
}

const SetFormDrawer: React.FC<SetFormDrawerProps> = ({
    isOpen,
    onClose,
    onSave,
    set,
    workId,
    doctors,
    allSets = [],
    defaultDoctorId,
    folderPath
}) => {
    const toast = useToast();
    const confirm = useConfirm();
    const [formData, setFormData] = useState<SetFormData>({
        set_sequence: '',
        type: '',
        upper_aligners_count: '',
        lower_aligners_count: '',
        days: '',
        aligner_dr_id: '',
        set_url: '',
        set_pdf_url: '',
        set_video: '',
        set_cost: '',
        currency: 'USD',
        notes: '',
        is_active: true
    });

    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<string>('details');
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [deletingPdf, setDeletingPdf] = useState<boolean>(false);
    const [displaySetCost, setDisplaySetCost] = useState('');

    // Check if an inactive set can be reactivated
    const cannotReactivate = (): boolean => {
        if (!set || set.is_active) {
            return false; // New sets or already active sets can be changed
        }

        // Get the creation date of current set
        const currentSetDate = new Date(set.creation_date || '');

        // Check if there's a newer set (created after this one) with at least one batch
        const hasNewerSetWithBatches = allSets.some(otherSet => {
            // Must be a different set
            if (otherSet.aligner_set_id === set.aligner_set_id) {
                return false;
            }

            const otherSetDate = new Date(otherSet.creation_date || '');

            // Must be created after the current set and have at least one batch
            return otherSetDate > currentSetDate && (otherSet.TotalBatches || 0) > 0;
        });

        return hasNewerSetWithBatches;
    };

    useEffect(() => {
        if (isOpen && set) {
            // Edit mode - populate form
            setFormData({
                set_sequence: set.set_sequence || '',
                type: set.type || '',
                upper_aligners_count: set.upper_aligners_count || '',
                lower_aligners_count: set.lower_aligners_count || '',
                days: set.days || '',
                aligner_dr_id: set.aligner_dr_id || '',
                set_url: set.set_url || '',
                set_pdf_url: set.set_pdf_url || '',
                set_video: set.set_video || '',
                set_cost: set.set_cost || '',
                currency: set.currency || 'USD',
                notes: set.notes || '',
                is_active: set.is_active !== undefined ? set.is_active : true
            });
            setDisplaySetCost(set.set_cost ? formatNumber(set.set_cost) : '');
        } else if (isOpen) {
            // Add mode - reset form with auto-populated values

            // Calculate next SetSequence as max existing sequence + 1
            const maxSequence = allSets.length > 0
                ? Math.max(...allSets.map(s => s.set_sequence || 0))
                : 0;
            const nextSequence = maxSequence + 1;

            // Determine default doctor ID
            // Only auto-populate if patient has existing sets (inherit from Set 1)
            // If no previous sets, leave empty — user must select manually
            let defaultDoctor: number | string = '';
            if (allSets.length > 0) {
                const firstSet = allSets.reduce((min, s) =>
                    (s.set_sequence || Infinity) < (min.set_sequence || Infinity) ? s : min
                , allSets[0]);
                if (firstSet.aligner_dr_id) {
                    const doctorExists = doctors?.find(d => d.dr_id === firstSet.aligner_dr_id);
                    if (doctorExists) {
                        defaultDoctor = firstSet.aligner_dr_id;
                    }
                }
            }

            setFormData({
                set_sequence: nextSequence,
                type: '',
                upper_aligners_count: '',
                lower_aligners_count: '',
                days: '',
                aligner_dr_id: defaultDoctor,
                set_url: '',
                set_pdf_url: '',
                set_video: '',
                set_cost: '',
                currency: 'USD',
                notes: '',
                is_active: true
            });
            setDisplaySetCost('');
        }
        setErrors({});
        setPdfFile(null); // Reset PDF file selection
    }, [isOpen, set, doctors, allSets, defaultDoctorId]);

    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>): void => {
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

    const validate = (): boolean => {
        const newErrors: FormErrors = {};

        if (!formData.set_sequence || formData.set_sequence === '') {
            newErrors.set_sequence = 'Set sequence is required';
        }

        if (!formData.aligner_dr_id || formData.aligner_dr_id === '' || isNaN(parseInt(String(formData.aligner_dr_id)))) {
            newErrors.aligner_dr_id = 'Doctor is required';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
        e.preventDefault();

        if (!validate()) {
            return;
        }

        setSaving(true);

        try {
            const dataToSend = {
                ...formData,
                work_id: workId
            };

            const url = set
                ? `/api/aligner/sets/${set.aligner_set_id}`
                : '/api/aligner/sets';

            const result = set
                ? await putJSON<{ setId?: number }>(url, dataToSend)
                : await postJSON<{ setId?: number }>(url, dataToSend);

            // If there's a PDF file to upload, do it after saving (success — a
            // non-2xx would have thrown).
            const setIdToUse = result.setId || set?.aligner_set_id;
            if (pdfFile && setIdToUse) {
                await handlePdfUpload(setIdToUse);
            }

            onSave();
            onClose();
        } catch (error) {
            console.error('Error saving set:', error);
            toast.error(httpErrorMessage(error, 'Failed to save set'));
        } finally {
            setSaving(false);
        }
    };

    const handlePdfUpload = async (setId: number): Promise<void> => {
        if (!pdfFile) return;

        if (pdfFile.type !== 'application/pdf') {
            toast.error('Please select a PDF file');
            return;
        }

        if (pdfFile.size > 100 * 1024 * 1024) {
            toast.error('File is too large. Maximum size is 100MB.');
            return;
        }

        try {
            const formDataUpload = new FormData();
            formDataUpload.append('pdf', pdfFile);

            // upload-pdf is sendSuccess-enveloped; fetchJSON unwraps to the inner
            // data (ignored here). A non-2xx throws → caught below.
            await postFormData(`/api/aligner/sets/${setId}/upload-pdf`, formDataUpload);
        } catch (error) {
            console.error('Error uploading PDF:', error);
            toast.error(httpErrorMessage(error, 'Failed to upload PDF'));
        }
    };

    const handlePdfDelete = async (): Promise<void> => {
        if (!set?.aligner_set_id) return;

        if (!await confirm('Are you sure you want to delete this PDF?', { title: 'Delete PDF', danger: true, confirmText: 'Delete' })) {
            return;
        }

        try {
            setDeletingPdf(true);

            await deleteJSON(`/api/aligner/sets/${set.aligner_set_id}/pdf`);

            // Update form data to reflect deletion
            setFormData(prev => ({ ...prev, set_pdf_url: '' }));
            toast.success('PDF deleted successfully');
        } catch (error) {
            console.error('Error deleting PDF:', error);
            toast.error(httpErrorMessage(error, 'Failed to delete PDF'));
        } finally {
            setDeletingPdf(false);
        }
    };

    const openFolder = (): void => {
        if (!folderPath) return;
        // Use custom protocol to open folder
        window.location.href = `explorer:${folderPath}`;
    };

    const copyFolderPathToClipboard = async (): Promise<void> => {
        if (!folderPath) return;

        const success = await copyToClipboard(folderPath);

        if (success) {
            toast.success('Folder path copied! Paste it in the file dialog address bar.');
        }
    };

    const handleFileInputClick = (): void => {
        // Automatically copy folder path to clipboard when file input is clicked
        copyFolderPathToClipboard();
    };

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.type !== 'application/pdf') {
                toast.error('Please select a PDF file');
                e.target.value = '';
                return;
            }
            if (file.size > 100 * 1024 * 1024) {
                toast.error('File is too large. Maximum size is 100MB.');
                e.target.value = '';
                return;
            }
            setPdfFile(file);
        }
    };

    if (!isOpen) return null;

    // Check if doctors are loaded
    const doctorsLoaded = doctors && doctors.length > 0;

    return (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click-to-dismiss
        <div className="drawer-overlay" onClick={onClose}>
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click-to-dismiss */}
            <div className="drawer-container" onClick={(e: MouseEvent) => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>{set ? 'Edit Aligner Set' : 'Add New Aligner Set'}</h2>
                    <button className="close-btn" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="drawer-body">
                    {!doctorsLoaded && !set ? (
                        <div className="drawer-loading-container">
                            <div className="spinner"></div>
                            <p>Loading doctors list...</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="drawer-form-flex">
                            {/* Tab Navigation */}
                            <div className="form-tabs">
                                <button
                                    type="button"
                                    className={`form-tab ${activeTab === 'details' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('details')}
                                >
                                    <i className="fas fa-teeth"></i>
                                    <span>Aligner Details</span>
                                </button>
                                <button
                                    type="button"
                                    className={`form-tab ${activeTab === 'resources' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('resources')}
                                >
                                    <i className="fas fa-link"></i>
                                    <span>Resources & Payment</span>
                                </button>
                                <button
                                    type="button"
                                    className={`form-tab ${activeTab === 'settings' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('settings')}
                                >
                                    <i className="fas fa-cog"></i>
                                    <span>Notes & Settings</span>
                                </button>
                            </div>

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
                                            <i className="fas fa-save"></i> {set ? 'Update Set' : 'Create Set'}
                                        </>
                                    )}
                                </button>
                            </div>

                            {/* Tab 1: Aligner Details */}
                            <div className={`tab-content ${activeTab === 'details' ? 'active' : ''}`}>
                                <div className="form-two-column-container">
                                    <div className="form-column">
                                        <div className="form-field">
                                            <label htmlFor="SetSequence">
                                                Set Sequence <span className="required">*</span>
                                            </label>
                                            <input
                                                type="number"
                                                id="SetSequence"
                                                name="set_sequence"
                                                value={formData.set_sequence}
                                                onChange={handleChange}
                                                className={errors.set_sequence ? 'error' : ''}
                                                min="1"
                                            />
                                            {errors.set_sequence && (
                                                <span className="error-message">{errors.set_sequence}</span>
                                            )}
                                        </div>

                                        <div className="form-field">
                                            <label htmlFor="UpperAlignersCount">Upper Aligners</label>
                                            <input
                                                type="number"
                                                id="UpperAlignersCount"
                                                name="upper_aligners_count"
                                                value={formData.upper_aligners_count}
                                                onChange={handleChange}
                                                min="0"
                                            />
                                        </div>

                                        <div className="form-field">
                                            <label htmlFor="Days">Treatment Days</label>
                                            <input
                                                type="number"
                                                id="Days"
                                                name="days"
                                                value={formData.days}
                                                onChange={handleChange}
                                                min="0"
                                            />
                                        </div>
                                    </div>

                                    <div className="form-column">
                                        <div className="form-field">
                                            <label htmlFor="type">Type</label>
                                            <select
                                                id="type"
                                                name="type"
                                                value={formData.type}
                                                onChange={handleChange}
                                            >
                                                <option value="">Select Type</option>
                                                <option value="Initial">Initial</option>
                                                <option value="Refinement">Refinement</option>
                                                <option value="Revision">Revision</option>
                                            </select>
                                        </div>

                                        <div className="form-field">
                                            <label htmlFor="LowerAlignersCount">Lower Aligners</label>
                                            <input
                                                type="number"
                                                id="LowerAlignersCount"
                                                name="lower_aligners_count"
                                                value={formData.lower_aligners_count}
                                                onChange={handleChange}
                                                min="0"
                                            />
                                        </div>

                                        <div className="form-field">
                                            <label htmlFor="AlignerDrID">
                                                Aligner Doctor <span className="required">*</span>
                                            </label>
                                            <select
                                                id="AlignerDrID"
                                                name="aligner_dr_id"
                                                value={formData.aligner_dr_id}
                                                onChange={handleChange}
                                                className={errors.aligner_dr_id ? 'error' : ''}
                                            >
                                                <option value="">Select Doctor</option>
                                                {doctors && doctors.map(doctor => (
                                                    <option key={doctor.dr_id} value={doctor.dr_id}>
                                                        {doctor.doctor_name === 'Admin' ? doctor.doctor_name : `Dr. ${doctor.doctor_name}`}
                                                    </option>
                                                ))}
                                            </select>
                                            {errors.aligner_dr_id && (
                                                <span className="error-message">{errors.aligner_dr_id}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Tab 2: Resources & Payment */}
                            <div className={`tab-content ${activeTab === 'resources' ? 'active' : ''}`}>
                                <div className="form-two-column-container">
                                    <div className="form-column">
                                        <div className="form-field">
                                            <label htmlFor="SetUrl">Set URL</label>
                                            <input
                                                type="url"
                                                id="SetUrl"
                                                name="set_url"
                                                value={formData.set_url}
                                                onChange={handleChange}
                                                placeholder="https://..."
                                            />
                                        </div>

                                        <div className="form-field">
                                            <label htmlFor="SetPdfUrl">PDF URL (Google Drive)</label>
                                            <input
                                                type="url"
                                                id="SetPdfUrl"
                                                name="set_pdf_url"
                                                value={formData.set_pdf_url}
                                                onChange={handleChange}
                                                placeholder="https://drive.google.com/..."
                                            />
                                        </div>

                                        <div className="form-field">
                                            <label htmlFor="SetVideo">Case Video URL (YouTube)</label>
                                            <input
                                                type="url"
                                                id="SetVideo"
                                                name="set_video"
                                                value={formData.set_video}
                                                onChange={handleChange}
                                                placeholder="https://www.youtube.com/watch?v=..."
                                            />
                                            <small className="pdf-upload-info">
                                                Add YouTube unlisted video URL for case explanation
                                            </small>
                                        </div>

                                        {/* PDF Upload Section */}
                                        <div className="form-field">
                                            <label htmlFor="set-pdf-file">PDF File</label>
                                            {formData.set_pdf_url ? (
                                                <div className="pdf-uploaded-status">
                                                    <div className="pdf-status-header">
                                                        <i className="fas fa-file-pdf"></i>
                                                        <span>PDF Uploaded</span>
                                                    </div>
                                                    <div className="pdf-status-actions">
                                                        <button
                                                            type="button"
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => window.open(formData.set_pdf_url, '_blank')}
                                                        >
                                                            <i className="fas fa-external-link-alt"></i> View PDF
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn btn-danger btn-sm"
                                                            onClick={handlePdfDelete}
                                                            disabled={deletingPdf}
                                                        >
                                                            {deletingPdf ? (
                                                                <>
                                                                    <i className="fas fa-spinner fa-spin"></i> Deleting...
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <i className="fas fa-trash"></i> Delete PDF
                                                                </>
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div>
                                                    {folderPath && (
                                                        <button
                                                            type="button"
                                                            className="btn btn-secondary pdf-upload-btn-full"
                                                            onClick={openFolder}
                                                        >
                                                            <i className="fas fa-folder-open"></i> Open Patient Folder
                                                        </button>
                                                    )}
                                                    <input
                                                        id="set-pdf-file"
                                                        type="file"
                                                        accept=".pdf,application/pdf"
                                                        className="pdf-file-input"
                                                        onClick={handleFileInputClick}
                                                        onChange={handleFileChange}
                                                    />
                                                    {pdfFile && (
                                                        <div className="pdf-file-selected">
                                                            <i className="fas fa-check-circle"></i> {pdfFile.name} selected
                                                        </div>
                                                    )}
                                                    <div className="pdf-file-hint">
                                                        <i className="fas fa-info-circle"></i> The folder path is automatically copied to your clipboard when you click "Choose File". Paste it in the file dialog address bar to navigate to the set folder.
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="form-column">
                                        <div className="form-field">
                                            <label htmlFor="SetCost">Set Cost</label>
                                            <input
                                                type="text"
                                                id="SetCost"
                                                name="set_cost"
                                                value={displaySetCost}
                                                onChange={(e) => {
                                                    const digits = e.target.value.replace(/[^\d]/g, '');
                                                    const num = parseInt(digits, 10) || 0;
                                                    setDisplaySetCost(num ? num.toLocaleString('en-US') : '');
                                                    setFormData(prev => ({ ...prev, set_cost: num }));
                                                }}
                                                onBlur={() => setDisplaySetCost(formData.set_cost ? formatNumber(formData.set_cost) : '')}
                                                placeholder="Enter cost"
                                            />
                                        </div>

                                        <div className="form-field">
                                            <label htmlFor="Currency">Currency</label>
                                            <select
                                                id="Currency"
                                                name="currency"
                                                value={formData.currency}
                                                onChange={handleChange}
                                            >
                                                <option value="USD">USD</option>
                                                <option value="IQD">IQD</option>
                                                <option value="EUR">EUR</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Tab 3: Notes & Settings */}
                            <div className={`tab-content ${activeTab === 'settings' ? 'active' : ''}`}>
                                <div className="form-field">
                                    <label htmlFor="Notes">Notes</label>
                                    <textarea
                                        id="Notes"
                                        name="notes"
                                        value={formData.notes}
                                        onChange={handleChange}
                                        rows={4}
                                        placeholder="Additional notes..."
                                    />
                                </div>

                                <div className="form-field-checkbox">
                                    {cannotReactivate() ? (
                                        <div className="warning-message-box">
                                            <i className="fas fa-info-circle"></i>
                                            <strong>Old Inactive Set:</strong> This set cannot be reactivated because there are newer sets with batches.
                                        </div>
                                    ) : (
                                        <>
                                            <input
                                                type="checkbox"
                                                id="IsActive"
                                                name="is_active"
                                                checked={formData.is_active}
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
                    )}
                </div>
            </div>
        </div>
    );
};

export default SetFormDrawer;
