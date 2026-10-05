/**
 * Centralized type definitions for Aligner module
 * All aligner-related components and hooks should import from this file
 */

// =============================================================================
// DOCTOR TYPES
// =============================================================================

// Canonical API-boundary row types live in the shared contract. The contract's Zod
// row schemas (`alignerDoctorRow`, `alignerSetRow`, …) define them via `z.infer`;
// the UI-only types below (form data, hook returns) stay inline — UI state, not an
// API boundary. They are re-exported so `from '.../aligner.types'` imports resolve.
import type {
    AlignerDoctor,
    AlignerSet,
    AlignerBatch,
    AlignerNote,
    ArchformPatient,
    AlignerSetForMatch,
    AlignerPhoto,
} from '@shared/contracts/aligner.contract';

export type {
    AlignerDoctor,
    AlignerSet,
    AlignerBatch,
    AlignerNote,
    ArchformPatient,
    AlignerSetForMatch,
    AlignerPhoto,
};

/**
 * Minimal doctor type for select dropdowns
 */
export type AlignerDoctorMinimal = Pick<AlignerDoctor, 'dr_id' | 'doctor_name'>;

// =============================================================================
// SET TYPES
// =============================================================================

/**
 * Minimal set type for batch operations
 * Used in useBatchDrawer and BatchFormDrawer
 */
export type AlignerSetForBatch = Pick<AlignerSet,
    | 'aligner_set_id'
    | 'set_sequence'
    | 'days'
    | 'remaining_upper_aligners'
    | 'remaining_lower_aligners'
    | 'aligner_dr_id'
    | 'AlignerDoctorName'
    | 'is_active'
>;

// =============================================================================
// HOOK RETURN TYPES
// =============================================================================

/**
 * Label modal data structure
 */
export interface LabelModalData {
    batch: AlignerBatch | null;
    set: AlignerSet | null;
}

/**
 * Return type for useLabelModal hook
 */
export interface UseLabelModalReturn {
    showLabelModal: boolean;
    labelModalData: LabelModalData;
    openLabelModal: (batch: AlignerBatch, set: AlignerSet) => void;
    closeLabelModal: () => void;
}

/**
 * Props for useSetDrawer hook
 */
export interface UseSetDrawerProps {
    onRefresh: () => void;
}

/**
 * Return type for useSetDrawer hook
 */
export interface UseSetDrawerReturn {
    showSetDrawer: boolean;
    editingSet: AlignerSet | null;
    openAddSetDrawer: () => void;
    openEditSetDrawer: (set: AlignerSet) => void;
    closeSetDrawer: () => void;
    handleSetSaved: () => void;
}

/**
 * Props for useBatchDrawer hook
 */
export interface UseBatchDrawerProps {
    /** After a save: refresh what it changed (the page invalidates the aligner reads). */
    onRefresh: (setId: number) => Promise<void>;
}

/**
 * Return type for useBatchDrawer hook
 */
export interface UseBatchDrawerReturn {
    showBatchDrawer: boolean;
    editingBatch: AlignerBatch | null;
    currentSetForBatch: AlignerSetForBatch | null;
    openAddBatchDrawer: (set: AlignerSetForBatch) => void;
    openEditBatchDrawer: (batch: AlignerBatch, set: AlignerSetForBatch) => void;
    closeBatchDrawer: () => void;
    handleBatchSaved: () => Promise<void>;
}
