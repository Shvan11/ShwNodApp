import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import {
    fetchTasks,
    setTaskStatus,
    snoozeTask,
    notifyTasksChanged,
    dateFromTodayYmd,
    TASKS_CHANGED_EVENT,
    type TaskRow,
} from '@/services/tasks';
import TaskFormModal from './TaskFormModal';
import styles from './TasksBell.module.css';

const REFRESH_MS = 5 * 60 * 1000;
const POPOVER_WIDTH = 360;

const SEV_CLASS: Record<number, string> = { 1: styles.sev1, 2: styles.sev2, 3: styles.sev3 };

function relAge(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diff)) return '';
    const day = 86_400_000;
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m`;
    if (diff < day) return `${Math.floor(diff / 3_600_000)}h`;
    return `${Math.floor(diff / day)}d`;
}

/**
 * TasksBell — the app-wide task surface in the universal header. A quiet bell
 * (badge only when there are tasks; red pulse if any are severe) opens a popover
 * listing active push tasks + escalated context alerts, each with done / snooze /
 * edit / dismiss actions. Freshness: mount + 5-min poll + visibility refetch + the
 * `tasks:changed` window event (fired by every task/alert mutation app-wide).
 */
const TasksBell = () => {
    const navigate = useNavigate();
    const toast = useToast();

    const [tasks, setTasks] = useState<TaskRow[]>([]);
    const [open, setOpen] = useState(false);
    const [formOpen, setFormOpen] = useState(false);
    const [editTask, setEditTask] = useState<TaskRow | null>(null);
    const [snoozeFor, setSnoozeFor] = useState<number | null>(null);
    // Assignee filter (feature #4): 'all' | 'unassigned' | a String(assigned_to).
    const [filter, setFilter] = useState<string>('all');
    // The popover is portaled to <body> (the fixed, overflow:hidden header would
    // otherwise clip it), so it's positioned with viewport-fixed coords off the bell.
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const bellRef = useRef<HTMLButtonElement | null>(null);
    const popRef = useRef<HTMLDivElement | null>(null);

    const placePopover = useCallback(() => {
        const r = bellRef.current?.getBoundingClientRect();
        if (!r) return;
        const left = Math.min(Math.max(8, r.right - POPOVER_WIDTH), window.innerWidth - POPOVER_WIDTH - 8);
        setCoords({ top: r.bottom + 8, left: Math.max(8, left) });
    }, []);

    const loadTasks = useCallback(() => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        fetchTasks(controller.signal)
            .then(setTasks)
            .catch((e) => { if (e instanceof Error && e.name !== 'AbortError') { /* keep last good list */ } });
    }, []);

    // Mount + periodic poll + visibility refetch + cross-app change event.
    useEffect(() => {
        loadTasks();
        const interval = setInterval(loadTasks, REFRESH_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') loadTasks(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener(TASKS_CHANGED_EVENT, loadTasks);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener(TASKS_CHANGED_EVENT, loadTasks);
            abortRef.current?.abort();
        };
    }, [loadTasks]);

    // Close the popover on outside click / Escape; keep it anchored on resize.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
            setOpen(false); setSnoozeFor(null);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setSnoozeFor(null); } };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', placePopover);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', placePopover);
        };
    }, [open, placePopover]);

    const count = tasks.length;
    const hasSevere = tasks.some((t) => t.alert_severity >= 3);

    // Distinct assignees present in the current list, for the filter dropdown.
    const assignees = Array.from(
        new Map(
            tasks
                .filter((t) => t.assigned_to != null)
                .map((t) => [t.assigned_to as number, t.assignee_name ?? `#${t.assigned_to}`])
        ).entries()
    ).map(([id, name]) => ({ id, name }));
    const hasUnassigned = tasks.some((t) => t.assigned_to == null);
    // Guard a stale selection (the picked assignee may have no tasks left).
    const effectiveFilter =
        filter === 'all' ||
        (filter === 'unassigned' && hasUnassigned) ||
        assignees.some((a) => String(a.id) === filter)
            ? filter
            : 'all';
    const visibleTasks =
        effectiveFilter === 'all'
            ? tasks
            : effectiveFilter === 'unassigned'
                ? tasks.filter((t) => t.assigned_to == null)
                : tasks.filter((t) => String(t.assigned_to) === effectiveFilter);
    const showFilter = assignees.length > 0;

    const runAction = async (fn: () => Promise<unknown>, failMsg: string) => {
        try {
            await fn();
            notifyTasksChanged();
        } catch (error) {
            toast.error(httpErrorMessage(error, failMsg));
        }
    };

    const handleDone = (t: TaskRow) => runAction(() => setTaskStatus(t.alert_id, 'done'), 'Failed to complete task');
    const handleDismiss = (t: TaskRow) => runAction(() => setTaskStatus(t.alert_id, 'dismissed'), 'Failed to dismiss task');
    const handleSnooze = (t: TaskRow, ymd: string) => {
        setSnoozeFor(null);
        return runAction(() => snoozeTask(t.alert_id, ymd), 'Failed to snooze task');
    };

    const openPatient = (personId: number) => {
        setOpen(false);
        navigate(`/patient/${personId}/photos/tp0`);
    };

    const openEdit = (t: TaskRow) => { setEditTask(t); setFormOpen(true); setOpen(false); };
    const openNew = () => { setEditTask(null); setFormOpen(true); setOpen(false); };
    const openHistory = () => { setOpen(false); navigate('/tasks/history'); };

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
                aria-label={`Tasks${count ? ` (${count})` : ''}`}
                aria-expanded={open}
                title="Tasks"
            >
                <i className="fas fa-bell" aria-hidden="true" />
                {count > 0 && (
                    <span className={`${styles.badge} ${hasSevere ? styles.badgeSevere : ''}`}>{count}</span>
                )}
            </button>

            {open && coords && createPortal(
                <div
                    className={styles.popover}
                    role="dialog"
                    aria-label="Tasks"
                    ref={popRef}
                    style={{ position: 'fixed', top: coords.top, left: coords.left }}
                >
                    <div className={styles.popHeader}>
                        <span>Tasks {count > 0 && <span className={styles.popCount}>{count}</span>}</span>
                        <div className={styles.popHeaderActions}>
                            <button
                                type="button"
                                className={styles.headerIconBtn}
                                onClick={openHistory}
                                title="All tasks"
                                aria-label="All tasks"
                            >
                                <i className="fas fa-list-check" />
                            </button>
                            <button type="button" className={styles.newBtn} onClick={openNew}>
                                <i className="fas fa-plus" /> New
                            </button>
                        </div>
                    </div>

                    {showFilter && (
                        <div className={styles.filterRow}>
                            <i className="fas fa-filter" aria-hidden="true" />
                            <select
                                className={styles.filterSelect}
                                value={effectiveFilter}
                                onChange={(e) => setFilter(e.target.value)}
                                aria-label="Filter tasks by assignee"
                            >
                                <option value="all">Everyone</option>
                                {hasUnassigned && <option value="unassigned">Unassigned</option>}
                                {assignees.map((a) => (
                                    <option key={a.id} value={String(a.id)}>{a.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className={styles.list}>
                        {visibleTasks.length === 0 ? (
                            <div className={styles.empty}>
                                <i className="fas fa-check-circle" />
                                <span>{count === 0 ? 'Nothing waiting on you' : 'No tasks for this filter'}</span>
                            </div>
                        ) : (
                            visibleTasks.map((t) => (
                                <div key={t.alert_id} className={styles.item}>
                                    <span className={`${styles.sevBar} ${SEV_CLASS[t.alert_severity] ?? styles.sev2}`} />
                                    <div className={styles.itemBody}>
                                        <div className={styles.itemText}>{t.alert_details}</div>
                                        <div className={styles.itemMeta}>
                                            {t.person_id != null && (
                                                <button type="button" className={styles.patientChip} onClick={() => { if (t.person_id != null) openPatient(t.person_id); }}>
                                                    <i className="fas fa-user" /> {t.patient_name ?? `#${t.person_id}`}
                                                </button>
                                            )}
                                            {t.AlertTypeName && <span className={styles.typeTag}>{t.AlertTypeName}</span>}
                                            {t.assignee_name && (
                                                <span className={styles.assigneeTag} title={`Assigned to ${t.assignee_name}`}>
                                                    <i className="fas fa-user-tag" /> {t.assignee_name}
                                                </span>
                                            )}
                                            {t.surface_mode === 'context' && <span className={styles.escTag} title="Escalated patient alert">escalated</span>}
                                            <span className={styles.age}>{relAge(t.creation_date)}</span>
                                        </div>

                                        {snoozeFor === t.alert_id && (
                                            <div className={styles.snoozeRow}>
                                                <button type="button" onClick={() => handleSnooze(t, dateFromTodayYmd(1))}>Tomorrow</button>
                                                <button type="button" onClick={() => handleSnooze(t, dateFromTodayYmd(7))}>Next week</button>
                                                <input
                                                    type="date"
                                                    aria-label="Snooze until"
                                                    onChange={(e) => e.target.value && handleSnooze(t, e.target.value)}
                                                />
                                            </div>
                                        )}
                                    </div>

                                    <div className={styles.actions}>
                                        <button type="button" title="Mark done" onClick={() => handleDone(t)}><i className="fas fa-check" /></button>
                                        <button type="button" title="Snooze" onClick={() => setSnoozeFor((s) => (s === t.alert_id ? null : t.alert_id))}><i className="fas fa-clock" /></button>
                                        <button type="button" title="Edit" onClick={() => openEdit(t)}><i className="fas fa-pen" /></button>
                                        <button type="button" title="Dismiss" onClick={() => handleDismiss(t)}><i className="fas fa-times" /></button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>,
                document.body
            )}

            <TaskFormModal
                isOpen={formOpen}
                onClose={() => setFormOpen(false)}
                onSaved={loadTasks}
                editTask={editTask}
            />
        </div>
    );
};

export default TasksBell;
