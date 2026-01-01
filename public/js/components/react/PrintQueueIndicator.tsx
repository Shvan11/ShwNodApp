/**
 * Print Queue Indicator Component
 * Floating UI showing queued batches for multi-batch label printing
 * Visible when queue has items, positioned at bottom-right
 */

import { useState } from 'react';
import type { FocusEvent } from 'react';
import {
    usePrintQueue,
    type PrintQueueItem,
    type PatientGroup
} from '../../contexts/PrintQueueContext';

// Import CSS
import '../../../css/components/print-queue-indicator.css';

interface QueueItemProps {
    item: PrintQueueItem;
    onRemove: (id: string) => void;
}

/**
 * Queue Item Component
 * Individual batch in the expanded queue panel
 */
function QueueItemComponent({ item, onRemove }: QueueItemProps) {
    return (
        <div className="queue-item">
            <div className="queue-item-info">
                <span className="queue-item-batch">Batch #{item.batchNumber}</span>
                <span className="queue-item-labels">{item.labels.length} labels</span>
            </div>
            <button
                className="queue-item-remove"
                onClick={() => onRemove(item.id)}
                title="Remove from queue"
                aria-label="Remove batch from queue"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>
    );
}

interface PatientGroupProps {
    group: PatientGroup;
    onRemove: (id: string) => void;
}

/**
 * Patient Group Component
 * Groups batches by patient in the expanded panel
 */
function PatientGroupComponent({ group, onRemove }: PatientGroupProps) {
    return (
        <div className="queue-patient-group">
            <div className="queue-patient-name">{group.patientName}</div>
            <div className="queue-patient-batches">
                {group.batches.map(item => (
                    <QueueItemComponent key={item.id} item={item} onRemove={onRemove} />
                ))}
            </div>
        </div>
    );
}

interface PrintQueueIndicatorProps {
    onPrintAll?: () => void;
}

/**
 * Main Print Queue Indicator Component
 */
export default function PrintQueueIndicator({ onPrintAll }: PrintQueueIndicatorProps) {
    const {
        queue,
        getStats,
        getGroupedQueue,
        clearQueue,
        removeFromQueue,
        isExpanded,
        setIsExpanded
    } = usePrintQueue();

    const [showClearConfirm, setShowClearConfirm] = useState(false);

    // Don't render if queue is empty
    if (queue.length === 0) {
        return null;
    }

    const stats = getStats();
    const groupedQueue = getGroupedQueue();

    const handleToggleExpand = () => {
        setIsExpanded(!isExpanded);
        setShowClearConfirm(false);
    };

    const handleClearClick = () => {
        if (showClearConfirm) {
            clearQueue();
            setShowClearConfirm(false);
        } else {
            setShowClearConfirm(true);
        }
    };

    const handleClearBlur = (_e: FocusEvent<HTMLButtonElement>) => {
        setShowClearConfirm(false);
    };

    const handlePrintAll = () => {
        if (onPrintAll) {
            onPrintAll();
        }
    };

    return (
        <div className={`print-queue-indicator ${isExpanded ? 'expanded' : ''}`}>
            {/* Collapsed badge */}
            <button
                className="queue-badge"
                onClick={handleToggleExpand}
                aria-expanded={isExpanded}
                aria-label={`Print queue: ${stats.batchCount} batches, ${stats.totalLabels} labels`}
            >
                <svg className="queue-badge-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="6" y="2" width="12" height="6" rx="1" />
                    <rect x="4" y="8" width="16" height="12" rx="1" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                    <line x1="9" y1="17" x2="12" y2="17" />
                </svg>
                <span className="queue-badge-text">
                    {stats.batchCount} {stats.batchCount === 1 ? 'batch' : 'batches'}
                    <span className="queue-badge-labels">({stats.totalLabels} labels)</span>
                </span>
                <svg
                    className={`queue-badge-chevron ${isExpanded ? 'up' : 'down'}`}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {/* Expanded panel */}
            {isExpanded && (
                <div className="queue-panel">
                    <div className="queue-panel-header">
                        <h3>Print Queue</h3>
                        {stats.patientCount > 1 && (
                            <span className="queue-panel-subtitle">
                                {stats.patientCount} patients
                            </span>
                        )}
                    </div>

                    <div className="queue-panel-content">
                        {groupedQueue.map(group => (
                            <PatientGroupComponent
                                key={group.patientId}
                                group={group}
                                onRemove={removeFromQueue}
                            />
                        ))}
                    </div>

                    <div className="queue-panel-actions">
                        <button
                            className={`queue-btn-clear ${showClearConfirm ? 'confirm' : ''}`}
                            onClick={handleClearClick}
                            onBlur={handleClearBlur}
                        >
                            {showClearConfirm ? 'Confirm Clear' : 'Clear All'}
                        </button>
                        <button
                            className="queue-btn-print"
                            onClick={handlePrintAll}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="6 9 6 2 18 2 18 9" />
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                                <rect x="6" y="14" width="12" height="8" />
                            </svg>
                            Print All Labels
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
