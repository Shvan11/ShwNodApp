import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import cn from 'classnames';
import TeethSelector, { type ToothOption } from './TeethSelector';
import { type WorkDetail } from './WorkDetailsPanel';
import {
    getWorkTypeConfig,
    MATERIAL_OPTIONS,
    FILLING_TYPE_OPTIONS,
    FILLING_DEPTH_OPTIONS,
    isProstheticWork,
} from '../../config/workTypeConfig';
import { formatNumber, formatLocaleDate } from '../../utils/formatters';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { useLookupManager } from '../../hooks/useLookupManager';
import LabCaseModal from './lab-tracking/LabCaseModal';
import { labelForStage } from '../../config/labStages';
import type { ImplantManufacturersResponse, LabsResponse, ShadesResponse } from '@shared/contracts/lookup.contract';
import styles from './WorkDetailItem.module.css';

type ImplantManufacturer = ImplantManufacturersResponse[number];
/** A lab option for the Bridge/Veneers lab dropdown (a "Lab" expense subcategory). */
type LabOption = LabsResponse[number];
/** A dental shade system and its values, for the Bridge/Veneers shade dropdowns. */
type ShadeSystemOption = ShadesResponse['systems'][number];

/** Editable mirror of a work item — all fields as strings, matching the add/update payload. */
interface DetailDraft {
    work_id: number;
    TeethIds: number[];
    filling_type: string;
    filling_depth: string;
    canals_no: string;
    working_length: string;
    implant_length: string;
    implant_diameter: string;
    implant_manufacturer_id: string;
    material: string;
    lab_id: string;
    shade_system: string;
    shade: string;
    item_cost: string;
    start_date: string;
    completed_date: string;
    note: string;
}

interface WorkDetailItemProps {
    workId: number;
    typeOfWork: number;
    /** null = a brand-new item being added inline. */
    detail: WorkDetail | null;
    teethOptions: ToothOption[];
    implantManufacturers: ImplantManufacturer[];
    shadeSystems: ShadeSystemOption[];
    labs: LabOption[];
    /** Start directly in edit mode (used for the freshly-added blank item). */
    startInEdit?: boolean;
    /** Called when a NEW item's edit finishes (saved or cancelled) so the panel can drop the draft slot. */
    onCloseNew?: () => void;
    /** The editor gained or lost unsaved input; the card asks before a collapse discards it (FE-F7-14). */
    onDirtyChange?: (key: string, dirty: boolean) => void;
}

const noop = () => {};

const buildDraft = (d: WorkDetail | null, workId: number): DetailDraft => ({
    work_id: workId,
    TeethIds: d?.TeethIds ?? [],
    filling_type: d?.filling_type ?? '',
    filling_depth: d?.filling_depth ?? '',
    canals_no: d?.canals_no != null ? String(d.canals_no) : '',
    working_length: d?.working_length ?? '',
    implant_length: d?.implant_length != null ? String(d.implant_length) : '',
    implant_diameter: d?.implant_diameter != null ? String(d.implant_diameter) : '',
    implant_manufacturer_id: d?.implant_manufacturer_id != null ? String(d.implant_manufacturer_id) : '',
    material: d?.material ?? '',
    lab_id: d?.lab_id != null ? String(d.lab_id) : '',
    shade_system: d?.shade_system ?? '',
    shade: d?.shade ?? '',
    item_cost: d?.item_cost != null ? String(d.item_cost) : '',
    start_date: d?.start_date ? String(d.start_date).split('T')[0] : '',
    completed_date: d?.completed_date ? String(d.completed_date).split('T')[0] : '',
    note: d?.note ?? '',
});

const fmtDate = (value: string | null): string => formatLocaleDate(value) || '—';

/** Read-mode value formatting — mirrors the table's former renderCell. */
const renderFieldValue = (d: WorkDetail, key: string): string => {
    if (key === 'canals_no') return d.canals_no ? `${d.canals_no} canal${d.canals_no > 1 ? 's' : ''}` : '—';
    if (key === 'implant_length' || key === 'implant_diameter') {
        const v = d[key];
        return v ? `${v} mm` : '—';
    }
    // The display config names its fields by string; only a real column is read.
    const v = key in d ? d[key as keyof WorkDetail] : undefined;
    return v === undefined || v === null || v === '' ? '—' : String(v);
};

