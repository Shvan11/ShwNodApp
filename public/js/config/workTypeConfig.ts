/**
 * Work Type Configuration
 * Defines features and fields for each work type
 */

// Work Type IDs from tblWorkType
export const WORK_TYPE_IDS = {
  ORTHO_BRACES: 1,
  ORTHO_PHASE1: 2,
  SCALING: 3,
  FILLING: 4,
  ENDO: 5,
  BLEACHING: 6,
  EXO: 7,
  GINGIVECTOMY: 8,
  VENEERS: 9,
  SURGERY: 10,
  RELAPSE: 11,
  RETAINER: 12,
  OTHER: 13,
  OPG: 14,
  IMPLANT: 15,
  BRIDGE: 17,
  CBCT: 18,
  ORTHO_ALIGNERS: 19,
  ORTHO_MIXED: 20,
  ALIGNER_LAB: 21,
  CEPHALO: 22,
} as const;

export type WorkTypeId = (typeof WORK_TYPE_IDS)[keyof typeof WORK_TYPE_IDS];

// Ortho-related work types that need visits and diagnosis
// Note: Aligner Lab (21) is NOT included - it's lab work, not patient treatment
export const ORTHO_WORK_TYPES: readonly WorkTypeId[] = [
  WORK_TYPE_IDS.ORTHO_BRACES, // 1
  WORK_TYPE_IDS.ORTHO_PHASE1, // 2
  WORK_TYPE_IDS.RELAPSE, // 11
  WORK_TYPE_IDS.ORTHO_ALIGNERS, // 19
  WORK_TYPE_IDS.ORTHO_MIXED, // 20
] as const;

// Work types that need detail records (work items)
export const DETAIL_WORK_TYPES: readonly WorkTypeId[] = [
  WORK_TYPE_IDS.FILLING,
  WORK_TYPE_IDS.ENDO,
  WORK_TYPE_IDS.EXO,
  WORK_TYPE_IDS.SURGERY,
  WORK_TYPE_IDS.IMPLANT,
  WORK_TYPE_IDS.BRIDGE,
  WORK_TYPE_IDS.VENEERS, // Veneers also use material/lab like crowns
] as const;

// Helper functions
export const isOrthoWork = (workTypeId: number): boolean =>
  ORTHO_WORK_TYPES.includes(workTypeId as WorkTypeId);
export const needsDetails = (workTypeId: number): boolean =>
  DETAIL_WORK_TYPES.includes(workTypeId as WorkTypeId);
export const needsVisits = (workTypeId: number): boolean => isOrthoWork(workTypeId);
export const needsDiagnosis = (workTypeId: number): boolean => isOrthoWork(workTypeId);

// Display field configuration
export interface DisplayField {
  key: string;
  label: string;
}

// Work type field configuration
export interface WorkTypeFieldConfig {
  name: string;
  icon: string;
  fields: string[];
  displayFields: DisplayField[];
}

/**
 * Work type field configurations
 * Defines which fields are relevant for each work type
 */
