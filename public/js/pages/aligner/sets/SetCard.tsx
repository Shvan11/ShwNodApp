/**
 * One aligner set on the patient's sets page: its header and actions, details,
 * links, progress, and — when expanded — its batches, the doctor's uploads and the
 * messages.
 *
 * KEYBOARD. The header used to be a `role="button"` div whose Enter/Space handler
 * called preventDefault, so Enter on any of the eight buttons inside it toggled the
 * set instead of pressing the button (FE-F17-4). It is a plain container now; the
 * set number is a heading holding a real disclosure button, and the chevron is a
 * second one.
 */
import { useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { putJSON, httpErrorMessage } from '@/core/http';
import { invalidateAligner } from '@/query/aligner';
import { useToast } from '../../../contexts/ToastContext';
import type { AlignerBatch, AlignerPhoto, AlignerSet } from '../aligner.types';
import BatchList from './BatchList';
import SetAttachments from './SetAttachments';
import SetCommunication from './SetCommunication';
import { formatSetDate, isValidYouTubeUrl } from './setHelpers';
import styles from '../PatientSets.module.css';

export interface SetCardActions {
    onEditSet: (set: AlignerSet) => void;
    onOpenFolder: (set: AlignerSet) => void;
    onDeleteSet: (set: AlignerSet) => void;
    onAddPayment: (set: AlignerSet) => void;
    onPickPdf: (set: AlignerSet) => void;
    onAddBatch: (set: AlignerSet) => void;
    onEditBatch: (batch: AlignerBatch, set: AlignerSet) => void;
    onMarkManufactured: (batch: AlignerBatch) => void;
    onMarkDelivered: (batch: AlignerBatch) => void;
    onDeleteBatch: (batch: AlignerBatch) => void;
    onPrintLabels: (batch: AlignerBatch, set: AlignerSet) => void;
    onToggleQueue: (batch: AlignerBatch, set: AlignerSet) => void;
    isInQueue: (batchId: number) => boolean;
    onViewPhotos: (photos: AlignerPhoto[], index: number) => void;
}

interface SetCardProps {
    set: AlignerSet;
    expanded: boolean;
    commOpen: boolean;
    onToggle: () => void;
    onToggleComm: () => void;
    /** The set's folder, or null when this install has no `AlignerSetsFolder`. */
    folderPath: string | null;
    labName: string;
    /** `caps.writeFinance`: the payment button. */
    canPay: boolean;
    workCurrency: string | null;
    uploadingPdf: boolean;
    /** The doctor portal exists on this install — only then are there uploads to show. */
    hasPortal: boolean;
    actions: SetCardActions;
}

/** Progress = the server's delivered count over the set's total (never total − remaining). */
function progressOf(set: AlignerSet): { delivered: number; total: number; percent: number } {
    const delivered = set.DeliveredAligners ?? 0;
    const total = set.upper_aligners_count + set.lower_aligners_count;
    return { delivered, total, percent: total > 0 ? Math.round((delivered / total) * 100) : 0 };
}

export default function SetCard({
    set,
    expanded,
    commOpen,
    onToggle,
    onToggleComm,
    folderPath,
    labName,
    canPay,
    workCurrency,
    uploadingPdf,
    hasPortal,
    actions,
}: SetCardProps) {
    const { delivered, total, percent } = progressOf(set);
    const setId = set.aligner_set_id;
    const unread = set.UnreadActivityCount ?? 0;
    const hasCost = set.set_cost != null;
    const currency = set.currency || 'USD';
    const workIsUsd = workCurrency === 'USD';
    const contentId = `aligner-set-${setId}-content`;

    return (
        <div className={`aligner-set-card ${set.is_active ? 'active' : 'inactive'} ${unread > 0 ? 'has-activity' : ''}`}>
            {unread > 0 && (
                <div className="activity-banner">
                    <i className="fas fa-bell" aria-hidden="true"></i>
                    <strong>{unread}</strong> new {unread === 1 ? 'update' : 'updates'} from doctor
                </div>
            )}

            <div className="set-header">
                <div className="set-title">
                    <h4>
                        <button
                            type="button"
                            className={styles.setTitleButton}
                            onClick={onToggle}
                            aria-expanded={expanded}
                            aria-controls={contentId}
                        >
                            Set #{set.set_sequence}
                        </button>
                        <span className={`set-badge ${set.is_active ? 'active' : 'inactive'}`}>
                            {set.is_active ? 'Active' : 'Inactive'}
                        </span>
                        {set.type && <span className="set-type">{set.type}</span>}
                    </h4>
                </div>
                <div className="set-header-actions">
                    <button type="button" className="edit-set-btn" onClick={() => actions.onEditSet(set)} title="Edit Set Details">
                        <i className="fas fa-edit" aria-hidden="true"></i>
                        <span>Edit Set</span>
                    </button>
                    <button
                        type="button"
                        className="folder-btn"
                        onClick={() => actions.onOpenFolder(set)}
                        title={folderPath ?? 'The aligner folder is not set up — set AlignerSetsFolder in Settings → General'}
                        disabled={!folderPath}
                    >
                        <i className="fas fa-folder-open" aria-hidden="true"></i>
                        <span>Open Folder</span>
                    </button>
                    {set.set_pdf_url && (
                        <a className="pdf-btn" href={set.set_pdf_url} target="_blank" rel="noopener noreferrer" title={set.set_pdf_url}>
                            <i className="fas fa-file-pdf" aria-hidden="true"></i>
                            <span>View PDF</span>
                        </a>
                    )}
                    {set.set_video && (
                        <a
                            className="video-btn bg-error"
                            href={set.set_video}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Watch case explanation video"
                        >
                            <i className="fab fa-youtube" aria-hidden="true"></i>
                            <span>Case Video</span>
                        </a>
                    )}
                    {set.archform_id != null && (
                        <a className="archform-btn" href={`archformlocal:${set.archform_id}`} title="Open in Archform">
                            <i className="fas fa-cube" aria-hidden="true"></i>
                            <span>Archform</span>
                        </a>
                    )}
                    {canPay && hasCost && (set.Balance ?? 0) > 0 && (
                        <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => actions.onAddPayment(set)}
                            disabled={!workIsUsd}
                            title={
                                workIsUsd
                                    ? 'Add Payment'
                                    : `Set payments are recorded in USD, but this treatment is billed in ${workCurrency ?? 'no currency'} — record the payment from the Works page`
                            }
                        >
                            <i className="fas fa-money-bill-wave" aria-hidden="true"></i>
                            <span>Add Payment</span>
                        </button>
                    )}
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => actions.onDeleteSet(set)} title="Delete Set">
                        <i className="fas fa-trash" aria-hidden="true"></i>
                        <span>Delete</span>
                    </button>
                    <button
                        type="button"
                        className={`toggle-batches-btn ${expanded ? 'expanded' : ''}`}
                        onClick={onToggle}
                        aria-expanded={expanded}
                        aria-controls={contentId}
                    >
                        <span>View Batches ({set.TotalBatches ?? 0})</span>
                        <i className="fas fa-chevron-down" aria-hidden="true"></i>
                    </button>
                </div>
            </div>

            {set.notes && (
                <div className="set-notes">
                    <i className="fas fa-sticky-note" aria-hidden="true"></i>
                    <div className="set-notes-body">
                        <span className="set-notes-label">Set Notes</span>
                        <p className="set-notes-text">{set.notes}</p>
                    </div>
                </div>
            )}

            <div className="set-info">
                <InfoItem icon="fas fa-teeth">Upper: <strong>{set.upper_aligners_count}</strong></InfoItem>
                <InfoItem icon="fas fa-teeth">Lower: <strong>{set.lower_aligners_count}</strong></InfoItem>
                <InfoItem icon="fas fa-box-open">Remaining Upper: <strong>{set.remaining_upper_aligners}</strong></InfoItem>
                <InfoItem icon="fas fa-box-open">Remaining Lower: <strong>{set.remaining_lower_aligners}</strong></InfoItem>
                <InfoItem icon="fas fa-calendar">Created: <strong>{formatSetDate(set.creation_date)}</strong></InfoItem>
                <InfoItem icon="fas fa-clock">Days: <strong>{set.days || 'N/A'}</strong></InfoItem>
                <InfoItem icon="fas fa-user-md">Doctor: <strong>{set.AlignerDoctorName || 'N/A'}</strong></InfoItem>
                <InfoItem icon="fas fa-check-circle">
                    Delivered Batches: <strong>{set.DeliveredBatches ?? 0}/{set.TotalBatches ?? 0}</strong>
                </InfoItem>
                {/* `!= null`, not truthiness: a 0 cost rendered a stray "0" (FE-F17-8). */}
                <InfoItem icon="fas fa-dollar-sign">
                    Cost: <strong>{hasCost ? `${set.set_cost} ${currency}` : 'Not set'}</strong>
                </InfoItem>
                {hasCost && (
                    <>
                        <InfoItem icon="fas fa-money-bill-wave">Paid: <strong>{set.TotalPaid ?? 0} {currency}</strong></InfoItem>
                        <InfoItem icon="fas fa-balance-scale">Balance: <strong>{set.Balance ?? set.set_cost} {currency}</strong></InfoItem>
                        <div className="set-info-item">
                            <span className={`payment-status-badge ${set.PaymentStatus?.toLowerCase().replace(/\s+/g, '-') || 'unpaid'}`}>
                                {set.PaymentStatus || 'Unpaid'}
                            </span>
                        </div>
                    </>
                )}
                <LinkField
                    setId={setId}
                    field="set_url"
                    icon="fas fa-external-link-alt"
                    label="Set URL"
                    value={set.set_url ?? null}
                    placeholder="https://..."
                />
                <LinkField
                    setId={setId}
                    field="set_pdf_url"
                    icon="fas fa-file-pdf"
                    label="PDF URL"
                    value={set.set_pdf_url ?? null}
                    placeholder="https://..."
                    extraAction={
                        <button
                            type="button"
                            className="action-icon-btn edit btn-medium"
                            onClick={() => actions.onPickPdf(set)}
                            title={set.set_pdf_url ? 'Replace PDF (upload file)' : 'Upload PDF'}
                            aria-label={set.set_pdf_url ? 'Replace the PDF' : 'Upload a PDF'}
                            disabled={uploadingPdf}
                        >
                            <i
                                className={uploadingPdf ? 'fas fa-spinner fa-spin' : set.set_pdf_url ? 'fas fa-upload' : 'fas fa-plus'}
                                aria-hidden="true"
                            ></i>
                        </button>
                    }
                />
                <LinkField
                    setId={setId}
                    field="set_video"
                    icon="fas fa-video"
                    label="Case Video"
                    value={set.set_video ?? null}
                    placeholder="https://youtube.com/watch?v=..."
                    validate={(url) =>
                        isValidYouTubeUrl(url)
                            ? null
                            : 'Please enter a valid YouTube URL. Accepted formats: youtube.com/watch, youtu.be, or youtube.com/embed'
                    }
                    renderValue={(url) => (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="video-link-youtube">
                            <i className="fab fa-youtube icon-gap-xs" aria-hidden="true"></i>
                            Watch Case Video
                        </a>
                    )}
                />
            </div>

            <div className="set-progress">
                <div className="progress-bar-container">
                    <div className="progress-bar" style={{ width: `${percent}%` }}></div>
                </div>
                <div className="progress-text">
                    <span>{delivered} of {total} aligners delivered</span>
                    <span>{percent}%</span>
                </div>
            </div>

            <div id={contentId}>
                {expanded && (
                    <>
                        <BatchList
                            set={set}
                            onAddBatch={() => actions.onAddBatch(set)}
                            onEditBatch={(batch) => actions.onEditBatch(batch, set)}
                            onMarkManufactured={actions.onMarkManufactured}
                            onMarkDelivered={actions.onMarkDelivered}
                            onDeleteBatch={actions.onDeleteBatch}
                            onPrintLabels={(batch) => actions.onPrintLabels(batch, set)}
                            onToggleQueue={(batch) => actions.onToggleQueue(batch, set)}
                            isInQueue={actions.isInQueue}
                        />
                        {hasPortal && <SetAttachments setId={setId} onViewPhotos={actions.onViewPhotos} />}
                    </>
                )}
            </div>

            <SetCommunication setId={setId} open={commOpen} onToggle={onToggleComm} labName={labName} />
        </div>
    );
}

