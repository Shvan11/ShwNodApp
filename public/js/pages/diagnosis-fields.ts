/**
 * The Diagnosis page's form, as data.
 *
 * Every field the page edits is one row here, grouped the way the page shows
 * them (tab → optional sub-section → fields). The keys are typed against the
 * contract's request body, so a field can't be spelled differently from the
 * column it posts to, and `diagnosis-fields.test.ts` fails if a contract field
 * has no row (the old 45 hand-written blocks had no such guard).
 */
import type { DiagnosisBody } from '@shared/contracts/work.contract';

export type DiagnosisField = Exclude<keyof DiagnosisBody, 'work_id'>;
/** The editable form: every field as a string (`''` = blank → NULL server-side). */
export type DiagnosisForm = Record<DiagnosisField, string>;

export type DiagnosisTabId = 'general' | 'facial' | 'intraoral' | 'occlusion' | 'cephalometric';

export interface DiagnosisFieldSpec {
    key: DiagnosisField;
    label: string;
    placeholder?: string;
    /** Default `text`. */
    kind?: 'text' | 'date' | 'textarea';
    rows?: number;
    /** Spans both grid columns. */
    full?: boolean;
    required?: boolean;
}

export interface DiagnosisSectionSpec {
    /** Sub-heading (`<h3>`) — only the cephalometric tab groups its fields. */
    title?: string;
    fields: DiagnosisFieldSpec[];
}

export interface DiagnosisTabSpec {
    id: DiagnosisTabId;
    label: string;
    icon: string;
    title: string;
    sections: DiagnosisSectionSpec[];
}

export const DIAGNOSIS_TABS: DiagnosisTabSpec[] = [
    {
        id: 'general',
        label: 'General',
        icon: 'fas fa-clipboard-list',
        title: 'General Information',
        sections: [{
            fields: [
                { key: 'dx_date', label: 'Diagnosis Date', kind: 'date' },
                { key: 'appliance', label: 'Appliance', placeholder: 'e.g., Roth, MBT, Damon...' },
                { key: 'chief_complain', label: 'Chief Complaint', kind: 'textarea', rows: 3, full: true, placeholder: "Patient's main concern or reason for seeking treatment..." },
                { key: 'diagnosis', label: 'Diagnosis', kind: 'textarea', rows: 5, full: true, required: true, placeholder: 'Complete orthodontic diagnosis (e.g., Class II Division 1 malocclusion, severe crowding, deep bite...)' },
                { key: 'treatment_plan', label: 'Treatment Plan', kind: 'textarea', rows: 5, full: true, required: true, placeholder: 'Detailed treatment plan including extractions, mechanics, duration, etc...' },
            ],
        }],
    },
    {
        id: 'facial',
        label: 'Facial Analysis',
        icon: 'fas fa-user',
        title: 'Facial Analysis',
        sections: [{
            fields: [
                { key: 'f_antero_posterior', label: 'Antero-Posterior', placeholder: 'e.g., Convex, Straight, Concave' },
                { key: 'f_vertical', label: 'Vertical', placeholder: 'e.g., Average, Long, Short' },
                { key: 'f_transverse', label: 'Transverse', placeholder: 'e.g., Symmetric, Asymmetric' },
                { key: 'f_lip_competence', label: 'Lip Competence', placeholder: 'e.g., Competent, Incompetent' },
                { key: 'f_naso_labial_angle', label: 'Nasolabial Angle', placeholder: 'e.g., 90-110°, Normal: 102°±8' },
                { key: 'f_upper_incisor_show_rest', label: 'Upper Incisor Show (Rest)', placeholder: 'e.g., 2-3mm (normal)' },
                { key: 'f_upper_incisor_show_smile', label: 'Upper Incisor Show (Smile)', placeholder: 'e.g., 100%, with gingiva' },
            ],
        }],
    },
    {
        id: 'intraoral',
        label: 'Intraoral',
        icon: 'fas fa-teeth',
        title: 'Intraoral Analysis',
        sections: [{
            fields: [
                { key: 'i_teeth_present', label: 'Teeth Present', full: true, placeholder: 'e.g., All permanent teeth, Mixed dentition' },
                { key: 'i_dental_health', label: 'Dental Health', full: true, placeholder: 'e.g., Good oral hygiene, No active caries' },
                { key: 'i_upper_crowding', label: 'Upper Crowding', placeholder: 'e.g., -5mm (negative = crowding)' },
                { key: 'i_upper_incisor_inclination', label: 'Upper Incisor Inclination', placeholder: 'e.g., Proclined, Retroclined, Normal' },
                { key: 'i_lower_crowding', label: 'Lower Crowding', placeholder: 'e.g., -3mm (negative = crowding)' },
                { key: 'i_lower_incisor_inclination', label: 'Lower Incisor Inclination', placeholder: 'e.g., Upright, Proclined, Retroclined' },
                { key: 'i_curveof_spee', label: 'Curve of Spee', full: true, placeholder: 'e.g., Moderate 3mm, Flat, Deep' },
            ],
        }],
    },
    {
        id: 'occlusion',
        label: 'Occlusion',
        icon: 'fas fa-grip-horizontal',
        title: 'Occlusion Analysis',
        sections: [{
            fields: [
                { key: 'o_incisor_relation', label: 'Incisor Relation', placeholder: 'e.g., Class I, Class II, Class III' },
                { key: 'o_overjet', label: 'Overjet', placeholder: 'e.g., 5mm (normal: 2-3mm)' },
                { key: 'o_overbite', label: 'Overbite', placeholder: 'e.g., 50%, Deep, Open' },
                { key: 'o_centerlines', label: 'Centerlines', placeholder: 'e.g., Coincident, Upper right 2mm' },
                { key: 'o_molar_relation', label: 'Molar Relation (Right / Left)', placeholder: 'e.g., Class I / Class II, Full cusp Class II' },
                { key: 'o_canine_relation', label: 'Canine Relation (Right / Left)', placeholder: 'e.g., Class I / Class II' },
                // The app's tooth notation is Palmer-style (UR6, ULA — DentalChart,
                // TeethSelector); the old "#24" example taught a numeric style used
                // nowhere else, and one that means different teeth in FDI and UNN.
                { key: 'o_functional_occlusion', label: 'Functional Occlusion', full: true, placeholder: 'e.g., No premature contacts, Crossbite on UL4' },
            ],
        }],
    },
    {
        id: 'cephalometric',
        label: 'Cephalometric',
        icon: 'fas fa-ruler-combined',
        title: 'Cephalometric Analysis',
        sections: [
            {
                title: 'Skeletal Relationships',
                fields: [
                    { key: 'c_sna', label: 'SNA (°)', placeholder: 'Normal: 82° ±2' },
                    { key: 'c_snb', label: 'SNB (°)', placeholder: 'Normal: 80° ±2' },
                    { key: 'c_anb', label: 'ANB (°)', placeholder: 'Normal: 2° ±2' },
                    { key: 'c_sn_mx', label: 'SN-Mx (°)', placeholder: 'Normal: 8° ±3' },
                    { key: 'c_wits', label: 'Wits (mm)', placeholder: 'Normal: -1mm ±2' },
                ],
            },
            {
                title: 'Vertical Relationships',
                fields: [
                    { key: 'c_fma', label: 'FMA (°)', placeholder: 'Normal: 25° ±5' },
                    { key: 'c_mma', label: 'MMA (°)', placeholder: 'Normal: 27° ±5' },
                    { key: 'c_tafh', label: 'TAFH (mm)', placeholder: 'Total anterior face height' },
                    { key: 'c_uafh', label: 'UAFH (mm)', placeholder: 'Upper anterior face height' },
                    { key: 'c_lafh', label: 'LAFH (mm)', placeholder: 'Lower anterior face height' },
                    { key: 'c_percent_lafh', label: 'LAFH (%)', placeholder: 'Normal: 55% ±2' },
                ],
            },
            {
                title: 'Dental Relationships',
                fields: [
                    { key: 'c_uimx', label: 'UI-Mx (°)', placeholder: 'Normal: 110° ±6' },
                    { key: 'c_li_md', label: 'LI-Md (°)', placeholder: 'Normal: 90° ±3' },
                    { key: 'c_ui_li', label: 'UI-LI (°)', placeholder: 'Normal: 130° ±10' },
                    { key: 'c_li_a_po', label: 'LI-APo (mm)', placeholder: 'Normal: 1mm ±2' },
                ],
            },
            {
                title: 'Soft Tissue Analysis',
                fields: [
                    { key: 'c_ulip_e', label: 'ULip-E (mm)', placeholder: 'Normal: -4mm ±2' },
                    { key: 'c_llip_e', label: 'LLip-E (mm)', placeholder: 'Normal: -2mm ±2' },
                    { key: 'c_naso_lip', label: 'Nasolabial (°)', placeholder: 'Normal: 102° ±8' },
                ],
            },
        ],
    },
];

