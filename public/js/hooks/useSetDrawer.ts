/**
 * useSetDrawer - Hook for managing SetFormDrawer state
 */
import { useState, useCallback } from 'react';
import type {
    AlignerSet,
    UseSetDrawerProps,
    UseSetDrawerReturn,
} from '../pages/aligner/aligner.types';

export function useSetDrawer({ onRefresh }: UseSetDrawerProps): UseSetDrawerReturn {
    const [showSetDrawer, setShowSetDrawer] = useState(false);
    const [editingSet, setEditingSet] = useState<AlignerSet | null>(null);

    const openAddSetDrawer = useCallback((): void => {
        setEditingSet(null);
        setShowSetDrawer(true);
    }, []);

    const openEditSetDrawer = useCallback((set: AlignerSet): void => {
        setEditingSet(set);
        setShowSetDrawer(true);
    }, []);

    const closeSetDrawer = useCallback((): void => {
        setShowSetDrawer(false);
        setEditingSet(null);
    }, []);

    const handleSetSaved = useCallback((): void => {
        setShowSetDrawer(false);
        setEditingSet(null);
        onRefresh();
    }, [onRefresh]);

    return {
        showSetDrawer,
        editingSet,
        openAddSetDrawer,
        openEditSetDrawer,
        closeSetDrawer,
        handleSetSaved,
    };
}
