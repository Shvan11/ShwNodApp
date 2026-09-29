/**
 * NewVisitComponent - Standalone form for adding/editing visits
 *
 * Compact, space-efficient form with dental chart integration
 */

import { useState, useRef, type FormEvent, type ChangeEvent } from 'react';
import cn from 'classnames';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatISODate } from '../../core/utils';
import { putJSON, postJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import type * as visitContract from '@shared/contracts/visit.contract';
import { wiresQuery, operatorsQuery, latestWiresQuery, visitByIdQuery } from '../../query/queries';
import DentalChart from './DentalChart';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useUnsavedRouteGuard } from '../../hooks/useUnsavedRouteGuard';
import styles from './NewVisitComponent.module.css';

// The form IS the add body: every field the contract enumerates, required here
// because the form always sends it. The three `<select>`-backed ids hold the
// option's string value ('' = none) until the contract coerces them.
type SelectIdField = 'upper_wire_id' | 'lower_wire_id' | 'operator_id';
type VisitFormData = Required<Omit<visitContract.AddVisitBody, SelectIdField>>
    & Record<SelectIdField, number | string>;

/** The flags whose change moves the WORK (dates, finished/active) — see visit-queries.ts. */
type LifecycleFlags = Pick<VisitFormData, 'i_photo' | 'f_photo' | 'appliance_removed'>;

interface NewVisitComponentProps {
    workId: number | null;
    visitId?: number | null;
    /**
     * The visit's patient. A photo flag can finish or reopen the work and
     * reclassify the patient, so a save refreshes the patient's cache too.
     */
    personId?: string | number | null;
    // Add returns { visitId }; update returns void.
    onSave?: (result: visitContract.AddVisitResponse | void) => void;
    onCancel?: () => void;
}

type TextFieldKey = 'others' | 'next_visit';

