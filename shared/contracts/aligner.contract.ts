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
 *  - **Row schemas use `z.looseObject`** (Phase 3 hardening): preserves long-tail
 *    fields the UI reads (joined columns, aliases). Array responses carry
 *    `z.array(<rowSchema>)` — runtime-verified on real DB data. Source types in
 *    aligner-queries.ts were flipped from `interface`→`type` to satisfy the
 *    looseObject index-signature assignment rule. `allSetsRow` and `alignerPatientRow`
 *    are new schemas for the v_allsets view and patient-list endpoints.
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
import { idParams, intId, optionalDateString, timestampString } from '../validation.js';

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
// CANONICAL ROW SCHEMAS — `z.looseObject` preserves long-tail fields (joined
// columns, aliased props) the UI reads. Plugged into array responses below.
// `timestampString` on PG `timestamp` columns (server-side Date → ISO string).
// PG `date` columns are already `string` both sides → plain `z.string()`.
// ===========================================================================

/** Full AlignerDoctor (DB snake_case). UnreadDoctorNotes present on the main
 *  /aligner/doctors endpoint (getDoctorsWithUnreadCounts); absent on /aligner-doctors
 *  (getAllDoctors) — optional here to cover both. */
export const alignerDoctorRow = z.looseObject({
  dr_id: z.number(),
  doctor_name: z.string(),
  doctor_email: z.string().nullish(),
  logo_path: z.string().nullish(),
  UnreadDoctorNotes: z.number().optional(),
});
export type AlignerDoctor = z.infer<typeof alignerDoctorRow>;

/** Full AlignerSet (backend snake_case response — the canonical set shape). */
export const alignerSetRow = z.looseObject({
  aligner_set_id: z.number(),
  set_sequence: z.number().nullable(),
  type: z.string().nullish(),
  upper_aligners_count: z.number(),
  lower_aligners_count: z.number(),
  remaining_upper_aligners: z.number(),
  remaining_lower_aligners: z.number(),
  days: z.number().nullish(),
  aligner_dr_id: z.number().optional(),
  AlignerDoctorName: z.string().nullish(),
  set_url: z.string().nullish(),
  set_pdf_url: z.string().nullish(),
  set_video: z.string().nullish(),
  set_cost: z.number().nullish(),
  currency: z.string().nullish(),
  notes: z.string().nullish(),
  archform_id: z.number().nullish(),
  is_active: z.boolean(),
  creation_date: z.string().nullish(),
  TotalBatches: z.number().optional(),
  DeliveredBatches: z.number().optional(),
  TotalPaid: z.number().nullish(),
  Balance: z.number().nullish(),
  PaymentStatus: z.string().nullish(),
  UnreadActivityCount: z.number().optional(),
});
export type AlignerSet = z.infer<typeof alignerSetRow>;

/** Full AlignerBatch (backend snake_case response).
 *  creation_date is a PG `timestamp` column → timestampString (Date server-side). */
export const alignerBatchRow = z.looseObject({
  aligner_batch_id: z.number(),
  aligner_set_id: z.number(),
  batch_sequence: z.number(),
  upper_aligner_count: z.number().optional(),
  lower_aligner_count: z.number().optional(),
  upper_aligner_start_sequence: z.number().nullish(),
  upper_aligner_end_sequence: z.number().nullish(),
  lower_aligner_start_sequence: z.number().nullish(),
  lower_aligner_end_sequence: z.number().nullish(),
  days: z.number().nullish(),
  validity_period: z.number().nullish(),
  manufacture_date: z.string().nullish(),
  delivered_to_patient_date: z.string().nullish(),
  batch_expiry_date: z.string().nullish(),
  notes: z.string().nullish(),
  creation_date: timestampString.optional(),
  // Form-specific fields (used in BatchFormDrawer)
  is_active: z.boolean().optional(),
  is_last: z.boolean().optional(),
  has_upper_template: z.boolean().optional(),
  has_lower_template: z.boolean().optional(),
});
export type AlignerBatch = z.infer<typeof alignerBatchRow>;

/** Communication note between lab and doctor.
 *  created_at is a PG `timestamp` column → timestampString (Date server-side). */
export const alignerNoteRow = z.looseObject({
  note_id: z.number(),
  aligner_set_id: z.number(),
  note_type: z.enum(['Lab', 'Doctor']),
  note_text: z.string(),
  doctor_name: z.string().optional(),
  created_at: timestampString,
  is_read: z.boolean(),
  is_edited: z.boolean().optional(),
});
export type AlignerNote = z.infer<typeof alignerNoteRow>;

/** Patient record from the Archform SQLite database. */
export const archformPatientRow = z.looseObject({
  Id: z.number(),
  Name: z.string(),
  LastName: z.string(),
  CreatedDate: z.string(),
  LastModifiedDate: z.string().nullable(),
});
export type ArchformPatient = z.infer<typeof archformPatientRow>;

