/**
 * Centralized type definitions for Aligner module
 * All aligner-related components and hooks should import from this file
 */

// =============================================================================
// DOCTOR TYPES
// =============================================================================

/**
 * Full AlignerDoctor type matching database schema (snake_case)
 */
export interface AlignerDoctor {
    dr_id: number;
    doctor_name: string;
    DoctorEmail?: string | null;
    LogoPath?: string | null;
}

/**
 * Extended AlignerDoctor with UI-friendly aliases
 * Used in components that need both database fields and UI properties
 */
export interface AlignerDoctorWithAliases extends AlignerDoctor {
    id: number;      // Alias for dr_id
    name: string;    // Alias for doctor_name
    logoPath?: string | null;  // camelCase alias for LogoPath
}

/**
 * Minimal doctor type for select dropdowns
 */
export type AlignerDoctorMinimal = Pick<AlignerDoctor, 'dr_id' | 'doctor_name'>;

// =============================================================================
// SET TYPES
// =============================================================================

/**
 * Full AlignerSet type matching backend snake_case response
 * This is the canonical type - use Pick<> for minimal versions
 */
export interface AlignerSet {
    aligner_set_id: number;
    set_sequence: number;
    type?: string;
    upper_aligners_count: number;
    lower_aligners_count: number;
    remaining_upper_aligners: number;
    remaining_lower_aligners: number;
    days?: number;
    aligner_dr_id?: number;
    AlignerDoctorName?: string;
    set_url?: string;
    set_pdf_url?: string;
    set_video?: string;
    set_cost?: number;
    currency?: string;
    notes?: string;
    archform_id?: number | null;
    is_active: boolean;
    creation_date?: string;
    TotalBatches?: number;
    DeliveredBatches?: number;
    TotalPaid?: number;
    Balance?: number;
    PaymentStatus?: string;
    UnreadActivityCount?: number;
}

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
 * Full AlignerBatch type matching backend snake_case response
 * This is the canonical type - use Pick<> for minimal versions
 */
export interface AlignerBatch {
    aligner_batch_id: number;
    aligner_set_id: number;
    batch_sequence: number;
    upper_aligner_count?: number;
    lower_aligner_count?: number;
    upper_aligner_start_sequence?: number;
    upper_aligner_end_sequence?: number;
    lower_aligner_start_sequence?: number;
    lower_aligner_end_sequence?: number;
    days?: number;
    validity_period?: number;
    manufacture_date?: string | null;
    delivered_to_patient_date?: string | null;
    batch_expiry_date?: string | null;
    notes?: string;
    creation_date?: string;
    // Form-specific fields (used in BatchFormDrawer)
    is_active?: boolean;
    is_last?: boolean;
    has_upper_template?: boolean;
    has_lower_template?: boolean;
}

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

/**
 * Communication note between lab and doctor
 */
export interface AlignerNote {
    note_id: number;
    aligner_set_id: number;
    note_type: 'Lab' | 'Doctor';
    note_text: string;
    doctor_name?: string;
    created_at: string;
    is_read: boolean;
    is_edited?: boolean;
}

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

/**
 * Patient record from Archform SQLite database
 */
export interface ArchformPatient {
    Id: number;
    Name: string;
    LastName: string;
    CreatedDate: string;
    LastModifiedDate: string | null;
}

/**
 * Aligner set with patient context for Archform matching
 */
export interface AlignerSetForMatch {
    aligner_set_id: number;
    work_id: number;
    person_id: number;
    archform_id: number | null;
    patient_name: string;
    first_name: string | null;
    last_name: string | null;
    set_sequence: number | null;
    doctor_name: string;
}

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
