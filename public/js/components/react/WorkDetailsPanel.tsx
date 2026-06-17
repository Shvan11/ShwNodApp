import { useQuery } from '@tanstack/react-query';
import cn from 'classnames';
import { getWorkTypeConfig, type DisplayField } from '../../config/workTypeConfig';
import { workDetailsListQuery } from '@/query/queries';
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
    lab_name?: string;
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
    onAdd: () => void;
    onEdit: (detail: WorkDetail) => void;
    onDelete: (detailId: number) => void;
}

/**
 * The treatment-items list for a work, rendered inline inside an expanded
 * WorkCard (formerly the hidden "Work Details" modal). Owns its own read so the
 * rows load when the card expands; Add/Edit still routes up to WorkComponent's
 * shared form modal, and writes invalidate this same query key to refresh here.
 */
const WorkDetailsPanel = ({ workId, typeOfWork, onAdd, onEdit, onDelete }: WorkDetailsPanelProps) => {
    const config = getWorkTypeConfig(typeOfWork);
    const { data, isLoading, isError } = useQuery(workDetailsListQuery(workId));
    const details = (data ?? []) as WorkDetail[];

    const renderCell = (detail: WorkDetail, field: DisplayField) => {
        if (field.key === 'Teeth') {
            return <span className={styles.teethBadge}>{detail.Teeth || '-'}</span>;
        }
        if (field.key === 'canals_no') {
            return detail.canals_no ? `${detail.canals_no} canal${detail.canals_no > 1 ? 's' : ''}` : '-';
        }
        if (field.key === 'implant_length' || field.key === 'implant_diameter') {
            return detail[field.key] ? `${detail[field.key]} mm` : '-';
        }
        return detail[field.key] || '-';
    };

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <h4>
                    <i className={config.icon}></i>
                    {' '}{config.name} Items
                </h4>
                <button type="button" onClick={onAdd} className="btn btn-sm btn-primary">
                    <i className="fas fa-plus"></i> Add Item
                </button>
            </div>

            <div className={styles.tableContainer}>
                {isLoading ? (
                    <div className={styles.stateMsg}>Loading items…</div>
                ) : isError ? (
                    <div className={styles.stateMsg}>Failed to load items.</div>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                {config.displayFields.map((field) => (
                                    <th key={field.key}>{field.label}</th>
                                ))}
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {details.map((detail) => (
                                <tr key={detail.id}>
                                    {config.displayFields.map((field) => (
                                        <td key={field.key}>{renderCell(detail, field)}</td>
                                    ))}
                                    <td>
                                        {detail.completed_date ? (
                                            <span className={cn(styles.statusBadge, styles.statusCompleted)}>Completed</span>
                                        ) : detail.start_date ? (
                                            <span className={cn(styles.statusBadge, styles.statusStarted)}>Started</span>
                                        ) : (
                                            <span className={cn(styles.statusBadge, styles.statusPending)}>Pending</span>
                                        )}
                                    </td>
                                    <td>
                                        <div className={styles.actionButtons}>
                                            <button
                                                onClick={() => onEdit(detail)}
                                                className="btn btn-xs btn-secondary"
                                                title="Edit"
                                            >
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                onClick={() => onDelete(detail.id)}
                                                className="btn btn-xs btn-danger"
                                                title="Delete"
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {details.length === 0 && (
                                <tr>
                                    <td colSpan={config.displayFields.length + 2} className={styles.noData}>
                                        No treatment items recorded yet
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default WorkDetailsPanel;
