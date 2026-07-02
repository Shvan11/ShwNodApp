import { useState } from 'react';
import cn from 'classnames';
import { LAB_STAGE_META, type LabCaseBoardRow, type LabStage } from '@shared/contracts/lab-case.contract';
import { labelForStage } from '@/config/labStages';
import { useAdvanceLabCase, useUpdateLabCase } from '@/hooks/useLabCases';
import { useToast } from '@/contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import styles from './LabCaseCard.module.css';

interface LabCaseCardProps {
    labCase: LabCaseBoardRow;
    onOpen: (labCase: LabCaseBoardRow) => void;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(dateStr: string): number {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / MS_PER_DAY));
}

function isOverdue(dueDate: string | null, status: string): boolean {
    if (!dueDate || status === 'delivered' || status === 'cancelled') return false;
    return dueDate < new Date().toISOString().slice(0, 10);
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
    const updateMut = useUpdateLabCase();

    const currentIdx = LAB_STAGE_META.findIndex((m) => m.key === labCase.status);
    const nextStage = currentIdx >= 0 ? LAB_STAGE_META[currentIdx + 1] : undefined;
    const overdue = isOverdue(labCase.due_date, labCase.status);

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
        if (!target || !isLabStageStatus(labCase.status)) return;
        try {
            await advanceMut.mutateAsync({
                id: labCase.id,
                workId: labCase.work_id,
                fromStatus: labCase.status,
                toStatus: target,
                note: note || undefined,
            });
            if (dueDate) {
                await updateMut.mutateAsync({ id: labCase.id, workId: labCase.work_id, dueDate });
            }
            toast.success('Case advanced');
            setQuickOpen(false);
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to advance case'));
        }
    };

    return (
        <div className={cn(styles.card, overdue && styles.overdue)}>
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- card click-through to the full modal; the Advance button below stops propagation */}
            <div className={styles.cardBody} onClick={() => onOpen(labCase)}>
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
                    <span className={styles.aging}>{daysSince(labCase.status_changed_at)}d in stage</span>
                    {labCase.due_date && (
                        <span className={cn(styles.due, overdue && styles.dueOverdue)}>
                            {overdue ? 'Overdue: ' : 'Due '}{labCase.due_date}
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
