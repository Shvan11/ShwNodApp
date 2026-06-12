/**
 * NewVisitComponent - Standalone form for adding/editing visits
 *
 * Compact, space-efficient form with dental chart integration
 */

import React, { useState, useEffect, useRef, useCallback, type FormEvent, type ChangeEvent } from 'react';
import cn from 'classnames';
import { useQuery } from '@tanstack/react-query';
import { formatISODate } from '../../core/utils';
import { putJSON, postJSON, httpErrorMessage } from '@/core/http';
import * as visitContract from '@shared/contracts/visit.contract';
import { wiresQuery, operatorsQuery, latestWiresQuery, visitByIdQuery } from '../../query/queries';
import DentalChart from './DentalChart';
import { useToast } from '../../contexts/ToastContext';
import styles from './NewVisitComponent.module.css';

interface Wire {
    id: number;
    name: string;
}

interface Operator {
    id: number;
    employee_name: string;
}

interface LatestWires {
    upper_wire_id: number | null;
    UpperWireName: string | null;
    lower_wire_id: number | null;
    LowerWireName: string | null;
}

interface VisitFormData {
    work_id: number;
    visit_date: string;
    upper_wire_id: number | string;
    lower_wire_id: number | string;
    bracket_change: string;
    wire_bending: string;
    elastics: string;
    opg: boolean;
    p_photo: boolean;
    i_photo: boolean;
    f_photo: boolean;
    others: string;
    next_visit: string;
    appliance_removed: boolean;
    operator_id: number | string;
}

// Full visit row as returned by GET /api/getvisitbyid (visitById.response is a
// loose container; this annotates the long-tail fields the form reads).
interface VisitRow {
    id: number;
    work_id: number;
    visit_date: string;
    upper_wire_id?: number;
    lower_wire_id?: number;
    bracket_change?: string;
    wire_bending?: string;
    elastics?: string;
    opg?: boolean;
    p_photo?: boolean;
    i_photo?: boolean;
    f_photo?: boolean;
    others?: string;
    next_visit?: string;
    appliance_removed?: boolean;
    operator_id?: number;
}

interface NewVisitComponentProps {
    workId: number | null;
    visitId?: number | null;
    // Add returns { visitId }; update returns void.
    onSave?: (result: visitContract.AddVisitResponse | void) => void;
    onCancel?: () => void;
}

type TextFieldKey = 'others' | 'next_visit';

