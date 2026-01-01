import React, { useState, useEffect, ChangeEvent, FormEvent, MouseEvent } from 'react';
import { copyToClipboard } from '../../core/utils';
import { useToast } from '../../contexts/ToastContext';

interface AlignerDoctor {
    DrID: number;
    DoctorName?: string;
}

interface AlignerSet {
    AlignerSetID: number;
    SetSequence: number;
    Type?: string;
    UpperAlignersCount?: number;
    LowerAlignersCount?: number;
    Days?: number;
    AlignerDrID?: number;
    SetUrl?: string;
    SetPdfUrl?: string;
    SetVideo?: string;
    SetCost?: number;
    Currency?: string;
    Notes?: string;
    IsActive?: boolean;
    CreationDate?: string;
    TotalBatches?: number;
}

interface SetFormData {
    SetSequence: number | string;
    Type: string;
    UpperAlignersCount: number | string;
    LowerAlignersCount: number | string;
    Days: number | string;
    AlignerDrID: number | string;
    SetUrl: string;
    SetPdfUrl: string;
    SetVideo: string;
    SetCost: number | string;
    Currency: string;
    Notes: string;
    IsActive: boolean;
}

interface FormErrors {
    SetSequence?: string;
    AlignerDrID?: string;
    [key: string]: string | undefined;
}

