import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import { approvalsPendingQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import {
    approveRequest,
    rejectRequest,
    acknowledgeRequest,
    notifyApprovalsChanged,
    APPROVALS_CHANGED_EVENT,
    REFRESH_MS,
    type ApprovalRow,
} from '@/services/approvals';
import styles from './ApprovalsBell.module.css';

const POPOVER_WIDTH = 390;

const ACTION_LABELS: Record<string, string> = {
    'work.update': 'Edit Treatment',
    'work.discount': 'Discount',
    'work.delete': 'Delete Treatment',
    'invoice.delete': 'Delete Invoice',
    'expense.update': 'Edit Expense',
    'expense.delete': 'Delete Expense',
    'patient.delete': 'Delete Patient',
};

function relAge(iso: string | null): string {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diff)) return '';
    const day = 86_400_000;
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m`;
    if (diff < day) return `${Math.floor(diff / 3_600_000)}h`;
    return `${Math.floor(diff / day)}d`;
}

/**
 * ApprovalsBell — admin-only header bell for the maker-checker queue. Shows
 * pending holds (need approve/reject) and pending notices (FYI, need acknowledge).
 * Freshness: mount + 5-min poll + visibilitychange + `approvals:changed` event.
 */
const ApprovalsBell = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const queryClient = useQueryClient();

    const [open, setOpen] = useState(false);
    const [rejectingId, setRejectingId] = useState<number | null>(null);
    const [rejectNote, setRejectNote] = useState('');
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

    const wrapRef = useRef<HTMLDivElement | null>(null);
    const bellRef = useRef<HTMLButtonElement | null>(null);
    const popRef = useRef<HTMLDivElement | null>(null);

    const placePopover = useCallback(() => {
        const r = bellRef.current?.getBoundingClientRect();
        if (!r) return;
        const left = Math.min(
            Math.max(8, r.right - POPOVER_WIDTH),
            window.innerWidth - POPOVER_WIDTH - 8,
        );
        setCoords({ top: r.bottom + 8, left: Math.max(8, left) });
    }, []);

    const { data, refetch } = useQuery({ ...approvalsPendingQuery(), refetchInterval: REFRESH_MS });
    const items = (data ?? []) as ApprovalRow[];

    useEffect(() => {
        const onVisible = () => { if (document.visibilityState === 'visible') void refetch(); };
        const onChanged = () => void refetch();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener(APPROVALS_CHANGED_EVENT, onChanged);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener(APPROVALS_CHANGED_EVENT, onChanged);
        };
    }, [refetch]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
            setOpen(false); setRejectingId(null); setRejectNote('');
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { setOpen(false); setRejectingId(null); setRejectNote(''); }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', placePopover);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', placePopover);
        };
    }, [open, placePopover]);

    const holds = items.filter((r) => r.kind === 'approval');
    const notices = items.filter((r) => r.kind === 'notice');
    const count = items.length;
    const hasHolds = holds.length > 0;

    const runAction = async (fn: () => Promise<unknown>, failMsg: string) => {
        try {
            await fn();
            notifyApprovalsChanged();
            await queryClient.invalidateQueries({ queryKey: qk.approvals.mine() });
        } catch (err) {
            toast.error(httpErrorMessage(err, failMsg));
        }
    };

    const handleApprove = (row: ApprovalRow) =>
        runAction(() => approveRequest(row.request_id), 'Failed to approve');

    const handleReject = (row: ApprovalRow) => {
        const note = rejectNote;
        setRejectingId(null); setRejectNote('');
        return runAction(() => rejectRequest(row.request_id, note || undefined), 'Failed to reject');
    };

    const handleAcknowledge = (row: ApprovalRow) =>
        runAction(() => acknowledgeRequest(row.request_id), 'Failed to acknowledge');

    const openPatient = (personId: number) => {
        setOpen(false);
        navigate(`/patient/${personId}/photos/tp0`);
    };

    const toggleOpen = () => {
        if (!open) placePopover();
        setOpen((o) => !o);
    };

    return (
        <div className={styles.wrap} ref={wrapRef}>
            <button
                type="button"
                ref={bellRef}
                className={styles.bellBtn}
                onClick={toggleOpen}
                aria-label={`Approvals${count ? ` (${count})` : ''}`}
                aria-expanded={open}
                title="Approvals"
            >
                <i className="fas fa-gavel" aria-hidden="true" />
                {count > 0 && (
                    <span className={`${styles.badge} ${hasHolds ? styles.badgeHold : styles.badgeNotice}`}>
                        {count}
                    </span>
                )}
            </button>

            {open && coords && createPortal(
                <div
                    className={styles.popover}
                    role="dialog"
                    aria-label="Approvals"
                    ref={popRef}
                    style={{ position: 'fixed', top: coords.top, left: coords.left }}
                >
                    <div className={styles.popHeader}>
                        <span>Approvals {count > 0 && <span className={styles.popCount}>{count}</span>}</span>
                    </div>

                    <div className={styles.list}>
                        {items.length === 0 ? (
                            <div className={styles.empty}>
                                <i className="fas fa-check-circle" />
                                <span>Nothing pending</span>
                            </div>
                        ) : (
                            <>
                                {holds.length > 0 && (
                                    <div className={styles.section}>
                                        <div className={styles.sectionLabel}>
                                            <i className="fas fa-pause-circle" aria-hidden="true" /> Holds
                                        </div>
                                        {holds.map((row) => (
                                            <div key={row.request_id} className={styles.item}>
                                                <span className={`${styles.kindBar} ${styles.kindHold}`} />
                                                <div className={styles.itemBody}>
                                                    <div className={styles.itemText}>{row.summary}</div>
                                                    <div className={styles.itemMeta}>
                                                        {row.person_id != null && (
                                                            <button
                                                                type="button"
                                                                className={styles.patientChip}
                                                                onClick={() => { if (row.person_id != null) openPatient(row.person_id); }}
                                                            >
                                                                <i className="fas fa-user" aria-hidden="true" /> Patient #{row.person_id}
                                                            </button>
                                                        )}
                                                        <span className={styles.typeTag}>
                                                            {ACTION_LABELS[row.action_type] ?? row.action_type}
                                                        </span>
                                                        <span className={styles.byTag}>{row.requested_by}</span>
                                                        <span className={styles.age}>{relAge(row.requested_at)}</span>
                                                    </div>

                                                    {rejectingId === row.request_id && (
                                                        <div className={styles.rejectRow}>
                                                            <input
                                                                type="text"
                                                                className={styles.rejectInput}
                                                                placeholder="Reason (optional)"
                                                                value={rejectNote}
                                                                // eslint-disable-next-line jsx-a11y/no-autofocus
                                                                autoFocus
                                                                onChange={(e) => setRejectNote(e.target.value)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') void handleReject(row);
                                                                    if (e.key === 'Escape') { setRejectingId(null); setRejectNote(''); }
                                                                }}
                                                            />
                                                            <button
                                                                type="button"
                                                                className={styles.confirmRejectBtn}
                                                                onClick={() => void handleReject(row)}
                                                            >
                                                                Confirm
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={styles.cancelBtn}
                                                                onClick={() => { setRejectingId(null); setRejectNote(''); }}
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className={styles.actions}>
                                                    <button
                                                        type="button"
                                                        className={styles.approveBtn}
                                                        title="Approve"
                                                        onClick={() => void handleApprove(row)}
                                                    >
                                                        <i className="fas fa-check" aria-hidden="true" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.rejectBtn}
                                                        title="Reject"
                                                        onClick={() => {
                                                            setRejectNote('');
                                                            setRejectingId((id) => (id === row.request_id ? null : row.request_id));
                                                        }}
                                                    >
                                                        <i className="fas fa-times" aria-hidden="true" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {notices.length > 0 && (
                                    <div className={styles.section}>
                                        <div className={styles.sectionLabel}>
                                            <i className="fas fa-info-circle" aria-hidden="true" /> Notices
                                        </div>
                                        {notices.map((row) => (
                                            <div key={row.request_id} className={styles.item}>
                                                <span className={`${styles.kindBar} ${styles.kindNotice}`} />
                                                <div className={styles.itemBody}>
                                                    <div className={styles.itemText}>{row.summary}</div>
                                                    <div className={styles.itemMeta}>
                                                        {row.person_id != null && (
                                                            <button
                                                                type="button"
                                                                className={styles.patientChip}
                                                                onClick={() => { if (row.person_id != null) openPatient(row.person_id); }}
                                                            >
                                                                <i className="fas fa-user" aria-hidden="true" /> Patient #{row.person_id}
                                                            </button>
                                                        )}
                                                        <span className={styles.typeTag}>
                                                            {ACTION_LABELS[row.action_type] ?? row.action_type}
                                                        </span>
                                                        <span className={styles.byTag}>{row.requested_by}</span>
                                                        <span className={styles.age}>{relAge(row.requested_at)}</span>
                                                    </div>
                                                </div>

                                                <div className={styles.actions}>
                                                    <button
                                                        type="button"
                                                        className={styles.ackBtn}
                                                        title="Acknowledge"
                                                        onClick={() => void handleAcknowledge(row)}
                                                    >
                                                        <i className="fas fa-eye-slash" aria-hidden="true" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
};

export default ApprovalsBell;
