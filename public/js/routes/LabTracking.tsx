import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { labsQuery } from '@/query/queries';
import { useLabCasesBoard } from '@/hooks/useLabCases';
import type { LabCaseBoardRow, ListLabCasesQuery } from '@shared/contracts/lab-case.contract';
import LabFilters from '../components/react/lab-tracking/LabFilters';
import LabBoard from '../components/react/lab-tracking/LabBoard';
import LabCaseModal from '../components/react/lab-tracking/LabCaseModal';
import styles from './LabTracking.module.css';

/**
 * The lab case tracker dashboard — one board column per open stage, with
 * stage/lab/overdue/search filters synced to the URL (deep-linkable, and
 * survives back/forward like the DailyAppointments doctor filter). English-only
 * in v1 (untranslated routes stay LTR automatically); only the dashboard tile
 * that links here is bilingual.
 */
export default function LabTracking() {
    const [searchParams, setSearchParams] = useSearchParams();

    const filters: ListLabCasesQuery = useMemo(() => ({
        status: (searchParams.get('status') as ListLabCasesQuery['status']) || undefined,
        labId: searchParams.get('labId') ? Number(searchParams.get('labId')) : undefined,
        overdue: searchParams.get('overdue') === 'true' ? 'true' : undefined,
        q: searchParams.get('q') || undefined,
    }), [searchParams]);

    const handleFiltersChange = (next: ListLabCasesQuery): void => {
        const params = new URLSearchParams();
        if (next.status) params.set('status', next.status);
        if (next.labId) params.set('labId', String(next.labId));
        if (next.overdue === 'true') params.set('overdue', 'true');
        if (next.q) params.set('q', next.q);
        setSearchParams(params);
    };

    const { data: cases, isLoading, isError, refetch } = useLabCasesBoard(filters);
    const { data: labs } = useQuery(labsQuery());

    const [selected, setSelected] = useState<LabCaseBoardRow | null>(null);

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <h1>Lab Case Tracker</h1>
            </div>

            <LabFilters filters={filters} labs={labs ?? []} onChange={handleFiltersChange} />

            {isLoading ? (
                <div className={styles.stateMsg}>Loading cases…</div>
            ) : isError ? (
                <div className={styles.stateMsg}>
                    Failed to load lab cases.{' '}
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => void refetch()}>Retry</button>
                </div>
            ) : (
                <LabBoard cases={cases ?? []} onOpen={setSelected} />
            )}

            {selected && (
                <LabCaseModal
                    isOpen
                    onClose={() => setSelected(null)}
                    workId={selected.work_id}
                    workItemId={selected.work_item_id}
                    labCaseId={selected.id}
                    prefillLabId={selected.lab_id}
                    prefillMaterial={selected.material}
                />
            )}
        </div>
    );
}
