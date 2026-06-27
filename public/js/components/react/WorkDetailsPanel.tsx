import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWorkTypeConfig } from '../../config/workTypeConfig';
import { workDetailsListQuery, teethQuery, implantManufacturersQuery, shadesQuery, labsQuery } from '@/query/queries';
import WorkDetailItem, { type ImplantManufacturer, type ShadeSystemOption, type LabOption } from './WorkDetailItem';
import { type ToothOption } from './TeethSelector';
import styles from './WorkDetailsPanel.module.css';

/** A single treatment-item (procedure) row under a work. */
export interface WorkDetail {
    id: number;
    work_id: number;
    TeethIds?: number[];
    Teeth?: string;
    ImplantManufacturerName?: string;
    filling_type?: string;
    filling_depth?: string;
    canals_no?: number;
    working_length?: string;
    implant_length?: number;
    implant_diameter?: number;
    implant_manufacturer_id?: number;
    material?: string;
    lab_id?: number;
    lab_name?: string;
    shade_system?: string;
    shade?: string;
    item_cost?: number;
    start_date?: string;
    completed_date?: string;
    note?: string;
    // Allow dynamic access for work type display fields
    [key: string]: string | number | number[] | undefined;
}

interface WorkDetailsPanelProps {
    workId: number;
    typeOfWork: number;
}

/**
 * The treatment-items list for a work, rendered inline inside an expanded
 * WorkCard. Owns its own reads (the item rows + the teeth/manufacturer lookups
 * the inline editor needs) and renders each item as a full WorkDetailItem card
 * with read + in-place edit modes. "Add Item" appends a blank card in edit mode;
 * all writes invalidate the shared detailsList key to refresh here.
 */
const WorkDetailsPanel = ({ workId, typeOfWork }: WorkDetailsPanelProps) => {
    const config = getWorkTypeConfig(typeOfWork);
    const { data, isLoading, isError } = useQuery(workDetailsListQuery(workId));
    const details = (data ?? []) as WorkDetail[];

    const { data: teethData } = useQuery(teethQuery());
    const teethOptions = (teethData?.teeth ?? []) as ToothOption[];

    const { data: manufacturersData } = useQuery(implantManufacturersQuery());
    const implantManufacturers = (manufacturersData ?? []) as ImplantManufacturer[];

    const { data: shadesData } = useQuery(shadesQuery());
    const shadeSystems = (shadesData?.systems ?? []) as ShadeSystemOption[];

    const { data: labsData } = useQuery(labsQuery());
    const labs = (labsData ?? []) as LabOption[];

    const [isAdding, setIsAdding] = useState(false);

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <h4>
                    <i className={config.icon}></i>
                    {' '}{config.name} Items
                </h4>
                <button type="button" onClick={() => setIsAdding(true)} className="btn btn-sm btn-primary" disabled={isAdding}>
                    <i className="fas fa-plus"></i> Add Item
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