/** The lab-stage badge text of an item with a lab case. */
const labBadgeText = (d: WorkDetail): string => {
    if (d.lab_status === 'cancelled') return 'Lab: Cancelled';
    return d.lab_status ? labelForStage(d.lab_status, d.material) : 'Lab case';
};

const StatusBadge = ({ detail }: { detail: WorkDetail }) => {
    if (detail.completed_date) return <span className={cn(styles.statusBadge, styles.statusCompleted)}>Completed</span>;
    if (detail.start_date) return <span className={cn(styles.statusBadge, styles.statusStarted)}>Started</span>;
    return <span className={cn(styles.statusBadge, styles.statusPending)}>Pending</span>;
};

/**
 * One treatment item rendered inside an expanded WorkCard. Defaults to a
 * read-only "full" card (visual teeth chart + every field); the pen flips it to
 * an in-place editable form (no modal). A null `detail` is a new item that opens
 * straight in edit mode. Save/Delete invalidate the shared detailsList key.
 */
const WorkDetailItem = ({
    workId,
    typeOfWork,
    detail,
    teethOptions,
    implantManufacturers,
    shadeSystems,
    labs,
    startInEdit = false,
    onCloseNew,
    onDirtyChange,
}: WorkDetailItemProps) => {
    const queryClient = useQueryClient();
    const toast = useToast();
    const confirm = useConfirm();
    // Doctors and assistants write treatment items (CLINICAL_ROLES on the server, FE-F7-7) —
    // except the cost, which is money: its input is finance-only, and the server drops
    // `item_cost` from a clinical caller's body anyway.
    const user = useAuthUser();
    const caps = roleCaps(user?.role as UserRole | undefined);
    const config = getWorkTypeConfig(typeOfWork);
    const isNew = detail === null;

    const hasDeciduousSelected = useMemo(() => {
        const ids = new Set(detail?.TeethIds ?? []);
        return teethOptions.some(t => !t.is_permanent && ids.has(t.id));
    }, [detail, teethOptions]);

    const [isEditing, setIsEditing] = useState(startInEdit || isNew);
    const [draft, setDraft] = useState<DetailDraft>(() => buildDraft(detail, workId));
    const [displayItemCost, setDisplayItemCost] = useState(() => (detail?.item_cost ? formatNumber(detail.item_cost) : ''));
    const [showPermanent, setShowPermanent] = useState(true);
    const [showDeciduous, setShowDeciduous] = useState(hasDeciduousSelected);
    const [saving, setSaving] = useState(false);
    const [labModalOpen, setLabModalOpen] = useState(false);

    // Right-click the Lab dropdown → "Edit values" → manage the labs lookup inline.
    // Edits refresh the shared labs feed (qk.lookups.labs), which both this dropdown
    // and the Expense modal's lab dropdown read.
    const labLookup = useLookupManager({
        tableKey: 'tblLabs',
        title: 'Manage Labs',
        menuLabel: 'Edit labs',
        invalidateKeys: [qk.lookups.labs()],
    });

    // Unsaved input = an open editor whose draft differs from what it opened with. The
    // card collapses by unmounting this editor, so it asks first while any is dirty
    // (a typed note used to vanish on collapse: FE-F7-14).
    const dirty = isEditing && JSON.stringify(draft) !== JSON.stringify(buildDraft(detail, workId));
    const dirtyKey = `item-${detail?.id ?? 'new'}`;
    useEffect(() => {
        if (!onDirtyChange) return;
        onDirtyChange(dirtyKey, dirty);
        return () => onDirtyChange(dirtyKey, false);
    }, [dirty, dirtyKey, onDirtyChange]);

    const fid = (name: string) => `wd-${detail?.id ?? 'new'}-${name}`;
    const hasField = (name: string) => config.fields.includes(name);

    const enterEdit = () => {
        setDraft(buildDraft(detail, workId));
        setDisplayItemCost(detail?.item_cost ? formatNumber(detail.item_cost) : '');
        setShowPermanent(true);
        setShowDeciduous(hasDeciduousSelected);
        setIsEditing(true);
    };

    const handleCancel = () => {
        if (detail) setIsEditing(false);
        else onCloseNew?.();
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaving(true);
        try {
            if (detail) {
                await putJSON('/api/updateworkdetail', { detailId: detail.id, ...draft });
            } else {
                await postJSON('/api/addworkdetail', draft);
            }
            await queryClient.invalidateQueries({ queryKey: qk.work.detailsList(workId) });
            if (detail) setIsEditing(false);
            else onCloseNew?.();
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to save work detail'), 5000);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!detail) return;
        // The item's lab case goes with it (lab_cases.work_item_id is ON DELETE CASCADE),
        // which the confirm used to leave unsaid (FE-F7-14).
        const message = detail.lab_case_id
            ? `Are you sure you want to delete this work detail?\n\nIts lab case (${labBadgeText(detail)}) and that case's history are deleted with it.`
            : 'Are you sure you want to delete this work detail?';
        if (!await confirm(message, { title: 'Delete Work Detail', danger: true, confirmText: 'Delete' })) return;
        try {
            await deleteJSON('/api/deleteworkdetail', { body: JSON.stringify({ detailId: detail.id }) });
            await queryClient.invalidateQueries({ queryKey: qk.work.detailsList(workId) });
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to delete work detail'), 5000);
        }
    };

    // ---- READ MODE -------------------------------------------------------
    if (!isEditing && detail) {
        const teethIds = detail.TeethIds ?? [];
        const rows = config.displayFields.filter(f => f.key !== 'Teeth' && f.key !== 'note');
        return (
            <div className={styles.card}>
                <div className={styles.cardActions}>
                    {isProstheticWork(typeOfWork) && (
                        detail.lab_case_id ? (
                            <button
                                type="button"
                                className={cn(styles.labStageBadge, detail.lab_status === 'cancelled' && styles.labStageBadgeCancelled)}
                                onClick={() => setLabModalOpen(true)}
                                title="Open lab case tracker"
                            >
                                <i className="fas fa-flask" aria-hidden="true"></i>{' '}
                                {labBadgeText(detail)}
                            </button>
                        ) : (
                            <button type="button" className="btn btn-xs btn-secondary" onClick={() => setLabModalOpen(true)} title="Start Lab Flow">
                                <i className="fas fa-flask" aria-hidden="true"></i> Start Lab Flow
                            </button>
                        )
                    )}
                    <button type="button" className="btn btn-xs btn-secondary" title="Edit" onClick={enterEdit}>
                        <i className="fas fa-pen" aria-hidden="true"></i>
                    </button>
                    <button type="button" className="btn btn-xs btn-danger" title="Delete" onClick={handleDelete}>
                        <i className="fas fa-trash" aria-hidden="true"></i>
                    </button>
                </div>
                {isProstheticWork(typeOfWork) && (
                    <LabCaseModal
                        isOpen={labModalOpen}
                        onClose={() => setLabModalOpen(false)}
                        workId={workId}
                        workItemId={detail.id}
                        labCaseId={detail.lab_case_id ?? null}
                        prefillLabId={detail.lab_id ?? null}
                        prefillMaterial={detail.material ?? null}
                    />
                )}

                {teethIds.length > 0 && (
                    <div className={styles.chartBlock}>
                        <TeethSelector
                            teethOptions={teethOptions}
                            selectedTeethIds={teethIds}
                            onSelectionChange={noop}
                            readOnly
                        />
                    </div>
                )}

                <div className={styles.fieldGrid}>
                    {detail.Teeth && (
                        <div className={styles.field}>
                            <span className={styles.fieldLabel}>Teeth</span>
                            <span className={styles.fieldValue}><span className={styles.teethBadge}>{detail.Teeth}</span></span>
                        </div>
                    )}
                    {rows.map(f => (
                        <div key={f.key} className={styles.field}>
                            <span className={styles.fieldLabel}>{f.label}</span>
                            <span className={styles.fieldValue}>{renderFieldValue(detail, f.key)}</span>
                        </div>
                    ))}
                    {detail.item_cost ? (
                        <div className={styles.field}>
                            <span className={styles.fieldLabel}>Item Cost</span>
                            <span className={styles.fieldValue}>{formatNumber(detail.item_cost)}</span>
                        </div>
                    ) : null}
                    <div className={styles.field}>
                        <span className={styles.fieldLabel}>Start Date</span>
                        <span className={styles.fieldValue}>{fmtDate(detail.start_date)}</span>
                    </div>
                    <div className={styles.field}>
                        <span className={styles.fieldLabel}>Completed Date</span>
                        <span className={styles.fieldValue}>{fmtDate(detail.completed_date)}</span>
                    </div>
                    <div className={styles.field}>
                        <span className={styles.fieldLabel}>Status</span>
                        <span className={styles.fieldValue}><StatusBadge detail={detail} /></span>
                    </div>
                    {detail.note && (
                        <div className={cn(styles.field, styles.fieldFull)}>
                            <span className={styles.fieldLabel}>Notes</span>
                            <span className={styles.fieldValue}>{detail.note}</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ---- EDIT MODE -------------------------------------------------------
    return (
        <form className={cn(styles.card, styles.editCard)} onSubmit={handleSubmit}>
            <div className={styles.editTitle}>
                <i className={config.icon} aria-hidden="true"></i>
                {' '}{isNew ? `New ${config.name} Item` : `Edit ${config.name} Item`}
            </div>

            {hasField('teeth') && (
                <div className={cn(styles.formGroup, styles.fullWidth)}>
                    <span className={styles.formLabel}>Select Teeth</span>
                    <TeethSelector
                        teethOptions={teethOptions}
                        selectedTeethIds={draft.TeethIds}
                        onSelectionChange={(ids) => setDraft({ ...draft, TeethIds: ids })}
                        showPermanent={showPermanent}
                        showDeciduous={showDeciduous}
                        onFilterChange={(type, value) => {
                            if (type === 'permanent') setShowPermanent(value);
                            if (type === 'deciduous') setShowDeciduous(value);
                        }}
                    />
                </div>
            )}

            <div className={styles.formRow}>
                {hasField('fillingType') && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('filling-type')}>Filling Type</label>
                        <select id={fid('filling-type')} value={draft.filling_type} onChange={(e) => setDraft({ ...draft, filling_type: e.target.value })}>
                            <option value="">Select Type</option>
                            {FILLING_TYPE_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                    </div>
                )}
                {hasField('fillingDepth') && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('filling-depth')}>Filling Depth</label>
                        <select id={fid('filling-depth')} value={draft.filling_depth} onChange={(e) => setDraft({ ...draft, filling_depth: e.target.value })}>
                            <option value="">Select Depth</option>
                            {FILLING_DEPTH_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                    </div>
                )}
                {hasField('canalsNo') && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('canals-no')}>Number of Canals</label>
                        <input id={fid('canals-no')} type="number" value={draft.canals_no} onChange={(e) => setDraft({ ...draft, canals_no: e.target.value })} min="1" max="5" placeholder="1-5" />
                    </div>
                )}
                {hasField('workingLength') && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('working-length')}>Working Length</label>
                        <input id={fid('working-length')} type="text" value={draft.working_length} onChange={(e) => setDraft({ ...draft, working_length: e.target.value })} placeholder="e.g., 20mm, 18mm" />
                    </div>
                )}
                {hasField('implantManufacturer') && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('manufacturer')}>Manufacturer</label>
                        <select id={fid('manufacturer')} value={draft.implant_manufacturer_id} onChange={(e) => setDraft({ ...draft, implant_manufacturer_id: e.target.value })}>
                            <option value="">Select Manufacturer...</option>
                            {implantManufacturers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                    </div>
                )}
                {hasField('implantLength') && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('implant-length')}>Implant Length (mm)</label>
                        <input id={fid('implant-length')} type="number" step="0.5" value={draft.implant_length} onChange={(e) => setDraft({ ...draft, implant_length: e.target.value })} placeholder="e.g., 10, 11.5" />
                    </div>
                )}
                {hasField('implantDiameter') && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('implant-diameter')}>Implant Diameter (mm)</label>
                        <input id={fid('implant-diameter')} type="number" step="0.1" value={draft.implant_diameter} onChange={(e) => setDraft({ ...draft, implant_diameter: e.target.value })} placeholder="e.g., 3.5, 4.0" />
                    </div>
                )}
                {hasField('material') && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('material')}>Material</label>
                        <select id={fid('material')} value={draft.material} onChange={(e) => setDraft({ ...draft, material: e.target.value })}>
                            <option value="">Select Material</option>
                            {MATERIAL_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                    </div>
                )}
                {hasField('shade') && (
                    <>
                        <div className={styles.formGroup}>
                            <label htmlFor={fid('shade-system')}>Shade System</label>
                            <select
                                id={fid('shade-system')}
                                value={draft.shade_system}
                                onChange={(e) => setDraft({ ...draft, shade_system: e.target.value, shade: '' })}
                            >
                                <option value="">Select System</option>
                                {shadeSystems.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                            </select>
                        </div>
                        <div className={styles.formGroup}>
                            <label htmlFor={fid('shade')}>Shade</label>
                            <select
                                id={fid('shade')}
                                value={draft.shade}
                                onChange={(e) => setDraft({ ...draft, shade: e.target.value })}
                                disabled={!draft.shade_system}
                            >
                                <option value="">{draft.shade_system ? 'Select Shade' : 'Select a system first'}</option>
                                {(shadeSystems.find((s) => s.name === draft.shade_system)?.shades ?? []).map(
                                    (sh) => <option key={sh.id} value={sh.shade}>{sh.shade}</option>
                                )}
                            </select>
                        </div>
                    </>
                )}
                {hasField('labName') && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('lab-name')}>Lab</label>
                        <select
                            id={fid('lab-name')}
                            value={draft.lab_id}
                            onChange={(e) => setDraft({ ...draft, lab_id: e.target.value })}
                            onContextMenu={labLookup.onContextMenu}
                            title="Right-click to edit the lab list"
                        >
                            <option value="">Select Lab</option>
                            {labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.name}</option>)}
                            {/* Preserve a previously-selected lab that's since been deactivated (its joined name). */}
                            {draft.lab_id && !labs.some((lab) => String(lab.id) === draft.lab_id) && (
                                <option value={draft.lab_id}>{detail?.lab_name ?? '—'}</option>
                            )}
                        </select>
                        {labLookup.overlay}
                    </div>
                )}
            </div>

            <div className={styles.formRow}>
                <div className={styles.formGroup}>
                    <label htmlFor={fid('start-date')}>Start Date</label>
                    <input id={fid('start-date')} type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                    <label htmlFor={fid('completed-date')}>Completed Date</label>
                    <input id={fid('completed-date')} type="date" value={draft.completed_date} onChange={(e) => setDraft({ ...draft, completed_date: e.target.value })} />
                </div>
                {caps.writeFinance && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('item-cost')}>Item Cost</label>
                        <input
                            id={fid('item-cost')}
                            type="text"
                            value={displayItemCost}
                            onChange={(e) => {
                                const digits = e.target.value.replace(/[^\d]/g, '');
                                const num = parseInt(digits, 10) || 0;
                                setDisplayItemCost(num ? num.toLocaleString('en-US') : '');
                                // Cleared is '' (no cost), not '0' — '0' re-displayed as `0` on
                                // blur (FE-F7-14); the server stores either as NULL.
                                setDraft({ ...draft, item_cost: num ? String(num) : '' });
                            }}
                            onBlur={() => setDisplayItemCost(draft.item_cost ? formatNumber(draft.item_cost) : '')}
                            placeholder="Optional"
                        />
                    </div>
                )}
            </div>

            <div className={cn(styles.formGroup, styles.fullWidth)}>
                <label htmlFor={fid('note')}>Notes</label>
                <textarea id={fid('note')} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} rows={3} placeholder="Additional notes..." />
            </div>

            <div className={styles.formActions}>
                <button type="button" onClick={handleCancel} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : isNew ? 'Add Item' : 'Update Item'}
                </button>
            </div>
        </form>
    );
};

export default WorkDetailItem;
