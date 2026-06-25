/**
 * API contract — work / treatment endpoints (Phase 3).
 *
 * Single source of truth for each work endpoint's request + response shapes,
 * imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One exported `const <action> = { body?, params?, query?,
 * response } as const` per endpoint; types via `z.infer`.
 * See docs/shared-contract-progress.md + the plan.
 *
 * Phase-3 scope decisions (see the dated Findings in the progress tracker):
 *  - **Responses are minimal**: assert the CONTAINER (array vs object) + the
 *    stable id the consumer keys on (`work_id`/`id`/`workId`), staying
 *    `z.looseObject` on the long tail. The frontend consumers keep their existing
 *    generics (multiple divergent `Work`/`WorkResponse`/`WorkInfo` shapes across
 *    files); `{ schema }` gives the runtime N13 boundary guard without a large,
 *    risky type-unification across every work consumer. Tighten per-field later.
 *  - **Request bodies**: now ALL FULLY ENUMERATED as strict `z.object` and the
 *    `z.infer` SSoT (the route's hand-written `UpdateWorkBody`/`WorkDetailBody`/
 *    `DiagnosisData`/`TransferWorkBody` interfaces were deleted). The big
 *    service-bound bodies (`addWork`/`addWorkWithInvoice`) mirror
 *    `WorkService.WorkCreateData` — a strict known-key object stays assignable to
 *    that interface's value-union index signature, so no service refactor is
 *    needed. `updateWork` forwards its non-id rest as `Record<string,unknown>`;
 *    its discount fields stay nullable (null = the service's "clear" signal).
 *    Numeric form fields are coerced (''/null → undefined via optInt/optNum).
 *  - `addition_date` (the only `timestamp` column) is pre-converted to a
 *    `YYYY-MM-DD` string by `toWorkWire` on the server, so the wire shape is a
 *    plain string — no `timestampString` needed here.
 */
import { z } from 'zod';
import { intId } from '../validation.js';
import { withPendingOutcome } from './approvals.contract.js';

// ---------------------------------------------------------------------------
// Shared building blocks.
// ---------------------------------------------------------------------------

/** `{ rowsAffected }` — the closed shape every lifecycle/mutation handler returns. */
const rowsAffected = z.object({ rowsAffected: z.number() });

/**
 * `updateWork`/`deleteWork` can divert a Front-Desk edit/delete on an old (or
 * discount) work into an admin-approval hold — see `services/approvals/`. Both
 * keep the plain `rowsAffected` shape on the immediate-apply path.
 */
const rowsAffectedOrPending = withPendingOutcome(rowsAffected.shape);

// The work forms send numeric fields as STRINGS ('' when blank). Collapse ''/null
// → undefined (NOT 0) so the service optionals hold; a chosen value coerces. The
// bodies below are STRICT `z.object` but stay assignable to the service `*Data`
// types (a known-key object conforms to their index signature / Record).
const optInt = z
  .preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().optional())
  .optional();
const optNum = z
  .preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().optional())
  .optional();
/** WorkStatusType = 1 | 2 | 3 (active/finished/discontinued). */
const workStatus = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** Body shared by /finishwork, /discontinuework, /reactivatework. Fully enumerated. */
const workStatusBody = z.object({ workId: intId, personId: intId.optional() });
export type WorkStatusBody = z.infer<typeof workStatusBody>;

/** Body shared by /updateworkdetail + /deleteworkdetail (either id may be present). */
const workDetailIdBody = z.object({
  detailId: intId.optional(),
  itemId: intId.optional(),
});
export type WorkDetailIdBody = z.infer<typeof workDetailIdBody>;

// The work-item fields (WorkItemData) the add/update-work-detail handlers spread
// into the query. Numeric fields coerced; TeethIds is the only array column.
const workItemFields = {
  filling_type: z.string().optional(),
  filling_depth: z.string().optional(),
  canals_no: optInt,
  working_length: z.string().optional(),
  implant_length: optInt,
  implant_diameter: optInt,
  implant_manufacturer_id: optInt,
  material: z.string().optional(),
  lab_name: z.string().optional(),
  item_cost: optNum,
  start_date: z.string().optional(),
  completed_date: z.string().optional(),
  note: z.string().optional(),
  TeethIds: z.array(z.coerce.number()).optional(),
} as const;

