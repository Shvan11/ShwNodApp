/**
 * useLabelModal - Hook for managing LabelPreviewModal state
 */
import { useState } from 'react';
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

    // Plain functions: the React Compiler memoizes them (FE-F20-11).
    const openLabelModal = (batch: AlignerBatch, set: AlignerSet): void => {
        setLabelModalData({ batch, set });
        setShowLabelModal(true);
    };

    const closeLabelModal = (): void => {
        setShowLabelModal(false);
        setLabelModalData({ batch: null, set: null });
    };

    return {
        showLabelModal,
        labelModalData,
        openLabelModal,
        closeLabelModal,
    };
}