const NewVisitComponent = ({ workId, visitId = null, personId = null, onSave, onCancel }: NewVisitComponentProps) => {
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const { allowNextNavigation } = useUnsavedRouteGuard(dirty);

    // Dropdown reads — each its own independent query (one failing can't blank
    // the others), each typed by its contract.
    const { data: wires = [] } = useQuery(wiresQuery());
    const { data: operators = [] } = useQuery(operatorsQuery());
    const { data: latestWires } = useQuery({
        ...latestWiresQuery(workId ?? ''),
        enabled: !!workId,
    });

    // Visit record read (edit mode). `refetchOnMount: 'always'` + the post-mount
    // seed below mean the form only ever takes the row THIS mount read. Before
    // FE-F9-2 it seeded from whatever `qk.visit.byId` held — a save never
    // refreshed that key, so re-editing a visit within minutes opened its
    // pre-edit values and Update (a whole-row PUT) reverted the first edit.
    const visitRead = useQuery({
        ...visitByIdQuery(visitId ?? ''),
        enabled: !!visitId,
        refetchOnMount: 'always',
    });

    const othersTextareaRef = useRef<HTMLTextAreaElement>(null);
    const nextVisitTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [lastFocusedField, setLastFocusedField] = useState<TextFieldKey>('others');
    const [activeTab, setActiveTab] = useState<'basic' | 'treatment'>('basic');

    // Form state
    const [formData, setFormData] = useState<VisitFormData>({
        work_id: workId ?? 0,
        visit_date: formatISODate(),
        upper_wire_id: '',
        lower_wire_id: '',
        bracket_change: '',
        wire_bending: '',
        elastics: '',
        opg: false,
        p_photo: false,
        i_photo: false,
        f_photo: false,
        others: '',
        next_visit: '',
        appliance_removed: false,
        operator_id: ''
    });
    // The lifecycle flags as stored (edit mode) — what the finish/reopen confirm compares against.
    const [storedFlags, setStoredFlags] = useState<LifecycleFlags | null>(null);

    // Seed the edit form once, during render (no set-state-in-effect), from the
    // read made after mount. The parent keys this component by work + visit, so
    // "once" is once per visit.
    const [seeded, setSeeded] = useState(!visitId);
    if (!seeded && visitRead.isFetchedAfterMount && !visitRead.isFetching && visitRead.data) {
        const visit = visitRead.data;
        setSeeded(true);
        setFormData({
            work_id: visit.work_id,
            visit_date: visit.visit_date ? formatISODate(visit.visit_date) : '',
            upper_wire_id: visit.upper_wire_id || '',
            lower_wire_id: visit.lower_wire_id || '',
            bracket_change: visit.bracket_change || '',
            wire_bending: visit.wire_bending || '',
            elastics: visit.elastics || '',
            opg: visit.opg || false,
            p_photo: visit.p_photo || false,
            i_photo: visit.i_photo || false,
            f_photo: visit.f_photo || false,
            others: visit.others || '',
            next_visit: visit.next_visit || '',
            appliance_removed: visit.appliance_removed || false,
            operator_id: visit.operator_id || ''
        });
        setStoredFlags({
            i_photo: visit.i_photo,
            f_photo: visit.f_photo,
            appliance_removed: visit.appliance_removed,
        });
    }
    // An edit whose visit could not be read shows no form: a blank "Edit Visit"
    // form over a failed read used to be submittable (FE-F9-8).
    const loadFailed = !seeded
        && visitRead.isFetchedAfterMount
        && !visitRead.isFetching
        && (visitRead.isError || (visitRead.isSuccess && !visitRead.data));

    const updateField = <K extends keyof VisitFormData>(field: K, value: VisitFormData[K]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setDirty(true);
    };

    /**
     * The Final Photo box finishes the work (status 2, f_photo_date, carried
     * wires cleared on the first finish); un-ticking it reopens the work. Ask
     * before a save does either, the way the Works page's own status change does.
     */
    const confirmLifecycleChange = async (): Promise<boolean> => {
        const wasFinal = storedFlags?.f_photo ?? false;
        if (formData.f_photo && !wasFinal) {
            return confirm(
                'Final Photo marks this treatment as Finished, dated this visit, and clears the patient\'s carried wires.\n\nSave the visit and finish the treatment?',
                { title: 'Finish treatment?', confirmText: 'Save & finish' }
            );
        }
        if (!formData.f_photo && wasFinal) {
            return confirm(
                'Un-ticking Final Photo reopens this treatment as Active.\n\nSave the visit and reopen the treatment?',
                { title: 'Reopen treatment?', confirmText: 'Save & reopen' }
            );
        }
        return true;
    };

    const handleFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        if (!await confirmLifecycleChange()) return;

        setLoading(true);
        // Save responses differ from the read row: add returns { visitId },
        // update returns no payload (sendSuccess(null) → void).
        let result: visitContract.AddVisitResponse | void;
        try {
            result = visitId
                ? await putJSON<void>('/api/updatevisitbywork', { visitId, ...formData })
                : await postJSON<visitContract.AddVisitResponse>('/api/addvisitbywork', formData);
        } catch (err) {
            const errorMessage = httpErrorMessage(err, 'Failed to save visit');
            setError(errorMessage);
            toast.error(`Failed to save visit: ${errorMessage}`);
            setLoading(false);
            return;
        }

        toast.success(visitId ? 'Visit updated successfully!' : 'Visit added successfully!');

        // qk.work.all covers the visit list, the latest-wires prefill and the
        // shell's work details. qk.patient.all covers the Works page and the
        // patient header: a photo flag can finish or reopen the work and
        // reclassify the patient (FE-F9-4). The single-visit row this form read
        // is stale now — marked so without a refetch, since the form is leaving.
        if (workId) void queryClient.invalidateQueries({ queryKey: qk.work.all(workId) });
        if (personId) void queryClient.invalidateQueries({ queryKey: qk.patient.all(personId) });
        if (visitId) void queryClient.invalidateQueries({ queryKey: qk.visit.byId(visitId), refetchType: 'none' });

        allowNextNavigation();
        setDirty(false);
        setLoading(false);
        onSave?.(result);
    };

    const handleToothClick = (palmerNotation: string) => {
        const targetField = lastFocusedField;
        setFormData(prevData => {
            const currentValue = prevData[targetField] || '';
            const newValue = currentValue
                ? `${currentValue} ${palmerNotation}`
                : palmerNotation;

            return { ...prevData, [targetField]: newValue };
        });
        setDirty(true);

        const targetRef = targetField === 'others' ? othersTextareaRef : nextVisitTextareaRef;
        targetRef.current?.focus();
    };

    if (visitId && !seeded) {
        if (loadFailed) {
            const message = visitRead.isError
                ? httpErrorMessage(visitRead.error, 'Failed to fetch visit data')
                : 'This visit no longer exists.';
            return (
                <div className={styles.container}>
                    <div className={styles.error} role="alert">
                        <span><i className="fas fa-exclamation-circle" aria-hidden="true"></i> {message}</span>
                    </div>
                    <div className={styles.formActions}>
                        <button type="button" className="btn btn-primary" onClick={() => void visitRead.refetch()}>
                            <i className="fas fa-redo" aria-hidden="true"></i> Retry
                        </button>
                        {onCancel && (
                            <button type="button" onClick={onCancel} className="btn btn-secondary">
                                <i className="fas fa-arrow-left" aria-hidden="true"></i> Back
                            </button>
                        )}
                    </div>
                </div>
            );
        }
        return (
            <div className={styles.loading}>
                <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> Loading visit data...
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <h3>
                    <i className="fas fa-calendar-plus"></i> {visitId ? 'Edit Visit' : 'Add New Visit'}
                </h3>
            </div>

            {/* Error Display */}
            {error && (
                <div className={styles.error} role="alert">
                    <span><i className="fas fa-exclamation-circle" aria-hidden="true"></i> {error}</span>
                    <button type="button" onClick={() => setError(null)} className={styles.errorClose} aria-label="Dismiss error">×</button>
                </div>
            )}

            {/* Form */}
            <form onSubmit={handleFormSubmit} className={styles.form}>
                {/* Top Action Buttons */}
                <div className={cn(styles.formActions, styles.topActions)}>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        <i className="fas fa-save"></i> {loading ? 'Saving...' : (visitId ? 'Update' : 'Add Visit')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            <i className="fas fa-times"></i> Cancel
                        </button>
                    )}
                </div>

                {/* Tabs */}
                <div className={styles.tabs} role="tablist" aria-label="Visit sections">
                    <button
                        type="button"
                        id="new-visit-tab-basic"
                        role="tab"
                        aria-selected={activeTab === 'basic'}
                        aria-controls="new-visit-panel-basic"
                        className={cn(styles.tab, { [styles.active]: activeTab === 'basic' })}
                        onClick={() => setActiveTab('basic')}
                    >
                        <i className="fas fa-calendar"></i> Basic Info
                    </button>
                    <button
                        type="button"
                        id="new-visit-tab-treatment"
                        role="tab"
                        aria-selected={activeTab === 'treatment'}
                        aria-controls="new-visit-panel-treatment"
                        className={cn(styles.tab, { [styles.active]: activeTab === 'treatment' })}
                        onClick={() => setActiveTab('treatment')}
                    >
                        <i className="fas fa-teeth"></i> Treatment Details
                    </button>
                </div>

                {/* Tab 1: Basic Information */}
                <div
                    id="new-visit-panel-basic"
                    role="tabpanel"
                    aria-labelledby="new-visit-tab-basic"
                    className={cn(styles.tabContent, { [styles.active]: activeTab === 'basic' })}
                >
                    {/* Basic Information */}
                    <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label htmlFor="new-visit-date">Visit Date <span className={styles.required}>*</span></label>
                        <input
                            id="new-visit-date"
                            type="date"
                            value={formData.visit_date}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('visit_date', e.target.value)}
                            required
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label htmlFor="new-visit-operator">Operator</label>
                        <select
                            id="new-visit-operator"
                            value={formData.operator_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => updateField('operator_id', e.target.value)}
                        >
                            <option value="">Select Operator</option>
                            {operators.map(op => (
                                <option key={op.id} value={op.id}>
                                    {op.employee_name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Latest Wires - Quick Select (only for new visits) */}
                {!visitId && latestWires && (latestWires.UpperWireName || latestWires.LowerWireName) && (
                    <div className={styles.latestWiresSection}>
                        <div className={styles.sectionLabel}>
                            <i className="fas fa-info-circle"></i> Most Recent Wires:
                        </div>
                        <div className={styles.wiresGrid}>
                            {latestWires.UpperWireName && (
                                <button
                                    type="button"
                                    onClick={() => updateField('upper_wire_id', latestWires.upper_wire_id ?? '')}
                                    className={cn(styles.wireBtn, styles.upper, { [styles.active]: formData.upper_wire_id === latestWires.upper_wire_id })}
                                >
                                    <div className={styles.wireLabel}>Upper:</div>
                                    <div className={styles.wireName}>{latestWires.UpperWireName}</div>
                                </button>
                            )}
                            {latestWires.LowerWireName && (
                                <button
                                    type="button"
                                    onClick={() => updateField('lower_wire_id', latestWires.lower_wire_id ?? '')}
                                    className={cn(styles.wireBtn, styles.lower, { [styles.active]: formData.lower_wire_id === latestWires.lower_wire_id })}
                                >
                                    <div className={styles.wireLabel}>Lower:</div>
                                    <div className={styles.wireName}>{latestWires.LowerWireName}</div>
                                </button>
                            )}
                        </div>
                    </div>
                )}

                    {/* Wire Information */}
                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label htmlFor="new-visit-upper-wire">Upper Wire</label>
                            <select
                                id="new-visit-upper-wire"
                                value={formData.upper_wire_id}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => updateField('upper_wire_id', e.target.value)}
                            >
                                <option value="">Select Wire</option>
                                {wires.map(wire => (
                                    <option key={wire.id} value={wire.id}>
                                        {wire.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className={styles.formGroup}>
                            <label htmlFor="new-visit-lower-wire">Lower Wire</label>
                            <select
                                id="new-visit-lower-wire"
                                value={formData.lower_wire_id}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => updateField('lower_wire_id', e.target.value)}
                            >
                                <option value="">Select Wire</option>
                                {wires.map(wire => (
                                    <option key={wire.id} value={wire.id}>
                                        {wire.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Tab 2: Treatment Details */}
                <div
                    id="new-visit-panel-treatment"
                    role="tabpanel"
                    aria-labelledby="new-visit-tab-treatment"
                    className={cn(styles.tabContent, { [styles.active]: activeTab === 'treatment' })}
                >
                    {/* Treatment Details */}
                    <div className={styles.formGroup}>
                        <label htmlFor="new-visit-bracket-change">Bracket Change</label>
                        <input
                            id="new-visit-bracket-change"
                            type="text"
                            value={formData.bracket_change}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('bracket_change', e.target.value)}
                            placeholder="e.g., Replaced upper left bracket"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label htmlFor="new-visit-wire-bending">Wire Bending</label>
                        <input
                            id="new-visit-wire-bending"
                            type="text"
                            value={formData.wire_bending}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('wire_bending', e.target.value)}
                            placeholder="e.g., Omega loop on upper wire"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label htmlFor="new-visit-elastics">Elastics</label>
                        <input
                            id="new-visit-elastics"
                            type="text"
                            value={formData.elastics}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('elastics', e.target.value)}
                            placeholder="e.g., Class II elastics"
                        />
                    </div>
                </div>

                {/* Dental Chart */}
                <div className={styles.dentalChartSection}>
                    <span className={styles.chartLabel}>
                        <span>
                            <i className="fas fa-tooth"></i> Select Teeth
                        </span>
                        <span className={styles.chartHint}>
                            <i className="fas fa-arrow-down"></i> Appends to: <strong>{lastFocusedField === 'others' ? 'Other Notes' : 'Next Visit'}</strong>
                        </span>
                    </span>
                    <DentalChart onToothClick={handleToothClick} />
                </div>

                {/* Notes */}
                <div className={cn(styles.formGroup, styles.fullWidth)}>
                    <label htmlFor="new-visit-others">
                        Other Notes
                        {lastFocusedField === 'others' && (
                            <span className={styles.activeIndicator}>
                                <i className="fas fa-tooth"></i> Active
                            </span>
                        )}
                    </label>
                    <textarea
                        id="new-visit-others"
                        ref={othersTextareaRef}
                        value={formData.others}
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updateField('others', e.target.value)}
                        onFocus={() => setLastFocusedField('others')}
                        rows={4}
                        placeholder="Any additional notes about this visit..."
                        className={lastFocusedField === 'others' ? styles.active : ''}
                    />
                </div>

                {/* Next Visit Instructions */}
                <div className={cn(styles.formGroup, styles.fullWidth)}>
                    <label htmlFor="new-visit-next-visit">
                        Next Visit Instructions
                        {lastFocusedField === 'next_visit' && (
                            <span className={styles.activeIndicator}>
                                <i className="fas fa-tooth"></i> Active
                            </span>
                        )}
                    </label>
                    <textarea
                        id="new-visit-next-visit"
                        ref={nextVisitTextareaRef}
                        value={formData.next_visit}
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updateField('next_visit', e.target.value)}
                        onFocus={() => setLastFocusedField('next_visit')}
                        rows={4}
                        placeholder="Instructions or notes for the next visit..."
                        className={lastFocusedField === 'next_visit' ? styles.active : ''}
                    />
                </div>

                {/* Checkboxes - Moved to bottom */}
                <div className={styles.checkboxesGrid}>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={formData.opg}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('opg', e.target.checked)}
                        />
                        <span>OPG Taken</span>
                    </label>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={formData.i_photo}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('i_photo', e.target.checked)}
                        />
                        <span>Initial Photo</span>
                        <span className={styles.flagHint}>sets the treatment&apos;s initial-photo date</span>
                    </label>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={formData.p_photo}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('p_photo', e.target.checked)}
                        />
                        <span>Progress Photo</span>
                    </label>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={formData.f_photo}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('f_photo', e.target.checked)}
                        />
                        <span>Final Photo</span>
                        <span className={styles.flagHint}>marks the treatment Finished</span>
                    </label>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={formData.appliance_removed}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('appliance_removed', e.target.checked)}
                        />
                        <span>Appliance Removed</span>
                        <span className={styles.flagHint}>sets the treatment&apos;s debond date</span>
                    </label>
                </div>

                {/* Bottom Form Actions */}
                <div className={styles.formActions}>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        <i className="fas fa-save"></i> {loading ? 'Saving...' : (visitId ? 'Update Visit' : 'Add Visit')}
                    </button>
                    {onCancel && (
                        <button type="button" onClick={onCancel} className="btn btn-secondary">
                            <i className="fas fa-times"></i> Cancel
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
};

export default NewVisitComponent;
