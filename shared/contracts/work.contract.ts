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
 *  - **Request bodies**: the small, fully-enumerable ones (`workStatus`,
 *    `deleteWork`) become `z.infer` SSoT. The large bodies that forward wholesale
 *    to `WorkService` (`addWork`/`addWorkWithInvoice`/`updateWork`) or carry a
 *    22+-field financial/clinical shape (`updateWork`, work-detail, `diagnosis`)
 *    keep the EXISTING loose guard relocated verbatim — the documented caveat for
 *    service-bound bodies (the service still owns full validation; full per-field
 *    enumeration is a later hardening, not a blind rewrite of money/clinical bodies).
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

/** Body shared by /finishwork, /discontinuework, /reactivatework. Fully enumerated. */
const workStatusBody = z.object({ workId: intId, personId: intId.optional() });
export type WorkStatusBody = z.infer<typeof workStatusBody>;

/** Body shared by /updateworkdetail + /deleteworkdetail (either id may be present). */
const workDetailIdBody = z.looseObject({
  detailId: intId.optional(),
  itemId: intId.optional(),
});
export type WorkDetailIdBody = z.infer<typeof workDetailIdBody>;

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

// POST /api/addwork — body forwarded to WorkService.validateAndCreateWork
// (loose guard relocated verbatim; service owns full validation). → { workId }.
export const addWork = {
  body: z.looseObject({ person_id: intId, dr_id: intId, type_of_work: intId }),
  response: z.looseObject({ workId: z.number() }),
} as const;

// POST /api/addWorkWithInvoice — finished work + invoice. → { workId, invoiceId }.
export const addWorkWithInvoice = {
  body: z.looseObject({
    person_id: intId,
    dr_id: intId,
    type_of_work: intId,
    total_required: z.coerce.number().positive(),
    currency: z.string().min(1),
  }),
  response: z.looseObject({ workId: z.number(), invoiceId: z.number() }),
} as const;

// PUT /api/updatework — loose guard (workId + dr_id required); every other work
// field passes through to WorkService.validateAndUpdateWork untouched. → { rowsAffected }.
export const updateWork = {
  body: z.looseObject({ workId: intId, dr_id: intId }),
  response: rowsAffected,
} as const;

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

// POST /api/addworkdetail — body carries the full work-item shape; loose guard
// (work_id required) relocated verbatim. → { detailId, itemId } (both = new id).
export const addWorkDetail = {
  body: z.looseObject({ work_id: intId }),
  response: z.looseObject({ detailId: z.number().optional(), itemId: z.number().optional() }),
} as const;

// PUT /api/updateworkdetail — { detailId|itemId, ...item fields } → { rowsAffected }.
export const updateWorkDetail = { body: workDetailIdBody, response: rowsAffected } as const;

// DELETE /api/deleteworkdetail — { detailId|itemId } → { rowsAffected }.
export const deleteWorkDetail = { body: workDetailIdBody, response: rowsAffected } as const;

// ===========================================================================
// DIAGNOSIS
// ===========================================================================

// POST /api/diagnosis — upsert; loose guard (work_id + diagnosis + treatment_plan
// required, the rest of the ~45 cephalometric fields pass through). sendSuccess(null)
// response is kept (no payload) → no `response` key here.
export const diagnosis = {
  body: z.looseObject({
    work_id: intId,
    diagnosis: z.string().trim().min(1),
    treatment_plan: z.string().trim().min(1),
  }),
} as const;
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

// POST /api/work/:workId/transfer — body { targetPatientId } stays handler-checked
// (no existing validate()); response is the TransferWorkResult.
export const transfer = {
  response: z.looseObject({ workId: z.number() }),
} as const;
