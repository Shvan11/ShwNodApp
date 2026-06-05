/**
 * Centralized type definitions for Aligner module
 * All aligner-related components and hooks should import from this file
 */

// =============================================================================
// DOCTOR TYPES
// =============================================================================

// Canonical API-boundary row types now live in the shared contract (the Phase-5
// "fold aligner.types.ts" goal). The contract's Zod row schemas (`alignerDoctorRow`,
// `alignerSetRow`, …) mirror these shapes EXACTLY via `z.infer`; the UI-only types
// below (aliases, form data, hook returns) stay inline — UI state, not an API
// boundary. We `import` them into local scope (the `WithAliases`/`Pick<>` helpers
// below reference them) AND re-export so existing `from '.../aligner.types'`
// imports keep resolving unchanged. See shared/contracts/aligner.contract.ts +
// docs/shared-contract-progress.md.
import type {
    AlignerDoctor,
    AlignerSet,
    AlignerBatch,
    AlignerNote,
    ArchformPatient,
    AlignerSetForMatch,
} from '@shared/contracts/aligner.contract';

export type {
    AlignerDoctor,
    AlignerSet,
    AlignerBatch,
    AlignerNote,
    ArchformPatient,
    AlignerSetForMatch,
};

/**
 * Extended AlignerDoctor with UI-friendly aliases
 * Used in components that need both database fields and UI properties
 */
export interface AlignerDoctorWithAliases extends AlignerDoctor {
    id: number;      // Alias for dr_id
    name: string;    // Alias for doctor_name
    logoPath?: string | null;  // camelCase alias for logo_path
}

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

/**
 * Minimal set type for label printing
 * Used in useLabelModal
 */
export type AlignerSetForLabel = Pick<AlignerSet,
    | 'aligner_set_id'
    | 'set_sequence'
    | 'aligner_dr_id'
    | 'AlignerDoctorName'
>;

/**
 * Set type for form editing
 * Used in SetFormDrawer - all optional except ID fields
 */
export interface AlignerSetFormData {
    aligner_set_id?: number;
    set_sequence: number;
    type?: string;
    upper_aligners_count?: number;
    lower_aligners_count?: number;
    days?: number;
    aligner_dr_id?: number;
    set_url?: string;
    set_pdf_url?: string;
    set_video?: string;
    set_cost?: number;
    currency?: string;
    notes?: string;
    is_active?: boolean;
    creation_date?: string;
    TotalBatches?: number;
}

// =============================================================================
// BATCH TYPES
// =============================================================================

/**
 * Minimal batch type for label printing
 * Used in useLabelModal
 */
export type AlignerBatchForLabel = Pick<AlignerBatch,
    | 'aligner_batch_id'
    | 'aligner_set_id'
    | 'batch_sequence'
    | 'upper_aligner_start_sequence'
    | 'upper_aligner_end_sequence'
    | 'lower_aligner_start_sequence'
    | 'lower_aligner_end_sequence'
>;

// =============================================================================
// NOTE TYPES
// =============================================================================

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

// =============================================================================
// ARCHFORM MATCHING TYPES
// =============================================================================

// =============================================================================
// HOOK RETURN TYPES (continued)
// =============================================================================

/**
 * Props for useBatchDrawer hook
 */
export interface UseBatchDrawerProps {
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
