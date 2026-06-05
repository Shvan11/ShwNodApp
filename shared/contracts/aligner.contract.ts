/**
 * API contract — aligner endpoints (Phase 5; the largest group — 30 endpoints,
 * 24 `validate()` sites). Imported by BOTH the Express routes (relative `.js`)
 * and the React app (`@shared` alias). One exported `const <action> = { body?,
 * params?, response } as const` per endpoint (+ standalone param schemas shared
 * across many endpoints); types via `z.infer`. See docs/shared-contract-progress.md
 * + the plan.
 *
 * Phase-5 scope decisions (see the dated Findings in the progress tracker):
 *
 *  - **`aligner.types.ts` is FOLDED into this contract** (the plan's named Phase-5
 *    goal). The canonical API-response ROW shapes (`AlignerDoctor`, `AlignerSet`,
 *    `AlignerBatch`, `AlignerNote`, `ArchformPatient`, `AlignerSetForMatch`) are
 *    authored here as Zod and re-exported from `aligner.types.ts` via `z.infer` —
 *    so the network-boundary types now live in `shared/` (single source of truth,
 *    both sides). The schemas mirror the prior hand-written interfaces EXACTLY
 *    (same optional/nullable shape), so consumers are structurally unchanged.
 *    UI-only types (`*WithAliases`, `*FormData`, `*ForBatch`/`*ForLabel`, hook
 *    returns) stay inline in `aligner.types.ts` — UI state, not an API boundary
 *    (CLAUDE.md). The pure-UI form `LabelData` body type also stays in the route.
 *
 *  - **Row schemas are TYPE-ONLY**: they are exported for their `z.infer` types but
 *    the array RESPONSES stay `anyArray` (`z.array(z.unknown())`) — the Phase 3/4
 *    "minimal responses + keep consumer generics" decision, here applied to the
 *    extreme multi-consumer shape (AlignerSet is mirrored across PatientSets /
 *    AllSetsList / forms). `anyArray` asserts the N13 array-vs-object class AND
 *    accepts an `interface[]` source with no query-row flip; plugging a rich row
 *    schema into the response (runtime row-field validation) is a later,
 *    runtime-verified hardening — NOT done blind here (a too-tight row would
 *    fail-loud on real data).
 *
 *  - **Mutation responses ARE modeled** (closed `z.object` inline-literals) — they
 *    carry stable scalar ids/flags the consumers key on (`setId`, `noteId`,
 *    `batchId`, the deliver/manufacture idempotency flags) and have no long-tail,
 *    so a closed object is correct and gives real drift detection. Closed
 *    `z.object` has no index signature, so an `interface`-typed `sendData` arg
 *    (e.g. `DeactivatedBatchInfo`, `PdfUploadResult`) assigns without a flip.
 *
 *  - **Bodies**: the small fully-enumerable ones (`createNote`, `updateNote`,
 *    the shared `targetDate` of manufacture/deliver) → `z.infer` SSoT. The rest
 *    forward wholesale to `AlignerService.validateAnd*` (the "validateAnd…" service
 *    owns those shapes) → they keep their EXISTING loose guard relocated verbatim
 *    and the route keeps its local body interface (the documented service-bound
 *    caveat). `archformPatient` keeps the `{ name }`-only guard verbatim (the
 *    handler does its own `lastName` check with a specific 400 — don't change that
 *    semantics by enumerating it here).
 *
 *  - **Not contracted**: `POST /aligner/labels/generate` sends a RAW PDF buffer
 *    (`res.send`, not the `sendSuccess` envelope) — like the raw diagnosis-GET in
 *    work, it stays out of the response contract (only its request `body` is here).
 *    The Archform 503 "unavailable" branches are error responses, left as-is.
 */
import { z } from 'zod';
import { idParams, intId, optionalDateString } from '../validation.js';

/** Minimal array guard: asserts the container is an array (the N13 array-vs-object
 *  class) while accepting any element — including an `interface[]` source, with no
 *  query-row `interface`→`type` flip (everything is assignable to `unknown`). */
const anyArray = z.array(z.unknown());

// The aligner set/batch forms send numeric fields as STRINGS ('' when blank) and
// batch end-sequences as `null`. Both must collapse to `undefined` (NOT 0) so the
// service `*Data` optionals hold; a chosen value coerces to a number. The bodies
// below enumerate the full service `*Data` field set (the route interfaces were
// incomplete), so a strict `z.object` strips only fields the service never reads.
const optInt = z
  .preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().optional())
  .optional();
