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

// ---------------------------------------------------------------------------
// Shared building blocks.
// ---------------------------------------------------------------------------

/** `{ rowsAffected }` — the closed shape every lifecycle/mutation handler returns. */
const rowsAffected = z.object({ rowsAffected: z.number() });

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
export const getWorks = {
  response: z.array(z.looseObject({ work_id: z.number() })),
} as const;

// GET /api/getworktypes — dropdown rows ({ id, work_type }).
export const getWorkTypes = {
  response: z.array(z.looseObject({ id: z.number() })),
} as const;

// GET /api/getworkkeywords — dropdown rows ({ id, key_word }).
export const getWorkKeywords = {
  response: z.array(z.looseObject({ id: z.number() })),
} as const;

// GET /api/teeth?permanent=&deciduous= — { teeth, count }.
export const teeth = {
  response: z.object({
    teeth: z.array(z.looseObject({ id: z.number() })),
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
  response: rowsAffected,
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
  response: rowsAffected,
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
// each must be enumerated or a strict object would strip it. All are optional
// strings except work_id; diagnosis + treatment_plan required. sendSuccess(null).
export const diagnosis = {
  body: z.object({
    work_id: intId,
    dx_date: z.string().optional(),
    diagnosis: z.string().trim().min(1),
    treatment_plan: z.string().trim().min(1),
    chief_complain: z.string().optional(),
    appliance: z.string().optional(),
    f_antero_posterior: z.string().optional(),
    f_vertical: z.string().optional(),
    f_transverse: z.string().optional(),
    f_lip_competence: z.string().optional(),
    f_naso_labial_angle: z.string().optional(),
    f_upper_incisor_show_rest: z.string().optional(),
    f_upper_incisor_show_smile: z.string().optional(),
    i_teeth_present: z.string().optional(),
    i_dental_health: z.string().optional(),
    i_lower_crowding: z.string().optional(),
    i_lower_incisor_inclination: z.string().optional(),
    i_curveof_spee: z.string().optional(),
    i_upper_crowding: z.string().optional(),
    i_upper_incisor_inclination: z.string().optional(),
    o_incisor_relation: z.string().optional(),
    o_overjet: z.string().optional(),
    o_overbite: z.string().optional(),
    o_centerlines: z.string().optional(),
    o_molar_relation: z.string().optional(),
    o_canine_relation: z.string().optional(),
    o_functional_occlusion: z.string().optional(),
    c_sna: z.string().optional(),
    c_snb: z.string().optional(),
    c_anb: z.string().optional(),
    c_sn_mx: z.string().optional(),
    c_wits: z.string().optional(),
    c_fma: z.string().optional(),
    c_mma: z.string().optional(),
    c_uimx: z.string().optional(),
    c_li_md: z.string().optional(),
    c_ui_li: z.string().optional(),
    c_li_a_po: z.string().optional(),
    c_ulip_e: z.string().optional(),
    c_llip_e: z.string().optional(),
    c_naso_lip: z.string().optional(),
    c_tafh: z.string().optional(),
    c_uafh: z.string().optional(),
    c_lafh: z.string().optional(),
    c_percent_lafh: z.string().optional(),
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
