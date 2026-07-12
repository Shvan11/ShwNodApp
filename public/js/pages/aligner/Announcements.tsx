// Announcements.tsx — staff management of doctor-portal announcements.
//
// Lists every `doctor_announcements` row (manual + auto batch events) with its
// type, target (one doctor or broadcast), expiry state and read receipts;
// compose/edit runs through the shared <Modal>/<ModalHeader>. Rows forward-sync
// to the Supabase mirror where the portal banner reads them; receipts flow back
// via reverse sync. Auto rows (auto_event set) are system-managed by
// updateBatchStatus — they can be deleted here but not edited.
import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Select from 'react-select';
import Modal from '../../components/react/Modal';
import ModalHeader from '../../components/react/ModalHeader';
import ConfirmDialog from '../../components/react/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';
import { httpErrorMessage, postJSON, putJSON, deleteJSON } from '@/core/http';
import { announcementsQuery, announcementReceiptsQuery, alignerDoctorsQuery } from '@/query/queries';
import { useApiMutation } from '@/query/useApiMutation';
import { qk } from '@/query/keys';
import {
    ANNOUNCEMENT_TYPES,
    type AnnouncementRow,
    type AnnouncementType,
    type CreateAnnouncementBody,
} from '@shared/contracts/announcement.contract';
import styles from './Announcements.module.css';

const TYPE_ICON: Record<AnnouncementType, string> = {
    success: 'fa-circle-check',
    info: 'fa-circle-info',
    warning: 'fa-triangle-exclamation',
    urgent: 'fa-circle-exclamation',
};

const TYPE_CHIP: Record<AnnouncementType, string> = {
    success: styles.chipSuccess,
    info: styles.chipInfo,
    warning: styles.chipWarning,
    urgent: styles.chipUrgent,
};

type FormState = {
    title: string;
    message: string;
    announcementType: AnnouncementType;
    targetDoctorId: number | null;
    isDismissible: boolean;
    linkUrl: string;
    linkText: string;
    expiresAt: string; // 'YYYY-MM-DD' or '' = never
};

const EMPTY_FORM: FormState = {
    title: '',
    message: '',
    announcementType: 'info',
    targetDoctorId: null,
    isDismissible: true,
    linkUrl: '',
    linkText: '',
    expiresAt: '',
};

type DoctorOption = { value: number | null; label: string };

function isExpired(a: AnnouncementRow): boolean {
    return a.expires_at != null && new Date(a.expires_at).getTime() <= Date.now();
}

function fmtDateTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Expandable read-receipts panel (fetched lazily when a row is expanded). */
const ReceiptsPanel: React.FC<{ announcementId: number }> = ({ announcementId }) => {
    const { data, isLoading } = useQuery(announcementReceiptsQuery(announcementId));
    if (isLoading) return <div className={styles.receiptsEmpty}>Loading…</div>;
    if (!data || data.length === 0) return <div className={styles.receiptsEmpty}>No one has read this yet</div>;
    return (
        <ul className={styles.receiptsList}>
            {data.map((r) => (
                <li key={r.read_id}>
                    <i className="fas fa-user-check" aria-hidden="true" />
                    <span>{r.doctor_name ?? `Doctor #${r.dr_id}`}</span>
                    <span className={styles.receiptDate}>{fmtDateTime(r.read_at)}</span>
                </li>
            ))}
        </ul>
    );
};