const optNum = z
  .preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().optional())
  .optional();

// One print label (GenerateLabelsBody.labels[]). The handler does its own per-label
// `!text`/`!patientName` 400s, so these stay plain `z.string()` (empty reaches the
// handler's specific message) — modeled, not opaque, so the handler can read them.
const labelData = z.object({
  text: z.string(),
  patientName: z.string(),
  doctorName: z.string().optional(),
  includeLogo: z.boolean().optional(),
});

// ===========================================================================
// Shared param schemas (referenced directly in the route's validate()).
// ===========================================================================

export const setIdParams = idParams('setId');
export const noteIdParams = idParams('noteId');
export const batchIdParams = idParams('batchId');
export const drIdParams = idParams('drID');
export const archformPatientIdParams = idParams('id');

// ===========================================================================
// CANONICAL ROW SCHEMAS — authored for their `z.infer` TYPES (folded into
// aligner.types.ts). NOT plugged into the array responses below (those stay
// `anyArray`); see the file header. Mirror the prior hand-written interfaces
// exactly so consumers are structurally unchanged. `z.object` (not looseObject)
// → clean inferred types with NO string index signature, matching the old
// interfaces. Date columns are modeled as `string` here (the FE-facing type);
// runtime row validation (where `timestampString` would matter) is deferred.
// ===========================================================================

/** Full AlignerDoctor (DB snake_case). */
export const alignerDoctorRow = z.object({
  dr_id: z.number(),
  doctor_name: z.string(),
  doctor_email: z.string().nullish(),
  logo_path: z.string().nullish(),
});
export type AlignerDoctor = z.infer<typeof alignerDoctorRow>;

/** Full AlignerSet (backend snake_case response — the canonical set shape). */
export const alignerSetRow = z.object({
  aligner_set_id: z.number(),
  set_sequence: z.number(),
  type: z.string().optional(),
  upper_aligners_count: z.number(),
  lower_aligners_count: z.number(),
  remaining_upper_aligners: z.number(),
  remaining_lower_aligners: z.number(),
  days: z.number().optional(),
  aligner_dr_id: z.number().optional(),
  AlignerDoctorName: z.string().optional(),
  set_url: z.string().optional(),
  set_pdf_url: z.string().optional(),
  set_video: z.string().optional(),
  set_cost: z.number().optional(),
  currency: z.string().optional(),
  notes: z.string().optional(),
  archform_id: z.number().nullish(),
  is_active: z.boolean(),
  creation_date: z.string().optional(),
  TotalBatches: z.number().optional(),
  DeliveredBatches: z.number().optional(),
  TotalPaid: z.number().optional(),
  Balance: z.number().optional(),
  PaymentStatus: z.string().optional(),
  UnreadActivityCount: z.number().optional(),
});
export type AlignerSet = z.infer<typeof alignerSetRow>;

/** Full AlignerBatch (backend snake_case response). */
export const alignerBatchRow = z.object({
  aligner_batch_id: z.number(),
  aligner_set_id: z.number(),
  batch_sequence: z.number(),
  upper_aligner_count: z.number().optional(),
  lower_aligner_count: z.number().optional(),
  upper_aligner_start_sequence: z.number().optional(),
  upper_aligner_end_sequence: z.number().optional(),
  lower_aligner_start_sequence: z.number().optional(),
  lower_aligner_end_sequence: z.number().optional(),
  days: z.number().optional(),
  validity_period: z.number().optional(),
  manufacture_date: z.string().nullish(),
  delivered_to_patient_date: z.string().nullish(),
  batch_expiry_date: z.string().nullish(),
  notes: z.string().optional(),
  creation_date: z.string().optional(),
  // Form-specific fields (used in BatchFormDrawer)
  is_active: z.boolean().optional(),
  is_last: z.boolean().optional(),
  has_upper_template: z.boolean().optional(),
  has_lower_template: z.boolean().optional(),
});
export type AlignerBatch = z.infer<typeof alignerBatchRow>;

/** Communication note between lab and doctor. */
export const alignerNoteRow = z.object({
  note_id: z.number(),
  aligner_set_id: z.number(),
  note_type: z.enum(['Lab', 'Doctor']),
  note_text: z.string(),
  doctor_name: z.string().optional(),
  created_at: z.string(),
  is_read: z.boolean(),
  is_edited: z.boolean().optional(),
});
export type AlignerNote = z.infer<typeof alignerNoteRow>;