// The shared WorkCreateData field map (POST /addwork + /addWorkWithInvoice). A
// strict `z.object` of these is assignable to WorkService.WorkCreateData (each
// field conforms to that interface's value-union index signature).
const workCreateFields = {
  person_id: intId,
  dr_id: intId,
  type_of_work: intId,
  total_required: optNum,
  currency: z.string().optional(),
  notes: z.string().optional(),
  status: workStatus.optional(),
  start_date: z.string().optional(),
  debond_date: z.string().optional(),
  f_photo_date: z.string().optional(),
  i_photo_date: z.string().optional(),
  notes_date: z.string().optional(),
  estimated_duration: optInt,
  keyword_id_1: optInt,
  keyword_id_2: optInt,
  keyword_id_3: optInt,
  keyword_id_4: optInt,
  keyword_id_5: optInt,
  createAsFinished: z.boolean().optional(),
} as const;

// ===========================================================================
// READS
// ===========================================================================

// GET /api/getworkdetails?workId= — single work (wire-shaped via toWorkWire).
export const getWorkDetails = {
  response: z.looseObject({ work_id: z.number() }),
} as const;

// GET /api/getworks?code= — all works for a patient.
// One work row as served by GET /api/getworks (work-queries.ts#getWorksByPatient
// → toWorkWire). Closed `z.object` (the SELECT list is fully enumerated, and a
// closed row keeps the DB-`interface`-typed `sendData` source assignable without a
// looseObject index signature). work_id/person_id/status are NOT NULL; addition_date
// is toWorkWire'd to a `YYYY-MM-DD` string; the joined name columns, FK ids and
// free-text fields are nullable; WorkStatus is a CASE string, TotalPaid a coalesced
// sum. `z.infer` (WorkRow) is the single source of truth for the works list read.
const workRow = z.object({
  work_id: z.number(),
  person_id: z.number(),
  total_required: z.number().nullable(),
  currency: z.string().nullable(),
  type_of_work: z.number().nullable(),
  notes: z.string().nullable(),
  status: z.number(),
  addition_date: z.string().nullable(),
  start_date: z.string().nullable(),
  debond_date: z.string().nullable(),
  f_photo_date: z.string().nullable(),
  i_photo_date: z.string().nullable(),
  estimated_duration: z.number().nullable(),
  dr_id: z.number().nullable(),
  notes_date: z.string().nullable(),
  keyword_id_1: z.number().nullable(),
  keyword_id_2: z.number().nullable(),
  keyword_id_3: z.number().nullable(),
  keyword_id_4: z.number().nullable(),
  keyword_id_5: z.number().nullable(),
  discount: z.number().nullable(),
  discount_date: z.string().nullable(),
  discount_reason: z.string().nullable(),
  doctor_name: z.string().nullable(),
  type_name: z.string().nullable(),
  status_name: z.string().nullable(),
  Keyword1: z.string().nullable(),
  Keyword2: z.string().nullable(),
  Keyword3: z.string().nullable(),
  Keyword4: z.string().nullable(),
  Keyword5: z.string().nullable(),
  WorkStatus: z.string(),
  TotalPaid: z.number(),
});
export type WorkRow = z.infer<typeof workRow>;

export const getWorks = {
  response: z.array(workRow),
} as const;

// GET /api/getworktypes — dropdown rows ({ id, work_type }). work_types.work_type
// is NOT NULL.
export const getWorkTypes = {
  response: z.array(z.looseObject({ id: z.number(), work_type: z.string() })),
} as const;

// GET /api/getworkkeywords — dropdown rows ({ id, key_word }). keywords.key_word
// is nullable in the DB → modeled nullable (rendered directly in the dropdown).
export const getWorkKeywords = {
  response: z.array(z.looseObject({ id: z.number(), key_word: z.string().nullable() })),
} as const;

