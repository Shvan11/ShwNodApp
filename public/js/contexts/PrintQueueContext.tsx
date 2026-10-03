/**
 * Print Queue Context
 * Global state for multi-batch label printing
 * Persists across patient navigation using sessionStorage
 *
 * Uses "rich labels" format: { text, patientName, doctorName, includeLogo }
 * Compatible with unified aligner-label-generator API
 *
 * Surface is deliberately minimal: `toggleLogo`, `updateLabels`,
 * `buildLabelsForPrint`, `isModalOpen`/`setIsModalOpen`, the `addedAt` field and
 * a `RichLabel` type were removed in the F3 audit — none had a consumer. The
 * label-building belongs to LabelPreviewModal (it builds from its own EDITED copy
 * of the queue) and the modal flag to RootLayout. What the two share lives here:
 * the item type (`PrintQueueItem`, which the modal takes as `queuedItems`) and
 * `groupByPatient` (the indicator groups the live queue, the modal its edited
 * copy — audit FE-F3-14). If you re-add a helper, wire it to the modal rather
 * than leaving a second implementation behind.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { buildLabelsFromRanges } from '../utils/aligner-labels';

// Types for the print queue.
// Sequence bounds are null when the batch has no aligners for that arch —
// 0 is a REAL start (template batches number from 0), so don't `|| 0` them.
export interface PrintQueueBatch {
    upperStart?: number | null;
    upperEnd?: number | null;
    lowerStart?: number | null;
    lowerEnd?: number | null;
    batchId: number | string;
    batchNumber?: number;
}

export interface PrintQueuePatient {
    code?: number | string;
    personId?: number;
    name?: string;
    patientName?: string;
}

export interface PrintQueueDoctor {
    id?: number;
    doctorId?: number;
    name?: string;
    doctorName?: string;
    logoPath?: string | null;
}

export interface PrintQueueSet {
    setId?: number;
}

export interface PrintQueueItem {
    id: string;
    batchId: number | string;
    batchNumber: number | string;
    personId: number;
    patientName: string;
    doctorId?: number;
    doctorName: string;
    setId?: number;
    labels: string[];
    includeLogo: boolean;
}

export interface PrintQueueStats {
    batchCount: number;
    totalLabels: number;
    patientCount: number;
    doctorCount: number;
}

/** Queue items of one patient, in queue order. */
export interface PatientGroupOf<T> {
    personId: number;
    patientName: string;
    batches: T[];
}

export type PatientGroup = PatientGroupOf<PrintQueueItem>;

/**
 * Group queue items by patient, keeping first-seen patient order and queue order
 * within each. Generic so the label modal can group its edited copies with the
 * same rule the indicator uses for the live queue.
 */
export function groupByPatient<T extends { personId: number; patientName: string }>(
    items: readonly T[]
): PatientGroupOf<T>[] {
    const grouped = new Map<number, PatientGroupOf<T>>();
    for (const item of items) {
        let group = grouped.get(item.personId);
        if (!group) {
            group = { personId: item.personId, patientName: item.patientName, batches: [] };
            grouped.set(item.personId, group);
        }
        group.batches.push(item);
    }
    return [...grouped.values()];
}

export interface PrintQueueContextValue {
    queue: PrintQueueItem[];
    addToQueue: (batch: PrintQueueBatch, patient: PrintQueuePatient, doctor: PrintQueueDoctor | null, set: PrintQueueSet | null) => void;
    removeFromQueue: (id: string) => void;
    removeByBatchId: (batchId: number | string) => void;
    clearQueue: () => void;
    isInQueue: (batchId: number | string) => boolean;
    getStats: () => PrintQueueStats;
    getGroupedQueue: () => PatientGroup[];
    isExpanded: boolean;
    setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

const PrintQueueContext = createContext<PrintQueueContextValue | undefined>(undefined);

const STORAGE_KEY = 'labelPrintQueue';

/**
 * Build default label texts from batch upper/lower ranges — same
 * sequence-keyed builder as LabelPreviewModal, so a template batch's
 * sequence 0 is kept and U/L pair by actual sequence number.
 */
function buildDefaultLabels(batch: PrintQueueBatch): string[] {
    return buildLabelsFromRanges(
        batch.upperStart,
        batch.upperEnd,
        batch.lowerStart,
        batch.lowerEnd
    ).map(label => label.text);
}

/**
 * Generate unique ID for queue items
 */
function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

interface PrintQueueProviderProps {
    children: ReactNode;
}

/**
 * Print Queue Provider Component
 * Manages global print queue state with sessionStorage persistence
 */
export function PrintQueueProvider({ children }: PrintQueueProviderProps) {
    // Load queue from sessionStorage once, via a lazy initializer (no mount effect
    // just to seed local state).
    const [queue, setQueue] = useState<PrintQueueItem[]>(() => {
        try {
            const stored = sessionStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            }
        } catch (e) {
            console.warn('Failed to load print queue from storage:', e);
        }
        return [];
    });
    const [isExpanded, setIsExpanded] = useState(false);