const NewVisitComponent = ({ workId, visitId = null, onSave, onCancel }: NewVisitComponentProps) => {
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Dropdown reads — each its own independent query (one failing can't blank
    // the others). Loose contract responses expose long-tail fields as unknown,
    // so `data` is cast to its concrete row type.
    const { data: wiresData } = useQuery(wiresQuery());
    const { data: operatorsData } = useQuery(operatorsQuery());
    const { data: latestWiresData } = useQuery({
        ...latestWiresQuery(workId ?? ''),
        enabled: !!workId,
    });

    const wires = (wiresData ?? []) as unknown as Wire[];
    const operators = (operatorsData ?? []) as unknown as Operator[];
    const latestWires: LatestWires = (latestWiresData as LatestWires | undefined) ?? {
        upper_wire_id: null,
        UpperWireName: null,
        lower_wire_id: null,
        LowerWireName: null
    };

    // Visit record read (edit mode) — populates the form via the effect below.
    const {
        data: visitData,
        isLoading: visitLoading,
        error: visitError,
    } = useQuery({
        ...visitByIdQuery(visitId ?? ''),
        enabled: !!visitId,
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


    // Populate the form when the visit record arrives (edit mode). Mirrors the
    // old loadVisitData population exactly — same field coercion / falsy→default.
    useEffect(() => {
        if (!visitData) return;
        const visit = visitData as unknown as VisitRow;
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
    }, [visitData]);

    // Surface a visit-record load failure in the existing error banner (the old
    // loadVisitData did setError(...) on its catch).
    useEffect(() => {
        if (visitError) {
            setError(httpErrorMessage(visitError, 'Failed to fetch visit data'));
        }
    }, [visitError]);

    // Memoized form submit handler
    const handleFormSubmit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);

        try {
            setLoading(true);

            // Save responses differ from the read row: add returns { visitId },
            // update returns no payload (sendSuccess(null) → void). Type them
            // accordingly rather than reusing the full-row VisitRow shape.
            const result = visitId
                ? await putJSON<void>('/api/updatevisitbywork', { visitId, ...formData })
                : await postJSON<visitContract.AddVisitResponse>('/api/addvisitbywork', formData);

            // Show success toast notification
            if (visitId) {
                toast.success('Visit updated successfully!');
            } else {
                toast.success('Visit added successfully!');
            }

            if (onSave) {
                onSave(result);
            }
        } catch (err) {
            const errorMessage = httpErrorMessage(err, 'Failed to save visit');
            setError(errorMessage);
            toast.error(`Failed to save visit: ${errorMessage}`);
        } finally {
            setLoading(false);
        }
    }, [visitId, formData, onSave, toast]);

    // Memoized tooth click handler - prevents DentalChart re-renders
    const handleToothClick = useCallback((palmerNotation: string) => {
        setFormData(prevData => {
            const targetField = lastFocusedField;
            const currentValue = prevData[targetField] || '';
            const newValue = currentValue
                ? `${currentValue} ${palmerNotation}`
                : palmerNotation;

            return { ...prevData, [targetField]: newValue };
        });

        const targetRef = lastFocusedField === 'others' ? othersTextareaRef : nextVisitTextareaRef;
        if (targetRef.current) {
            targetRef.current.focus();
        }
    }, [lastFocusedField]);

    // Generic memoized field change handler
    const handleFieldChange = useCallback((field: keyof VisitFormData, value: string | boolean | number) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    }, []);

    // Memoized tab change handler
    const handleTabChange = useCallback((tab: 'basic' | 'treatment') => {
        setActiveTab(tab);
    }, []);

    // Memoized focus handler
    const handleFieldFocus = useCallback((field: TextFieldKey) => {
        setLastFocusedField(field);
    }, []);

    // Memoized error clear handler
    const handleClearError = useCallback(() => {
        setError(null);
    }, []);

    if (visitLoading && visitId) {
        return (
            <div className={styles.loading}>
                <i className="fas fa-spinner fa-spin"></i> Loading visit data...
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
                <div className={styles.error}>
                    <i className="fas fa-exclamation-circle"></i> {error}
                    <button onClick={handleClearError} className={styles.errorClose}>×</button>
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
                <div className={styles.tabs}>
                    <button
                        type="button"
                        className={cn(styles.tab, { [styles.active]: activeTab === 'basic' })}
                        onClick={() => handleTabChange('basic')}
                    >
                        <i className="fas fa-calendar"></i> Basic Info
                    </button>
                    <button
                        type="button"
                        className={cn(styles.tab, { [styles.active]: activeTab === 'treatment' })}
                        onClick={() => handleTabChange('treatment')}
                    >
                        <i className="fas fa-teeth"></i> Treatment Details
                    </button>
                </div>

                {/* Tab 1: Basic Information */}
                <div className={cn(styles.tabContent, { [styles.active]: activeTab === 'basic' })}>
                    {/* Basic Information */}
                    <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                        <label>Visit Date <span className={styles.required}>*</span></label>
                        <input
                            type="date"
                            value={formData.visit_date}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange('visit_date', e.target.value)}
                            required
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label>Operator</label>
                        <select
                            value={formData.operator_id}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleFieldChange('operator_id', e.target.value)}
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
                {!visitId && (latestWires.UpperWireName || latestWires.LowerWireName) && (
                    <div className={styles.latestWiresSection}>
                        <div className={styles.sectionLabel}>
                            <i className="fas fa-info-circle"></i> Most Recent Wires:
                        </div>
                        <div className={styles.wiresGrid}>
                            {latestWires.UpperWireName && (
                                <button
                                    type="button"
                                    onClick={() => handleFieldChange('upper_wire_id', latestWires.upper_wire_id!)}
                                    className={cn(styles.wireBtn, styles.upper, { [styles.active]: formData.upper_wire_id === latestWires.upper_wire_id })}
                                >
                                    <div className={styles.wireLabel}>Upper:</div>
                                    <div className={styles.wireName}>{latestWires.UpperWireName}</div>
                                </button>
                            )}
                            {latestWires.LowerWireName && (
                                <button
                                    type="button"
                                    onClick={() => handleFieldChange('lower_wire_id', latestWires.lower_wire_id!)}
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
                            <label>Upper Wire</label>
                            <select
                                value={formData.upper_wire_id}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleFieldChange('upper_wire_id', e.target.value)}
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
                            <label>Lower Wire</label>
                            <select
                                value={formData.lower_wire_id}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleFieldChange('lower_wire_id', e.target.value)}
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
                <div className={cn(styles.tabContent, { [styles.active]: activeTab === 'treatment' })}>
                    {/* Treatment Details */}
                    <div className={styles.formGroup}>
                        <label>Bracket Change</label>
                        <input
                            type="text"
                            value={formData.bracket_change}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange('bracket_change', e.target.value)}
                            placeholder="e.g., Replaced upper left bracket"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label>Wire Bending</label>
                        <input
                            type="text"
                            value={formData.wire_bending}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange('wire_bending', e.target.value)}
                            placeholder="e.g., Omega loop on upper wire"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label>Elastics</label>
                        <input
                            type="text"
                            value={formData.elastics}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange('elastics', e.target.value)}
                            placeholder="e.g., Class II elastics"
                        />
                    </div>
                </div>

                {/* Dental Chart */}
                <div className={styles.dentalChartSection}>
                    <label className={styles.chartLabel}>
                        <span>
                            <i className="fas fa-tooth"></i> Select Teeth
                        </span>
                        <span className={styles.chartHint}>
                            <i className="fas fa-arrow-down"></i> Appends to: <strong>{lastFocusedField === 'others' ? 'Other Notes' : 'Next Visit'}</strong>
                        </span>
                    </label>
                    <DentalChart onToothClick={handleToothClick} />
                </div>

                {/* Notes */}
                <div className={cn(styles.formGroup, styles.fullWidth)}>
                    <label>
                        Other Notes
                        {lastFocusedField === 'others' && (
                            <span className={styles.activeIndicator}>
                                <i className="fas fa-tooth"></i> Active
                            </span>
                        )}
                    </label>
                    <textarea
                        ref={othersTextareaRef}
                        value={formData.others}
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleFieldChange('others', e.target.value)}
                        onFocus={() => handleFieldFocus('others')}
                        rows={4}
                        placeholder="Any additional notes about this visit..."
                        className={lastFocusedField === 'others' ? styles.active : ''}
                    />
                </div>

                {/* Next Visit Instructions */}
                <div className={cn(styles.formGroup, styles.fullWidth)}>
                    <label>
                        Next Visit Instructions
                        {lastFocusedField === 'next_visit' && (
                            <span className={styles.activeIndicator}>
                                <i className="fas fa-tooth"></i> Active
                            </span>
                        )}
                    </label>
                    <textarea
                        ref={nextVisitTextareaRef}
                        value={formData.next_visit}
                        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleFieldChange('next_visit', e.target.value)}
                        onFocus={() => handleFieldFocus('next_visit')}
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
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange('opg', e.target.checked)}
                        />
                        <span>OPG Taken</span>
                    </label>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={formData.i_photo}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange('i_photo', e.target.checked)}
                        />
                        <span>Initial Photo</span>
                    </label>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={formData.p_photo}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange('p_photo', e.target.checked)}
                        />
                        <span>Progress Photo</span>
                    </label>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={formData.f_photo}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange('f_photo', e.target.checked)}
                        />
                        <span>Final Photo</span>
                    </label>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={formData.appliance_removed}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFieldChange('appliance_removed', e.target.checked)}
                        />
                        <span>Appliance Removed</span>
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