function InfoItem({ icon, children }: { icon: string; children: ReactNode }) {
    return (
        <div className="set-info-item">
            <i className={icon} aria-hidden="true"></i>
            <span>{children}</span>
        </div>
    );
}

interface LinkFieldProps {
    setId: number;
    field: 'set_url' | 'set_pdf_url' | 'set_video';
    icon: string;
    label: string;
    value: string | null;
    placeholder: string;
    /** An error message for a value that may not be saved, or null. */
    validate?: (value: string) => string | null;
    renderValue?: (value: string) => ReactNode;
    extraAction?: ReactNode;
}

/**
 * An inline-editable link. Save sends THIS field only (FE-F17-1: it PUT the whole
 * cached row — 28 keys, `is_active` among them — so a link edit reverted anything
 * changed since the page loaded, and re-activated a set that had been superseded).
 */
function LinkField({ setId, field, icon, label, value, placeholder, validate, renderValue, extraAction }: LinkFieldProps) {
    const toast = useToast();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);

    const save = async (): Promise<void> => {
        if (saving) return;
        const next = draft.trim();
        const problem = next ? validate?.(next) : null;
        if (problem) {
            toast.warning(problem);
            return;
        }
        setSaving(true);
        try {
            await putJSON(`/api/aligner/sets/${setId}`, { [field]: next || null });
            await invalidateAligner();
            setEditing(false);
            setDraft('');
        } catch (error) {
            toast.error(`Failed to save ${label}: ${httpErrorMessage(error, 'unknown error')}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="set-info-item grid-col-full-flex">
            <i className={icon} aria-hidden="true"></i>
            <span className="flex-1">
                {label}:{' '}
                {editing ? (
                    <span className="inline-buttons-container">
                        <input
                            type="url"
                            value={draft}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void save();
                                if (e.key === 'Escape') setEditing(false);
                            }}
                            placeholder={placeholder}
                            aria-label={label}
                            className="url-input-inline"
                            // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                            autoFocus
                        />
                    </span>
                ) : value ? (
                    renderValue ? (
                        renderValue(value)
                    ) : (
                        <a href={value} target="_blank" rel="noopener noreferrer" className="url-link">
                            {value}
                        </a>
                    )
                ) : (
                    <em className="url-not-set">Not set</em>
                )}
            </span>
            {editing ? (
                <div className="flex-gap-sm">
                    <button
                        type="button"
                        className="action-icon-btn edit btn-small"
                        onClick={() => void save()}
                        disabled={saving}
                        title={`Save ${label}`}
                        aria-label={`Save ${label}`}
                    >
                        <i className={saving ? 'fas fa-spinner fa-spin' : 'fas fa-save'} aria-hidden="true"></i>
                    </button>
                    <button
                        type="button"
                        className="action-icon-btn delete btn-small"
                        onClick={() => setEditing(false)}
                        title="Cancel"
                        aria-label="Cancel"
                        disabled={saving}
                    >
                        <i className="fas fa-times" aria-hidden="true"></i>
                    </button>
                </div>
            ) : (
                <div className="flex-gap-sm">
                    {extraAction}
                    <button
                        type="button"
                        className="action-icon-btn edit btn-medium"
                        onClick={() => {
                            setDraft(value ?? '');
                            setEditing(true);
                        }}
                        title={value ? `Edit ${label}` : `Add ${label}`}
                        aria-label={value ? `Edit ${label}` : `Add ${label}`}
                    >
                        <i className={value ? 'fas fa-edit' : 'fas fa-plus'} aria-hidden="true"></i>
                    </button>
                </div>
            )}
        </div>
    );
}
