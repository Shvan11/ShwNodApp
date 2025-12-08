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
    CEPHALO: 22
};

// Ortho-related work types that need visits and diagnosis
// Note: Aligner Lab (21) is NOT included - it's lab work, not patient treatment
export const ORTHO_WORK_TYPES = [
    WORK_TYPE_IDS.ORTHO_BRACES,     // 1
    WORK_TYPE_IDS.ORTHO_PHASE1,     // 2
    WORK_TYPE_IDS.RELAPSE,          // 11
    WORK_TYPE_IDS.ORTHO_ALIGNERS,   // 19
    WORK_TYPE_IDS.ORTHO_MIXED       // 20
];

// Work types that need detail records (work items)
export const DETAIL_WORK_TYPES = [
    WORK_TYPE_IDS.FILLING,
    WORK_TYPE_IDS.ENDO,
    WORK_TYPE_IDS.EXO,
    WORK_TYPE_IDS.SURGERY,
    WORK_TYPE_IDS.IMPLANT,
    WORK_TYPE_IDS.BRIDGE,
    WORK_TYPE_IDS.VENEERS  // Veneers also use material/lab like crowns
];

// Helper functions
export const isOrthoWork = (workTypeId) => ORTHO_WORK_TYPES.includes(workTypeId);
export const needsDetails = (workTypeId) => DETAIL_WORK_TYPES.includes(workTypeId);
export const needsVisits = (workTypeId) => isOrthoWork(workTypeId);
export const needsDiagnosis = (workTypeId) => isOrthoWork(workTypeId);

/**
 * Work type field configurations
 * Defines which fields are relevant for each work type
 */
export const WORK_TYPE_FIELDS = {
    // Endo: tooth, number of canals, working length, notes
    [WORK_TYPE_IDS.ENDO]: {
        name: 'Endo',
        icon: 'fas fa-tooth',
        fields: ['teeth', 'canalsNo', 'workingLength', 'note'],
        displayFields: [
            { key: 'Teeth', label: 'Tooth' },
            { key: 'CanalsNo', label: 'Canals' },
            { key: 'WorkingLength', label: 'Working Length' },
            { key: 'Note', label: 'Notes' }
        ]
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
            { key: 'Note', label: 'Notes' }
        ]
    },

    // Implant: tooth, length, diameter, notes
    [WORK_TYPE_IDS.IMPLANT]: {
        name: 'Implant',
        icon: 'fas fa-screw',
        fields: ['teeth', 'implantLength', 'implantDiameter', 'note'],
        displayFields: [
            { key: 'Teeth', label: 'Tooth Position' },
            { key: 'ImplantLength', label: 'Length (mm)' },
            { key: 'ImplantDiameter', label: 'Diameter (mm)' },
            { key: 'Note', label: 'Notes' }
        ]
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
            { key: 'Note', label: 'Notes' }
        ]
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
            { key: 'Note', label: 'Notes' }
        ]
    },

    // Surgery: tooth, notes
    [WORK_TYPE_IDS.SURGERY]: {
        name: 'Surgery',
        icon: 'fas fa-scalpel',
        fields: ['teeth', 'note'],
        displayFields: [
            { key: 'Teeth', label: 'Tooth/Area' },
            { key: 'Note', label: 'Procedure Notes' }
        ]
    },

    // Exo (Extraction): tooth, notes
    [WORK_TYPE_IDS.EXO]: {
        name: 'Extraction',
        icon: 'fas fa-tooth',
        fields: ['teeth', 'note'],
        displayFields: [
            { key: 'Teeth', label: 'Tooth Extracted' },
            { key: 'Note', label: 'Notes' }
        ]
    }
};

/**
 * Get field configuration for a work type
 * Returns default config if work type not specifically configured
 */
export const getWorkTypeConfig = (workTypeId) => {
    return WORK_TYPE_FIELDS[workTypeId] || {
        name: 'Treatment',
        icon: 'fas fa-briefcase-medical',
        fields: ['teeth', 'note'],
        displayFields: [
            { key: 'Teeth', label: 'Teeth' },
            { key: 'Note', label: 'Notes' }
        ]
    };
};

/**
 * Material options for Crown/Bridge/Veneers
 */
export const MATERIAL_OPTIONS = [
    'Zirconia',
    'PFM (Porcelain Fused to Metal)',
    'E-Max',
    'Full Metal',
    'Composite',
    'Acrylic',
    'Other'
];

/**
 * Filling type options
 */
export const FILLING_TYPE_OPTIONS = [
    'Composite',
    'Amalgam',
    'GIC (Glass Ionomer)',
    'Temporary',
    'Other'
];

/**
 * Filling depth options
 */
export const FILLING_DEPTH_OPTIONS = [
    'Superficial',
    'Medium',
    'Deep',
    'Very Deep (Near Pulp)'
];

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
    FILLING_DEPTH_OPTIONS
};