    // Save queue to sessionStorage on change
    useEffect(() => {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
        } catch (e) {
            console.warn('Failed to save print queue to storage:', e);
        }
    }, [queue]);

    /**
     * Add a batch to the print queue
     */
    const addToQueue = useCallback((
        batch: PrintQueueBatch,
        patient: PrintQueuePatient,
        doctor: PrintQueueDoctor | null,
        set: PrintQueueSet | null
    ) => {
        setQueue(prev => {
            // Check if batch already in queue
            if (prev.some(item => item.batchId === batch.batchId)) {
                return prev; // Already in queue
            }

            const labels = buildDefaultLabels(batch);
            // Format doctor name with "Dr. " prefix if not already present
            const rawDoctorName = doctor?.name || doctor?.doctorName || '';
            const formattedDoctorName = rawDoctorName && !rawDoctorName.startsWith('Dr.') && !rawDoctorName.startsWith('Dr ')
                ? `Dr. ${rawDoctorName}`
                : rawDoctorName;

            const newItem: PrintQueueItem = {
                id: generateId(),
                batchId: batch.batchId,
                batchNumber: batch.batchNumber || batch.batchId,
                personId: Number(patient.code || patient.personId || 0),
                patientName: patient.name || patient.patientName || '',
                doctorId: doctor?.id || doctor?.doctorId,
                doctorName: formattedDoctorName,
                setId: set?.setId,
                labels,
                includeLogo: !!doctor?.logoPath,
            };

            return [...prev, newItem];
        });
    }, []);

    /**
     * Remove a batch from the queue by id
     */
    const removeFromQueue = useCallback((id: string) => {
        setQueue(prev => prev.filter(item => item.id !== id));
    }, []);

    /**
     * Remove a batch by batchId
     */
    const removeByBatchId = useCallback((batchId: number | string) => {
        setQueue(prev => prev.filter(item => item.batchId !== batchId));
    }, []);

    /**
     * Clear entire queue
     */
    const clearQueue = useCallback(() => {
        setQueue([]);
        setIsExpanded(false);
    }, []);

    /**
     * Check if a batch is already in queue
     */
    const isInQueue = useCallback((batchId: number | string) => {
        return queue.some(item => item.batchId === batchId);
    }, [queue]);

    /**
     * Get queue statistics
     */
    const getStats = useCallback((): PrintQueueStats => {
        const totalLabels = queue.reduce((sum, item) => sum + item.labels.length, 0);
        const uniquePatients = new Set(queue.map(item => item.personId)).size;
        const uniqueDoctors = new Set(queue.filter(item => item.doctorId).map(item => item.doctorId)).size;

        return {
            batchCount: queue.length,
            totalLabels,
            patientCount: uniquePatients,
            doctorCount: uniqueDoctors
        };
    }, [queue]);

    /**
     * Get queue grouped by patient
     */
    const getGroupedQueue = useCallback((): PatientGroup[] => groupByPatient(queue), [queue]);

    const value: PrintQueueContextValue = {
        queue,
        addToQueue,
        removeFromQueue,
        removeByBatchId,
        clearQueue,
        isInQueue,
        getStats,
        getGroupedQueue,
        isExpanded,
        setIsExpanded
    };

    return (
        <PrintQueueContext.Provider value={value}>
            {children}
        </PrintQueueContext.Provider>
    );
}

/**
 * Hook to access print queue
 * Usage: const { addToQueue, queue, isInQueue } = usePrintQueue();
 */
export function usePrintQueue(): PrintQueueContextValue {
    const context = useContext(PrintQueueContext);

    if (!context) {
        throw new Error('usePrintQueue must be used within PrintQueueProvider');
    }

    return context;
}

export default PrintQueueContext;