/** Patient record from the Archform SQLite database. */
export const archformPatientRow = z.object({
  Id: z.number(),
  Name: z.string(),
  LastName: z.string(),
  CreatedDate: z.string(),
  LastModifiedDate: z.string().nullable(),
});
export type ArchformPatient = z.infer<typeof archformPatientRow>;

/** Aligner set with patient context for Archform matching. */
export const alignerSetForMatchRow = z.object({
  aligner_set_id: z.number(),
  work_id: z.number(),
  person_id: z.number(),
  archform_id: z.number().nullable(),
  patient_name: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  set_sequence: z.number().nullable(),
  doctor_name: z.string(),
});
export type AlignerSetForMatch = z.infer<typeof alignerSetForMatchRow>;

// ===========================================================================
// READS — inline-literal `{ <array>, count, … }` containers built in the
// handler. Closed `z.object` container (exactly the keys the handler builds) +
// `anyArray` rows (see header). `count`/`noNextBatchCount` always present.
// ===========================================================================

// GET /api/aligner/doctors — doctors with unread counts.
export const alignerDoctors = {
  response: z.object({ doctors: anyArray, count: z.number() }),
} as const;

// GET /api/aligner/all-sets — v_allsets view rows.
export const allSets = {
  response: z.object({ sets: anyArray, count: z.number(), noNextBatchCount: z.number() }),
} as const;

// GET /api/aligner/patients/all — all aligner patients (all doctors).
export const allPatients = {
  response: z.object({ patients: anyArray, count: z.number() }),
} as const;

// GET /api/aligner/patients/by-doctor/:doctorId — patients for one doctor.
export const patientsByDoctor = {
  response: z.object({ patients: anyArray, count: z.number() }),
} as const;

// GET /api/aligner/patients?search&doctorId — patient search.
export const searchAlignerPatients = {
  response: z.object({ patients: anyArray, count: z.number() }),
} as const;

// GET /api/aligner/sets/:workId — sets for a work.
export const setsByWorkId = {
  response: z.object({ sets: anyArray, count: z.number() }),
} as const;

// GET /api/aligner/batches/:setId — batches for a set.
export const batchesBySetId = {
  response: z.object({ batches: anyArray, count: z.number() }),
} as const;

// GET /api/aligner/notes/:setId — notes for a set.
export const notesBySetId = {
  response: z.object({ notes: anyArray, count: z.number() }),
} as const;

// GET /api/aligner/notes/:noteId/status — { isRead } (or 404).
export const noteStatus = {
  response: z.object({ isRead: z.boolean() }),
} as const;

// GET /api/aligner/archform/patients — Archform SQLite patients.
export const archformPatients = {
  response: z.object({ patients: anyArray, count: z.number() }),
} as const;

// GET /api/aligner/archform/status — { available, path, error? }.
export const archformStatus = {
  response: z.object({ available: z.boolean(), path: z.string(), error: z.string().optional() }),
} as const;

// GET /api/aligner/archform/matches — sets carrying archform_id, for the match UI.
export const archformMatches = {
  response: z.object({ sets: anyArray, count: z.number() }),
} as const;

// GET /api/aligner-doctors — { doctors } (no count).
export const doctorsList = {
  response: z.object({ doctors: anyArray }),
} as const;

// ===========================================================================
// SETS — CRUD
// ===========================================================================

// POST /api/aligner/payments — fully enumerated (mirrors PaymentCreateData; the
// client's `currency`/`actual_*` extras are stripped — the service never reads
// them). `amount_paid` coerced (form sends a string); `change` may arrive null.
export const addPayment = {
  body: z.object({
    workid: intId,
    aligner_set_id: intId,
    amount_paid: z.coerce.number(),
    date_of_payment: z.string().min(1),
    usd_received: optNum,
    iqd_received: optNum,
    change: optNum,
    notes: z.string().optional(),
  }),
  response: z.object({ invoice_id: z.number() }),
} as const;
export type AddPaymentBody = z.infer<typeof addPayment.body>;

