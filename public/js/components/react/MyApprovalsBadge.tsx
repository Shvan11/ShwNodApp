import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { myApprovalsQuery, HEADER_BELL_POLL } from '@/query/queries';
import { ACTION_LABEL_KEY } from '@/services/approvals';
import type { ApprovalStatus } from '@shared/contracts/approvals.contract';
import HeaderPopover, { RelativeAge } from './HeaderPopover';
import styles from './MyApprovalsBadge.module.css';

const STATUS_STYLE: Record<ApprovalStatus, string> = {
    pending: styles.statusPending,
    approved: styles.statusApproved,
    rejected: styles.statusRejected,
    acknowledged: styles.statusAcknowledged,
    failed: styles.statusFailed,
    stale: styles.statusStale,
};

/**
 * MyApprovalsBadge — shown for front-desk users; tracks their own submitted
 * holds and notices so they can see whether each was approved, rejected, or is
 * still waiting. Badge count = pending-approval items only (not notices, which
 * apply immediately and don't need admin action). Freshness: `HEADER_BELL_POLL`
 * + `invalidateApprovals()` from every write that creates a request.
 */
const MyApprovalsBadge = () => {
    const { t } = useTranslation('approvals');
    const [open, setOpen] = useState(false);

    const { data: items = [] } = useQuery({ ...myApprovalsQuery(), ...HEADER_BELL_POLL });
    const pendingCount = items.filter((r) => r.kind === 'approval' && r.status === 'pending').length;

    return (
        <HeaderPopover
            open={open}
            onOpenChange={setOpen}
            bellLabel={pendingCount ? t('mine.titleCount', { n: pendingCount }) : t('mine.title')}
            title={t('mine.tooltip')}
            icon="fa-inbox"
            width={340}
            badge={pendingCount > 0 && <span className={styles.badge}>{pendingCount}</span>}
        >
            <div className={styles.popHeader}>
                <span>
                    {t('mine.title')}{pendingCount > 0 && <span className={styles.popCount}>{pendingCount}</span>}
                </span>
            </div>

            <div className={styles.list}>
                {items.length === 0 ? (
                    <div className={styles.empty}>
                        <i className="fas fa-inbox" aria-hidden="true" />
                        <span>{t('mine.empty')}</span>
                    </div>
                ) : (
                    items.map((row) => {
                        const isPending = row.kind === 'approval' && row.status === 'pending';
                        const patient = row.person_id != null
                            ? row.patient_name ?? t('patientFallback', { id: row.person_id })
                            : row.patient_name;
                        return (
                            <div
                                key={row.request_id}
                                className={`${styles.item} ${isPending ? '' : styles.decided}`}
                            >
                                <div className={styles.itemBody}>
                                    <div className={styles.itemText}>{row.summary}</div>
                                    <div className={styles.itemMeta}>
                                        {patient && (
                                            <span className={styles.patientTag} title={patient}>
                                                <i className="fas fa-user" aria-hidden="true" />
                                                {patient}
                                            </span>
                                        )}
                                        <span className={styles.typeTag}>
                                            {t(`action.${ACTION_LABEL_KEY[row.action_type]}`)}
                                        </span>
                                        <span className={`${styles.statusTag} ${STATUS_STYLE[row.status]}`}>
                                            {t(`status.${row.status}`)}
                                        </span>
                                        {row.review_note && (
                                            <span className={styles.note} title={row.review_note}>
                                                {row.review_note}
                                            </span>
                                        )}
                                        <RelativeAge iso={row.requested_at} className={styles.age} />
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </HeaderPopover>
    );
};

export default MyApprovalsBadge;
