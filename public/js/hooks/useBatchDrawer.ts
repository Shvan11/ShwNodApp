/**
 * useBatchDrawer - Hook for managing BatchFormDrawer state
 */
import { useState } from 'react';
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

    const openAddBatchDrawer = (set: AlignerSetForBatch): void => {
        setCurrentSetForBatch(set);
        setEditingBatch(null);
        setShowBatchDrawer(true);
    };

    const openEditBatchDrawer = (batch: AlignerBatch, set: AlignerSetForBatch): void => {
        setCurrentSetForBatch(set);
        setEditingBatch(batch);
        setShowBatchDrawer(true);
    };

    const closeBatchDrawer = (): void => {
        setShowBatchDrawer(false);
        setEditingBatch(null);
        setCurrentSetForBatch(null);
    };

    /** A save (create/update) is done: close, and refresh what it changed. */
    const handleBatchSaved = async (): Promise<void> => {
        const setId = currentSetForBatch?.aligner_set_id;
        closeBatchDrawer();
        if (setId) await onRefresh(setId);
    };

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
