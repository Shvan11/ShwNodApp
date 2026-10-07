import { useRef, useState } from 'react';
import cn from 'classnames';
import { LAB_STAGE_META, type LabCaseBoardRow, type LabStage } from '@shared/contracts/lab-case.contract';
import { labelForStage } from '@/config/labStages';
import { useAdvanceLabCase } from '@/hooks/useLabCases';
import { useToast } from '@/contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import { useToday, useNowMinute } from '@/hooks/useClock';
import { formatLocaleDate } from '@/utils/formatters';
import styles from './LabCaseCard.module.css';

interface LabCaseCardProps {
    labCase: LabCaseBoardRow;
    onOpen: (labCase: LabCaseBoardRow) => void;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The clock comes in as an argument (the component reads it through useClock):
// a `new Date()` in a helper called from render is cached by the React Compiler
// with the block around it, and goes stale on a screen left open (FE-F26-8).
function daysSince(dateStr: string, now: number): number {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return 0;
    return Math.max(0, Math.floor((now - d.getTime()) / MS_PER_DAY));
}

function isOverdue(dueDate: string | null, status: string, today: string): boolean {
    if (!dueDate || status === 'delivered' || status === 'cancelled') return false;
    // `today` is the LOCAL date: the UTC one is still yesterday between 00:00 and
    // 03:00 Baghdad time, so a case due yesterday read as not overdue.
    return dueDate < today;
}

/**
 * One board card. Clicking the card body opens the full LabCaseModal (track
 * mode); the "Advance →" button opens a small inline picker (preselected to
 * the immediate next stage) so the common one-click case never needs the full
 * modal — the picker still lets staff jump past a skipped checkpoint.
 */
const LabCaseCard = ({ labCase, onOpen }: LabCaseCardProps) => {
    const toast = useToast();
    const advanceMut = useAdvanceLabCase();
    // A double click on Confirm sent two advances; the second was refused and
    // toasted an error after the success (FE-F20-7d).
    const submittingRef = useRef(false);
    // A board left open for days: "overdue" turns at midnight and "Nd in stage"
    // counts up without a data change.
    const today = useToday();
    const nowMinute = useNowMinute();

    const currentIdx = LAB_STAGE_META.findIndex((m) => m.key === labCase.status);
    const nextStage = currentIdx >= 0 ? LAB_STAGE_META[currentIdx + 1] : undefined;
    const overdue = isOverdue(labCase.due_date, labCase.status, today);

    const [quickOpen, setQuickOpen] = useState(false);
    const [target, setTarget] = useState<LabStage | ''>('');
    const [dueDate, setDueDate] = useState('');
    const [note, setNote] = useState('');

    const openQuick = (): void => {
        setTarget((nextStage?.key as LabStage) ?? '');
        setDueDate('');
        setNote('');
        setQuickOpen(true);
    };

    const targetLocation = target ? LAB_STAGE_META.find((m) => m.key === target)?.location : undefined;

    const submitQuick = async (): Promise<void> => {
        if (!target || !isLabStageStatus(labCase.status) || submittingRef.current) return;
        submittingRef.current = true;
        try {
            // The due date rides on the advance (one transaction — FE-F20-7c).
            await advanceMut.mutateAsync({
                id: labCase.id,
                workId: labCase.work_id,
                fromStatus: labCase.status,
                toStatus: target,
                note: note || undefined,
                dueDate: dueDate && targetLocation === 'lab' ? dueDate : undefined,
            });
            toast.success('Case advanced');
            setQuickOpen(false);
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to advance case'));
        } finally {
            submittingRef.current = false;
        }
    };

    return (
        <div className={cn(styles.card, overdue && styles.overdue)}>
            {/* The card body opens the case. It is a keyboard stop of its own (it had
                no tab stop, so the board could not open a case without a mouse —
                FE-F20-8c); the Advance button is its sibling, not a child. */}
            <div
                className={styles.cardBody}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(labCase)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(labCase);
                    }
                }}
            >
                <div className={styles.cardTop}>
                    <span className={styles.patientName}>{labCase.patient_name}</span>
                    {labCase.is_rush && <span className={styles.rushBadge}>Rush</span>}
                    {labCase.is_on_hold && <span className={styles.holdBadge}>Hold</span>}
                </div>
                <div className={styles.restoration}>
                    {labCase.restoration}{labCase.teeth ? ` · ${labCase.teeth}` : ''}
                </div>
                <div className={styles.metaLine}>
                    {labCase.lab_name && <span>{labCase.lab_name}</span>}
                    {labCase.material && <span>{labCase.material}</span>}
                    {labCase.shade && <span>{labCase.shade}</span>}
                </div>
                <div className={styles.footerLine}>
                    <span className={styles.aging}>{daysSince(labCase.status_changed_at, nowMinute)}d in stage</span>
                    {labCase.due_date && (
                        <span className={cn(styles.due, overdue && styles.dueOverdue)}>
                            {overdue ? 'Overdue: ' : 'Due '}{formatLocaleDate(labCase.due_date) || labCase.due_date}
                        </span>
                    )}
                </div>
            </div>

            {nextStage && !quickOpen && (
                <button
                    type="button"
                    className={cn('btn btn-xs btn-primary', styles.advanceBtn)}
                    onClick={(e) => { e.stopPropagation(); openQuick(); }}
                >
                    Advance → {labelForStage(nextStage.key)}
                </button>
            )}

            {quickOpen && (
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- stop the card's onOpen click-through while the quick picker is interacted with
                <div className={styles.quickPanel} onClick={(e) => e.stopPropagation()}>
                    <select className={styles.quickSelect} value={target} onChange={(e) => setTarget(e.target.value as LabStage)}>
                        {LAB_STAGE_META.slice(currentIdx + 1).map((m) => (
                            <option key={m.key} value={m.key}>{labelForStage(m.key, labCase.material)}</option>
                        ))}
                    </select>
                    {targetLocation === 'lab' && (
                        <input
                            type="date"
                            className={styles.quickSelect}
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            placeholder="New due date"
                            title="New due date for this lab trip"
                        />
                    )}
                    <input
                        type="text"
                        className={styles.quickSelect}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Note (optional)"
                    />
                    <div className={styles.quickActions}>
                        <button type="button" className="btn btn-xs btn-secondary" onClick={() => setQuickOpen(false)}>Cancel</button>
                        <button type="button" className="btn btn-xs btn-primary" onClick={() => void submitQuick()} disabled={!target || advanceMut.isPending}>
                            {advanceMut.isPending ? 'Advancing…' : 'Confirm'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

function isLabStageStatus(status: string): status is LabStage {
    return LAB_STAGE_META.some((m) => m.key === status);
}

export default LabCaseCard;
