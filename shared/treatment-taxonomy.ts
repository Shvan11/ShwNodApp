/**
 * Treatment taxonomy — the SSoT for work-type ids, the ortho/x-ray/aligner-lab
 * groupings, work-status ids, patient-type ids, and the pure classifier that
 * derives a patient's type from their works. Imported by BOTH the Express server
 * (relative `.js`) and the React app (`@shared` alias) — the same dual-import
 * pattern as `shared/auth/roles.ts`.
 *
 * NEW PARADIGM: patient type is no longer a manually-picked lookup. It is DERIVED
 * from the patient's works by `classifyPatient()` and materialized into
 * `patients.patient_type_id` on every work-lifecycle change (see
 * `services/database/queries/patient-type-classifier.ts`).
 *
 * The work-type ids (23 = Consult) and patient-type ids (10 = X-ray) are CODE
 * CONSTANTS — `migrations/supabase/patient-type-taxonomy-*.sql` must run before
 * this code deploys on each instance (idempotent re-runs are safe).
 */

// ── Work-type ids (from the `work_types` table) ────────────────────────────────
// Moved here from public/js/config/workTypeConfig.ts so both tiers share one
// definition; the config module re-exports these. CONSULT (23) is the intake
// consult work type introduced by this feature.
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
  CONSULT: 23,
} as const;

export type WorkTypeId = (typeof WORK_TYPE_IDS)[keyof typeof WORK_TYPE_IDS];

// Orthodontic treatment work types (need visits + diagnosis). Aligner Lab (21) is
// deliberately NOT here — it's lab work, its own patient-type category.
export const ORTHO_WORK_TYPE_IDS: readonly number[] = [
  WORK_TYPE_IDS.ORTHO_BRACES, // 1
  WORK_TYPE_IDS.ORTHO_PHASE1, // 2
  WORK_TYPE_IDS.RELAPSE, // 11
  WORK_TYPE_IDS.ORTHO_ALIGNERS, // 19
  WORK_TYPE_IDS.ORTHO_MIXED, // 20
];

// Imaging-only work types (a radiograph purchased without treatment).
export const XRAY_WORK_TYPE_IDS: readonly number[] = [
  WORK_TYPE_IDS.OPG, // 14
  WORK_TYPE_IDS.CBCT, // 18
  WORK_TYPE_IDS.CEPHALO, // 22
];

// The single Aligner-Lab (portal) work type. Portal cases arrive as ACTIVE
// aligner-lab works via reverse CDC.
export const ALIGNER_LAB_WORK_TYPE_ID = WORK_TYPE_IDS.ALIGNER_LAB; // 21

/**
 * Work status ids (`works.status`). Moved here from work-queries.ts (which now
 * re-exports it for existing importers). `FINISHED` (2) is a WORK status —
 * unrelated to patient-type row 2 'Former Patient'.
 */
export const WORK_STATUS = {
  ACTIVE: 1,
  FINISHED: 2,
  DISCONTINUED: 3,
} as const;

export type WorkStatusId = (typeof WORK_STATUS)[keyof typeof WORK_STATUS];

/**
 * Patient-type ids (the `patient_types` table). Reuses/renames existing rows;
 * ids 6/7/8 (OPG/Missing/Finisjed) are retired by the Phase-7 backfill. Display
 * names: 1 'Active Ortho', 2 'Former Patient', 3 'New / No Works', 4 'Consult',
 * 5 'Active Non-Ortho', 9 'Aligner Lab', 10 'X-ray'.
 */
export const PATIENT_TYPE_IDS = {
  ACTIVE_ORTHO: 1,
  FORMER_PATIENT: 2,
  NEW_NO_WORKS: 3,
  CONSULT: 4,
  ACTIVE_NON_ORTHO: 5,
  ALIGNER_LAB: 9,
  XRAY: 10,
} as const;

export type PatientTypeId = (typeof PATIENT_TYPE_IDS)[keyof typeof PATIENT_TYPE_IDS];

/** The classification-relevant fields of one work row. */
export interface ClassifiableWork {
  type_of_work: number | null;
  status: number | null;
}

// Consult ∪ x-ray, precomputed for the "all works are consult/imaging" rule.
const CONSULT_OR_XRAY: ReadonlySet<number> = new Set([
  WORK_TYPE_IDS.CONSULT,
  ...XRAY_WORK_TYPE_IDS,
]);

/**
 * Derive a patient's type id from their works (pure). The DB enforces at most one
 * active work per patient (`unq_tblwork_active`), so rule 2 assumes a single
 * active row. Rule ORDER matters — Aligner-Lab wins first (portal cases arrive
 * ACTIVE and sit outside the ortho set).
 *
 *  1. Any Aligner-Lab work (any status)         → ALIGNER_LAB
 *  2. An active work exists (status=1):
 *       ortho set    → ACTIVE_ORTHO
 *       consult (23) → CONSULT
 *       x-ray set    → XRAY
 *       else         → ACTIVE_NON_ORTHO
 *  3. Works exist, none active:
 *       all consult  → CONSULT
 *       all consult∪x-ray → XRAY
 *       else         → FORMER_PATIENT
 *  4. Zero works                                → NEW_NO_WORKS
 */
export function classifyPatient(works: readonly ClassifiableWork[]): PatientTypeId {
  // 1. Aligner Lab short-circuits everything.
  if (works.some((w) => w.type_of_work === ALIGNER_LAB_WORK_TYPE_ID)) {
    return PATIENT_TYPE_IDS.ALIGNER_LAB;
  }

  // 2. An active work (at most one, per the DB constraint).
  const active = works.find((w) => w.status === WORK_STATUS.ACTIVE);
  if (active) {
    const t = active.type_of_work;
    if (t != null && ORTHO_WORK_TYPE_IDS.includes(t)) return PATIENT_TYPE_IDS.ACTIVE_ORTHO;
    if (t === WORK_TYPE_IDS.CONSULT) return PATIENT_TYPE_IDS.CONSULT;
    if (t != null && XRAY_WORK_TYPE_IDS.includes(t)) return PATIENT_TYPE_IDS.XRAY;
    return PATIENT_TYPE_IDS.ACTIVE_NON_ORTHO;
  }

  // 3. Works exist, but none active (finished/discontinued).
  if (works.length > 0) {
    if (works.every((w) => w.type_of_work === WORK_TYPE_IDS.CONSULT)) {
      return PATIENT_TYPE_IDS.CONSULT;
    }
    if (works.every((w) => w.type_of_work != null && CONSULT_OR_XRAY.has(w.type_of_work))) {
      return PATIENT_TYPE_IDS.XRAY;
    }
    return PATIENT_TYPE_IDS.FORMER_PATIENT;
  }

  // 4. Zero works.
  return PATIENT_TYPE_IDS.NEW_NO_WORKS;
}
