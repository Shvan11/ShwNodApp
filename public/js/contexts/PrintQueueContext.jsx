/**
 * Print Queue Context
 * Global state for multi-batch label printing
 * Persists across patient navigation using sessionStorage
 *
 * Uses "rich labels" format: { text, patientName, doctorName, includeLogo }
 * Compatible with unified aligner-label-generator API
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const PrintQueueContext = createContext();

const STORAGE_KEY = 'labelPrintQueue';

/**
 * Build default labels from batch upper/lower ranges
 */
function buildDefaultLabels(batch) {
    const labels = [];
    const upperStart = batch.upperStart || 0;
    const upperEnd = batch.upperEnd || 0;
    const lowerStart = batch.lowerStart || 0;
    const lowerEnd = batch.lowerEnd || 0;

    // Create combined labels where sequences match
    const maxUpper = upperEnd - upperStart + 1;
    const maxLower = lowerEnd - lowerStart + 1;
    const maxSequence = Math.max(maxUpper, maxLower);

    for (let i = 0; i < maxSequence; i++) {
        const upperSeq = upperStart + i;
        const lowerSeq = lowerStart + i;
        const hasUpper = upperSeq <= upperEnd && upperStart > 0;
        const hasLower = lowerSeq <= lowerEnd && lowerStart > 0;

        if (hasUpper && hasLower) {
            labels.push(`U${upperSeq}/L${lowerSeq}`);
        } else if (hasUpper) {
            labels.push(`U${upperSeq}`);
        } else if (hasLower) {
            labels.push(`L${lowerSeq}`);
        }
    }

    return labels;
}

/**
 * Generate unique ID for queue items
 */
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Print Queue Provider Component
 * Manages global print queue state with sessionStorage persistence
 */
export function PrintQueueProvider({ children }) {
    const [queue, setQueue] = useState([]);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Load queue from sessionStorage on mount
    useEffect(() => {
        try {
            const stored = sessionStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    setQueue(parsed);
                }
            }
        } catch (e) {
            console.warn('Failed to load print queue from storage:', e);
        }
    }, []);

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
     * @param {Object} batch - Batch data (batchId, upperStart, upperEnd, lowerStart, lowerEnd, etc.)
     * @param {Object} patient - Patient data (code, name, etc.)
     * @param {Object} doctor - Doctor data (id, name, logoPath, etc.)
     * @param {Object} set - Set data (setId, etc.)
     */
    const addToQueue = useCallback((batch, patient, doctor, set) => {
        setQueue(prev => {
            // Check if batch already in queue
            if (prev.some(item => item.batchId === batch.batchId)) {
                return prev; // Already in queue
            }

            const labels = buildDefaultLabels(batch);
            const newItem = {
                id: generateId(),
                batchId: batch.batchId,
                batchNumber: batch.batchNumber || batch.batchId,
                patientId: patient.code || patient.patientId,
                patientName: patient.name || patient.patientName,
                doctorId: doctor?.id || doctor?.doctorId,
                doctorName: doctor?.name || doctor?.doctorName || '',
                setId: set?.setId,
                labels,
                includeLogo: !!doctor?.logoPath,
                addedAt: Date.now()
            };

            return [...prev, newItem];
        });
    }, []);

    /**
     * Remove a batch from the queue by id
     */
    const removeFromQueue = useCallback((id) => {
        setQueue(prev => prev.filter(item => item.id !== id));
    }, []);

    /**
     * Remove a batch by batchId
     */
    const removeByBatchId = useCallback((batchId) => {
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
    const isInQueue = useCallback((batchId) => {
        return queue.some(item => item.batchId === batchId);
    }, [queue]);

    /**
     * Toggle logo for a specific queue item
     */
    const toggleLogo = useCallback((id) => {
        setQueue(prev => prev.map(item =>
            item.id === id ? { ...item, includeLogo: !item.includeLogo } : item
        ));
    }, []);

    /**
     * Update labels for a specific queue item
     */
    const updateLabels = useCallback((id, labels) => {
        setQueue(prev => prev.map(item =>
            item.id === id ? { ...item, labels } : item
        ));
    }, []);

    /**
     * Get queue statistics
     */
    const getStats = useCallback(() => {
        const totalLabels = queue.reduce((sum, item) => sum + item.labels.length, 0);
        const uniquePatients = new Set(queue.map(item => item.patientId)).size;
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
    const getGroupedQueue = useCallback(() => {
        const grouped = {};
        queue.forEach(item => {
            if (!grouped[item.patientId]) {
                grouped[item.patientId] = {
                    patientId: item.patientId,
                    patientName: item.patientName,
                    batches: []
                };
            }
            grouped[item.patientId].batches.push(item);
        });
        return Object.values(grouped);
    }, [queue]);

    /**
     * Build flattened rich labels array for PDF generation
     * Each label is a rich object: { text, patientName, doctorName, includeLogo }
     */
    const buildLabelsForPrint = useCallback(() => {
        const labels = [];
        queue.forEach(item => {
            item.labels.forEach(labelText => {
                labels.push({
                    text: labelText,
                    patientName: item.patientName,
                    doctorName: item.doctorName || '',
                    includeLogo: item.includeLogo
                });
            });
        });
        return labels;
    }, [queue]);

    const value = {
        queue,
        addToQueue,
        removeFromQueue,
        removeByBatchId,
        clearQueue,
        isInQueue,
        toggleLogo,
        updateLabels,
        getStats,
        getGroupedQueue,
        buildLabelsForPrint,
        isExpanded,
        setIsExpanded,
        isModalOpen,
        setIsModalOpen
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
export function usePrintQueue() {
    const context = useContext(PrintQueueContext);

    if (!context) {
        throw new Error('usePrintQueue must be used within PrintQueueProvider');
    }

    return context;
}

export default PrintQueueContext;