export const WORK_TYPE_FIELDS: Record<number, WorkTypeFieldConfig> = {
  // Endo: tooth, number of canals, working length, notes
  [WORK_TYPE_IDS.ENDO]: {
    name: 'Endo',
    icon: 'fas fa-tooth',
    fields: ['teeth', 'canalsNo', 'workingLength', 'note'],
    displayFields: [
      { key: 'Teeth', label: 'Tooth' },
      { key: 'CanalsNo', label: 'Canals' },
      { key: 'WorkingLength', label: 'Working Length' },
      { key: 'Note', label: 'Notes' },
    ],
  },

  // Filling: tooth, type, depth, notes
  [WORK_TYPE_IDS.FILLING]: {
    name: 'Filling',
    icon: 'fas fa-fill-drip',
    fields: ['teeth', 'fillingType', 'fillingDepth', 'note'],
    displayFields: [
      { key: 'Teeth', label: 'Tooth' },
      { key: 'FillingType', label: 'Type' },
      { key: 'FillingDepth', label: 'Depth' },
      { key: 'Note', label: 'Notes' },
    ],
  },

  // Implant: tooth, manufacturer, length, diameter, notes
  [WORK_TYPE_IDS.IMPLANT]: {
    name: 'Implant',
    icon: 'fas fa-screw',
    fields: ['teeth', 'implantManufacturer', 'implantLength', 'implantDiameter', 'note'],
    displayFields: [
      { key: 'Teeth', label: 'Tooth Position' },
      { key: 'ImplantManufacturerName', label: 'Manufacturer' },
      { key: 'ImplantLength', label: 'Length (mm)' },
      { key: 'ImplantDiameter', label: 'Diameter (mm)' },
      { key: 'Note', label: 'Notes' },
    ],
  },

  // Bridge: material, lab, teeth, notes
  [WORK_TYPE_IDS.BRIDGE]: {
    name: 'Bridge',
    icon: 'fas fa-bridge',
    fields: ['teeth', 'material', 'labName', 'note'],
    displayFields: [
      { key: 'Teeth', label: 'Teeth' },
      { key: 'Material', label: 'Material' },
      { key: 'LabName', label: 'Lab' },
      { key: 'Note', label: 'Notes' },
    ],
  },

  // Veneers: material, lab, teeth, notes (similar to bridge)
  [WORK_TYPE_IDS.VENEERS]: {
    name: 'Veneers',
    icon: 'fas fa-sparkles',
    fields: ['teeth', 'material', 'labName', 'note'],
    displayFields: [
      { key: 'Teeth', label: 'Teeth' },
      { key: 'Material', label: 'Material' },
      { key: 'LabName', label: 'Lab' },
      { key: 'Note', label: 'Notes' },
    ],
  },

  // Surgery: tooth, notes
  [WORK_TYPE_IDS.SURGERY]: {
    name: 'Surgery',
    icon: 'fas fa-scalpel',
    fields: ['teeth', 'note'],
    displayFields: [
      { key: 'Teeth', label: 'Tooth/Area' },
      { key: 'Note', label: 'Procedure Notes' },
    ],
  },

  // Exo (Extraction): tooth, notes
  [WORK_TYPE_IDS.EXO]: {
    name: 'Extraction',
    icon: 'fas fa-tooth',
    fields: ['teeth', 'note'],
    displayFields: [
      { key: 'Teeth', label: 'Tooth Extracted' },
      { key: 'Note', label: 'Notes' },
    ],
  },
};

// Default work type configuration
const DEFAULT_WORK_TYPE_CONFIG: WorkTypeFieldConfig = {
  name: 'Treatment',
  icon: 'fas fa-briefcase-medical',
  fields: ['teeth', 'note'],
  displayFields: [
    { key: 'Teeth', label: 'Teeth' },
    { key: 'Note', label: 'Notes' },
  ],
};

/**
 * Get field configuration for a work type
 * Returns default config if work type not specifically configured
 */
export const getWorkTypeConfig = (workTypeId: number): WorkTypeFieldConfig => {
  return WORK_TYPE_FIELDS[workTypeId] || DEFAULT_WORK_TYPE_CONFIG;
};

/**
 * Material options for Crown/Bridge/Veneers
 */
export const MATERIAL_OPTIONS: readonly string[] = [
  'Zirconia',
  'PFM (Porcelain Fused to Metal)',
  'E-Max',
  'Full Metal',
  'Composite',
  'Acrylic',
  'Other',
] as const;

/**
 * Filling type options
 */
export const FILLING_TYPE_OPTIONS: readonly string[] = [
  'Composite',
  'Amalgam',
  'GIC (Glass Ionomer)',
  'Temporary',
  'Other',
] as const;

/**
 * Filling depth options
 */
export const FILLING_DEPTH_OPTIONS: readonly string[] = [
  'Superficial',
  'Medium',
  'Deep',
  'Very Deep (Near Pulp)',
] as const;

export default {
  WORK_TYPE_IDS,
  ORTHO_WORK_TYPES,
  DETAIL_WORK_TYPES,
  WORK_TYPE_FIELDS,
  isOrthoWork,
  needsDetails,
  needsVisits,
  needsDiagnosis,
  getWorkTypeConfig,
  MATERIAL_OPTIONS,
  FILLING_TYPE_OPTIONS,
  FILLING_DEPTH_OPTIONS,
};
