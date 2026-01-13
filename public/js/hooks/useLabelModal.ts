/**
 * useLabelModal - Hook for managing LabelPreviewModal state
 */
import { useState, useCallback } from 'react';
import type {
    AlignerSet,
    AlignerBatch,
    LabelModalData,
    UseLabelModalReturn,
} from '../pages/aligner/aligner.types';

export function useLabelModal(): UseLabelModalReturn {
    const [showLabelModal, setShowLabelModal] = useState(false);
    const [labelModalData, setLabelModalData] = useState<LabelModalData>({
        batch: null,
        set: null,
    });

    const openLabelModal = useCallback((batch: AlignerBatch, set: AlignerSet): void => {
        setLabelModalData({ batch, set });
        setShowLabelModal(true);
    }, []);

    const closeLabelModal = useCallback((): void => {
        setShowLabelModal(false);
        setLabelModalData({ batch: null, set: null });
    }, []);

    return {
        showLabelModal,
        labelModalData,
        openLabelModal,
        closeLabelModal,
    };
}
