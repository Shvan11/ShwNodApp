/**
 * useBatchDrawer - Hook for managing BatchFormDrawer state
 */
import { useState, useCallback } from 'react';
import type {
    AlignerBatch,
    AlignerSetForBatch,
    UseBatchDrawerProps,
    UseBatchDrawerReturn,
} from '../pages/aligner/aligner.types';

export function useBatchDrawer({ onRefresh }: UseBatchDrawerProps): UseBatchDrawerReturn {
    const [showBatchDrawer, setShowBatchDrawer] = useState(false);
    const [editingBatch, setEditingBatch] = useState<AlignerBatch | null>(null);
    const [currentSetForBatch, setCurrentSetForBatch] = useState<AlignerSetForBatch | null>(null);

    const openAddBatchDrawer = useCallback((set: AlignerSetForBatch): void => {
        setCurrentSetForBatch(set);
        setEditingBatch(null);
        setShowBatchDrawer(true);
    }, []);

    const openEditBatchDrawer = useCallback((batch: AlignerBatch, set: AlignerSetForBatch): void => {
        setCurrentSetForBatch(set);
        setEditingBatch(batch);
        setShowBatchDrawer(true);
    }, []);

    const closeBatchDrawer = useCallback((): void => {
        setShowBatchDrawer(false);
        setEditingBatch(null);
        setCurrentSetForBatch(null);
    }, []);

    const handleBatchSaved = useCallback(async (): Promise<void> => {
        const setId = currentSetForBatch?.AlignerSetID;
        setShowBatchDrawer(false);
        setEditingBatch(null);
        setCurrentSetForBatch(null);
        if (setId) await onRefresh(setId);
    }, [currentSetForBatch, onRefresh]);

    return {
        showBatchDrawer,
        editingBatch,
        currentSetForBatch,
        openAddBatchDrawer,
        openEditBatchDrawer,
        closeBatchDrawer,
        handleBatchSaved,
    };
}