// GET /api/teeth?permanent=&deciduous= — { teeth, count }. Tooth rows are fully
// modeled: tooth_code/tooth_name/tooth_number are text, quadrant is the controlled
// 4-value vocabulary (enum), is_permanent a flag — all NOT NULL.
export const teeth = {
  response: z.object({
    teeth: z.array(
      z.looseObject({
        id: z.number(),
        tooth_code: z.string(),
        tooth_name: z.string(),
        tooth_number: z.string(),
        quadrant: z.enum(['UR', 'UL', 'LR', 'LL']),
        is_permanent: z.boolean(),
      })
    ),
    count: z.number(),
  }),
} as const;

// GET /api/getworkdetailslist?workId= — work items for a work.
export const getWorkDetailsList = {
  response: z.array(z.looseObject({ id: z.number() })),
} as const;

// ===========================================================================
// WORK MUTATIONS
// ===========================================================================

// POST /api/addwork — fully enumerated (mirrors WorkCreateData) → { workId }. The
// strict object is assignable to validateAndCreateWork's `WorkCreateData` param.
export const addWork = {
  body: z.object(workCreateFields),
  response: z.looseObject({ workId: z.number() }),
} as const;
export type AddWorkBody = z.infer<typeof addWork.body>;

// POST /api/addWorkWithInvoice — finished work + invoice. → { workId, invoiceId }.
// Same fields, but total_required + currency are REQUIRED for the invoice path.
export const addWorkWithInvoice = {
  body: z.object({
    ...workCreateFields,
    total_required: z.coerce.number().positive(),
    currency: z.string().min(1),
  }),
  response: z.looseObject({ workId: z.number(), invoiceId: z.number() }),
} as const;
export type AddWorkWithInvoiceBody = z.infer<typeof addWorkWithInvoice.body>;

// PUT /api/updatework — fully enumerated (the route's UpdateWorkBody, deleted).
// The handler peels off workId and forwards the rest as Record<string,unknown> to
// validateAndUpdateWork. Discount fields stay NULLABLE — null is the "clear it"
// signal the service's change-detection relies on. → { rowsAffected }.
export const updateWork = {
  body: z.object({
    workId: intId,
    dr_id: intId,
    person_id: optInt,
    total_required: optNum,
    currency: z.string().optional(),
    type_of_work: optInt,
    notes: z.string().optional(),
    status: workStatus.optional(),
    start_date: z.string().optional(),
    debond_date: z.string().optional(),
    f_photo_date: z.string().optional(),
    i_photo_date: z.string().optional(),
    notes_date: z.string().optional(),
    keyword_id_1: optInt,
    keyword_id_2: optInt,
    keyword_id_3: optInt,
    keyword_id_4: optInt,
    keyword_id_5: optInt,
    discount: z.union([z.coerce.number(), z.null()]).optional(),
    discount_date: z.union([z.string(), z.null()]).optional(),
    discount_reason: z.union([z.string(), z.null()]).optional(),
  }),
  response: rowsAffectedOrPending,
} as const;
export type UpdateWorkBody = z.infer<typeof updateWork.body>;

// POST /api/finishwork — { workId, personId? } → { rowsAffected }.
export const finishWork = { body: workStatusBody, response: rowsAffected } as const;

// POST /api/discontinuework — { workId, personId? } → { rowsAffected }.
export const discontinueWork = { body: workStatusBody, response: rowsAffected } as const;

// POST /api/reactivatework — { workId, personId? } → { rowsAffected }.
export const reactivateWork = { body: workStatusBody, response: rowsAffected } as const;

// DELETE /api/deletework — { workId } (fully enumerated) → { rowsAffected }.
export const deleteWork = {
  body: z.object({ workId: intId }),
  response: rowsAffectedOrPending,
} as const;
export type DeleteWorkBody = z.infer<typeof deleteWork.body>;

// ===========================================================================
// WORK DETAILS
// ===========================================================================

// POST /api/addworkdetail — fully enumerated (work_id + the WorkItemData fields the
// handler spreads into addWorkDetail). → { detailId, itemId } (both = new id).
export const addWorkDetail = {
  body: z.object({ work_id: intId, ...workItemFields }),
  response: z.looseObject({ detailId: z.number().optional(), itemId: z.number().optional() }),
} as const;
export type AddWorkDetailBody = z.infer<typeof addWorkDetail.body>;

