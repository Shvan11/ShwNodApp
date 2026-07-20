import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { myApprovalsQuery } from '@/query/queries';
import { APPROVALS_CHANGED_EVENT, REFRESH_MS, type ApprovalRow } from '@/services/approvals';
import styles from './MyApprovalsBadge.module.css';

const POPOVER_WIDTH = 340;

const ACTION_LABELS: Record<string, string> = {
    'work.update': 'Edit Treatment',
    'work.discount': 'Discount',
    'work.delete': 'Delete Treatment',
    'invoice.delete': 'Delete Invoice',
    'expense.update': 'Edit Expense',
    'expense.delete': 'Delete Expense',
    'patient.delete': 'Delete Patient',
};

const STATUS_LABELS: Record<string, string> = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    acknowledged: 'Acknowledged',
    failed: 'Failed',
    stale: 'Stale',
};

const STATUS_STYLE: Record<string, string> = {
    pending: styles.statusPending,
    approved: styles.statusApproved,
    rejected: styles.statusRejected,
    acknowledged: styles.statusAcknowledged,
    failed: styles.statusFailed,
    stale: styles.statusStale,
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
 * MyApprovalsBadge — shown for front-desk users; tracks their own submitted
 * holds and notices so they can see whether each was approved, rejected, or is
 * still waiting. Badge count = pending-approval items only (not notices, which
 * apply immediately and don't need admin action). Freshness: same cadence as
 * ApprovalsBell (mount + 5-min poll + visibilitychange + `approvals:changed`).
 */
const MyApprovalsBadge = () => {
    const [open, setOpen] = useState(false);
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

    const { data, refetch } = useQuery({ ...myApprovalsQuery(), refetchInterval: REFRESH_MS });
    const items = (data ?? []) as ApprovalRow[];
    const pendingCount = items.filter((r) => r.kind === 'approval' && r.status === 'pending').length;

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
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', placePopover);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', placePopover);
        };
    }, [open, placePopover]);

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
                aria-label={`My submissions${pendingCount ? ` (${pendingCount} pending)` : ''}`}
                aria-expanded={open}
                title="My submitted approvals"
            >
                <i className="fas fa-inbox" aria-hidden="true" />
                {pendingCount > 0 && (
                    <span className={styles.badge}>{pendingCount}</span>
                )}
            </button>

            {open && coords && createPortal(
                <div
                    className={styles.popover}
                    role="dialog"
                    aria-label="My submissions"
                    ref={popRef}
                    style={{ position: 'fixed', top: coords.top, left: coords.left }}
                >
                    <div className={styles.popHeader}>
                        <span>
                            My submissions{pendingCount > 0 && <span className={styles.popCount}>{pendingCount}</span>}
                        </span>
                    </div>

                    <div className={styles.list}>
                        {items.length === 0 ? (
                            <div className={styles.empty}>
                                <i className="fas fa-inbox" aria-hidden="true" />
                                <span>No submissions yet</span>
                            </div>
                        ) : (
                            items.map((row) => {
                                const isPending = row.kind === 'approval' && row.status === 'pending';
                                return (
                                    <div
                                        key={row.request_id}
                                        className={`${styles.item} ${isPending ? '' : styles.decided}`}
                                    >
                                        <div className={styles.itemBody}>
                                            <div className={styles.itemText}>{row.summary}</div>
                                            <div className={styles.itemMeta}>
                                                {(row.patient_name || row.person_id != null) && (
                                                    <span
                                                        className={styles.patientTag}
                                                        title={row.patient_name ?? `Patient #${row.person_id}`}
                                                    >
                                                        <i className="fas fa-user" aria-hidden="true" />
                                                        {row.patient_name ?? `Patient #${row.person_id}`}
                                                    </span>
                                                )}
                                                <span className={styles.typeTag}>
                                                    {ACTION_LABELS[row.action_type] ?? row.action_type}
                                                </span>
                                                <span className={`${styles.statusTag} ${STATUS_STYLE[row.status] ?? ''}`}>
                                                    {STATUS_LABELS[row.status] ?? row.status}
                                                </span>
                                                {row.review_note && (
                                                    <span className={styles.note} title={row.review_note}>
                                                        {row.review_note}
                                                    </span>
                                                )}
                                                <span className={styles.age}>{relAge(row.requested_at)}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
};

export default MyApprovalsBadge;
