/**
 * Centralized type definitions for Aligner module
 * All aligner-related components and hooks should import from this file
 */

// =============================================================================
// DOCTOR TYPES
// =============================================================================

/**
 * Full AlignerDoctor type matching database schema
 */
export interface AlignerDoctor {
    DrID: number;
    DoctorName: string;
    DoctorEmail?: string | null;
    LogoPath?: string | null;
}

/**
 * Extended AlignerDoctor with UI-friendly aliases
 * Used in components that need both database fields and UI properties
 */
export interface AlignerDoctorWithAliases extends AlignerDoctor {
    id: number;      // Alias for DrID
    name: string;    // Alias for DoctorName
    logoPath?: string | null;  // camelCase alias for LogoPath
}

/**
 * Minimal doctor type for select dropdowns
 */
export type AlignerDoctorMinimal = Pick<AlignerDoctor, 'DrID' | 'DoctorName'>;

// =============================================================================
// SET TYPES
// =============================================================================

/**
 * Full AlignerSet type with all properties
 * This is the canonical type - use Pick<> for minimal versions
 */
export interface AlignerSet {
    AlignerSetID: number;
    SetSequence: number;
    Type?: string;
    UpperAlignersCount: number;
    LowerAlignersCount: number;
    RemainingUpperAligners: number;
    RemainingLowerAligners: number;
    Days?: number;
    AlignerDrID?: number;
    AlignerDoctorName?: string;
    SetUrl?: string;
    SetPdfUrl?: string;
    SetVideo?: string;
    SetCost?: number;
    Currency?: string;
    Notes?: string;
    ArchformID?: number | null;
    IsActive: boolean;
    CreationDate?: string;
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
    | 'AlignerSetID'
    | 'SetSequence'
    | 'Days'
    | 'RemainingUpperAligners'
    | 'RemainingLowerAligners'
    | 'AlignerDrID'
    | 'AlignerDoctorName'
    | 'IsActive'
>;

/**
 * Minimal set type for label printing
 * Used in useLabelModal
 */
export type AlignerSetForLabel = Pick<AlignerSet,
    | 'AlignerSetID'
    | 'SetSequence'
    | 'AlignerDrID'
    | 'AlignerDoctorName'
>;

/**
 * Set type for form editing
 * Used in SetFormDrawer - all optional except ID fields
 */
export interface AlignerSetFormData {
    AlignerSetID?: number;
    SetSequence: number;
    Type?: string;
    UpperAlignersCount?: number;
    LowerAlignersCount?: number;
    Days?: number;
    AlignerDrID?: number;
    SetUrl?: string;
    SetPdfUrl?: string;
    SetVideo?: string;
    SetCost?: number;
    Currency?: string;
    Notes?: string;
    IsActive?: boolean;
    CreationDate?: string;
    TotalBatches?: number;
}

// =============================================================================
// BATCH TYPES
// =============================================================================

/**
 * Full AlignerBatch type with all properties
 * This is the canonical type - use Pick<> for minimal versions
 */
export interface AlignerBatch {
    AlignerBatchID: number;
    AlignerSetID: number;
    BatchSequence: number;
    UpperAlignerCount?: number;
    LowerAlignerCount?: number;
    UpperAlignerStartSequence?: number;
    UpperAlignerEndSequence?: number;
    LowerAlignerStartSequence?: number;
    LowerAlignerEndSequence?: number;
    Days?: number;
    ValidityPeriod?: number;
    ManufactureDate?: string | null;
    DeliveredToPatientDate?: string | null;
    BatchExpiryDate?: string | null;
    Notes?: string;
    CreationDate?: string;
    // Form-specific fields (used in BatchFormDrawer)
    IsActive?: boolean;
    IsLast?: boolean;
    HasUpperTemplate?: boolean;
    HasLowerTemplate?: boolean;
}

/**
 * Minimal batch type for label printing
 * Used in useLabelModal
 */
export type AlignerBatchForLabel = Pick<AlignerBatch,
    | 'AlignerBatchID'
    | 'AlignerSetID'
    | 'BatchSequence'
    | 'UpperAlignerStartSequence'
    | 'UpperAlignerEndSequence'
    | 'LowerAlignerStartSequence'
    | 'LowerAlignerEndSequence'
>;

// =============================================================================
// NOTE TYPES
// =============================================================================

/**
 * Communication note between lab and doctor
 */
export interface AlignerNote {
    NoteID: number;
    AlignerSetID: number;
    NoteType: 'Lab' | 'Doctor';
    NoteText: string;
    DoctorName?: string;
    CreatedAt: string;
    IsRead: boolean;
    IsEdited?: boolean;
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
    AlignerSetID: number;
    WorkID: number;
    PersonID: number;
    ArchformID: number | null;
    PatientName: string;
    FirstName: string | null;
    LastName: string | null;
    SetSequence: number | null;
    DoctorName: string;
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