const Announcements: React.FC = () => {
    const toast = useToast();
    const modalTitleId = useId();

    const [includeExpired, setIncludeExpired] = useState(false);
    const [formOpen, setFormOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [deleteTarget, setDeleteTarget] = useState<AnnouncementRow | null>(null);
    const [expandedId, setExpandedId] = useState<number | null>(null);

    const { data: announcements = [], isLoading } = useQuery(announcementsQuery(includeExpired));
    const { data: doctorsData } = useQuery(alignerDoctorsQuery());
    const doctors = doctorsData?.doctors ?? [];

    const doctorOptions: DoctorOption[] = [
        { value: null, label: 'All doctors (broadcast)' },
        ...doctors.map((d) => ({ value: d.dr_id, label: d.doctor_name })),
    ];

    const save = useApiMutation({
        mutationFn: (vars: { id: number | null; body: CreateAnnouncementBody }) =>
            vars.id == null
                ? postJSON('/api/announcements', vars.body)
                : putJSON(`/api/announcements/${vars.id}`, vars.body),
        invalidate: [qk.announcements.all()],
    });

    const remove = useApiMutation({
        mutationFn: (id: number) => deleteJSON(`/api/announcements/${id}`),
        invalidate: [qk.announcements.all()],
    });

    const openNew = () => {
        setEditId(null);
        setForm(EMPTY_FORM);
        setFormOpen(true);
    };

    const openEdit = (a: AnnouncementRow) => {
        setEditId(a.announcement_id);
        setForm({
            title: a.title,
            message: a.message,
            announcementType: a.announcement_type,
            targetDoctorId: a.target_doctor_id,
            isDismissible: a.is_dismissible,
            linkUrl: a.link_url ?? '',
            linkText: a.link_text ?? '',
            expiresAt: a.expires_at ? a.expires_at.slice(0, 10) : '',
        });
        setFormOpen(true);
    };

    const handleSave = async () => {
        const body: CreateAnnouncementBody = {
            title: form.title.trim(),
            message: form.message.trim(),
            announcementType: form.announcementType,
            targetDoctorId: form.targetDoctorId,
            isDismissible: form.isDismissible,
            linkUrl: form.linkUrl.trim() || undefined,
            linkText: form.linkText.trim() || undefined,
            expiresAt: form.expiresAt || undefined,
        };
        try {
            await save.mutateAsync({ id: editId, body });
            toast.success(editId == null ? 'Announcement published' : 'Announcement updated');
            setFormOpen(false);
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to save announcement'));
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await remove.mutateAsync(deleteTarget.announcement_id);
            toast.success('Announcement deleted');
        } catch (error) {
            toast.error(httpErrorMessage(error, 'Failed to delete announcement'));
        } finally {
            setDeleteTarget(null);
        }
    };

    const canSave = form.title.trim().length > 0 && form.message.trim().length > 0 && !save.isPending;

    return (
        <>
            <div className={styles.sectionHeader}>
                <h2>
                    <i className="fas fa-bullhorn" aria-hidden="true"></i>
                    Announcements
                </h2>
                <div className={styles.sectionInfo}>
                    <label className={styles.expiredToggle}>
                        <input
                            type="checkbox"
                            checked={includeExpired}
                            onChange={(e) => setIncludeExpired(e.target.checked)}
                        />
                        Show expired
                    </label>
                    <Link to="/aligner" className={styles.btnBack} title="Back to doctors">
                        <i className="fas fa-arrow-left" aria-hidden="true"></i>
                        Doctors
                    </Link>
                    <button type="button" className={styles.btnNew} onClick={openNew}>
                        <i className="fas fa-plus" aria-hidden="true"></i>
                        New announcement
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className={styles.empty}>Loading announcements…</div>
            ) : announcements.length === 0 ? (
                <div className={styles.empty}>
                    <i className="fas fa-bullhorn" aria-hidden="true"></i>
                    <p>No announcements yet. Compose one to greet your portal doctors.</p>
                </div>
            ) : (
                <div className={styles.list}>
                    {announcements.map((a) => {
                        const expired = isExpired(a);
                        const isAuto = a.auto_event != null;
                        return (
                            <div key={a.announcement_id} className={`${styles.card} ${expired ? styles.cardExpired : ''}`}>
                                <div className={styles.cardMain}>
                                    <div className={styles.cardTitleRow}>
                                        <span className={`${styles.chip} ${TYPE_CHIP[a.announcement_type]}`}>
                                            <i className={`fas ${TYPE_ICON[a.announcement_type]}`} aria-hidden="true" />
                                            {a.announcement_type}
                                        </span>
                                        <span className={styles.cardTitle}>{a.title}</span>
                                        {isAuto && <span className={styles.autoTag} title={`System event: ${a.auto_event}`}>auto</span>}
                                        {expired && <span className={styles.expiredTag}>expired</span>}
                                    </div>
                                    <div className={styles.cardMessage}>{a.message}</div>
                                    <div className={styles.cardMeta}>
                                        <span className={styles.metaItem}>
                                            <i className={`fas ${a.target_doctor_id == null ? 'fa-users' : 'fa-user-md'}`} aria-hidden="true" />
                                            {a.target_doctor_id == null
                                                ? 'All doctors'
                                                : a.target_doctor_name ?? `Doctor #${a.target_doctor_id}`}
                                        </span>
                                        {a.expires_at && (
                                            <span className={styles.metaItem}>
                                                <i className="fas fa-hourglass-half" aria-hidden="true" />
                                                {fmtDateTime(a.expires_at)}
                                            </span>
                                        )}
                                        <span className={styles.metaItem}>
                                            <i className="fas fa-clock" aria-hidden="true" />
                                            {fmtDateTime(a.created_at)}
                                            {a.created_by ? ` · ${a.created_by}` : ''}
                                        </span>
                                        <button
                                            type="button"
                                            className={styles.receiptsBtn}
                                            onClick={() =>
                                                setExpandedId((id) => (id === a.announcement_id ? null : a.announcement_id))
                                            }
                                            aria-expanded={expandedId === a.announcement_id}
                                        >
                                            <i className="fas fa-envelope-open-text" aria-hidden="true" />
                                            {a.read_count} read
                                            <i
                                                className={`fas ${expandedId === a.announcement_id ? 'fa-chevron-up' : 'fa-chevron-down'}`}
                                                aria-hidden="true"
                                            />
                                        </button>
                                    </div>
                                    {expandedId === a.announcement_id && <ReceiptsPanel announcementId={a.announcement_id} />}
                                </div>
                                <div className={styles.cardActions}>
                                    {!isAuto && (
                                        <button type="button" title="Edit" onClick={() => openEdit(a)}>
                                            <i className="fas fa-pen" aria-hidden="true" />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        title="Delete"
                                        className={styles.deleteBtn}
                                        onClick={() => setDeleteTarget(a)}
                                    >
                                        <i className="fas fa-trash" aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} ariaLabelledBy={modalTitleId}>
                <ModalHeader
                    title={editId == null ? 'New announcement' : 'Edit announcement'}
                    titleId={modalTitleId}
                    icon={<i className="fas fa-bullhorn" />}
                    variant="info"
                    onClose={() => setFormOpen(false)}
                />
                <div className={styles.formBody}>
                    <div className={styles.formRow}>
                        <label htmlFor="ann-title">Title</label>
                        <input
                            id="ann-title"
                            type="text"
                            value={form.title}
                            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                            maxLength={200}
                        />
                    </div>
                    <div className={styles.formRow}>
                        <label htmlFor="ann-message">Message</label>
                        <textarea
                            id="ann-message"
                            rows={4}
                            value={form.message}
                            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                        />
                    </div>
                    <div className={styles.formGrid}>
                        <div className={styles.formRow}>
                            <label htmlFor="ann-type">Type</label>
                            <select
                                id="ann-type"
                                value={form.announcementType}
                                onChange={(e) => setForm((f) => ({ ...f, announcementType: e.target.value as AnnouncementType }))}
                            >
                                {ANNOUNCEMENT_TYPES.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                        <div className={styles.formRow}>
                            <span className={styles.fieldLabel} id="ann-doctor-label">Audience</span>
                            <Select<DoctorOption>
                                aria-labelledby="ann-doctor-label"
                                classNamePrefix="react-select"
                                options={doctorOptions}
                                value={doctorOptions.find((o) => o.value === form.targetDoctorId) ?? doctorOptions[0]}
                                onChange={(opt) => setForm((f) => ({ ...f, targetDoctorId: opt?.value ?? null }))}
                                menuPortalTarget={document.body}
                                menuPlacement="auto"
                            />
                        </div>
                        <div className={styles.formRow}>
                            <label htmlFor="ann-expires">Expires</label>
                            <input
                                id="ann-expires"
                                type="date"
                                value={form.expiresAt}
                                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                            />
                        </div>
                        <div className={styles.formRowCheck}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={form.isDismissible}
                                    onChange={(e) => setForm((f) => ({ ...f, isDismissible: e.target.checked }))}
                                />
                                Doctors can dismiss
                            </label>
                        </div>
                    </div>
                    <div className={styles.formGrid}>
                        <div className={styles.formRow}>
                            <label htmlFor="ann-link-url">Link URL (optional)</label>
                            <input
                                id="ann-link-url"
                                type="text"
                                placeholder="/case/123 or https://…"
                                value={form.linkUrl}
                                onChange={(e) => setForm((f) => ({ ...f, linkUrl: e.target.value }))}
                            />
                        </div>
                        <div className={styles.formRow}>
                            <label htmlFor="ann-link-text">Link label</label>
                            <input
                                id="ann-link-text"
                                type="text"
                                placeholder="View case"
                                value={form.linkText}
                                onChange={(e) => setForm((f) => ({ ...f, linkText: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div className={styles.formFooter}>
                        <button type="button" className={styles.btnCancel} onClick={() => setFormOpen(false)}>
                            Cancel
                        </button>
                        <button type="button" className={styles.btnSave} onClick={handleSave} disabled={!canSave}>
                            {save.isPending ? (
                                <i className="fas fa-spinner fa-spin" aria-hidden="true" />
                            ) : (
                                <i className="fas fa-paper-plane" aria-hidden="true" />
                            )}
                            {editId == null ? 'Publish' : 'Save changes'}
                        </button>
                    </div>
                </div>
            </Modal>

            <ConfirmDialog
                isOpen={deleteTarget != null}
                title="Delete announcement"
                message={
                    deleteTarget
                        ? `Delete "${deleteTarget.title}"? Doctors will no longer see it, and its read receipts are removed.`
                        : ''
                }
                onConfirm={handleDelete}
                onCancel={() => setDeleteTarget(null)}
                confirmText="Delete"
                isDangerous
            />
        </>
    );
};

export default Announcements;
