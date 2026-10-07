import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { httpErrorMessage } from '@/core/http';
import { LANGUAGES } from '@/core/language';
import { useLanguage } from '../contexts/LanguageContext';
import { approvalsHistoryQuery } from '@/query/queries';
import { ACTION_LABEL_KEY, approvalNoteText, approvalSummaryText } from '@/services/approvals';
import type { ApprovalRow, ApprovalStatus } from '@shared/contracts/approvals.contract';
import styles from './ApprovalsHistory.module.css';

/** The server's cap on the history read (`listHistory`). */
const HISTORY_LIMIT = 500;

type DecidedStatus = Exclude<ApprovalStatus, 'pending'>;
const STATUSES: readonly DecidedStatus[] = ['approved', 'rejected', 'acknowledged', 'stale', 'failed'];

type Kind = ApprovalRow['kind'];
const KINDS = [
    { value: 'approval', label: 'kindApproval' },
    { value: 'notice', label: 'kindNotice' },
] as const satisfies ReadonlyArray<{ value: Kind; label: string }>;

/** The "no filter" value of both selects. */
const ANY = '';

const STATUS_CLASS: Record<ApprovalStatus, string> = {
    pending: styles.stPending,
    approved: styles.stApproved,
    rejected: styles.stRejected,
    acknowledged: styles.stAcknowledged,
    stale: styles.stStale,
    failed: styles.stFailed,
};

/**
 * ApprovalsHistory — what was decided on every held write and notice: who asked,
 * what the outcome was, who decided and when, and the reason for a rejection or
 * a failure. Once an admin acts, the row leaves the bell, so this is the only
 * place a stale or failed approval can still be seen (audit FE-F5-16). Admin
 * only, like the bell that links here; the read is `GET /api/approvals/history`.
 */
const ApprovalsHistory = () => {
    const { t } = useTranslation('approvals');
    const { language } = useLanguage();
    const navigate = useNavigate();

    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<typeof ANY | DecidedStatus>(ANY);
    const [kindFilter, setKindFilter] = useState<typeof ANY | Kind>(ANY);

    const { data: rows = [], isLoading, error } = useQuery(approvalsHistoryQuery());

    const formatStamp = (iso: string | null): string => {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString(LANGUAGES[language].locale, {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    };

    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
        if (statusFilter !== ANY && r.status !== statusFilter) return false;
        if (kindFilter !== ANY && r.kind !== kindFilter) return false;
        if (!q) return true;
        // Search what the table shows: the summary and note in this language.
        return (
            approvalSummaryText(r, t).toLowerCase().includes(q) ||
            (r.patient_name ?? '').toLowerCase().includes(q) ||
            r.requested_by.toLowerCase().includes(q) ||
            (r.reviewed_by ?? '').toLowerCase().includes(q) ||
            approvalNoteText(r.review_note, t).toLowerCase().includes(q)
        );
    });

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <button type="button" className={styles.backBtn} onClick={() => navigate(-1)} aria-label={t('history.back')}>
                    <i className="fas fa-arrow-left" aria-hidden="true" />
                </button>
                <h1 className={styles.title}>
                    <i className="fas fa-clock-rotate-left" aria-hidden="true" /> {t('history.title')}
                </h1>
                <div className={styles.filters}>
                    <select
                        className={styles.select}
                        value={kindFilter}
                        onChange={(e) => setKindFilter(e.target.value as typeof ANY | Kind)}
                        aria-label={t('history.kindLabel')}
                    >
                        <option value={ANY}>{t('history.allKinds')}</option>
                        {KINDS.map((k) => <option key={k.value} value={k.value}>{t(`history.${k.label}`)}</option>)}
                    </select>
                    <select
                        className={styles.select}
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as typeof ANY | DecidedStatus)}
                        aria-label={t('history.filterLabel')}
                    >
                        <option value={ANY}>{t('history.allStatuses')}</option>
                        {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                    </select>
                    <div className={styles.search}>
                        <i className="fas fa-search" aria-hidden="true" />
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('history.search')}
                            aria-label={t('history.searchLabel')}
                        />
                    </div>
                </div>
            </header>

            {isLoading ? (
                <div className={styles.state}>
                    <i className="fas fa-spinner fa-spin" aria-hidden="true" /> {t('history.loading')}
                </div>
            ) : error ? (
                <div className={styles.state} role="alert">
                    <i className="fas fa-triangle-exclamation" aria-hidden="true" />
                    <span>{httpErrorMessage(error, t('history.loadFailed'))}</span>
                </div>
            ) : filtered.length === 0 ? (
                <div className={styles.state}>
                    <i className="fas fa-inbox" aria-hidden="true" />
                    <span>{rows.length === 0 ? t('history.empty') : t('history.noMatches')}</span>
                </div>
            ) : (
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{t('history.col.requested')}</th>
                                <th>{t('history.col.action')}</th>
                                <th>{t('history.col.summary')}</th>
                                <th>{t('history.col.patient')}</th>
                                <th>{t('history.col.requestedBy')}</th>
                                <th>{t('history.col.status')}</th>
                                <th>{t('history.col.reviewed')}</th>
                                <th>{t('history.col.note')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r) => {
                                const patientName = r.patient_name ?? (r.person_id != null ? t('patientFallback', { id: r.person_id }) : null);
                                return (
                                    <tr key={r.request_id}>
                                        <td className={styles.nowrap}>{formatStamp(r.requested_at)}</td>
                                        <td className={styles.nowrap}>
                                            <span className={r.kind === 'approval' ? styles.kindHold : styles.kindNotice} aria-hidden="true" />
                                            {t(`action.${ACTION_LABEL_KEY[r.action_type]}`)}
                                        </td>
                                        <td className={styles.summaryCell}>{approvalSummaryText(r, t)}</td>
                                        <td>
                                            {r.person_id != null && patientName ? (
                                                <button
                                                    type="button"
                                                    className={styles.patientLink}
                                                    onClick={() => navigate(`/patient/${r.person_id}/works`)}
                                                    title={t('openPatient', { name: patientName })}
                                                >
                                                    {patientName}
                                                </button>
                                            ) : <span className={styles.muted}>—</span>}
                                        </td>
                                        <td>{r.requested_by}</td>
                                        <td>
                                            <span className={`${styles.statusBadge} ${STATUS_CLASS[r.status]}`}>
                                                {t(`status.${r.status}`)}
                                            </span>
                                        </td>
                                        <td className={styles.muted}>
                                            {r.reviewed_at || r.reviewed_by
                                                ? <>{r.reviewed_by ? `${r.reviewed_by} · ` : ''}{formatStamp(r.reviewed_at)}</>
                                                : '—'}
                                        </td>
                                        <td className={styles.noteCell}>{approvalNoteText(r.review_note, t)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {rows.length >= HISTORY_LIMIT && (
                        <p className={styles.limitNote}>{t('history.limitNote', { n: HISTORY_LIMIT })}</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default ApprovalsHistory;
