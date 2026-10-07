import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { httpErrorMessage } from '@/core/http';
import { approvalsPendingQuery, HEADER_BELL_POLL } from '@/query/queries';
import {
    approveRequest,
    rejectRequest,
    acknowledgeRequest,
    approveAllRequests,
    acknowledgeAllNotices,
    invalidateApprovals,
    invalidateApprovalTarget,
    ACTION_LABEL_KEY,
    approvalNoteText,
    approvalSummaryText,
    type ApprovalRow,
} from '@/services/approvals';
import HeaderPopover, { RelativeAge } from './HeaderPopover';
import styles from './ApprovalsBell.module.css';

/**
 * ApprovalsBell — admin-only header bell for the maker-checker queue. Shows
 * pending holds (need approve/reject) and pending notices (FYI, need acknowledge).
 * Freshness: `HEADER_BELL_POLL` + `invalidateApprovals()` from every write that
 * creates or resolves a request.
 */
const ApprovalsBell = () => {
    const { t } = useTranslation('approvals');
    const navigate = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();

    const [open, setOpen] = useState(false);
    const [rejectingId, setRejectingId] = useState<number | null>(null);
    const [rejectNote, setRejectNote] = useState('');

    const { data: items = [] } = useQuery({ ...approvalsPendingQuery(), ...HEADER_BELL_POLL });

    const setOpenAndReset = (next: boolean) => {
        setOpen(next);
        if (!next) { setRejectingId(null); setRejectNote(''); }
    };

    const holds = items.filter((r) => r.kind === 'approval');
    const notices = items.filter((r) => r.kind === 'notice');
    const count = items.length;
    const hasHolds = holds.length > 0;

    const runAction = async (fn: () => Promise<unknown>, failMsg: string) => {
        try {
            await fn();
        } catch (err) {
            toast.error(httpErrorMessage(err, failMsg));
        } finally {
            // Even a failed call may have resolved the row (a 409 "already
            // processed"), so the list refreshes either way.
            void invalidateApprovals();
        }
    };

    // The server answers 200 for a hold it could NOT apply too — `stale` (the
    // record changed after the request) or `failed` (it is gone, or replaying
    // threw) — so the outcome is read off the row, not the status code (FE-F5-3).
    const handleApprove = (row: ApprovalRow) =>
        runAction(async () => {
            const result = await approveRequest(row.request_id);
            if (result.status === 'approved') {
                await invalidateApprovalTarget(row);
                toast.success(t('bell.approved'));
            } else if (result.status === 'stale') {
                toast.warning(t('bell.stale'));
            } else {
                toast.error(result.review_note ? t('bell.failed', { reason: approvalNoteText(result.review_note, t) }) : t('bell.failedUnknown'));
            }
        }, t('bell.approveFailed'));

    const handleReject = (row: ApprovalRow) => {
        const note = rejectNote;
        setRejectingId(null); setRejectNote('');
        return runAction(() => rejectRequest(row.request_id, note || undefined), t('bell.rejectFailed'));
    };

    const handleAcknowledge = (row: ApprovalRow) =>
        runAction(() => acknowledgeRequest(row.request_id), t('bell.acknowledgeFailed'));

    const handleApproveAll = async () => {
        const pending = holds;
        const ok = await confirm(
            t('bell.approveAllConfirm', { n: pending.length }),
            { title: t('bell.approveAll'), confirmText: t('bell.approveAll'), danger: true },
        );
        if (!ok) return;
        await runAction(async () => {
            const r = await approveAllRequests();
            // The response does not say which rows applied; refreshing the targets
            // of the skipped ones as well costs a refetch, never a stale screen.
            if (r.approved > 0) await Promise.all(pending.map((row) => invalidateApprovalTarget(row)));
            if (r.skipped > 0) {
                toast.warning(t('bell.approvedSome', { approved: r.approved, skipped: r.skipped }));
            } else {
                toast.success(t('bell.approvedAll', { n: r.approved }));
            }
        }, t('bell.approveAllFailed'));
    };

    const handleClearAllNotices = () =>
        runAction(async () => {
            const r = await acknowledgeAllNotices();
            toast.success(t('bell.cleared', { n: r.cleared }));
        }, t('bell.clearFailed'));

    const openPatient = (personId: number) => {
        setOpenAndReset(false);
        navigate(`/patient/${personId}/works`);
    };

    const openHistory = () => {
        setOpenAndReset(false);
        navigate('/approvals/history');
    };

    const patientChip = (row: ApprovalRow) => {
        if (row.person_id == null) return null;
        const personId = row.person_id;
        const name = row.patient_name ?? t('patientFallback', { id: personId });
        return (
            <button
                type="button"
                className={styles.patientChip}
                onClick={() => openPatient(personId)}
                title={t('openPatient', { name })}
            >
                <i className="fas fa-user" aria-hidden="true" /> {name}
            </button>
        );
    };

    const meta = (row: ApprovalRow) => (
        <div className={styles.itemMeta}>
            {patientChip(row)}
            <span className={styles.typeTag}>{t(`action.${ACTION_LABEL_KEY[row.action_type]}`)}</span>
            <span className={styles.byTag}>{row.requested_by}</span>
            <RelativeAge iso={row.requested_at} className={styles.age} />
        </div>
    );

    return (
        <HeaderPopover
            open={open}
            onOpenChange={setOpenAndReset}
            bellLabel={count ? t('bell.titleCount', { n: count }) : t('bell.title')}
            title={t('bell.title')}
            icon="fa-gavel"
            width={390}
            badge={count > 0 && (
                <span className={`${styles.badge} ${hasHolds ? styles.badgeHold : styles.badgeNotice}`}>
                    {count}
                </span>
            )}
        >
            <div className={styles.popHeader}>
                <span>{t('bell.title')} {count > 0 && <span className={styles.popCount}>{count}</span>}</span>
                <button
                    type="button"
                    className={styles.headerIconBtn}
                    onClick={openHistory}
                    title={t('bell.history')}
                    aria-label={t('bell.history')}
                >
                    <i className="fas fa-clock-rotate-left" aria-hidden="true" />
                </button>
            </div>

            <div className={styles.list}>
                {items.length === 0 ? (
                    <div className={styles.empty}>
                        <i className="fas fa-check-circle" aria-hidden="true" />
                        <span>{t('bell.empty')}</span>
                    </div>
                ) : (
                    <>
                        {holds.length > 0 && (
                            <div className={styles.section}>
                                <div className={styles.sectionLabel}>
                                    <i className="fas fa-pause-circle" aria-hidden="true" /> {t('bell.holds')}
                                    <button
                                        type="button"
                                        className={styles.bulkBtn}
                                        onClick={() => void handleApproveAll()}
                                        title={t('bell.approveAllTitle')}
                                    >
                                        <i className="fas fa-check-double" aria-hidden="true" /> {t('bell.approveAll')}
                                    </button>
                                </div>
                                {holds.map((row) => (
                                    <div key={row.request_id} className={styles.item}>
                                        <span className={`${styles.kindBar} ${styles.kindHold}`} />
                                        <div className={styles.itemBody}>
                                            <div className={styles.itemText}>{approvalSummaryText(row, t)}</div>
                                            {meta(row)}

                                            {rejectingId === row.request_id && (
                                                <div className={styles.rejectRow}>
                                                    <input
                                                        type="text"
                                                        className={styles.rejectInput}
                                                        placeholder={t('bell.reason')}
                                                        aria-label={t('bell.reason')}
                                                        value={rejectNote}
                                                        // eslint-disable-next-line jsx-a11y/no-autofocus
                                                        autoFocus
                                                        onChange={(e) => setRejectNote(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') void handleReject(row);
                                                            if (e.key === 'Escape') {
                                                                // Close the reason row only, not the popover.
                                                                e.stopPropagation();
                                                                setRejectingId(null); setRejectNote('');
                                                            }
                                                        }}
                                                    />
                                                    <button
                                                        type="button"
                                                        className={styles.confirmRejectBtn}
                                                        onClick={() => void handleReject(row)}
                                                    >
                                                        {t('bell.confirm')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.cancelBtn}
                                                        onClick={() => { setRejectingId(null); setRejectNote(''); }}
                                                    >
                                                        {t('bell.cancel')}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div className={styles.actions}>
                                            <button
                                                type="button"
                                                className={styles.approveBtn}
                                                title={t('bell.approve')}
                                                aria-label={t('bell.approve')}
                                                onClick={() => void handleApprove(row)}
                                            >
                                                <i className="fas fa-check" aria-hidden="true" />
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.rejectBtn}
                                                title={t('bell.reject')}
                                                aria-label={t('bell.reject')}
                                                aria-expanded={rejectingId === row.request_id}
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
                                    <i className="fas fa-info-circle" aria-hidden="true" /> {t('bell.notices')}
                                    <button
                                        type="button"
                                        className={styles.bulkBtn}
                                        onClick={() => void handleClearAllNotices()}
                                        title={t('bell.clearAllTitle')}
                                    >
                                        <i className="fas fa-check-double" aria-hidden="true" /> {t('bell.clearAll')}
                                    </button>
                                </div>
                                {notices.map((row) => (
                                    <div key={row.request_id} className={styles.item}>
                                        <span className={`${styles.kindBar} ${styles.kindNotice}`} />
                                        <div className={styles.itemBody}>
                                            <div className={styles.itemText}>{approvalSummaryText(row, t)}</div>
                                            {meta(row)}
                                        </div>

                                        <div className={styles.actions}>
                                            <button
                                                type="button"
                                                className={styles.ackBtn}
                                                title={t('bell.acknowledge')}
                                                aria-label={t('bell.acknowledge')}
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
        </HeaderPopover>
    );
};

export default ApprovalsBell;
