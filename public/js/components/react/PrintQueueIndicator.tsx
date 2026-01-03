/**
 * Print Queue Indicator Component
 * Floating UI showing queued batches for multi-batch label printing
 * Visible when queue has items, positioned at bottom-right
 */

import { useState } from 'react';
import type { FocusEvent } from 'react';
import cn from 'classnames';
import {
    usePrintQueue,
    type PrintQueueItem,
    type PatientGroup
} from '../../contexts/PrintQueueContext';

// CSS Module import
import styles from './PrintQueueIndicator.module.css';

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
        <div className={styles.item}>
            <div className={styles.itemInfo}>
                <span className={styles.itemBatch}>Batch #{item.batchNumber}</span>
                <span className={styles.itemLabels}>{item.labels.length} labels</span>
            </div>
            <button
                className={styles.itemRemove}
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
        <div className={styles.patientGroup}>
            <div className={styles.patientName}>{group.patientName}</div>
            <div className={styles.patientBatches}>
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
        <div className={cn(styles.container, { [styles.expanded]: isExpanded })}>
            {/* Collapsed badge */}
            <button
                className={styles.badge}
                onClick={handleToggleExpand}
                aria-expanded={isExpanded}
                aria-label={`Print queue: ${stats.batchCount} batches, ${stats.totalLabels} labels`}
            >
                <svg className={styles.badgeIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="6" y="2" width="12" height="6" rx="1" />
                    <rect x="4" y="8" width="16" height="12" rx="1" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                    <line x1="9" y1="17" x2="12" y2="17" />
                </svg>
                <span className={styles.badgeText}>
                    {stats.batchCount} {stats.batchCount === 1 ? 'batch' : 'batches'}
                    <span className={styles.badgeLabels}>({stats.totalLabels} labels)</span>
                </span>
                <svg
                    className={cn(styles.badgeChevron, { up: isExpanded })}
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
                <div className={styles.panel}>
                    <div className={styles.panelHeader}>
                        <h3>Print Queue</h3>
                        {stats.patientCount > 1 && (
                            <span className={styles.panelSubtitle}>
                                {stats.patientCount} patients
                            </span>
                        )}
                    </div>

                    <div className={styles.panelContent}>
                        {groupedQueue.map(group => (
                            <PatientGroupComponent
                                key={group.personId}
                                group={group}
                                onRemove={removeFromQueue}
                            />
                        ))}
                    </div>

                    <div className={styles.panelActions}>
                        <button
                            className={cn(styles.btnClear, { [styles.confirm]: showClearConfirm })}
                            onClick={handleClearClick}
                            onBlur={handleClearBlur}
                        >
                            {showClearConfirm ? 'Confirm Clear' : 'Clear All'}
                        </button>
                        <button
                            className={styles.btnPrint}
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
