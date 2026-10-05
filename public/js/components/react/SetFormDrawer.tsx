import React, { useState, ChangeEvent, FormEvent } from 'react';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import { copyToClipboard } from '../../core/utils';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { doctorLabel } from '../../utils/aligner-labels';
import type { AlignerDoctorMinimal, AlignerSet } from '../../pages/aligner/aligner.types';
import { postJSON, putJSON, deleteJSON, postFormData, httpErrorMessage } from '@/core/http';
import { invalidateAligner } from '@/query/aligner';

/** The set types the form offers; a stored type outside them is kept as an extra option. */
const SET_TYPES = ['Initial', 'Refinement', 'Revision'] as const;

/** A cost as typed: digits and at most one '.' with two decimals (the column is numeric(10,2)). */
function cleanCost(raw: string): string {
    const kept = raw.replace(/[^\d.]/g, '');
    const [whole, ...rest] = kept.split('.');
    return rest.length > 0 ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
}

/** "1,250.5" for display; the field shows the raw value while focused. */
function displayCost(value: string): string {
    if (value === '') return '';
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : value;
}

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
    /** As typed ('' = no cost). */
    set_cost: string;
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
    folderPath?: string | null;
    /**
     * `roleCaps().writeFinance`. Set prices are front-desk/admin (owner decision
     * 2026-10-04, FE-F17-9); the server refuses the rest.
     */
    canPrice: boolean;
    /** The work's currency: a price only on a USD work (FE-F17-9). */
    workCurrency: string | null;
}

