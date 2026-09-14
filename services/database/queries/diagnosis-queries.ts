/**
 * Diagnosis / treatment-planning records (`diagnoses`) — the single owner of that
 * table's SQL. Extracted verbatim from `routes/api/work.routes.ts` (R9(b)),
 * rationale comments included.
 *
 * A work has at most one diagnosis (`UNIQUE (work_id)`), so the write is a single
 * upsert rather than an update-then-insert pair.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

/**
 * One diagnosis row as the GET projects it — ~45 nullable text/numeric columns.
 * Left as an open record: the endpoint returns it RAW (no contract, see the
 * route), so enumerating 45 columns here would buy nothing the DB types don't
 * already give the writer.
 */
export type DiagnosisRow = Record<string, unknown>;

/**
 * Everything the upsert writes. The text fields arrive as the request left them
 * (`string | null | undefined`) and are normalized to null here — an empty
 * string means "not recorded", same as null, and the columns are all nullable.
 */
export type DiagnosisUpsertData = {
  work_id: number;
  /** `timestamp` WITHOUT time zone — the caller builds LOCAL midnight, not UTC. */
  dx_date: Date;
  diagnosis: string;
  treatment_plan: string;
  chief_complain?: string | null;
  appliance?: string | null;
  f_antero_posterior?: string | null;
  f_vertical?: string | null;
  f_transverse?: string | null;
  f_lip_competence?: string | null;
  f_naso_labial_angle?: string | null;
  f_upper_incisor_show_rest?: string | null;
  f_upper_incisor_show_smile?: string | null;
  i_teeth_present?: string | null;
  i_dental_health?: string | null;
  i_lower_crowding?: string | null;
  i_lower_incisor_inclination?: string | null;
  i_curveof_spee?: string | null;
  i_upper_crowding?: string | null;
  i_upper_incisor_inclination?: string | null;
  o_incisor_relation?: string | null;
  o_overjet?: string | null;
  o_overbite?: string | null;
  o_centerlines?: string | null;
  o_molar_relation?: string | null;
  o_canine_relation?: string | null;
  o_functional_occlusion?: string | null;
  c_sna?: string | null;
  c_snb?: string | null;
  c_anb?: string | null;
  c_sn_mx?: string | null;
  c_wits?: string | null;
  c_fma?: string | null;
  c_mma?: string | null;
  c_uimx?: string | null;
  c_li_md?: string | null;
  c_ui_li?: string | null;
  c_li_a_po?: string | null;
  c_ulip_e?: string | null;
  c_llip_e?: string | null;
  c_naso_lip?: string | null;
  c_tafh?: string | null;
  c_uafh?: string | null;
  c_lafh?: string | null;
  c_percent_lafh?: string | null;
};

/** The diagnosis for a work, or undefined when none has been recorded yet. */
export async function getDiagnosisByWorkId(workId: number): Promise<DiagnosisRow | undefined> {
  const { rows } = await sql<DiagnosisRow>`
        SELECT
            "id",
            to_char("dx_date", 'YYYY-MM-DD') as "dx_date",
            "work_id",
            "diagnosis",
            "treatment_plan",
            "chief_complain",
            "f_antero_posterior",
            "f_vertical",
            "f_transverse",
            "f_lip_competence",
            "f_naso_labial_angle",
            "f_upper_incisor_show_rest",
            "f_upper_incisor_show_smile",
            "i_teeth_present",
            "i_dental_health",
            "i_lower_crowding",
            "i_lower_incisor_inclination",
            "i_curveof_spee",
            "i_upper_crowding",
            "i_upper_incisor_inclination",
            "o_incisor_relation",
            "o_overjet",
            "o_overbite",
            "o_centerlines",
            "o_molar_relation",
            "o_canine_relation",
            "o_functional_occlusion",
            "c_sna",
            "c_snb",
            "c_anb",
            "c_sn_mx",
            "c_wits",
            "c_fma",
            "c_mma",
            "c_uimx",
            "c_li_md",
            "c_ui_li",
            "c_li_a_po",
            "c_ulip_e",
            "c_llip_e",
            "c_naso_lip",
            "c_tafh",
            "c_uafh",
            "c_lafh",
            "c_percent_lafh",
            "appliance"
        FROM "diagnoses"
        WHERE "work_id" = ${workId}
    `.execute(getKysely());

  return rows[0];
}

/**
 * Create or update the diagnosis for a work. Returns true when a row was
 * INSERTed (i.e. this was the first save for that work), false on update.
 */