/** Aligner set with patient context for Archform matching. */
export const alignerSetForMatchRow = z.looseObject({
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

/** v_allsets view row — joined shape for AllSetsList.tsx (different from alignerSetRow).
 *  PG `date` columns (creation_date, manufacture_date, etc.) are already strings.
 *  BatchCreationDate (timestamp) and WorkStatusName are not read by the UI; they
 *  pass through via looseObject. */
export const allSetsRow = z.looseObject({
  person_id: z.number(),
  work_id: z.number(),
  aligner_set_id: z.number(),
  aligner_dr_id: z.number(),
  patient_name: z.string(),
  doctor_name: z.string(),
  set_sequence: z.number().nullable(),
  batch_sequence: z.number().nullable(),
  SetIsActive: z.boolean(),
  is_last: z.boolean().nullable(),
  WorkStatus: z.number().nullable(),
  delivered_to_patient_date: z.string().nullable(),
  NextDueDate: z.string().nullable(),
  NextBatchPresent: z.string().nullable(),
  LabStatus: z.string().nullable(),
  notes: z.string().nullable(),
  creation_date: z.string().nullable(),
  manufacture_date: z.string().nullable(),
});
export type AlignerSetView = z.infer<typeof allSetsRow>;

/** Patient list row for all-patients / by-doctor / search endpoints.
 *  DateOfBirth and start_date (PG timestamp/date) are not read by UI; pass through. */
export const alignerPatientRow = z.looseObject({
  person_id: z.number(),
  workid: z.number(),
  patient_name: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone: z.string().nullable(),
  work_type: z.string(),
  WorkTypeID: z.number(),
  TotalSets: z.number().optional(),
  ActiveSets: z.number().optional(),
  UnreadDoctorNotes: z.number().optional(),
});
export type AlignerPatient = z.infer<typeof alignerPatientRow>;

// ===========================================================================
// READS — inline-literal `{ <array>, count, … }` containers built in the
// handler. Closed `z.object` container (exactly the keys the handler builds) +
// modeled row arrays. `count`/`noNextBatchCount` always present.
// ===========================================================================

// GET /api/aligner/doctors — doctors with unread counts.
export const alignerDoctors = {
  response: z.object({ doctors: z.array(alignerDoctorRow), count: z.number() }),
} as const;

// GET /api/aligner/all-sets — v_allsets view rows (allSetsRow, not alignerSetRow).
export const allSets = {
  response: z.object({ sets: z.array(allSetsRow), count: z.number(), noNextBatchCount: z.number() }),
} as const;

// GET /api/aligner/patients/all — all aligner patients (all doctors).
export const allPatients = {
  response: z.object({ patients: z.array(alignerPatientRow), count: z.number() }),
} as const;

// GET /api/aligner/patients/by-doctor/:doctorId — patients for one doctor.
export const patientsByDoctor = {
  response: z.object({ patients: z.array(alignerPatientRow), count: z.number() }),
} as const;

// GET /api/aligner/patients?search&doctorId — patient search.
export const searchAlignerPatients = {
  response: z.object({ patients: z.array(alignerPatientRow), count: z.number() }),
} as const;

// GET /api/aligner/sets/:workId — sets for a work.
export const setsByWorkId = {
  response: z.object({ sets: z.array(alignerSetRow), count: z.number() }),
} as const;

// GET /api/aligner/batches/:setId — batches for a set.
export const batchesBySetId = {
  response: z.object({ batches: z.array(alignerBatchRow), count: z.number() }),
} as const;

// GET /api/aligner/notes/:setId — notes for a set.
export const notesBySetId = {
  response: z.object({ notes: z.array(alignerNoteRow), count: z.number() }),
} as const;

// GET /api/aligner/notes/:noteId/status — { isRead } (or 404).
export const noteStatus = {
  response: z.object({ isRead: z.boolean() }),
} as const;

// GET /api/aligner/archform/patients — Archform SQLite patients.
export const archformPatients = {
  response: z.object({ patients: z.array(archformPatientRow), count: z.number() }),
} as const;

// GET /api/aligner/archform/status — { available, path, error? }.
export const archformStatus = {
  response: z.object({ available: z.boolean(), path: z.string(), error: z.string().optional() }),
} as const;

// GET /api/aligner/archform/matches — sets carrying archform_id, for the match UI.
export const archformMatches = {
  response: z.object({ sets: z.array(alignerSetForMatchRow), count: z.number() }),
} as const;

// GET /api/aligner-doctors — { doctors } (no count).
export const doctorsList = {
  response: z.object({ doctors: z.array(alignerDoctorRow) }),
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

// GET /api/aligner/patients?search=&doctorId= — type-only (handler reads both directly).
export const patientsQuery = z.object({
  search: z.string().optional(),
  doctorId: z.string().optional(),
});
export type AlignerQueryParams = z.infer<typeof patientsQuery>;
