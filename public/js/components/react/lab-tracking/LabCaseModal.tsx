import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useLookupManager } from '@/hooks/useLookupManager';
import { httpErrorMessage } from '@/core/http';
import { formatLocaleDate, formatLocaleDateTime } from '@/utils/formatters';
import { qk } from '@/query/keys';
import { labsQuery } from '@/query/queries';
import { MATERIAL_OPTIONS } from '@/config/workTypeConfig';
import { LAB_STAGE_META, type LabStage, type LabCaseBoardRow } from '@shared/contracts/lab-case.contract';
import { labelForStage, defaultRemakeTarget } from '@/config/labStages';
import {
    useLabCase,
    useCreateLabCase,
    useAdvanceLabCase,
    useRemakeLabCase,
    useHoldLabCase,
    useResumeLabCase,
    useUpdateLabCase,
    useCancelLabCase,
} from '@/hooks/useLabCases';
import styles from './LabCaseModal.module.css';

interface LabCaseModalProps {
    isOpen: boolean;
    onClose: () => void;
    workId: number;
    workItemId: number;
    /** null = no case yet -> create mode; a number -> track mode. */
    labCaseId: number | null;
    prefillLabId?: number | null;
    prefillMaterial?: string | null;
}

type ActionMode = null | 'advance' | 'remake' | 'edit' | 'cancel';

const fmtDateTime = (value: string): string => formatLocaleDateTime(value) || value;
const fmtDate = (value: string): string => formatLocaleDate(value) || value;

/** Index of a stage in the pipeline (-1 for `cancelled`). */
const stageIndex = (stage: string): number => LAB_STAGE_META.findIndex((m) => m.key === stage);
const READY_IDX = stageIndex('ready');

const isLabStage = (stage: string): stage is LabStage =>
    LAB_STAGE_META.some((m) => m.key === stage);

const locationOf = (stage: LabStage): 'lab' | 'clinic' | 'done' =>
    LAB_STAGE_META.find((m) => m.key === stage)?.location ?? 'lab';

/**
 * Shared lab-case modal — reused from the work-item card (Start Lab Flow /
 * stage badge) AND the /lab-tracking board. `labCaseId === null` renders the
 * create form; otherwise renders the timeline + stage-transition actions.
 */
