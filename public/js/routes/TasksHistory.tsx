import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { tasksHistoryQuery } from '@/query/queries';
import {
    setTaskStatus,
    deleteTask,
    notifyTasksChanged,
    dateFromTodayYmd,
    type CompletedTaskRow,
} from '@/services/tasks';
import styles from './TasksHistory.module.css';

/**
 * TasksHistory — the full task log. Every push task in any state (active, snoozed,
 * done, dismissed), newest-active first. Per-row lifecycle actions are contextual:
 * an active/snoozed task can be marked Done or Dismissed; a done/dismissed task can
 * be Reopened (→ active) or permanently Deleted. The completed_at/completed_by audit
 * stamps show where present. Fed by GET /api/tasks/history through the funnel.
 */

type DisplayStatus = 'active' | 'snoozed' | 'done' | 'dismissed';

const SEV: Record<number, { label: string; cls: string }> = {
    1: { label: 'Mild', cls: styles.sev1 },
    2: { label: 'Moderate', cls: styles.sev2 },
    3: { label: 'Severe', cls: styles.sev3 },
};

const STATUS_META: Record<DisplayStatus, { label: string; cls: string }> = {
    active: { label: 'Active', cls: styles.stActive },
    snoozed: { label: 'Snoozed', cls: styles.stSnoozed },
    done: { label: 'Done', cls: styles.stDone },
    dismissed: { label: 'Dismissed', cls: styles.stDismissed },
};

const FILTERS: Array<{ value: 'all' | DisplayStatus; label: string }> = [
    { value: 'all', label: 'All states' },
    { value: 'active', label: 'Active' },
    { value: 'snoozed', label: 'Snoozed' },
    { value: 'done', label: 'Done' },
    { value: 'dismissed', label: 'Dismissed' },
];

function displayStatus(r: CompletedTaskRow): DisplayStatus {
    if (r.status === 'active') {
        return r.snoozed_until && r.snoozed_until > dateFromTodayYmd(0) ? 'snoozed' : 'active';
    }
    return r.status as DisplayStatus;
}

function fmtDateTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

const TasksHistory = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();

    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | DisplayStatus>('all');
    const [busyId, setBusyId] = useState<number | null>(null);

    const { data, isLoading: loading, isError, error } = useQuery(tasksHistoryQuery());
    const rows = (data ?? []) as CompletedTaskRow[];

    useEffect(() => {
        if (isError) toast.error(httpErrorMessage(error, 'Failed to load tasks'));
    }, [isError, error, toast]);

    // Run a lifecycle mutation, then refresh quietly (so the row reflects its new
    // state) and let the bell know. Invalidating qk.tasks.all() covers both this
    // history view and the bell's active list; notifyTasksChanged() additionally
    // wakes non-RQ listeners (e.g. the patient view) over the change event.
    const runAction = async (id: number, fn: () => Promise<unknown>, okMsg: string, failMsg: string) => {
        setBusyId(id);
        try {
            await fn();
            notifyTasksChanged();
            toast.success(okMsg);
            void queryClient.invalidateQueries({ queryKey: qk.tasks.all() });
        } catch (e) {
            toast.error(httpErrorMessage(e, failMsg));
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (id: number) => {
        const ok = await confirm(
            'Permanently delete this task? This removes it for good and cannot be undone.',
            { title: 'Delete task', danger: true, confirmText: 'Delete' }
        );
        if (!ok) return;
        await runAction(id, () => deleteTask(id), 'Task deleted', 'Failed to delete task');
    };

    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
        if (statusFilter !== 'all' && displayStatus(r) !== statusFilter) return false;
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
                                const st = displayStatus(r);
                                const stMeta = STATUS_META[st];
                                const isOpen = st === 'active' || st === 'snoozed';
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
                                                            onClick={() => runAction(r.alert_id, () => setTaskStatus(r.alert_id, 'done'), 'Task completed', 'Failed to complete task')}
                                                        >
                                                            {busy ? <i className="fas fa-spinner fa-spin" /> : <><i className="fas fa-check" /> Done</>}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={styles.plainBtn}
                                                            disabled={busy}
                                                            onClick={() => runAction(r.alert_id, () => setTaskStatus(r.alert_id, 'dismissed'), 'Task dismissed', 'Failed to dismiss task')}
                                                        >
                                                            <i className="fas fa-ban" /> Dismiss
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            type="button"
                                                            className={styles.plainBtn}
                                                            disabled={busy}
                                                            onClick={() => runAction(r.alert_id, () => setTaskStatus(r.alert_id, 'active'), 'Task reopened', 'Failed to reopen task')}
                                                        >
                                                            {busy ? <i className="fas fa-spinner fa-spin" /> : <><i className="fas fa-rotate-left" /> Reopen</>}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={styles.deleteBtn}
                                                            disabled={busy}
                                                            onClick={() => handleDelete(r.alert_id)}
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
                </div>
            )}
        </div>
    );
};

export default TasksHistory;