// POST /api/aligner/sets — fully enumerated (mirrors SetCreateData). SetFormDrawer
// sends a subset; numeric fields are strings/'' → coerced via optInt/optNum.
export const createSet = {
  body: z.object({
    work_id: intId,
    aligner_dr_id: intId,
    is_active: z.boolean().optional(),
    TotalAligners: optInt,
    RemainingAligners: optInt,
    set_cost: optNum,
    notes: z.string().optional(),
    set_sequence: optInt,
    type: z.string().optional(),
    upper_aligners_count: optInt,
    lower_aligners_count: optInt,
  }),
  response: z.object({ setId: z.number() }),
} as const;
export type CreateSetBody = z.infer<typeof createSet.body>;

// PUT /api/aligner/sets/:setId — fully enumerated (mirrors SetUpdateData; all
// optional). sendSuccess(null) — no response key.
export const updateSet = {
  body: z.object({
    aligner_dr_id: optInt,
    is_active: z.boolean().optional(),
    TotalAligners: optInt,
    RemainingAligners: optInt,
    set_cost: optNum,
    notes: z.string().optional(),
    set_sequence: optInt,
    type: z.string().optional(),
    upper_aligners_count: optInt,
    lower_aligners_count: optInt,
  }),
} as const;
export type UpdateSetBody = z.infer<typeof updateSet.body>;

// DELETE /api/aligner/sets/:setId — sendSuccess(null).

// ===========================================================================
// NOTES
// ===========================================================================

// POST /api/aligner/notes — fully enumerated → SSoT (passed as scalars to the
// service). { aligner_set_id, note_text }.
export const createNote = {
  body: z.object({ aligner_set_id: intId, note_text: z.string().min(1) }),
  response: z.object({ noteId: z.number() }),
} as const;
export type CreateNoteBody = z.infer<typeof createNote.body>;

// PATCH /api/aligner/notes/:noteId/toggle-read — sendSuccess(null).

// PATCH /api/aligner/notes/:noteId — fully enumerated → SSoT. { note_text }.
export const updateNote = {
  body: z.object({ note_text: z.string().min(1) }),
} as const;
export type UpdateNoteBody = z.infer<typeof updateNote.body>;

// DELETE /api/aligner/notes/:noteId — sendSuccess(null).

// ===========================================================================
// BATCHES
// ===========================================================================

// POST /api/aligner/batches — fully enumerated (mirrors BatchCreateData). The
// form's `is_last` extra is stripped (BatchCreateData has none on create); end
// sequences arrive null → undefined via optInt.
export const createBatch = {
  body: z.object({
    aligner_set_id: intId,
    is_active: z.boolean().optional(),
    batch_sequence: optInt,
    AlignersInBatch: optInt,
    notes: z.string().optional(),
    upper_aligner_count: optInt,
    lower_aligner_count: optInt,
    upper_aligner_start_sequence: optInt,
    upper_aligner_end_sequence: optInt,
    lower_aligner_start_sequence: optInt,
    lower_aligner_end_sequence: optInt,
    days: optInt,
    validity_period: optInt,
    has_upper_template: z.boolean().optional(),
    has_lower_template: z.boolean().optional(),
  }),
  response: z.object({
    batchId: z.number(),
    deactivatedBatch: z.object({ batchId: z.number(), batchSequence: z.number() }).nullable(),
  }),
} as const;
export type CreateBatchBody = z.infer<typeof createBatch.body>;

// PUT /api/aligner/batches/:batchId — fully enumerated (mirrors BatchUpdateData).
// Response is the handler's `Record<string, unknown>` (optional `deactivatedBatch`)
// → open `looseObject({})` so the Record arg assigns and nothing is stripped.
export const updateBatch = {
  body: z.object({
    aligner_set_id: optInt,
    is_active: z.boolean().optional(),
    batch_sequence: optInt,
    AlignersInBatch: optInt,
    notes: z.string().optional(),
    upper_aligner_count: optInt,
    lower_aligner_count: optInt,
    upper_aligner_start_sequence: optInt,
    upper_aligner_end_sequence: optInt,
    lower_aligner_start_sequence: optInt,
    lower_aligner_end_sequence: optInt,
    days: optInt,
    is_last: z.boolean().optional(),
    has_upper_template: z.boolean().optional(),
    has_lower_template: z.boolean().optional(),
  }),
  response: z.looseObject({}),
} as const;
export type UpdateBatchBody = z.infer<typeof updateBatch.body>;

// Shared OPTIONAL targetDate body for manufacture/deliver (backdating). The
// handlers read only `targetDate` → SSoT (strict; nothing else is read).
export const targetDateBody = z.object({ targetDate: optionalDateString });
export type TargetDateBody = z.infer<typeof targetDateBody>;

