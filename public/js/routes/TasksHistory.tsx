import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { httpErrorMessage } from '@/core/http';
import { tasksHistoryQuery } from '@/query/queries';
import {
    setTaskStatus,
    deleteTask,
    invalidateTasks,
    dateFromTodayYmd,
    type CompletedTaskRow,
} from '@/services/tasks';
import { formatLocaleDateTime } from '@/utils/formatters';
import styles from './TasksHistory.module.css';

/**
 * TasksHistory — the task log: the latest 200 push tasks in any state (active,
 * snoozed, expired, done, dismissed), open ones first. Per-row lifecycle actions are contextual:
 * an active/snoozed task can be marked Done or Dismissed; a done/dismissed task can
 * be Reopened (→ active) or permanently Deleted. The completed_at/completed_by audit
 * stamps show where present. Fed by GET /api/tasks/history through the funnel.
 */

type DisplayStatus = 'active' | 'snoozed' | 'expired' | 'done' | 'dismissed';

/** The server's cap on the log (`getAllTasks`). */
const HISTORY_LIMIT = 200;

const SEV: Record<number, { label: string; cls: string }> = {
    1: { label: 'Mild', cls: styles.sev1 },
    2: { label: 'Moderate', cls: styles.sev2 },
    3: { label: 'Severe', cls: styles.sev3 },
};

const STATUS_META: Record<DisplayStatus, { label: string; cls: string }> = {
    active: { label: 'Active', cls: styles.stActive },
    snoozed: { label: 'Snoozed', cls: styles.stSnoozed },
    expired: { label: 'Expired', cls: styles.stExpired },
    done: { label: 'Done', cls: styles.stDone },
    dismissed: { label: 'Dismissed', cls: styles.stDismissed },
};

const FILTERS: Array<{ value: 'all' | DisplayStatus; label: string }> = [
    { value: 'all', label: 'All states' },
    { value: 'active', label: 'Active' },
    { value: 'snoozed', label: 'Snoozed' },
    { value: 'expired', label: 'Expired' },
    { value: 'done', label: 'Done' },
    { value: 'dismissed', label: 'Dismissed' },
];

/** Past its expiry day: the bell no longer shows it, whatever its status (same rule as the server's read). */
function isExpired(r: CompletedTaskRow, today: string): boolean {
    return !!r.expires_at && r.expires_at < today;
}

function displayStatus(r: CompletedTaskRow, today: string): DisplayStatus {
    if (r.status === 'active') {
        // An expired task used to read "Active" here while the bell had hidden it (FE-F5-7).
        if (isExpired(r, today)) return 'expired';
        return r.snoozed_until && r.snoozed_until > today ? 'snoozed' : 'active';
    }
    return r.status === 'done' ? 'done' : 'dismissed';
}

