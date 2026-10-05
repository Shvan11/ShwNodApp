/**
 * One set's batches — read through React Query (`qk.aligner.batches(setId)`), so a
 * write anywhere that invalidates the aligner prefix refreshes it, and a revisit
 * re-reads it (FE-F17-2: they were cached in page state for the mount's life).
 */
import { useQuery } from '@tanstack/react-query';
import { alignerBatchesQuery } from '@/query/queries';
import type { AlignerBatch, AlignerSet } from '../aligner.types';
import { formatSetDate } from './setHelpers';

interface BatchListProps {
    set: AlignerSet;
    onAddBatch: () => void;
    onEditBatch: (batch: AlignerBatch) => void;
    onMarkManufactured: (batch: AlignerBatch) => void;
    onMarkDelivered: (batch: AlignerBatch) => void;
    onDeleteBatch: (batch: AlignerBatch) => void;
    onPrintLabels: (batch: AlignerBatch) => void;
    onToggleQueue: (batch: AlignerBatch) => void;
    isInQueue: (batchId: number) => boolean;
}

export default function BatchList({
    set,
    onAddBatch,
    onEditBatch,
    onMarkManufactured,
    onMarkDelivered,
    onDeleteBatch,
    onPrintLabels,
    onToggleQueue,
    isInQueue,
}: BatchListProps) {
    const { data, isPending, isError, refetch } = useQuery(alignerBatchesQuery(set.aligner_set_id));
    const batches = data?.batches ?? [];

    return (
        <div className="batches-container expanded">
            <div className="batches-header">
                <h5>Batches</h5>
                <button
                    type="button"
                    className="btn btn-success btn-sm"
                    onClick={onAddBatch}
                    disabled={!set.is_active}
                    title={!set.is_active ? 'Cannot add batches to inactive sets' : 'Add new batch'}
                >
                    <i className="fas fa-plus" aria-hidden="true"></i> Add Batch
                </button>
            </div>
            {isPending ? (
                <div className="loading">
                    <div className="spinner"></div>
                    <p>Loading batches...</p>
                </div>
            ) : isError ? (
                <p className="empty-state">
                    Could not load the batches.{' '}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refetch()}>
                        Retry
                    </button>
                </p>
            ) : batches.length === 0 ? (
                <p className="empty-state">No batches found for this set</p>
            ) : (
                batches.map((batch) => {
                    const isManufactured = batch.manufacture_date != null;
                    const isDelivered = batch.delivered_to_patient_date != null;
                    // Three states: pending-manufacture, pending-delivery, delivered
                    const batchState = !isManufactured ? 'pending-manufacture' : !isDelivered ? 'pending-delivery' : 'delivered';
                    const batchStateLabel = !isManufactured ? 'Pending Manufacture' : !isDelivered ? 'Pending Delivery' : 'Delivered';
                    const queued = isInQueue(batch.aligner_batch_id);
                    return (
                        <div key={batch.aligner_batch_id} className={`batch-item ${batchState}`}>
                            <div className="batch-header">
                                <div className="batch-title">Batch #{batch.batch_sequence}</div>
                                <div className="batch-actions">
                                    <span className={`batch-status ${batchState}`}>{batchStateLabel}</span>
                                    {!isManufactured && (
                                        <button
                                            type="button"
                                            className="action-icon-btn manufacture"
                                            onClick={() => onMarkManufactured(batch)}
                                            title="Mark as Manufactured (sets today's date)"
                                            aria-label={`Mark batch ${batch.batch_sequence} as manufactured`}
                                        >
                                            <i className="fas fa-industry" aria-hidden="true"></i>
                                        </button>
                                    )}
                                    {isManufactured && !isDelivered && (
                                        <button
                                            type="button"
                                            className="action-icon-btn deliver"
                                            onClick={() => onMarkDelivered(batch)}
                                            title="Mark as Delivered (sets today's date)"
                                            aria-label={`Mark batch ${batch.batch_sequence} as delivered`}
                                        >
                                            <i className="fas fa-truck" aria-hidden="true"></i>
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className={`action-icon-btn queue-labels ${queued ? 'in-queue' : ''}`}
                                        onClick={() => onToggleQueue(batch)}
                                        title={queued ? 'Remove from print queue' : 'Add to print queue'}
                                        aria-label={queued ? 'Remove from print queue' : 'Add to print queue'}
                                        aria-pressed={queued}
                                    >
                                        <i className={queued ? 'fas fa-check' : 'fas fa-cart-plus'} aria-hidden="true"></i>
                                    </button>
                                    <button
                                        type="button"
                                        className="action-icon-btn print-labels bg-purple"
                                        onClick={() => onPrintLabels(batch)}
                                        title="Print Labels (PDF)"
                                        aria-label="Print labels"
                                    >
                                        <i className="fas fa-print" aria-hidden="true"></i>
                                    </button>
                                    <button
                                        type="button"
                                        className="action-icon-btn edit"
                                        onClick={() => onEditBatch(batch)}
                                        title="Edit Batch"
                                        aria-label={`Edit batch ${batch.batch_sequence}`}
                                    >
                                        <i className="fas fa-edit" aria-hidden="true"></i>
                                    </button>
                                    <button
                                        type="button"
                                        className="action-icon-btn delete"
                                        onClick={() => onDeleteBatch(batch)}
                                        title="Delete Batch"
                                        aria-label={`Delete batch ${batch.batch_sequence}`}
                                    >
                                        <i className="fas fa-times" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>
                            <div className="batch-details">
                                <div className="batch-detail">
                                    <i className="fas fa-teeth" aria-hidden="true"></i>
                                    <span>Upper: {batch.upper_aligner_start_sequence}-{batch.upper_aligner_end_sequence} ({batch.upper_aligner_count})</span>
                                </div>
                                <div className="batch-detail">
                                    <i className="fas fa-teeth" aria-hidden="true"></i>
                                    <span>Lower: {batch.lower_aligner_start_sequence}-{batch.lower_aligner_end_sequence} ({batch.lower_aligner_count})</span>
                                </div>
                                {batch.creation_date && (
                                    <div className="batch-detail">
                                        <i className="fas fa-plus-circle" aria-hidden="true"></i>
                                        <span>Created: {formatSetDate(batch.creation_date)}</span>
                                    </div>
                                )}
                                <div className="batch-detail">
                                    <i className="fas fa-industry" aria-hidden="true"></i>
                                    <span>Manufactured: {batch.manufacture_date ? formatSetDate(batch.manufacture_date) : 'Not yet'}</span>
                                </div>
                                {isDelivered && (
                                    <div className="batch-detail">
                                        <i className="fas fa-truck" aria-hidden="true"></i>
                                        <span>Delivered: {formatSetDate(batch.delivered_to_patient_date)}</span>
                                    </div>
                                )}
                                <div className="batch-detail">
                                    <i className="fas fa-clock" aria-hidden="true"></i>
                                    <span>Days: {batch.days || 'N/A'}</span>
                                </div>
                                <div className="batch-detail">
                                    <i className="fas fa-hourglass-half" aria-hidden="true"></i>
                                    <span>Validity: {batch.validity_period || 'N/A'} days</span>
                                </div>
                                {batch.batch_expiry_date && (
                                    <div className="batch-detail">
                                        <i className="fas fa-calendar-check" aria-hidden="true"></i>
                                        <span>Batch Expiry: {formatSetDate(batch.batch_expiry_date)}</span>
                                    </div>
                                )}
                                {batch.notes && (
                                    <div className="batch-detail batch-detail-full">
                                        <i className="fas fa-sticky-note" aria-hidden="true"></i>
                                        <span>Notes: {batch.notes}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })
            )}
        </div>
    );
}