interface SetFormDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    set?: AlignerSet | null;
    workId: number;
    doctors?: AlignerDoctor[];
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
    const [formData, setFormData] = useState<SetFormData>({
        SetSequence: '',
        Type: '',
        UpperAlignersCount: '',
        LowerAlignersCount: '',
        Days: '',
        AlignerDrID: '',
        SetUrl: '',
        SetPdfUrl: '',
        SetVideo: '',
        SetCost: '',
        Currency: 'USD',
        Notes: '',
        IsActive: true
    });

    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<string>('details');
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [uploadingPdf, setUploadingPdf] = useState<boolean>(false);
    const [deletingPdf, setDeletingPdf] = useState<boolean>(false);

    // Check if an inactive set can be reactivated
    const cannotReactivate = (): boolean => {
        if (!set || set.IsActive) {
            return false; // New sets or already active sets can be changed
        }

        // Get the creation date of current set
        const currentSetDate = new Date(set.CreationDate || '');

        // Check if there's a newer set (created after this one) with at least one batch
        const hasNewerSetWithBatches = allSets.some(otherSet => {
            // Must be a different set
            if (otherSet.AlignerSetID === set.AlignerSetID) {
                return false;
            }

            const otherSetDate = new Date(otherSet.CreationDate || '');

            // Must be created after the current set and have at least one batch
            return otherSetDate > currentSetDate && (otherSet.TotalBatches || 0) > 0;
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
                SetVideo: set.SetVideo || '',
                SetCost: set.SetCost || '',
                Currency: set.Currency || 'USD',
                Notes: set.Notes || '',
                IsActive: set.IsActive !== undefined ? set.IsActive : true
            });
        } else if (isOpen) {
            // Add mode - reset form with auto-populated values

            // Calculate next SetSequence as max existing sequence + 1
            const maxSequence = allSets.length > 0
                ? Math.max(...allSets.map(s => s.SetSequence || 0))
                : 0;
            const nextSequence = maxSequence + 1;

            // Determine default doctor ID
            let defaultDoctor: number | string = '';
            if (defaultDoctorId) {
                // If doctorId is provided from URL, use it
                const doctorExists = doctors && doctors.find(d => d.DrID === parseInt(String(defaultDoctorId)));
                if (doctorExists) {
                    defaultDoctor = parseInt(String(defaultDoctorId));
                } else if (doctors && doctors.length > 0) {
                    defaultDoctor = doctors[0].DrID;
                }
            } else if (doctors && doctors.length > 0) {
                // Otherwise use the first doctor
                defaultDoctor = doctors[0].DrID;
            }

            setFormData({
                SetSequence: nextSequence,
                Type: '',
                UpperAlignersCount: '',
                LowerAlignersCount: '',
                Days: '',
                AlignerDrID: defaultDoctor,
                SetUrl: '',
                SetPdfUrl: '',
                SetVideo: '',
                SetCost: '',
                Currency: 'USD',
                Notes: '',
                IsActive: true
            });
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

        if (!formData.SetSequence || formData.SetSequence === '') {
            newErrors.SetSequence = 'Set sequence is required';
        }

        if (!formData.AlignerDrID || formData.AlignerDrID === '' || isNaN(parseInt(String(formData.AlignerDrID)))) {
            newErrors.AlignerDrID = 'Doctor is required';
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
                // If there's a PDF file to upload, do it after saving
                if (pdfFile && (result.setId || set?.AlignerSetID)) {
                    const setIdToUse = result.setId || set?.AlignerSetID;
                    await handlePdfUpload(setIdToUse);
                }

                onSave();
                onClose();
            } else {
                toast.error('Error: ' + (result.error || 'Failed to save set'));
            }
        } catch (error) {
            console.error('Error saving set:', error);
            toast.error('Error saving set: ' + (error as Error).message);
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
            setUploadingPdf(true);

            const formDataUpload = new FormData();
            formDataUpload.append('pdf', pdfFile);

            const response = await fetch(`/api/aligner/sets/${setId}/upload-pdf`, {
                method: 'POST',
                body: formDataUpload
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to upload PDF');
            }

        } catch (error) {
            console.error('Error uploading PDF:', error);
            toast.error('Failed to upload PDF: ' + (error as Error).message);
        } finally {
            setUploadingPdf(false);
        }
    };

    const handlePdfDelete = async (): Promise<void> => {
        if (!set?.AlignerSetID) return;

        if (!confirm('Are you sure you want to delete this PDF?')) {
            return;
        }

        try {
            setDeletingPdf(true);

            const response = await fetch(`/api/aligner/sets/${set.AlignerSetID}/pdf`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Failed to delete PDF');
            }

            // Update form data to reflect deletion
            setFormData(prev => ({ ...prev, SetPdfUrl: '' }));
            toast.success('PDF deleted successfully');

        } catch (error) {
            console.error('Error deleting PDF:', error);
            toast.error('Failed to delete PDF: ' + (error as Error).message);
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
            // Show success notification
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #10b981, #059669);
                color: white;
                padding: 1rem 1.5rem;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                z-index: 10000;
                animation: slideIn 0.3s ease-out;
                font-size: 0.95rem;
                max-width: 400px;
            `;
            notification.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <i class="fas fa-check-circle" style="font-size: 1.2rem;"></i>
                    <div>
                        <div style="font-weight: 600; margin-bottom: 0.25rem;">Folder path copied!</div>
                        <div style="font-size: 0.85rem; opacity: 0.9;">Paste it in the file dialog address bar</div>
                    </div>
                </div>
            `;

            document.body.appendChild(notification);

            // Remove notification after 4 seconds
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease-out';
                setTimeout(() => notification.remove(), 300);
            }, 4000);
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
        <div className="drawer-overlay" onClick={onClose}>
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

                                    <div className="form-column">
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
                                                        {doctor.DoctorName === 'Admin' ? doctor.DoctorName : `Dr. ${doctor.DoctorName}`}
                                                    </option>
                                                ))}
                                            </select>
                                            {errors.AlignerDrID && (
                                                <span className="error-message">{errors.AlignerDrID}</span>
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

                                        <div className="form-field">
                                            <label htmlFor="SetVideo">Case Video URL (YouTube)</label>
                                            <input
                                                type="url"
                                                id="SetVideo"
                                                name="SetVideo"
                                                value={formData.SetVideo}
                                                onChange={handleChange}
                                                placeholder="https://www.youtube.com/watch?v=..."
                                            />
                                            <small className="pdf-upload-info">
                                                Add YouTube unlisted video URL for case explanation
                                            </small>
                                        </div>

                                        {/* PDF Upload Section */}
                                        <div className="form-field">
                                            <label>PDF File</label>
                                            {formData.SetPdfUrl ? (
                                                <div className="pdf-uploaded-status">
                                                    <div className="pdf-status-header">
                                                        <i className="fas fa-file-pdf"></i>
                                                        <span>PDF Uploaded</span>
                                                    </div>
                                                    <div className="pdf-status-actions">
                                                        <button
                                                            type="button"
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => window.open(formData.SetPdfUrl, '_blank')}
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
                            </div>

                            {/* Tab 3: Notes & Settings */}
                            <div className={`tab-content ${activeTab === 'settings' ? 'active' : ''}`}>
                                <div className="form-field">
                                    <label htmlFor="Notes">Notes</label>
                                    <textarea
                                        id="Notes"
                                        name="Notes"
                                        value={formData.Notes}
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
                    )}
                </div>
            </div>
        </div>
    );
};

export default SetFormDrawer;
