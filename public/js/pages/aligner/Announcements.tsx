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
import {
    announcementsQuery,
    announcementReceiptsQuery,
    alignerDoctorsQuery,
    alignerFeaturesQuery,
    supabaseStatusQuery,
} from '@/query/queries';
import { useApiMutation } from '@/query/useApiMutation';
import { qk } from '@/query/keys';
import {
    ANNOUNCEMENT_TYPES,
    type AnnouncementRow,
    type AnnouncementType,
    type CreateAnnouncementBody,
} from '@shared/contracts/announcement.contract';
import { formatLocaleDate, formatLocaleDateTime } from '@/utils/formatters';
import { parseLocalDate, toLocalDateString } from '@/utils/calendarDate';
import { useToday, useNowMinute } from '@/hooks/useClock';
import { doctorLabel } from '@/utils/aligner-labels';
import styles from './Announcements.module.css';

/** The newest rows the server returns with "Show expired" (announcement-queries.ts). */
const HISTORY_LIMIT = 300;

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
    /** The LAST day the announcement shows ('YYYY-MM-DD'), or '' = never expires. */
    showUntil: string;
};

const EMPTY_FORM: FormState = {
    title: '',
    message: '',
    announcementType: 'info',
    targetDoctorId: null,
    isDismissible: true,
    linkUrl: '',
    linkText: '',
    showUntil: '',
};

type DoctorOption = { value: number | null; label: string; isDisabled?: boolean };

/** `now` comes from useClock: a clock read in render is cached and goes stale (FE-F26-8). */
function isExpired(a: AnnouncementRow, now: number): boolean {
    return a.expires_at != null && new Date(a.expires_at).getTime() <= now;
}

/** 'YYYY-MM-DD' plus `days`, as a local day. */
function addDays(ymd: string, days: number): string {
    const d = parseLocalDate(ymd);
    d.setDate(d.getDate() + days);
    return toLocalDateString(d);
}

/**
 * The last LOCAL day an announcement shows. `expires_at` is the instant it stops
 * (a manual one: local midnight after its last day), and it reaches the browser as
 * an ISO UTC string — slicing that string read the day before in any zone east of
 * UTC, so every save of an edit moved the expiry a day earlier (FE-F18-1).
 */
function lastShownDay(expiresAt: string): string {
    return toLocalDateString(new Date(new Date(expiresAt).getTime() - 1));
}

