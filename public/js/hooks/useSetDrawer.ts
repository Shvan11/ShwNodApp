/**
 * useSetDrawer - Hook for managing SetFormDrawer state
 */
import { useState } from 'react';
import type {
    AlignerSet,
    UseSetDrawerProps,
    UseSetDrawerReturn,
} from '../pages/aligner/aligner.types';

export function useSetDrawer({ onRefresh }: UseSetDrawerProps): UseSetDrawerReturn {
    const [showSetDrawer, setShowSetDrawer] = useState(false);
    const [editingSet, setEditingSet] = useState<AlignerSet | null>(null);

    const openAddSetDrawer = (): void => {
        setEditingSet(null);
        setShowSetDrawer(true);
    };

    const openEditSetDrawer = (set: AlignerSet): void => {
        setEditingSet(set);
        setShowSetDrawer(true);
    };

    const closeSetDrawer = (): void => {
        setShowSetDrawer(false);
        setEditingSet(null);
    };

    const handleSetSaved = (): void => {
        closeSetDrawer();
        onRefresh();
    };

    return {
        showSetDrawer,
        editingSet,
        openAddSetDrawer,
        openEditSetDrawer,
        closeSetDrawer,
        handleSetSaved,
    };
}
