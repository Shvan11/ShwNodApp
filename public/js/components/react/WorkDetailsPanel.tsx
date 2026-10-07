import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWorkTypeConfig } from '../../config/workTypeConfig';
import { workDetailsListQuery, teethQuery, implantManufacturersQuery, shadesQuery, labsQuery } from '@/query/queries';
import type { WorkItemRow } from '@shared/contracts/work.contract';
import WorkDetailItem from './WorkDetailItem';
import styles from './WorkDetailsPanel.module.css';

/** A single treatment-item (procedure) row under a work — the contract's row (FE-F7-17). */
export type WorkDetail = WorkItemRow;

interface WorkDetailsPanelProps {
    workId: number;
    typeOfWork: number;
    /** An item editor gained or lost unsaved input (keyed per item) — the card asks before a collapse discards it. */
    onItemDirtyChange?: (key: string, dirty: boolean) => void;
}

/**
 * The treatment-items list for a work, rendered inline inside an expanded
 * WorkCard. Owns its own reads (the item rows + the teeth/manufacturer lookups
 * the inline editor needs) and renders each item as a full WorkDetailItem card
 * with read + in-place edit modes. "Add Item" appends a blank card in edit mode;
 * all writes invalidate the shared detailsList key to refresh here.
 */
const WorkDetailsPanel = ({ workId, typeOfWork, onItemDirtyChange }: WorkDetailsPanelProps) => {
    const config = getWorkTypeConfig(typeOfWork);
    const { data, isLoading, isError } = useQuery(workDetailsListQuery(workId));
    const details = data ?? [];

    const { data: teethData } = useQuery(teethQuery());
    const teethOptions = teethData?.teeth ?? [];

    const { data: manufacturersData } = useQuery(implantManufacturersQuery());
    const implantManufacturers = manufacturersData ?? [];

    const { data: shadesData } = useQuery(shadesQuery());
    const shadeSystems = shadesData?.systems ?? [];

    const { data: labsData } = useQuery(labsQuery());
    const labs = labsData ?? [];

    const [isAdding, setIsAdding] = useState(false);

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <h4>
                    <i className={config.icon} aria-hidden="true"></i>
                    {' '}{config.name} Items
                </h4>
                <button type="button" onClick={() => setIsAdding(true)} className="btn btn-sm btn-primary" disabled={isAdding}>
                    <i className="fas fa-plus" aria-hidden="true"></i> Add Item
                </button>
            </div>

            <div className={styles.body}>
                {isLoading ? (
                    <div className={styles.stateMsg}>Loading items…</div>
                ) : isError ? (
                    <div className={styles.stateMsg}>Failed to load items.</div>
                ) : (
                    <>
                        {details.map((detail) => (
                            <WorkDetailItem
                                key={detail.id}
                                workId={workId}
                                typeOfWork={typeOfWork}
                                detail={detail}
                                teethOptions={teethOptions}
                                implantManufacturers={implantManufacturers}
                                shadeSystems={shadeSystems}
                                labs={labs}
                                onDirtyChange={onItemDirtyChange}
                            />
                        ))}
                        {isAdding && (
                            <WorkDetailItem
                                workId={workId}
                                typeOfWork={typeOfWork}
                                detail={null}
                                teethOptions={teethOptions}
                                implantManufacturers={implantManufacturers}
                                shadeSystems={shadeSystems}
                                labs={labs}
                                startInEdit
                                onCloseNew={() => setIsAdding(false)}
                                onDirtyChange={onItemDirtyChange}
                            />
                        )}
                        {details.length === 0 && !isAdding && (
                            <div className={styles.noData}>No treatment items recorded yet</div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default WorkDetailsPanel;