function fmtDateTime(iso: string | null): string {
    return formatLocaleDateTime(iso, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

const TasksHistory = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();

    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | DisplayStatus>('all');
    const [busyId, setBusyId] = useState<number | null>(null);

    const { data, isLoading: loading, isError, error } = useQuery(tasksHistoryQuery());
    const rows = data ?? [];
    const today = dateFromTodayYmd(0);

    useEffect(() => {
        if (isError) toast.error(httpErrorMessage(error, 'Failed to load tasks'));
    }, [isError, error, toast]);

    // Run a lifecycle mutation, then refresh this log, the bell and — for a
    // patient-linked task — that patient's alert list.
    const runAction = async (row: CompletedTaskRow, fn: () => Promise<unknown>, okMsg: string, failMsg: string) => {
        const id = row.alert_id;
        setBusyId(id);
        try {
            await fn();
            toast.success(okMsg);
            void invalidateTasks(row.person_id);
        } catch (e) {
            toast.error(httpErrorMessage(e, failMsg));
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (row: CompletedTaskRow) => {
        const ok = await confirm(
            'Permanently delete this task? This removes it for good and cannot be undone.',
            { title: 'Delete task', danger: true, confirmText: 'Delete' }
        );
        if (!ok) return;
        await runAction(row, () => deleteTask(row.alert_id), 'Task deleted', 'Failed to delete task');
    };

    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
        if (statusFilter !== 'all' && displayStatus(r, today) !== statusFilter) return false;
        if (!q) return true;
        return (
            (r.alert_details ?? '').toLowerCase().includes(q) ||
            (r.patient_name ?? '').toLowerCase().includes(q) ||
            (r.assignee_name ?? '').toLowerCase().includes(q) ||
            (r.completed_by ?? '').toLowerCase().includes(q)
        );
    });

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <button type="button" className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
                    <i className="fas fa-arrow-left" />
                </button>
                <h1 className={styles.title}>
                    <i className="fas fa-list-check" aria-hidden="true" /> Tasks
                </h1>
                <select
                    className={styles.statusSelect}
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as 'all' | DisplayStatus)}
                    aria-label="Filter by state"
                >
                    {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <div className={styles.search}>
                    <i className="fas fa-search" aria-hidden="true" />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search details, patient, staff…"
                        aria-label="Search tasks"
                    />
                </div>
            </header>

            {loading ? (
                <div className={styles.state}><i className="fas fa-spinner fa-spin" /> Loading…</div>
            ) : filtered.length === 0 ? (
                <div className={styles.state}>
                    <i className="fas fa-inbox" />
                    <span>{rows.length === 0 ? 'No tasks yet' : 'No matches'}</span>
                </div>
            ) : (
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Task</th>
                                <th>State</th>
                                <th>Patient</th>
                                <th>Severity</th>
                                <th>Assigned to</th>
                                <th>Completed</th>
                                <th aria-label="Actions" />
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r) => {
                                const sev = SEV[r.alert_severity] ?? SEV[2];
                                const st = displayStatus(r, today);
                                const stMeta = STATUS_META[st];
                                const isOpen = st === 'active' || st === 'snoozed' || st === 'expired';
                                // Reopening a task past its expiry would report success for a task
                                // the bell can never show again (FE-F5-7).
                                const canReopen = !isExpired(r, today);
                                const busy = busyId === r.alert_id;
                                return (
                                    <tr key={r.alert_id}>
                                        <td className={styles.detailsCell}>{r.alert_details}</td>
                                        <td><span className={`${styles.statusBadge} ${stMeta.cls}`}>{stMeta.label}</span></td>
                                        <td>
                                            {r.person_id != null ? (
                                                <button
                                                    type="button"
                                                    className={styles.patientLink}
                                                    onClick={() => navigate(`/patient/${r.person_id}/works`)}
                                                >
                                                    {r.patient_name ?? `#${r.person_id}`}
                                                </button>
                                            ) : <span className={styles.muted}>—</span>}
                                        </td>
                                        <td><span className={`${styles.sevDot} ${sev.cls}`} /> {sev.label}</td>
                                        <td>{r.assignee_name ?? <span className={styles.muted}>—</span>}</td>
                                        <td className={styles.muted}>
                                            {r.completed_at
                                                ? <>{r.completed_by ? `${r.completed_by} · ` : ''}{fmtDateTime(r.completed_at)}</>
                                                : '—'}
                                        </td>
                                        <td className={styles.actionCell}>
                                            <div className={styles.rowActions}>
                                                {isOpen ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            className={styles.doneBtn}
                                                            disabled={busy}
                                                            onClick={() => runAction(r, () => setTaskStatus(r.alert_id, 'done'), 'Task completed', 'Failed to complete task')}
                                                        >
                                                            {busy ? <i className="fas fa-spinner fa-spin" /> : <><i className="fas fa-check" /> Done</>}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={styles.plainBtn}
                                                            disabled={busy}
                                                            onClick={() => runAction(r, () => setTaskStatus(r.alert_id, 'dismissed'), 'Task dismissed', 'Failed to dismiss task')}
                                                        >
                                                            <i className="fas fa-ban" /> Dismiss
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        {canReopen && (
                                                            <button
                                                                type="button"
                                                                className={styles.plainBtn}
                                                                disabled={busy}
                                                                onClick={() => runAction(r, () => setTaskStatus(r.alert_id, 'active'), 'Task reopened', 'Failed to reopen task')}
                                                            >
                                                                {busy ? <i className="fas fa-spinner fa-spin" /> : <><i className="fas fa-rotate-left" /> Reopen</>}
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            className={styles.deleteBtn}
                                                            disabled={busy}
                                                            onClick={() => handleDelete(r)}
                                                            aria-label="Delete task permanently"
                                                        >
                                                            <i className="fas fa-trash" /> Delete
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {rows.length >= HISTORY_LIMIT && (
                        <p className={styles.limitNote}>Showing the most recent {HISTORY_LIMIT} tasks.</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default TasksHistory;