export async function upsertDiagnosis(data: DiagnosisUpsertData): Promise<boolean> {
  // Normalized column values (null for empty strings — preserves original semantics).
  const diagnosis = data.diagnosis;
  const treatmentPlan = data.treatment_plan;
  const chiefComplain = data.chief_complain || null;
  const appliance = data.appliance || null;
  // Facial Analysis
  const fAnteroPosterior = data.f_antero_posterior || null;
  const fVertical = data.f_vertical || null;
  const fTransverse = data.f_transverse || null;
  const fLipCompetence = data.f_lip_competence || null;
  const fNasoLabialAngle = data.f_naso_labial_angle || null;
  const fUpperIncisorShowRest = data.f_upper_incisor_show_rest || null;
  const fUpperIncisorShowSmile = data.f_upper_incisor_show_smile || null;
  // Intraoral Analysis
  const iTeethPresent = data.i_teeth_present || null;
  const iDentalHealth = data.i_dental_health || null;
  const iLowerCrowding = data.i_lower_crowding || null;
  const iLowerIncisorInclination = data.i_lower_incisor_inclination || null;
  const iCurveofSpee = data.i_curveof_spee || null;
  const iUpperCrowding = data.i_upper_crowding || null;
  const iUpperIncisorInclination = data.i_upper_incisor_inclination || null;
  // Occlusion Analysis
  const oIncisorRelation = data.o_incisor_relation || null;
  const oOverjet = data.o_overjet || null;
  const oOverbite = data.o_overbite || null;
  const oCenterlines = data.o_centerlines || null;
  const oMolarRelation = data.o_molar_relation || null;
  const oCanineRelation = data.o_canine_relation || null;
  const oFunctionalOcclusion = data.o_functional_occlusion || null;
  // Cephalometric Analysis
  const c_SNA = data.c_sna || null;
  const c_SNB = data.c_snb || null;
  const c_ANB = data.c_anb || null;
  const c_SNMx = data.c_sn_mx || null;
  const c_Wits = data.c_wits || null;
  const c_FMA = data.c_fma || null;
  const c_MMA = data.c_mma || null;
  const c_UIMX = data.c_uimx || null;
  const c_LIMd = data.c_li_md || null;
  const c_UI_LI = data.c_ui_li || null;
  const c_LI_APo = data.c_li_a_po || null;
  const c_Ulip_E = data.c_ulip_e || null;
  const c_Llip_E = data.c_llip_e || null;
  const c_Naso_lip = data.c_naso_lip || null;
  const c_TAFH = data.c_tafh || null;
  const c_UAFH = data.c_uafh || null;
  const c_LAFH = data.c_lafh || null;
  const c_PercentLAFH = data.c_percent_lafh || null;

  // Single-statement upsert on `UNIQUE (work_id)`
  // (migrations/pg/1788812600000_diagnoses-unique-workid.sql). A work has exactly one
  // diagnosis, and now the table says so, which is what makes concurrent saves safe: the
  // second writer's INSERT conflicts and becomes the UPDATE instead of silently creating a
  // duplicate row for the same work. This replaces the UPDATE-then-INSERT-if-zero-rows pair
  // and the per-work `pg_advisory_xact_lock` that serialised it (audit finding F7.3) — the
  // invariant is now enforced against every writer, including the CDC sinks, rather than
  // only against the one code path that remembered to take the lock.
  //
  // `xmax = 0` is true only for a row this statement actually INSERTed, which is how the
  // response message still distinguishes "created" from "updated".
  const { rows: [upserted] } = await sql<{ inserted: boolean }>`
        INSERT INTO "diagnoses" (
            "dx_date", "work_id", "diagnosis", "treatment_plan", "chief_complain", "appliance",
            "f_antero_posterior", "f_vertical", "f_transverse", "f_lip_competence", "f_naso_labial_angle",
            "f_upper_incisor_show_rest", "f_upper_incisor_show_smile",
            "i_teeth_present", "i_dental_health", "i_lower_crowding", "i_lower_incisor_inclination",
            "i_curveof_spee", "i_upper_crowding", "i_upper_incisor_inclination",
            "o_incisor_relation", "o_overjet", "o_overbite", "o_centerlines", "o_molar_relation",
            "o_canine_relation", "o_functional_occlusion",
            "c_sna", "c_snb", "c_anb", "c_sn_mx", "c_wits", "c_fma", "c_mma", "c_uimx", "c_li_md",
            "c_ui_li", "c_li_a_po", "c_ulip_e", "c_llip_e", "c_naso_lip",
            "c_tafh", "c_uafh", "c_lafh", "c_percent_lafh"
        )
        VALUES (
            ${data.dx_date}, ${data.work_id}, ${diagnosis}, ${treatmentPlan}, ${chiefComplain}, ${appliance},
            ${fAnteroPosterior}, ${fVertical}, ${fTransverse}, ${fLipCompetence}, ${fNasoLabialAngle},
            ${fUpperIncisorShowRest}, ${fUpperIncisorShowSmile},
            ${iTeethPresent}, ${iDentalHealth}, ${iLowerCrowding}, ${iLowerIncisorInclination},
            ${iCurveofSpee}, ${iUpperCrowding}, ${iUpperIncisorInclination},
            ${oIncisorRelation}, ${oOverjet}, ${oOverbite}, ${oCenterlines}, ${oMolarRelation},
            ${oCanineRelation}, ${oFunctionalOcclusion},
            ${c_SNA}, ${c_SNB}, ${c_ANB}, ${c_SNMx}, ${c_Wits}, ${c_FMA}, ${c_MMA}, ${c_UIMX}, ${c_LIMd},
            ${c_UI_LI}, ${c_LI_APo}, ${c_Ulip_E}, ${c_Llip_E}, ${c_Naso_lip},
            ${c_TAFH}, ${c_UAFH}, ${c_LAFH}, ${c_PercentLAFH}
        )
        ON CONFLICT ("work_id") DO UPDATE SET
            "dx_date" = EXCLUDED."dx_date",
            "diagnosis" = EXCLUDED."diagnosis",
            "treatment_plan" = EXCLUDED."treatment_plan",
            "chief_complain" = EXCLUDED."chief_complain",
            "appliance" = EXCLUDED."appliance",
            "f_antero_posterior" = EXCLUDED."f_antero_posterior",
            "f_vertical" = EXCLUDED."f_vertical",
            "f_transverse" = EXCLUDED."f_transverse",
            "f_lip_competence" = EXCLUDED."f_lip_competence",
            "f_naso_labial_angle" = EXCLUDED."f_naso_labial_angle",
            "f_upper_incisor_show_rest" = EXCLUDED."f_upper_incisor_show_rest",
            "f_upper_incisor_show_smile" = EXCLUDED."f_upper_incisor_show_smile",
            "i_teeth_present" = EXCLUDED."i_teeth_present",
            "i_dental_health" = EXCLUDED."i_dental_health",
            "i_lower_crowding" = EXCLUDED."i_lower_crowding",
            "i_lower_incisor_inclination" = EXCLUDED."i_lower_incisor_inclination",
            "i_curveof_spee" = EXCLUDED."i_curveof_spee",
            "i_upper_crowding" = EXCLUDED."i_upper_crowding",
            "i_upper_incisor_inclination" = EXCLUDED."i_upper_incisor_inclination",
            "o_incisor_relation" = EXCLUDED."o_incisor_relation",
            "o_overjet" = EXCLUDED."o_overjet",
            "o_overbite" = EXCLUDED."o_overbite",
            "o_centerlines" = EXCLUDED."o_centerlines",
            "o_molar_relation" = EXCLUDED."o_molar_relation",
            "o_canine_relation" = EXCLUDED."o_canine_relation",
            "o_functional_occlusion" = EXCLUDED."o_functional_occlusion",
            "c_sna" = EXCLUDED."c_sna",
            "c_snb" = EXCLUDED."c_snb",
            "c_anb" = EXCLUDED."c_anb",
            "c_sn_mx" = EXCLUDED."c_sn_mx",
            "c_wits" = EXCLUDED."c_wits",
            "c_fma" = EXCLUDED."c_fma",
            "c_mma" = EXCLUDED."c_mma",
            "c_uimx" = EXCLUDED."c_uimx",
            "c_li_md" = EXCLUDED."c_li_md",
            "c_ui_li" = EXCLUDED."c_ui_li",
            "c_li_a_po" = EXCLUDED."c_li_a_po",
            "c_ulip_e" = EXCLUDED."c_ulip_e",
            "c_llip_e" = EXCLUDED."c_llip_e",
            "c_naso_lip" = EXCLUDED."c_naso_lip",
            "c_tafh" = EXCLUDED."c_tafh",
            "c_uafh" = EXCLUDED."c_uafh",
            "c_lafh" = EXCLUDED."c_lafh",
            "c_percent_lafh" = EXCLUDED."c_percent_lafh"
        RETURNING (xmax = 0) AS "inserted"
    `.execute(getKysely());

  return !!upserted?.inserted;
}

/** Remove a work's diagnosis. A no-op when there isn't one. */
export async function deleteDiagnosisByWorkId(workId: number): Promise<void> {
  await sql`DELETE FROM "diagnoses" WHERE "work_id" = ${workId}`.execute(getKysely());
}