const SetFormDrawer: React.FC<SetFormDrawerProps> = ({
    isOpen,
    onClose,
    onSave,
    set,
    workId,
    doctors,
    allSets = [],
    folderPath,
    canPrice,
    workCurrency,
}) => {
    const toast = useToast();
    const confirm = useConfirm();

    // In add mode, inherit the doctor from the earliest existing set — but only
    // when that doctor still exists in the dropdown. Used both to seed the form
    // and to back-fill once the doctors list finishes loading.
    const computeDefaultDoctor = (): number | string => {
        if (set || allSets.length === 0) return '';
        const firstSet = allSets.reduce((min, s) =>
            (s.set_sequence || Infinity) < (min.set_sequence || Infinity) ? s : min
        , allSets[0]);
        if (firstSet.aligner_dr_id && doctors?.some(d => d.dr_id === firstSet.aligner_dr_id)) {
            return firstSet.aligner_dr_id;
        }
        return '';
    };

    // The drawer is mounted fresh each time it opens (parent renders it only while
    // open), so the initial form state IS the on-open reset — seed it lazily here
    // instead of syncing it in an effect.
    const [initialForm] = useState<SetFormData>(() => {
        if (set) {
            // Edit mode — populate from the existing set
            return {
                set_sequence: set.set_sequence || '',
                type: set.type || '',
                upper_aligners_count: set.upper_aligners_count || '',
                lower_aligners_count: set.lower_aligners_count || '',
                days: set.days || '',
                aligner_dr_id: set.aligner_dr_id || '',
                set_url: set.set_url || '',
                set_pdf_url: set.set_pdf_url || '',
                set_video: set.set_video || '',
                // `!= null`: a 0 cost is a cost (FE-F17-8).
                set_cost: set.set_cost != null ? String(set.set_cost) : '',
                currency: set.currency || 'USD',
                notes: set.notes || '',
                is_active: set.is_active !== undefined ? set.is_active : true
            };
        }
        // Add mode — next sequence + inherited doctor
        const maxSequence = allSets.length > 0
            ? Math.max(...allSets.map(s => s.set_sequence || 0))
            : 0;
        return {
            set_sequence: maxSequence + 1,
            type: '',
            upper_aligners_count: '',
            lower_aligners_count: '',
            days: '',
            aligner_dr_id: computeDefaultDoctor(),
            set_url: '',
            set_pdf_url: '',
            set_video: '',
            set_cost: '',
            currency: 'USD',
            notes: '',
            is_active: true
        };
    });
    const [formData, setFormData] = useState<SetFormData>(initialForm);

    const [errors, setErrors] = useState<FormErrors>({});
    const [saving, setSaving] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<string>('details');
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [deletingPdf, setDeletingPdf] = useState<boolean>(false);
    const [costFocused, setCostFocused] = useState(false);
    // Why the price can't be edited here, or null when it can (FE-F17-9).
    const priceLock = !canPrice
        ? 'Only the front desk or an admin can set the price of an aligner set.'
        : workCurrency !== 'USD'
          ? `Aligner sets are priced in USD, but this treatment is billed in ${workCurrency ?? 'no currency'} — record the charge on the Works page.`
          : null;

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

    // In add mode the drawer can open before the doctors list has loaded (the
    // body shows a spinner until it does). When the list arrives, back-fill the
    // inherited default once, if the user hasn't already picked one. This is
    // React's sanctioned render-phase state adjustment — no setState-in-effect.
    const [doctorsBackfilled, setDoctorsBackfilled] = useState(() => (doctors?.length ?? 0) > 0);
    if (!doctorsBackfilled && (doctors?.length ?? 0) > 0) {
        setDoctorsBackfilled(true);
        if (!set && !formData.aligner_dr_id) {
            const dflt = computeDefaultDoctor();
            if (dflt) setFormData(prev => ({ ...prev, aligner_dr_id: dflt }));
        }
    }

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
        } else if (
            // The server's unique (work, set number) index answered this with a 500
            // (FE-F17-13); it is a 409 now, and caught here before the round trip.
            allSets.some(
                (s) => s.aligner_set_id !== set?.aligner_set_id && String(s.set_sequence) === String(formData.set_sequence)
            )
        ) {
            newErrors.set_sequence = `Set #${formData.set_sequence} already exists for this treatment`;
        }

        if (!formData.aligner_dr_id || formData.aligner_dr_id === '' || isNaN(parseInt(String(formData.aligner_dr_id), 10))) {
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

        // An empty cost box is "no cost" (null) — it used to save 0 (FE-F17-8).
        const costValue = formData.set_cost === '' ? null : Number(formData.set_cost);
        let dataToSend: Record<string, unknown>;
        if (set) {
            // An edit sends only what changed. The form is seeded from the page's read,
            // so sending the whole row would revert whatever changed since (the
            // inline-edit half of FE-F17-1, and RB4's note on the work form).
            dataToSend = {};
            for (const key of Object.keys(formData) as (keyof SetFormData)[]) {
                if (String(formData[key]) !== String(initialForm[key])) {
                    dataToSend[key] = key === 'set_cost' ? costValue : formData[key];
                }
            }
            if (Object.keys(dataToSend).length === 0 && !pdfFile) {
                toast.info('Nothing changed');
                onClose();
                return;
            }
        } else {
            dataToSend = { ...formData, set_cost: costValue, work_id: workId };
        }

        setSaving(true);

        try {
            const result = set
                ? Object.keys(dataToSend).length > 0
                    ? await putJSON<{ setId?: number }>(`/api/aligner/sets/${set.aligner_set_id}`, dataToSend)
                    : {}
                : await postJSON<{ setId?: number }>('/api/aligner/sets', dataToSend);

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
            // 120s to match the server's timeouts.long on this route (and the
            // sibling call site in PatientSets.tsx): the default 30s funnel
            // timeout aborts a large PDF client-side while the server is still
            // completing the upload + the Drive copy, so the user sees "Failed to
            // upload PDF" for an upload that actually landed — and retries it.
            // The size cap above admits files up to 100MB.
            await postFormData(`/api/aligner/sets/${setId}/upload-pdf`, formDataUpload, { timeoutMs: 120000 });
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

            // The deletion is immediate (not on Save), so the card's View PDF must
            // follow now — Cancel used to leave it on the deleted file (FE-F17-13).
            setFormData(prev => ({ ...prev, set_pdf_url: '' }));
            toast.success('PDF deleted successfully');
            void invalidateAligner();
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

    // Block dismissal (backdrop / X / Escape) while a save is in flight so the
    // set edit can't be abandoned mid-request.
    const handleClose = () => {
        if (!saving) onClose();
    };

    // Check if doctors are loaded
    const doctorsLoaded = doctors && doctors.length > 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            overlayClassName="drawer-overlay"
            contentClassName="drawer-container"
            ariaLabelledBy="set-form-drawer-title"
            // A drawer dismisses on Escape/backdrop like any other modal —
            // `isDrawer` only disables dragging.
            unsavedGuard={{ watchInput: true }}
        >
            {(dismiss) => (<>
            <ModalHeader
                title={set ? 'Edit Aligner Set' : 'Add New Aligner Set'}
                titleId="set-form-drawer-title"
                onClose={dismiss}
            />

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
                            <button type="button" className="btn btn-secondary" onClick={dismiss} disabled={saving}>
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
                                            {SET_TYPES.map((t) => (
                                                <option key={t} value={t}>{t}</option>
                                            ))}
                                            {/* A stored type outside the list (live: 'Correction')
                                                showed as "Select Type" (FE-F17-13). */}
                                            {formData.type && !(SET_TYPES as readonly string[]).includes(formData.type) && (
                                                <option value={formData.type}>{formData.type}</option>
                                            )}
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
                                                    {doctorLabel(doctor.doctor_name)}
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
                                        <label htmlFor="SetCost">Set Cost (USD)</label>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            id="SetCost"
                                            name="set_cost"
                                            value={costFocused ? formData.set_cost : displayCost(formData.set_cost)}
                                            onFocus={() => setCostFocused(true)}
                                            onBlur={() => setCostFocused(false)}
                                            onChange={(e) => setFormData(prev => ({ ...prev, set_cost: cleanCost(e.target.value) }))}
                                            placeholder={priceLock ? 'Not set' : 'Enter cost'}
                                            disabled={!!priceLock}
                                            title={priceLock ?? undefined}
                                            aria-describedby={priceLock ? 'SetCostLock' : undefined}
                                        />
                                        {priceLock && (
                                            <small id="SetCostLock" className="pdf-upload-info">{priceLock}</small>
                                        )}
                                    </div>

                                    {/* Aligner sets are USD-only (the lab bills external
                                        doctors in USD) — fixed, not a choice: the payment
                                        path books every set payment into invoices.usd_received,
                                        so another currency would price the set one way and
                                        bank it another. Enforced in aligner.contract.ts too. */}
                                    <div className="form-field">
                                        <label htmlFor="Currency">Currency</label>
                                        <input
                                            id="Currency"
                                            name="currency"
                                            type="text"
                                            value={formData.currency}
                                            readOnly
                                            disabled
                                            title="Aligner sets are billed in USD only"
                                        />
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
                            <button type="button" className="btn btn-secondary" onClick={dismiss} disabled={saving}>
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
            </>)}
        </Modal>
    );
};

export default SetFormDrawer;