// PUT /api/updateworkdetail — { detailId|itemId, ...item fields } → { rowsAffected }.
export const updateWorkDetail = {
  body: z.object({ detailId: intId.optional(), itemId: intId.optional(), ...workItemFields }),
  response: rowsAffected,
} as const;
export type UpdateWorkDetailBody = z.infer<typeof updateWorkDetail.body>;

// DELETE /api/deleteworkdetail — { detailId|itemId } → { rowsAffected }.
export const deleteWorkDetail = { body: workDetailIdBody, response: rowsAffected } as const;

// ===========================================================================
// DIAGNOSIS
// ===========================================================================

// POST /api/diagnosis — upsert; FULLY ENUMERATED (the route's DiagnosisData,
// deleted). The handler reads every cephalometric field EXPLICITLY (`|| null`), so
// each must be enumerated or a strict object would strip it. work_id required;
// diagnosis + treatment_plan required non-empty; everything else optional.
//
// `optText` is `.nullish()` (string | null | undefined), NOT `.optional()`: the
// diagnoses columns are all NULLABLE (types/db.d.ts), so when the UI re-edits a
// saved row it seeds the form from the GET payload and posts the NULLs back
// verbatim. A bare `.optional()` rejects null → a 400 on every edit of a row that
// has any blank field. The handler coalesces every field with `|| null` anyway.
const optText = z.string().nullish();
export const diagnosis = {
  body: z.object({
    work_id: intId,
    dx_date: optText,
    diagnosis: z.string().trim().min(1),
    treatment_plan: z.string().trim().min(1),
    chief_complain: optText,
    appliance: optText,
    f_antero_posterior: optText,
    f_vertical: optText,
    f_transverse: optText,
    f_lip_competence: optText,
    f_naso_labial_angle: optText,
    f_upper_incisor_show_rest: optText,
    f_upper_incisor_show_smile: optText,
    i_teeth_present: optText,
    i_dental_health: optText,
    i_lower_crowding: optText,
    i_lower_incisor_inclination: optText,
    i_curveof_spee: optText,
    i_upper_crowding: optText,
    i_upper_incisor_inclination: optText,
    o_incisor_relation: optText,
    o_overjet: optText,
    o_overbite: optText,
    o_centerlines: optText,
    o_molar_relation: optText,
    o_canine_relation: optText,
    o_functional_occlusion: optText,
    c_sna: optText,
    c_snb: optText,
    c_anb: optText,
    c_sn_mx: optText,
    c_wits: optText,
    c_fma: optText,
    c_mma: optText,
    c_uimx: optText,
    c_li_md: optText,
    c_ui_li: optText,
    c_li_a_po: optText,
    c_ulip_e: optText,
    c_llip_e: optText,
    c_naso_lip: optText,
    c_tafh: optText,
    c_uafh: optText,
    c_lafh: optText,
    c_percent_lafh: optText,
  }),
} as const;
export type DiagnosisBody = z.infer<typeof diagnosis.body>;
// GET /api/diagnosis/:workId stays a RAW res.json(row|null) (the null signals
// "no diagnosis yet" — see the route comment); not modeled here.

// ===========================================================================
// TRANSFER (admin)
// ===========================================================================

// GET /api/work/:workId/transfer-preview — { work, relatedRecords }.
export const transferPreview = {
  response: z.object({
    work: z.looseObject({ workId: z.number() }),
    relatedRecords: z.looseObject({}),
  }),
} as const;

// POST /api/work/:workId/transfer — { targetPatientId } (the route's TransferWorkBody,
// deleted) → now validated; response is the TransferWorkResult.
export const transfer = {
  body: z.object({ targetPatientId: intId }),
  response: z.looseObject({ workId: z.number() }),
} as const;
export type TransferBody = z.infer<typeof transfer.body>;

// Shared GET query for the work read endpoints (getworks/getworkdetails/teeth/…).
// Type-only (handlers parse manually); the schema is the SSoT for the route generic.
export const workQuery = z.object({
  code: z.string().optional(),
  workId: z.string().optional(),
  permanent: z.string().optional(),
  deciduous: z.string().optional(),
});
export type WorkQueryParams = z.infer<typeof workQuery>;
