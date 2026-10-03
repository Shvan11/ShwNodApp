import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import { tasksQuery, HEADER_BELL_POLL } from '@/query/queries';
import {
    setTaskStatus,
    snoozeTask,
    invalidateTasks,
    dateFromTodayYmd,
    type TaskRow,
} from '@/services/tasks';
import HeaderPopover, { RelativeAge } from './HeaderPopover';
import TaskFormModal from './TaskFormModal';
import styles from './TasksBell.module.css';

const SEV_CLASS: Record<number, string> = { 1: styles.sev1, 2: styles.sev2, 3: styles.sev3 };

/** Assignee-filter sentinels (any other value is a `String(assigned_to)`). */
const FILTER_ALL = 'all';
const FILTER_UNASSIGNED = 'unassigned';

/**
 * The custom-snooze date. It commits on *Set* or Enter, never on change: a date
 * input fires `change` for every complete-looking value while the year is typed,
 * so committing on change sent `0002-10-15` after the first year digit — a past
 * date, and the task never left the bell (audit FE-F5-4).
 */
const SnoozeDate = ({ onSnooze }: { onSnooze: (ymd: string) => void }) => {
    const { t } = useTranslation('tasks');
    const toast = useToast();
    const [value, setValue] = useState('');
    const min = dateFromTodayYmd(1);
    const commit = () => {
        if (!value || value < min) {
            toast.error(t('bell.snoozeDateInvalid'));
            return;
        }
        onSnooze(value);
    };
    return (
        <>
            <input
                type="date"
                aria-label={t('bell.snoozeUntil')}
                min={min}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        commit();
                    }
                }}
            />
            <button type="button" onClick={commit} disabled={!value}>{t('bell.snoozeApply')}</button>
        </>
    );
};

/**
 * TasksBell — the app-wide task surface in the universal header. A quiet bell
 * (badge only when there are tasks; red pulse if any are severe) opens a popover
 * listing active push tasks + escalated context alerts, each with done / snooze /
 * edit / dismiss actions. Freshness: `HEADER_BELL_POLL` + `invalidateTasks()`,
 * which every task/alert write calls.
 */