// PATCH /api/aligner/batches/:batchId/manufacture.
export const manufactureBatch = {
  body: targetDateBody,
  response: z.object({
    batchId: z.number(),
    batchSequence: z.number(),
    action: z.string(),
    wasAlreadyManufactured: z.boolean(),
  }),
} as const;

// PATCH /api/aligner/batches/:batchId/deliver.
export const deliverBatch = {
  body: targetDateBody,
  response: z.object({
    batchId: z.number(),
    batchSequence: z.number(),
    setId: z.number(),
    wasActivated: z.boolean(),
    wasAlreadyActive: z.boolean(),
    wasAlreadyDelivered: z.boolean(),
    previouslyActiveBatchSequence: z.number().nullable(),
  }),
} as const;

// Shared { batchId, batchSequence } result of the undo endpoints.
const batchSeqResult = z.object({ batchId: z.number(), batchSequence: z.number() });

// PATCH /api/aligner/batches/:batchId/undo-manufacture.
export const undoManufacture = { response: batchSeqResult } as const;

// PATCH /api/aligner/batches/:batchId/undo-deliver.
export const undoDeliver = { response: batchSeqResult } as const;

// DELETE /api/aligner/batches/:batchId — sendSuccess(null).

// ===========================================================================
// PDF UPLOAD / DELETE
// ===========================================================================

// POST /api/aligner/sets/:setId/upload-pdf — { url, fileName, size } (PdfUploadResult;
// `size` is typed `string | number` in the service result → union here).
export const uploadPdf = {
  response: z.object({ url: z.string(), fileName: z.string(), size: z.union([z.string(), z.number()]) }),
} as const;

// DELETE /api/aligner/sets/:setId/pdf — sendSuccess(null).

// ===========================================================================
// ARCHFORM PATIENT MATCHING
// ===========================================================================

// PATCH /api/aligner/sets/:setId/archform — sendSuccess(null) (save/clear archform_id).

// PUT /api/aligner/archform/patients/:id — { name, lastName }. The handler does
// its own `!name`/`!lastName` 400 (with a specific message), so both stay
// permissive here (lastName optional; the handler enforces it). sendSuccess(null).
export const updateArchformPatient = {
  body: z.object({ name: z.string().min(1), lastName: z.string().optional() }),
} as const;
export type UpdateArchformPatientBody = z.infer<typeof updateArchformPatient.body>;

// DELETE /api/aligner/archform/patients/:id — { deletedFromTables }.
export const deleteArchformPatient = {
  response: z.object({ deletedFromTables: z.array(z.string()) }),
} as const;

// ===========================================================================
// LABEL GENERATION (request-only — raw PDF response, not enveloped)
// ===========================================================================

// POST /api/aligner/labels/generate — fully enumerated. `labels` modeled as
// `labelData[]` (the handler reads `.text`/`.patientName`), `arabicFont` enumerated
// (the handler defaults 'cairo'). Response is a raw PDF buffer (res.send) → NOT modeled.
export const generateLabels = {
  body: z.object({
    labels: z.array(labelData).min(1, 'No labels to generate'),
    startingPosition: z.coerce.number().int(),
    arabicFont: z.enum(['cairo', 'noto']).optional(),
  }),
} as const;
export type GenerateLabelsBody = z.infer<typeof generateLabels.body>;

// ===========================================================================
// DOCTORS — CRUD
// ===========================================================================

// Shared doctor body (create + update → DoctorCreateData/DoctorUpdateData) — fully
// enumerated. The client's `logo_path` extra is stripped (the service has no such
// field; the logo is set via a separate upload).
export const doctorBody = z.object({
  doctor_name: z.string().trim().min(1),
  doctor_email: z.string().optional(),
  DoctorPhone: z.string().optional(),
  is_active: z.boolean().optional(),
  Address: z.string().optional(),
  notes: z.string().optional(),
});
export type DoctorBody = z.infer<typeof doctorBody>;

// POST /api/aligner-doctors — { drID }.
export const createDoctor = {
  body: doctorBody,
  response: z.object({ drID: z.number() }),
} as const;

// PUT /api/aligner-doctors/:drID — sendSuccess(null).
export const updateDoctor = { body: doctorBody } as const;

// DELETE /api/aligner-doctors/:drID — sendSuccess(null).
