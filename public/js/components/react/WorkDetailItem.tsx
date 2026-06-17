import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import cn from 'classnames';
import TeethSelector, { type ToothOption } from './TeethSelector';
import { type WorkDetail } from './WorkDetailsPanel';
import {
    getWorkTypeConfig,
    MATERIAL_OPTIONS,
    FILLING_TYPE_OPTIONS,
    FILLING_DEPTH_OPTIONS,
} from '../../config/workTypeConfig';
import { formatNumber } from '../../utils/formatters';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import styles from './WorkDetailItem.module.css';

export interface ImplantManufacturer {
    id: number;
    name: string;
}

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
    lab_name: string;
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
    /** Start directly in edit mode (used for the freshly-added blank item). */
    startInEdit?: boolean;
    /** Called when a NEW item's edit finishes (saved or cancelled) so the panel can drop the draft slot. */
    onCloseNew?: () => void;
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
    lab_name: d?.lab_name ?? '',
    item_cost: d?.item_cost != null ? String(d.item_cost) : '',
    start_date: d?.start_date ? String(d.start_date).split('T')[0] : '',
    completed_date: d?.completed_date ? String(d.completed_date).split('T')[0] : '',
    note: d?.note ?? '',
});

const fmtDate = (value?: string): string => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

/** Read-mode value formatting — mirrors the table's former renderCell. */
const renderFieldValue = (d: WorkDetail, key: string): string => {
    if (key === 'canals_no') return d.canals_no ? `${d.canals_no} canal${d.canals_no > 1 ? 's' : ''}` : '—';
    if (key === 'implant_length' || key === 'implant_diameter') {
        const v = d[key];
        return v ? `${v} mm` : '—';
    }
    const v = d[key];
    return v === undefined || v === null || v === '' ? '—' : String(v);
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
    startInEdit = false,
    onCloseNew,
}: WorkDetailItemProps) => {
    const queryClient = useQueryClient();
    const toast = useToast();
    const confirm = useConfirm();
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
        if (!await confirm('Are you sure you want to delete this work detail?', { title: 'Delete Work Detail', danger: true, confirmText: 'Delete' })) return;
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
                    <button type="button" className="btn btn-xs btn-secondary" title="Edit" onClick={enterEdit}>
                        <i className="fas fa-pen"></i>
                    </button>
                    <button type="button" className="btn btn-xs btn-danger" title="Delete" onClick={handleDelete}>
                        <i className="fas fa-trash"></i>
                    </button>
                </div>

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
                <i className={config.icon}></i>
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
                {hasField('labName') && (
                    <div className={styles.formGroup}>
                        <label htmlFor={fid('lab-name')}>Lab Name</label>
                        <input id={fid('lab-name')} type="text" value={draft.lab_name} onChange={(e) => setDraft({ ...draft, lab_name: e.target.value })} placeholder="Enter lab name" />
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
                            setDraft({ ...draft, item_cost: String(num) });
                        }}
                        onBlur={() => setDisplayItemCost(draft.item_cost ? formatNumber(draft.item_cost) : '')}
                        placeholder="Optional"
                    />
                </div>
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