export const DIAGNOSIS_FIELD_KEYS: DiagnosisField[] = DIAGNOSIS_TABS.flatMap(tab =>
    tab.sections.flatMap(section => section.fields.map(field => field.key))
);

/** `dx-<field>` with `_` → `-` (and the redundant `dx_` prefix dropped: `dx-date`). */
export const diagnosisFieldId = (key: DiagnosisField): string =>
    `dx-${key.replace(/^dx_/, '').replace(/_/g, '-')}`;

/** A blank form — what a work with no diagnosis yet opens with. */
export function emptyDiagnosisForm(today: string): DiagnosisForm {
    const form = Object.fromEntries(DIAGNOSIS_FIELD_KEYS.map(key => [key, ''])) as DiagnosisForm;
    form.dx_date = today;
    return form;
}

/**
 * The form seeded from a stored row (`GET /api/diagnosis/:workId`). Only the
 * form's own keys are copied — the row's id/timestamps never ride back into the
 * POST — and a NULL column becomes `''`. `dx_date` arrives as `YYYY-MM-DD`
 * (the route's `to_char`); `normalizeDate` keeps any longer timestamp string safe.
 */
export function diagnosisFormFromRow(
    row: Record<string, unknown>,
    today: string,
    normalizeDate: (value: string) => string
): DiagnosisForm {
    const form = emptyDiagnosisForm(today);
    for (const key of DIAGNOSIS_FIELD_KEYS) {
        const value = row[key];
        form[key] = value == null ? '' : String(value);
    }
    form.dx_date = form.dx_date ? normalizeDate(form.dx_date) : today;
    return form;
}