/** Why a link would be refused, or null — the contract's rule, checked before the round trip. */
function linkProblem(url: string): string | null {
    const v = url.trim();
    if (!v || v.startsWith('/') || /^https?:\/\//i.test(v)) return null;
    return 'The link must start with / (a portal page) or with http:// or https://';
}

/**
 * Why the doctors may not be seeing what this page shows, or null. The page writes
 * the local database; a doctor sees a row once the failover sync has forwarded it,
 * and a read receipt arrives with the reverse sync (FE-F18-12).
 */
function syncProblem(status: { sinks?: Array<{ sink: string; configured: boolean; enabled: boolean; stale: boolean; backlogAgeSec: number | null; reachable: boolean | null }> } | undefined): string | null {
    const sinks = status?.sinks ?? [];
    const behind = (sink: string): boolean => {
        const s = sinks.find((x) => x.sink === sink);
        if (!s || !s.configured) return false;
        return !s.enabled || s.stale || s.reachable === false || (s.backlogAgeSec ?? 0) > 300;
    };
    if (behind('failover')) {
        return "The sync to the doctors' portal is not keeping up right now. Announcements are saved here and appear in the portal once it catches up.";
    }
    if (behind('reverse')) {
        return "Read receipts from the doctors' portal are delayed right now, so the read counts below may be behind.";
    }
    return null;
}

function fmtDateTime(iso: string | null): string {
    return formatLocaleDateTime(iso) || '—';
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
    const syncWarning = syncProblem(useQuery(supabaseStatusQuery()).data);

    // A doctor with no email has no portal access, so a notice only for them is never
    // seen; they are listed but can't be picked (FE-F18-11).
    const doctorOptions: DoctorOption[] = [
        { value: null, label: 'All doctors (broadcast)' },
        ...doctors.map((d) => ({
            value: d.dr_id,
            label: d.doctor_email ? doctorLabel(d.doctor_name) : `${doctorLabel(d.doctor_name)} — no portal access`,
            isDisabled: !d.doctor_email,
        })),
    ];
    const today = useToday();
    const nowMinute = useNowMinute();
    // Without a doctor portal there is no one to announce to (owner decision,
    // FE-F18-12): the entry point is hidden, and a direct link says why.
    const features = useQuery(alignerFeaturesQuery()).data;

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
            showUntil: a.expires_at ? lastShownDay(a.expires_at) : '',
        });
        setFormOpen(true);
    };

    const handleSave = async () => {
        const problem = linkProblem(form.linkUrl);
        if (problem) {
            toast.warning(problem);
            return;
        }
        const body: CreateAnnouncementBody = {
            title: form.title.trim(),
            message: form.message.trim(),
            announcementType: form.announcementType,
            targetDoctorId: form.targetDoctorId,
            isDismissible: form.isDismissible,
            linkUrl: form.linkUrl.trim() || undefined,
            linkText: form.linkText.trim() || undefined,
            // The stored expiry is the midnight AFTER the last day it shows, so a
            // notice set to "today" shows today — it used to save already expired.
            expiresAt: form.showUntil ? addDays(form.showUntil, 1) : undefined,
        };
        try {
            await save.mutateAsync({ id: editId, body });
            // "Saved", not "published": the doctors see it once the sync has
            // forwarded it (FE-F18-12).
            toast.success(
                editId == null
                    ? "Announcement saved — it appears in the doctors' portal once synced"
                    : 'Announcement updated — the portal shows the change once synced'
            );
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

    if (features && !features.portal) {
        return (
            <div className={styles.empty}>
                <i className="fas fa-bullhorn" aria-hidden="true"></i>
                <p>This install has no doctor portal, so there is no one to send announcements to.</p>
                <Link to="/aligner" className={styles.btnBack}>
                    <i className="fas fa-arrow-left" aria-hidden="true"></i>
                    Doctors
                </Link>
            </div>
        );
    }

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

            {syncWarning && (
                <div className={styles.syncWarning} role="status">
                    <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
                    {syncWarning}
                </div>
            )}

            {includeExpired && announcements.length >= HISTORY_LIMIT && (
                <div className={styles.historyNote} role="status">
                    Showing the newest {HISTORY_LIMIT} announcements.
                </div>
            )}

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
                        const expired = isExpired(a, nowMinute);
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
                                                : a.target_doctor_name
                                                  ? doctorLabel(a.target_doctor_name)
                                                  : `Doctor #${a.target_doctor_id}`}
                                        </span>
                                        {a.expires_at && (
                                            <span className={styles.metaItem} title={`Stops showing at ${fmtDateTime(a.expires_at)}`}>
                                                <i className="fas fa-hourglass-half" aria-hidden="true" />
                                                {expired ? 'Ended' : 'Shown until'} {formatLocaleDate(lastShownDay(a.expires_at))}
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
                                        <button type="button" title="Edit" aria-label={`Edit ${a.title}`} onClick={() => openEdit(a)}>
                                            <i className="fas fa-pen" aria-hidden="true" />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        title="Delete"
                                        aria-label={`Delete ${a.title}`}
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

            {/* A half-typed notice asks before Escape / the backdrop / ✕ / Cancel throw
                it away (FE-F18-9). */}
            <Modal
                isOpen={formOpen}
                onClose={() => setFormOpen(false)}
                ariaLabelledBy={modalTitleId}
                unsavedGuard={{ watchInput: true }}
            >
                {(dismiss) => (<>
                <ModalHeader
                    title={editId == null ? 'New announcement' : 'Edit announcement'}
                    titleId={modalTitleId}
                    icon={<i className="fas fa-bullhorn" aria-hidden="true" />}
                    variant="info"
                    onClose={dismiss}
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
                            <label htmlFor="ann-expires">Show until (last day)</label>
                            <input
                                id="ann-expires"
                                type="date"
                                min={today}
                                value={form.showUntil}
                                onChange={(e) => setForm((f) => ({ ...f, showUntil: e.target.value }))}
                                aria-describedby="ann-expires-hint"
                            />
                            <span id="ann-expires-hint" className={styles.fieldHint}>
                                Empty = no end date. The notice disappears the morning after this day.
                            </span>
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
                                aria-invalid={linkProblem(form.linkUrl) ? true : undefined}
                                aria-describedby={linkProblem(form.linkUrl) ? 'ann-link-error' : undefined}
                            />
                            {linkProblem(form.linkUrl) && (
                                <span id="ann-link-error" className={styles.fieldError}>{linkProblem(form.linkUrl)}</span>
                            )}
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
                        <button type="button" className={styles.btnCancel} onClick={dismiss}>
                            Cancel
                        </button>
                        <button type="button" className={styles.btnSave} onClick={handleSave} disabled={!canSave}>
                            {save.isPending ? (
                                <i className="fas fa-spinner fa-spin" aria-hidden="true" />
                            ) : (
                                <i className="fas fa-paper-plane" aria-hidden="true" />
                            )}
                            {editId == null ? 'Save & send' : 'Save changes'}
                        </button>
                    </div>
                </div>
                </>)}
            </Modal>

            <ConfirmDialog
                isOpen={deleteTarget != null}
                title="Delete announcement"
                message={
                    deleteTarget
                        ? `Delete "${deleteTarget.title}"? It is removed from the doctors' portal once synced, and its read receipts are removed.`
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