const LabCaseModal = ({ isOpen, onClose, workId, workItemId, labCaseId, prefillLabId = null, prefillMaterial = null }: LabCaseModalProps) => {
    const toast = useToast();
    const confirm = useConfirm();
    const isCreate = labCaseId === null;

    const { data: labs } = useQuery(labsQuery());
    const labOptions = labs ?? [];

    const labLookup = useLookupManager({
        tableKey: 'tblLabs',
        title: 'Manage Labs',
        menuLabel: 'Edit labs',
        invalidateKeys: [qk.lookups.labs()],
    });

    // ---- CREATE MODE ------------------------------------------------------
    const [createDraft, setCreateDraft] = useState({
        labId: prefillLabId != null ? String(prefillLabId) : '',
        material: prefillMaterial ?? '',
        dueDate: '',
        sentOn: '',
        isRush: false,
        note: '',
    });
    const createMut = useCreateLabCase();

    // One write at a time, its failure toasted with the server's message.
    // `disabled={mut.isPending}` lands a render too late: a double click sent two
    // requests, and the second was refused and toasted an error right after the
    // success (FE-F20-7d).
    const busyRef = useRef(false);
    const runWrite = async (failure: string, run: () => Promise<void>): Promise<void> => {
        if (busyRef.current) return;
        busyRef.current = true;
        try {
            await run();
        } catch (err) {
            toast.error(httpErrorMessage(err, failure));
        } finally {
            busyRef.current = false;
        }
    };

    const handleCreate = (e: FormEvent<HTMLFormElement>): void => {
        e.preventDefault();
        void runWrite('Failed to start lab flow', async () => {
            await createMut.mutateAsync({
                workId,
                workItemId,
                labId: createDraft.labId ? Number(createDraft.labId) : undefined,
                material: createDraft.material || undefined,
                dueDate: createDraft.dueDate || undefined,
                sentOn: createDraft.sentOn || undefined,
                isRush: createDraft.isRush || undefined,
                note: createDraft.note || undefined,
            });
            toast.success('Lab flow started');
            onClose();
        });
    };

    // ---- TRACK MODE ---------------------------------------------------------
    const { data, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useLabCase(isCreate ? null : labCaseId);
    const [mode, setMode] = useState<ActionMode>(null);

    const [advanceTo, setAdvanceTo] = useState<LabStage | ''>('');
    const [advanceDueDate, setAdvanceDueDate] = useState('');
    const [advanceOccurredAt, setAdvanceOccurredAt] = useState('');
    const [advanceNote, setAdvanceNote] = useState('');

    const [remakeTo, setRemakeTo] = useState<LabStage | ''>('');
    const [remakeReason, setRemakeReason] = useState('');
    const [remakeOccurredAt, setRemakeOccurredAt] = useState('');

    const [editDraft, setEditDraft] = useState({ labId: '', dueDate: '', isRush: false, note: '' });
    const [cancelNote, setCancelNote] = useState('');

    const advanceMut = useAdvanceLabCase();
    const remakeMut = useRemakeLabCase();
    const holdMut = useHoldLabCase();
    const resumeMut = useResumeLabCase();
    const updateMut = useUpdateLabCase();
    const cancelMut = useCancelLabCase();
    const reactivateMut = useCreateLabCase();

    const caseRow: LabCaseBoardRow | undefined = data?.case;
    const events = data?.events ?? [];
    const currentStatus = caseRow && isLabStage(caseRow.status) ? caseRow.status : null;
    const currentIdx = currentStatus ? stageIndex(currentStatus) : -1;
    const isTerminal = caseRow?.status === 'delivered' || caseRow?.status === 'cancelled';

    const laterStages = useMemo(
        () => (currentIdx === -1 ? [] : LAB_STAGE_META.slice(currentIdx + 1)),
        [currentIdx]
    );
    // A remake sends the case BACK: only earlier stages are offered (the server
    // refuses the current one and later ones — FE-F20-7a). A delivered case can be
    // sent back too; the service has always accepted it (FE-F20-6).
    const earlierStages = useMemo(
        () => (currentIdx <= 0 ? [] : LAB_STAGE_META.slice(0, currentIdx)),
        [currentIdx]
    );

    const openAdvance = (): void => {
        const next = laterStages[0]?.key ?? '';
        setAdvanceTo(next);
        setAdvanceDueDate('');
        setAdvanceOccurredAt('');
        setAdvanceNote('');
        setMode('advance');
    };

    const openRemake = (): void => {
        const suggested = currentStatus ? defaultRemakeTarget(currentStatus) : null;
        setRemakeTo(suggested ?? '');
        setRemakeReason('');
        setRemakeOccurredAt('');
        setMode('remake');
    };

    const openEdit = (): void => {
        if (!caseRow) return;
        setEditDraft({
            labId: caseRow.lab_id != null ? String(caseRow.lab_id) : '',
            dueDate: caseRow.due_date ?? '',
            isRush: caseRow.is_rush,
            note: caseRow.note ?? '',
        });
        setMode('edit');
    };

    const openCancel = (): void => {
        setCancelNote('');
        setMode('cancel');
    };

    const closeAction = (): void => setMode(null);

    const submitAdvance = (e: FormEvent<HTMLFormElement>): void => {
        e.preventDefault();
        if (!caseRow || !currentStatus || !advanceTo) return;
        void runWrite('Failed to advance case', async () => {
            // The new due date rides on the advance, in its transaction: as a second
            // PATCH, its failure was reported as a failed advance (FE-F20-7c).
            await advanceMut.mutateAsync({
                id: caseRow.id,
                workId,
                fromStatus: currentStatus,
                toStatus: advanceTo,
                occurredAt: advanceOccurredAt || undefined,
                note: advanceNote || undefined,
                dueDate: advanceDueDate && locationOf(advanceTo) === 'lab' ? advanceDueDate : undefined,
            });
            toast.success('Case advanced');
            closeAction();
        });
    };

    const submitDeliver = (): void => {
        if (!caseRow || !currentStatus) return;
        void runWrite('Failed to mark delivered', async () => {
            // Deliver sits beside Advance on every open case and skips every stage
            // between, and a delivered case leaves the board — so before Ready to
            // Cement, ask (FE-F20-6).
            if (currentIdx < READY_IDX && !(await confirm(
                `This case is at ${labelForStage(currentStatus, caseRow.material)}, before ${labelForStage('ready')}. Mark it delivered now?`,
                { title: 'Deliver Lab Case', confirmText: 'Deliver' }
            ))) return;
            await advanceMut.mutateAsync({ id: caseRow.id, workId, fromStatus: currentStatus, toStatus: 'delivered' });
            toast.success('Case delivered');
        });
    };

    const submitRemake = (e: FormEvent<HTMLFormElement>): void => {
        e.preventDefault();
        if (!caseRow || !remakeTo || !remakeReason.trim()) return;
        void runWrite('Failed to send case back', async () => {
            await remakeMut.mutateAsync({
                id: caseRow.id,
                workId,
                returnToStatus: remakeTo,
                reason: remakeReason.trim(),
                occurredAt: remakeOccurredAt || undefined,
            });
            toast.success('Case sent back for remake');
            closeAction();
        });
    };

    const toggleHold = (): void => {
        if (!caseRow) return;
        void runWrite('Failed to update hold status', async () => {
            if (caseRow.is_on_hold) {
                await resumeMut.mutateAsync({ id: caseRow.id, workId });
                toast.success('Case resumed');
            } else {
                await holdMut.mutateAsync({ id: caseRow.id, workId });
                toast.success('Case put on hold');
            }
        });
    };

    const submitEdit = (e: FormEvent<HTMLFormElement>): void => {
        e.preventDefault();
        if (!caseRow) return;
        void runWrite('Failed to update case', async () => {
            await updateMut.mutateAsync({
                id: caseRow.id,
                workId,
                labId: editDraft.labId ? Number(editDraft.labId) : '',
                dueDate: editDraft.dueDate || '',
                isRush: editDraft.isRush,
                // Sent as typed: `''` clears the note. `undefined` means "unchanged",
                // so an emptied note was never cleared (FE-F20-7b).
                note: editDraft.note.trim(),
            });
            toast.success('Case updated');
            closeAction();
        });
    };

    const submitCancel = (e: FormEvent<HTMLFormElement>): void => {
        e.preventDefault();
        if (!caseRow) return;
        void runWrite('Failed to cancel case', async () => {
            if (!(await confirm('Cancel this lab case? It can be restarted later.', { title: 'Cancel Lab Case', danger: true, confirmText: 'Cancel Case' }))) return;
            await cancelMut.mutateAsync({ id: caseRow.id, workId, note: cancelNote || undefined });
            toast.success('Case cancelled');
            closeAction();
        });
    };

    const submitRestart = (): void => {
        void runWrite('Failed to restart lab flow', async () => {
            await reactivateMut.mutateAsync({ workId, workItemId });
            toast.success('Lab flow restarted');
        });
    };

    const titleId = 'lab-case-modal-title';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            contentClassName={styles.dialog}
            ariaLabelledBy={titleId}
            // Track mode SAVES AND STAYS OPEN (advance / hold / note edit), so the
            // guard has to forget what the user typed once it has been written.
            // `dataUpdatedAt` moves only when this case is refetched, and the only
            // thing that refetches it is one of those writes invalidating the key
            // (`refetchOnWindowFocus` is off repo-wide — query/client.ts). Create
            // mode disables the query, so it stays 0 and never resets; that branch
            // closes on success anyway.
            unsavedGuard={{ watchInput: true, resetKey: dataUpdatedAt }}
        >
            {(dismiss) => (<>
            <ModalHeader
                title={isCreate ? 'Start Lab Flow' : `Lab Case — ${caseRow ? labelForStage(caseRow.status as LabStage, caseRow.material) : '…'}`}
                titleId={titleId}
                icon={<i className="fas fa-flask" />}
                subtitle={caseRow ? `${caseRow.patient_name} · ${caseRow.restoration}${caseRow.teeth ? ` · ${caseRow.teeth}` : ''}` : undefined}
                onClose={dismiss}
            />

            {isCreate ? (
                <form className={styles.body} onSubmit={handleCreate}>
                    <div className={styles.formRow}>
                        <div className={styles.field}>
                            <label htmlFor="lc-lab" className={styles.label}>Lab</label>
                            <select
                                id="lc-lab"
                                className={styles.input}
                                value={createDraft.labId}
                                onChange={(e) => setCreateDraft({ ...createDraft, labId: e.target.value })}
                                onContextMenu={labLookup.onContextMenu}
                                title="Right-click to edit the lab list"
                            >
                                <option value="">Select Lab</option>
                                {labOptions.map((lab) => <option key={lab.id} value={lab.id}>{lab.name}</option>)}
                            </select>
                            {labLookup.overlay}
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="lc-material" className={styles.label}>Material</label>
                            <select
                                id="lc-material"
                                className={styles.input}
                                value={createDraft.material}
                                onChange={(e) => setCreateDraft({ ...createDraft, material: e.target.value })}
                            >
                                <option value="">Select Material</option>
                                {MATERIAL_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className={styles.formRow}>
                        <div className={styles.field}>
                            <label htmlFor="lc-sent-on" className={styles.label}>Sent On</label>
                            <input
                                id="lc-sent-on"
                                type="date"
                                className={styles.input}
                                value={createDraft.sentOn}
                                onChange={(e) => setCreateDraft({ ...createDraft, sentOn: e.target.value })}
                            />
                        </div>
                        <div className={styles.field}>
                            <label htmlFor="lc-due-date" className={styles.label}>Due Date</label>
                            <input
                                id="lc-due-date"
                                type="date"
                                className={styles.input}
                                value={createDraft.dueDate}
                                onChange={(e) => setCreateDraft({ ...createDraft, dueDate: e.target.value })}
                            />
                        </div>
                    </div>
                    <label className={styles.checkboxRow}>
                        <input
                            type="checkbox"
                            checked={createDraft.isRush}
                            onChange={(e) => setCreateDraft({ ...createDraft, isRush: e.target.checked })}
                        />
                        <span>Rush case</span>
                    </label>
                    <div className={styles.field}>
                        <label htmlFor="lc-note" className={styles.label}>Notes</label>
                        <textarea
                            id="lc-note"
                            className={styles.input}
                            rows={2}
                            value={createDraft.note}
                            onChange={(e) => setCreateDraft({ ...createDraft, note: e.target.value })}
                        />
                    </div>
                    <div className={styles.footer}>
                        <button type="button" className="btn btn-secondary" onClick={dismiss}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={createMut.isPending}>
                            {createMut.isPending ? 'Starting…' : 'Start Lab Flow'}
                        </button>
                    </div>
                </form>
            ) : isLoading ? (
                <div className={styles.body}><p className={styles.empty}>Loading…</p></div>
            ) : isError || !caseRow ? (
                <div className={styles.body}>
                    <p className={styles.empty}>
                        Failed to load this case.{' '}
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => void refetch()} disabled={isFetching}>
                            {isFetching ? 'Retrying…' : 'Retry'}
                        </button>
                    </p>
                </div>
            ) : (
                <>
                    <div className={styles.body}>
                        <div className={styles.badgeRow}>
                            <span className={styles.stageBadge} data-location={currentStatus ? locationOf(currentStatus) : 'lab'}>
                                {labelForStage(caseRow.status as LabStage, caseRow.material)}
                            </span>
                            {caseRow.is_on_hold && <span className={styles.holdBadge}>On Hold</span>}
                            {caseRow.is_rush && <span className={styles.rushBadge}>Rush</span>}
                            {caseRow.remake_count > 0 && <span className={styles.remakeBadge}>Remade ×{caseRow.remake_count}</span>}
                        </div>

                        <div className={styles.metaGrid}>
                            <div><span className={styles.metaLabel}>Lab</span><span>{caseRow.lab_name ?? '—'}</span></div>
                            <div><span className={styles.metaLabel}>Material</span><span>{caseRow.material ?? '—'}</span></div>
                            <div><span className={styles.metaLabel}>Due</span><span>{caseRow.due_date ? fmtDate(caseRow.due_date) : '—'}</span></div>
                            <div><span className={styles.metaLabel}>Sent</span><span>{fmtDateTime(caseRow.sent_at)}</span></div>
                        </div>

                        {caseRow.status === 'cancelled' ? (
                            <div className={styles.footer}>
                                <button type="button" className="btn btn-primary" onClick={submitRestart} disabled={reactivateMut.isPending}>
                                    {reactivateMut.isPending ? 'Restarting…' : 'Restart Lab Flow'}
                                </button>
                            </div>
                        ) : mode === null ? (
                            <div className={styles.actionsRow}>
                                {laterStages.length > 0 && (
                                    <button type="button" className="btn btn-sm btn-primary" onClick={openAdvance}>
                                        <i className="fas fa-arrow-right" /> Advance
                                    </button>
                                )}
                                {earlierStages.length > 0 && (
                                    <button type="button" className="btn btn-sm btn-secondary" onClick={openRemake}>
                                        <i className="fas fa-rotate-left" /> Send back (remake)
                                    </button>
                                )}
                                {!isTerminal && (
                                    <button type="button" className="btn btn-sm btn-success" onClick={submitDeliver} disabled={advanceMut.isPending}>
                                        <i className="fas fa-check" /> Deliver
                                    </button>
                                )}
                                {!isTerminal && (
                                    <button type="button" className="btn btn-sm btn-secondary" onClick={toggleHold} disabled={holdMut.isPending || resumeMut.isPending}>
                                        <i className={caseRow.is_on_hold ? 'fas fa-play' : 'fas fa-pause'} /> {caseRow.is_on_hold ? 'Resume' : 'Hold'}
                                    </button>
                                )}
                                <button type="button" className="btn btn-sm btn-secondary" onClick={openEdit}>
                                    <i className="fas fa-pen" /> Edit
                                </button>
                                {!isTerminal && (
                                    <button type="button" className="btn btn-sm btn-danger" onClick={openCancel}>
                                        <i className="fas fa-ban" /> Cancel Case
                                    </button>
                                )}
                            </div>
                        ) : mode === 'advance' ? (
                            <form className={styles.actionForm} onSubmit={submitAdvance}>
                                <div className={styles.field}>
                                    <label htmlFor="adv-to" className={styles.label}>Advance to</label>
                                    <select id="adv-to" className={styles.input} value={advanceTo} onChange={(e) => setAdvanceTo(e.target.value as LabStage)}>
                                        {laterStages.map((m) => <option key={m.key} value={m.key}>{labelForStage(m.key, caseRow.material)}</option>)}
                                    </select>
                                </div>
                                {advanceTo && locationOf(advanceTo) === 'lab' && (
                                    <div className={styles.field}>
                                        <label htmlFor="adv-due" className={styles.label}>New due date (this lab trip)</label>
                                        <input id="adv-due" type="date" className={styles.input} value={advanceDueDate} onChange={(e) => setAdvanceDueDate(e.target.value)} />
                                    </div>
                                )}
                                <div className={styles.field}>
                                    <label htmlFor="adv-date" className={styles.label}>Occurred on</label>
                                    <input id="adv-date" type="date" className={styles.input} value={advanceOccurredAt} onChange={(e) => setAdvanceOccurredAt(e.target.value)} />
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor="adv-note" className={styles.label}>Note</label>
                                    <textarea id="adv-note" className={styles.input} rows={2} value={advanceNote} onChange={(e) => setAdvanceNote(e.target.value)} />
                                </div>
                                <div className={styles.footer}>
                                    <button type="button" className="btn btn-secondary" onClick={closeAction}>Cancel</button>
                                    <button type="submit" className="btn btn-primary" disabled={!advanceTo || advanceMut.isPending}>
                                        {advanceMut.isPending ? 'Advancing…' : 'Advance'}
                                    </button>
                                </div>
                            </form>
                        ) : mode === 'remake' ? (
                            <form className={styles.actionForm} onSubmit={submitRemake}>
                                <div className={styles.field}>
                                    <label htmlFor="rmk-to" className={styles.label}>Send back to</label>
                                    <select id="rmk-to" className={styles.input} value={remakeTo} onChange={(e) => setRemakeTo(e.target.value as LabStage)}>
                                        <option value="">Select stage</option>
                                        {earlierStages.map((m) => (
                                            <option key={m.key} value={m.key}>{labelForStage(m.key, caseRow.material)}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor="rmk-reason" className={styles.label}>Reason</label>
                                    <textarea id="rmk-reason" className={styles.input} rows={2} value={remakeReason} onChange={(e) => setRemakeReason(e.target.value)} required />
                                </div>
                                <div className={styles.field}>
                                    <label htmlFor="rmk-date" className={styles.label}>Occurred on</label>
                                    <input id="rmk-date" type="date" className={styles.input} value={remakeOccurredAt} onChange={(e) => setRemakeOccurredAt(e.target.value)} />
                                </div>
                                <div className={styles.footer}>
                                    <button type="button" className="btn btn-secondary" onClick={closeAction}>Cancel</button>
                                    <button type="submit" className="btn btn-primary" disabled={!remakeTo || !remakeReason.trim() || remakeMut.isPending}>
                                        {remakeMut.isPending ? 'Sending back…' : 'Send Back'}
                                    </button>
                                </div>
                            </form>
                        ) : mode === 'edit' ? (
                            <form className={styles.actionForm} onSubmit={submitEdit}>
                                <div className={styles.formRow}>
                                    <div className={styles.field}>
                                        <label htmlFor="edit-lab" className={styles.label}>Lab</label>
                                        <select id="edit-lab" className={styles.input} value={editDraft.labId} onChange={(e) => setEditDraft({ ...editDraft, labId: e.target.value })}>
                                            <option value="">Select Lab</option>
                                            {labOptions.map((lab) => <option key={lab.id} value={lab.id}>{lab.name}</option>)}
                                        </select>
                                    </div>
                                    <div className={styles.field}>
                                        <label htmlFor="edit-due" className={styles.label}>Due Date</label>
                                        <input id="edit-due" type="date" className={styles.input} value={editDraft.dueDate} onChange={(e) => setEditDraft({ ...editDraft, dueDate: e.target.value })} />
                                    </div>
                                </div>
                                <label className={styles.checkboxRow}>
                                    <input type="checkbox" checked={editDraft.isRush} onChange={(e) => setEditDraft({ ...editDraft, isRush: e.target.checked })} />
                                    <span>Rush case</span>
                                </label>
                                <div className={styles.field}>
                                    <label htmlFor="edit-note" className={styles.label}>Notes</label>
                                    <textarea id="edit-note" className={styles.input} rows={2} value={editDraft.note} onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })} />
                                </div>
                                <div className={styles.footer}>
                                    <button type="button" className="btn btn-secondary" onClick={closeAction}>Cancel</button>
                                    <button type="submit" className="btn btn-primary" disabled={updateMut.isPending}>
                                        {updateMut.isPending ? 'Saving…' : 'Save'}
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <form className={styles.actionForm} onSubmit={submitCancel}>
                                <div className={styles.field}>
                                    <label htmlFor="cancel-note" className={styles.label}>Reason (optional)</label>
                                    <textarea id="cancel-note" className={styles.input} rows={2} value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} />
                                </div>
                                <div className={styles.footer}>
                                    <button type="button" className="btn btn-secondary" onClick={closeAction}>Back</button>
                                    <button type="submit" className="btn btn-danger" disabled={cancelMut.isPending}>
                                        {cancelMut.isPending ? 'Cancelling…' : 'Cancel Case'}
                                    </button>
                                </div>
                            </form>
                        )}

                        {events.length > 0 && (
                            <div className={styles.timeline}>
                                <div className={styles.groupLabel}>Timeline</div>
                                <ul className={styles.list}>
                                    {[...events].reverse().map((ev) => (
                                        <li key={ev.id} className={styles.timelineRow}>
                                            <span className={styles.timelineType}>{ev.event_type}</span>
                                            {ev.to_status && (
                                                <span className={styles.timelineStage}>
                                                    {ev.from_status ? `${labelForStage(ev.from_status as LabStage, caseRow.material)} → ` : ''}
                                                    {labelForStage(ev.to_status as LabStage, caseRow.material)}
                                                </span>
                                            )}
                                            {ev.note && <span className={styles.timelineNote}>{ev.note}</span>}
                                            <span className={styles.timelineMeta}>{fmtDateTime(ev.occurred_at)} · {ev.created_by ?? 'unknown'}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </>
            )}
            </>)}
        </Modal>
    );
};

export default LabCaseModal;
