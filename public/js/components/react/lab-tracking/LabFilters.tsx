import { useEffect, useRef, useState } from 'react';
import { LAB_STAGE_META, type ListLabCasesQuery } from '@shared/contracts/lab-case.contract';
import { labelForStage } from '@/config/labStages';
import styles from './LabFilters.module.css';

interface LabOption {
    id: number;
    name: string;
}

interface LabFiltersProps {
    filters: ListLabCasesQuery;
    labs: LabOption[];
    onChange: (filters: ListLabCasesQuery) => void;
}

/**
 * Stage / lab / overdue / search filter bar for the /lab-tracking board.
 * URL-synced by the parent (LabTracking) — this component is a controlled
 * form over the `filters` prop, mirroring the DailyAppointments doctor filter.
 */
const LabFilters = ({ filters, labs, onChange }: LabFiltersProps) => {
    // Debounce the free-text search so every keystroke doesn't refetch.
    const [qDraft, setQDraft] = useState(filters.q ?? '');
    // Re-sync the draft when the URL's `q` changes from outside this input
    // (Clear filters, back/forward nav) — adjusted during render, not an
    // effect, so it doesn't cascade (see set-state-in-effect-fix-patterns).
    const [syncedQ, setSyncedQ] = useState(filters.q ?? '');
    if (syncedQ !== (filters.q ?? '')) {
        setSyncedQ(filters.q ?? '');
        setQDraft(filters.q ?? '');
    }
    // The debounce reads the LATEST filters when it fires: it used to apply the
    // ones it captured, so a stage/lab change made within 300 ms of typing was
    // thrown away (FE-F20-8a).
    const latest = useRef({ filters, onChange });
    useEffect(() => {
        latest.current = { filters, onChange };
    });
    useEffect(() => {
        const timer = setTimeout(() => {
            const { filters: current, onChange: apply } = latest.current;
            if (qDraft !== (current.q ?? '')) apply({ ...current, q: qDraft || undefined });
        }, 300);
        return () => clearTimeout(timer);
    }, [qDraft]);

    return (
        <div className={styles.bar}>
            <select
                className={styles.select}
                value={filters.status ?? ''}
                onChange={(e) => onChange({ ...filters, status: (e.target.value || undefined) as ListLabCasesQuery['status'] })}
                aria-label="Filter by stage"
            >
                <option value="">All Stages</option>
                {LAB_STAGE_META.map((m) => (
                    <option key={m.key} value={m.key}>{labelForStage(m.key)}</option>
                ))}
            </select>

            <select
                className={styles.select}
                value={filters.labId ?? ''}
                onChange={(e) => onChange({ ...filters, labId: e.target.value ? Number(e.target.value) : undefined })}
                aria-label="Filter by lab"
            >
                <option value="">All Labs</option>
                {labs.map((lab) => <option key={lab.id} value={lab.id}>{lab.name}</option>)}
            </select>

            <label className={styles.overdueToggle}>
                <input
                    type="checkbox"
                    checked={filters.overdue === 'true'}
                    onChange={(e) => onChange({ ...filters, overdue: e.target.checked ? 'true' : undefined })}
                />
                <span>Overdue only</span>
            </label>

            <input
                type="search"
                className={styles.search}
                placeholder="Search patient…"
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                aria-label="Search by patient name"
            />

            {(filters.status || filters.labId || filters.overdue || filters.q) && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => onChange({})}>
                    Clear filters
                </button>
            )}
        </div>
    );
};

export default LabFilters;