const TasksBell = () => {
    const { t } = useTranslation('tasks');
    const navigate = useNavigate();
    const toast = useToast();

    const [open, setOpen] = useState(false);
    const [formOpen, setFormOpen] = useState(false);
    const [editTask, setEditTask] = useState<TaskRow | null>(null);
    const [snoozeFor, setSnoozeFor] = useState<number | null>(null);
    // Assignee filter (feature #4): FILTER_ALL | FILTER_UNASSIGNED | a String(assigned_to).
    const [filter, setFilter] = useState<string>(FILTER_ALL);

    const { data: tasks = [] } = useQuery({ ...tasksQuery(), ...HEADER_BELL_POLL });

    const setOpenAndReset = (next: boolean) => {
        setOpen(next);
        if (!next) setSnoozeFor(null);
    };

    const count = tasks.length;
    const hasSevere = tasks.some((task) => task.alert_severity >= 3);

    // Distinct assignees present in the current list, for the filter dropdown.
    const assignees = Array.from(
        new Map(
            tasks
                .filter((task) => task.assigned_to != null)
                .map((task) => [task.assigned_to as number, task.assignee_name ?? `#${task.assigned_to}`])
        ).entries()
    ).map(([id, name]) => ({ id, name }));
    const hasUnassigned = tasks.some((task) => task.assigned_to == null);
    // Guard a stale selection (the picked assignee may have no tasks left).
    const effectiveFilter =
        filter === FILTER_ALL ||
        (filter === FILTER_UNASSIGNED && hasUnassigned) ||
        assignees.some((a) => String(a.id) === filter)
            ? filter
            : FILTER_ALL;
    const visibleTasks =
        effectiveFilter === FILTER_ALL
            ? tasks
            : effectiveFilter === FILTER_UNASSIGNED
                ? tasks.filter((task) => task.assigned_to == null)
                : tasks.filter((task) => String(task.assigned_to) === effectiveFilter);
    const showFilter = assignees.length > 0;

    const runAction = async (task: TaskRow, fn: () => Promise<unknown>, failMsg: string) => {
        try {
            await fn();
            await invalidateTasks(task.person_id);
        } catch (error) {
            toast.error(httpErrorMessage(error, failMsg));
        }
    };

    const handleDone = (task: TaskRow) =>
        runAction(task, () => setTaskStatus(task.alert_id, 'done'), t('bell.completeFailed'));
    const handleDismiss = (task: TaskRow) =>
        runAction(task, () => setTaskStatus(task.alert_id, 'dismissed'), t('bell.dismissFailed'));
    const handleSnooze = (task: TaskRow, ymd: string) => {
        setSnoozeFor(null);
        return runAction(task, () => snoozeTask(task.alert_id, ymd), t('bell.snoozeFailed'));
    };

    const openPatient = (personId: number) => {
        setOpenAndReset(false);
        navigate(`/patient/${personId}/works`);
    };

    const openEdit = (task: TaskRow) => { setEditTask(task); setFormOpen(true); setOpenAndReset(false); };
    const openNew = () => { setEditTask(null); setFormOpen(true); setOpenAndReset(false); };
    const openHistory = () => { setOpenAndReset(false); navigate('/tasks/history'); };

    return (
        <>
            <HeaderPopover
                open={open}
                onOpenChange={setOpenAndReset}
                bellLabel={count ? t('bell.titleCount', { n: count }) : t('bell.title')}
                title={t('bell.title')}
                icon="fa-bell"
                width={360}
                badge={count > 0 && (
                    <span className={`${styles.badge} ${hasSevere ? styles.badgeSevere : ''}`}>{count}</span>
                )}
            >
                <div className={styles.popHeader}>
                    <span>{t('bell.title')} {count > 0 && <span className={styles.popCount}>{count}</span>}</span>
                    <div className={styles.popHeaderActions}>
                        <button
                            type="button"
                            className={styles.headerIconBtn}
                            onClick={openHistory}
                            title={t('bell.allTasks')}
                            aria-label={t('bell.allTasks')}
                        >
                            <i className="fas fa-list-check" aria-hidden="true" />
                        </button>
                        <button type="button" className={styles.newBtn} onClick={openNew}>
                            <i className="fas fa-plus" aria-hidden="true" /> {t('bell.new')}
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
                            aria-label={t('bell.filterLabel')}
                        >
                            <option value={FILTER_ALL}>{t('bell.everyone')}</option>
                            {hasUnassigned && <option value={FILTER_UNASSIGNED}>{t('bell.unassigned')}</option>}
                            {assignees.map((a) => (
                                <option key={a.id} value={String(a.id)}>{a.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                <div className={styles.list}>
                    {visibleTasks.length === 0 ? (
                        <div className={styles.empty}>
                            <i className="fas fa-check-circle" aria-hidden="true" />
                            <span>{count === 0 ? t('bell.emptyAll') : t('bell.emptyFilter')}</span>
                        </div>
                    ) : (
                        visibleTasks.map((task) => (
                            <div key={task.alert_id} className={styles.item}>
                                <span className={`${styles.sevBar} ${SEV_CLASS[task.alert_severity] ?? styles.sev2}`} />
                                <div className={styles.itemBody}>
                                    <div className={styles.itemText}>{task.alert_details}</div>
                                    <div className={styles.itemMeta}>
                                        {task.person_id != null && (
                                            <button
                                                type="button"
                                                className={styles.patientChip}
                                                onClick={() => { if (task.person_id != null) openPatient(task.person_id); }}
                                                title={t('bell.openPatient', { name: task.patient_name ?? `#${task.person_id}` })}
                                            >
                                                <i className="fas fa-user" aria-hidden="true" /> {task.patient_name ?? `#${task.person_id}`}
                                            </button>
                                        )}
                                        {task.AlertTypeName && <span className={styles.typeTag}>{task.AlertTypeName}</span>}
                                        {task.assignee_name && (
                                            <span className={styles.assigneeTag} title={t('bell.assignedTo', { name: task.assignee_name })}>
                                                <i className="fas fa-user-tag" aria-hidden="true" /> {task.assignee_name}
                                            </span>
                                        )}
                                        {task.surface_mode === 'context' && (
                                            <span className={styles.escTag} title={t('bell.escalatedTitle')}>{t('bell.escalated')}</span>
                                        )}
                                        <RelativeAge iso={task.creation_date} className={styles.age} />
                                    </div>

                                    {snoozeFor === task.alert_id && (
                                        <div className={styles.snoozeRow}>
                                            <button type="button" onClick={() => handleSnooze(task, dateFromTodayYmd(1))}>{t('bell.snoozeTomorrow')}</button>
                                            <button type="button" onClick={() => handleSnooze(task, dateFromTodayYmd(7))}>{t('bell.snoozeNextWeek')}</button>
                                            <SnoozeDate onSnooze={(ymd) => handleSnooze(task, ymd)} />
                                        </div>
                                    )}
                                </div>

                                <div className={styles.actions}>
                                    <button type="button" title={t('bell.markDone')} aria-label={t('bell.markDone')} onClick={() => handleDone(task)}>
                                        <i className="fas fa-check" aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        title={t('bell.snooze')}
                                        aria-label={t('bell.snooze')}
                                        aria-expanded={snoozeFor === task.alert_id}
                                        onClick={() => setSnoozeFor((s) => (s === task.alert_id ? null : task.alert_id))}
                                    >
                                        <i className="fas fa-clock" aria-hidden="true" />
                                    </button>
                                    <button type="button" title={t('bell.edit')} aria-label={t('bell.edit')} onClick={() => openEdit(task)}>
                                        <i className="fas fa-pen" aria-hidden="true" />
                                    </button>
                                    <button type="button" title={t('bell.dismiss')} aria-label={t('bell.dismiss')} onClick={() => handleDismiss(task)}>
                                        <i className="fas fa-times" aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </HeaderPopover>

            <TaskFormModal
                isOpen={formOpen}
                onClose={() => setFormOpen(false)}
                editTask={editTask}
            />
        </>
    );
};

export default TasksBell;
