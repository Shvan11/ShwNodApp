/**
 * API contract — aligner endpoints (Phase 5; the largest group — 30 endpoints,
 * 24 `validate()` sites). Imported by BOTH the Express routes (relative `.js`)
 * and the React app (`@shared` alias). One exported `const <action> = { body?,
 * params?, response } as const` per endpoint (+ standalone param schemas shared
 * across many endpoints); types via `z.infer`. (The rollout tracker this header
 * used to cite is retired; `npm run gate` enforces the contract rules now.)
 *
 * Phase-5 scope decisions:
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
 *    the aligner-*-queries modules were flipped from `interface`→`type` to satisfy the
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
 *    forward wholesale to the `Aligner*Service.validateAnd*` (the "validateAnd…" service
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
import {
  idParams,
  intId,
  moneyDecimal,
  moneyInt,
  NUMERIC_10_2_MAX,
  numericParam,
  optionalDateString,
  timestampString,
} from '../validation.js';
import { PDF_ARABIC_FONT_IDS } from '../pdf-fonts.js';

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

// Clearable numerics — for PARTIAL-update bodies only. The form always sends the
// field and uses '' for "user blanked it", so '' (and null) must survive as null
// ("clear the column"), distinct from an absent key ("leave unchanged"). optInt/
// optNum can't be used there: they collapse '' to undefined, making a clear
// indistinguishable from an omission. (There is no plain `clearableNum` — the one
// clearable numeric field, set_cost, carries its own money rule below.)
const clearableInt = z
  .preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().int().nullable())
  .optional();
// Same clearable contract for strings: a plain `z.string().optional()` rejects
// `null` outright, which broke updateSet whenever the caller round-tripped a
// GET row (alignerSetRow types notes/type/set_url/set_video/currency nullable)
// or explicitly cleared a field — both send `null`, not `''`.
const clearableStr = z
  .preprocess((v) => (v === '' ? null : v), z.string().nullable())
  .optional();

// `aligner_sets.set_cost` — the optional/clearable pair above, but carrying the sign + ceiling rule
// every other money field has. It is `numeric(10,2)` (decimals are legitimate, so `moneyInt` does
// not apply), and that exemption is what dropped the sign rule: a negative set cost makes
// PaymentStatus read 'Paid' at zero paid and makes the set unpayable forever (audit F6).
const setCost = moneyDecimal(NUMERIC_10_2_MAX);
const optSetCost = z.preprocess((v) => (v === '' || v === null ? undefined : v), setCost.optional()).optional();
const clearableSetCost = z
  .preprocess((v) => (v === '' || v === null ? null : v), setCost.nullable())
  .optional();

// Aligner-set currency is USD-ONLY, enforced here rather than left to the UI.
// The lab bills external doctors in USD; more importantly the payment path has no
// representation for anything else — `createAlignerPayment` books the amount into
// `invoices.usd_received`/`iqd_received` (two columns, no third), and the cash-box
// reports read exactly those. A set priced in another currency would validate its
// balance in that currency while its payments were still booked as USD cash.
// Two shapes, matching how the two bodies are built:
//  - create: a fresh form that always sends 'USD' → 'USD' or omitted (optInt-style,
//    ''/null collapse to undefined, so it stays assignable to SetCreateData).
//  - update: clearableStr-style (null survives), because the quick-edit paths in
//    PatientSets round-trip a whole GET row and legacy rows carry `currency: null`
//    (which every reader already renders as USD via `|| 'USD'`).
const usdOnlyCurrencyCreate = z
  .preprocess((v) => (v === '' || v === null ? undefined : v), z.literal('USD').optional())
  .optional();
const usdOnlyCurrencyUpdate = z
  .preprocess((v) => (v === '' ? null : v), z.literal('USD').nullable())
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
  DeliveredAligners: z.number().optional(),
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

/** Case attachment (photo or scan file) living in R2 storage. */
export const alignerPhotoRow = z.looseObject({
  path: z.string(),
  file_name: z.string(),
  file_size: z.number().int().nullable(),
  mime_type: z.string().nullable(),
  uploaded_at: z.string().nullable(),
  view_url: z.string(),
});
export type AlignerPhoto = z.infer<typeof alignerPhotoRow>;

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
  work_closed: z.boolean(),
});
export type AlignerSetForMatch = z.infer<typeof alignerSetForMatchRow>;

/** `works.status` values that close out a treatment (2 = Finished, 3 = Discontinued). */
export const CLOSED_WORK_STATUSES = [2, 3] as const;
export const isClosedWorkStatus = (status: number | null): boolean =>
  status !== null && (CLOSED_WORK_STATUSES as readonly number[]).includes(status);

/** v_allsets view row — joined shape for AllSetsList.tsx (different from alignerSetRow).
 *  PG `date` columns (delivered_to_patient_date, NextDueDate) are already strings. */
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
  // PG timestamp: Date on the server (dev-parse), ISO string on the client.
  NextAppointment: timestampString.nullable(),
  NextBatchPresent: z.boolean(),
  LabStatus: z.string().nullable(),
  notes: z.string().nullable(),
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
  /** The first session's Smile thumbnail by its real file name, or null (the lists only). FE-F18-8. */
  smile_file: z.string().nullable().optional(),
});
export type AlignerPatient = z.infer<typeof alignerPatientRow>;

// ===========================================================================
// READS — inline-literal `{ <array>, count, … }` containers built in the
// handler. Closed `z.object` container (exactly the keys the handler builds) +
// modeled row arrays. `count` present where the handler builds it.
// ===========================================================================

// GET /api/aligner/doctors — doctors with unread counts.
export const alignerDoctors = {
  response: z.object({ doctors: z.array(alignerDoctorRow), count: z.number() }),
} as const;

// GET /api/aligner/all-sets — v_allsets view rows (allSetsRow, not alignerSetRow).
// By default only ACTIVE sets of OPEN works; `inactive=1` / `finished=1` opt into
// the history (FE-F18-13: every set ever made was downloaded and filtered in the
// browser). `hidden` counts what the default left out, for the two toggles.
export const allSets = {
  query: z.object({
    inactive: z.enum(['0', '1']).optional(),
    finished: z.enum(['0', '1']).optional(),
  }),
  response: z.object({
    sets: z.array(allSetsRow),
    hidden: z.object({ inactive: z.number(), finished: z.number() }),
  }),
} as const;
export type AllSetsQuery = z.infer<typeof allSets.query>;

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

// DELETE /api/aligner/sets/:setId/photos?path= — the R2 key to remove. Validated
// so a repeated `?path=a&path=b` (an ARRAY from Express's query parser) 400s here
// rather than reaching `key.startsWith(...)` and throwing a TypeError → 500.
export const deletePhotoQuery = z.object({ path: z.string().min(1) });
export type DeletePhotoQuery = z.infer<typeof deletePhotoQuery>;

// GET /api/aligner/sets/:setId/photos — photos for a set.
export const getSetPhotos = {
  response: z.object({ photos: z.array(alignerPhotoRow) }),
} as const;

// GET /api/aligner/notes/:noteId/status — { isRead } (or 404).
export const noteStatus = {
  response: z.object({ isRead: z.boolean() }),
} as const;

// GET /api/aligner/archform/patients — Archform SQLite patients.
export const archformPatients = {
  response: z.object({ patients: z.array(archformPatientRow), count: z.number() }),
} as const;

// GET /api/aligner/archform/status — { available, configured, path, error? }.
// `configured` false = this install has no ARCHFORM_DB_PATH (FE-F18-4).
export const archformStatus = {
  response: z.object({
    available: z.boolean(),
    configured: z.boolean(),
    path: z.string(),
    error: z.string().optional(),
  }),
} as const;

// GET /api/aligner/features — which optional integrations this install uses, so the
// aligner screens offer only those (owner decision 2026-10-04, FE-F18-4 / FE-F18-12):
// `archform` = an ARCHFORM_DB_PATH is set; `portal` = a doctor-portal mirror
// (SUPABASE_FAILOVER_DB_URL) is configured — without one, announcements and portal
// access mean nothing.
export const alignerFeatures = {
  response: z.object({ archform: z.boolean(), portal: z.boolean() }),
} as const;
export type AlignerFeatures = z.infer<typeof alignerFeatures.response>;

// GET /api/aligner/archform/matches — every aligner set (linked or not) with its
// patient, for the match UI's dropdowns and its "linked" map.
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
//
// No `usd_received`/`iqd_received`: no client sends them and createAlignerPayment
// derives the cash split itself from `amount_paid` + the set currency, so accepting
// them only advertised a field the write path overwrote.
export const addPayment = {
  body: z.object({
    workid: intId,
    aligner_set_id: intId,
    // `invoices.amount_paid` is an `integer` column — a fractional value used to
    // reach PG as-is and come back as `22P02` → 500. `.positive()` mirrors
    // `AlignerPaymentService.validateAndCreatePayment`'s own `paymentAmount <= 0` throw, so
    // the rejection is a field-level 400 rather than a service error the route maps.
    amount_paid: moneyInt.positive('Payment amount must be greater than zero'),
    date_of_payment: z.string().min(1),
    change: optNum,
    notes: z.string().optional(),
  }),
  response: z.object({ invoice_id: z.number() }),
} as const;
export type AddPaymentBody = z.infer<typeof addPayment.body>;

// POST /api/aligner/sets — fully enumerated (mirrors SetCreateData). SetFormDrawer
// sends a subset; numeric fields are strings/'' → coerced via optInt/optNum.
// days/set_url/set_video/currency are form fields the query persists — they must
// be enumerated here or the strict body strips them and they save as NULL.
// set_pdf_url is deliberately absent: AlignerPdfService owns that column, and so
// are TotalAligners/RemainingAligners — retired SQL-Server-era names that
// createAlignerSet/updateAlignerSet never read (remaining_* is seeded from
// upper_aligners_count/lower_aligners_count). Enumerating them here meant the API
// accepted them and silently discarded them.
export const createSet = {
  body: z.object({
    work_id: intId,
    aligner_dr_id: intId,
    is_active: z.boolean().optional(),
    set_cost: optSetCost,
    notes: z.string().optional(),
    set_sequence: optInt,
    type: z.string().optional(),
    upper_aligners_count: optInt,
    lower_aligners_count: optInt,
    days: optInt,
    set_url: z.string().optional(),
    set_video: z.string().optional(),
    currency: usdOnlyCurrencyCreate,
  }),
  response: z.object({ setId: z.number() }),
} as const;
export type CreateSetBody = z.infer<typeof createSet.body>;

// PUT /api/aligner/sets/:setId — fully enumerated (mirrors SetUpdateData; all
// optional — the query only writes fields that are present, so an omitted field
// is left untouched, never nulled). set_cost/days/notes/type/set_url/set_video/
// set_pdf_url/currency are all clearable*: a blanked/cleared field arrives as
// null (or '') and clears the column — callers may also round-trip a GET row
// verbatim (alignerSetRow types these nullable), so `null` must be accepted,
// not just ''. set_pdf_url here is for the MANUAL "paste a link" quick-edit
// (PatientSets' inline PDF-URL editor) — the dedicated upload/delete-pdf
// endpoints remain the Drive-managed path and separately own `drive_file_id`;
// the two don't conflict (whichever wrote last wins, same as set_url/set_video).
export const updateSet = {
  body: z.object({
    aligner_dr_id: optInt,
    is_active: z.boolean().optional(),
    set_cost: clearableSetCost,
    notes: clearableStr,
    set_sequence: optInt,
    type: clearableStr,
    upper_aligners_count: optInt,
    lower_aligners_count: optInt,
    days: clearableInt,
    set_url: clearableStr,
    set_video: clearableStr,
    set_pdf_url: clearableStr,
    currency: usdOnlyCurrencyUpdate,
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

// PATCH /api/aligner/notes/read — SET the read state of the listed notes. It
// replaced `/notes/:noteId/toggle-read`: a toggle flipped a note back to unread
// whenever two tabs (or a double render) opened the same set (FE-F17-12). The
// page marks a doctor's notes read when they are actually on screen, and the
// checkbox sends the state it wants.
export const markNotesRead = {
  body: z.object({ noteIds: z.array(intId).min(1).max(500), isRead: z.boolean() }),
  response: z.object({ updated: z.number() }),
} as const;
export type MarkNotesReadBody = z.infer<typeof markNotesRead.body>;

// PATCH /api/aligner/notes/:noteId — fully enumerated → SSoT. { note_text }.
export const updateNote = {
  body: z.object({ note_text: z.string().min(1) }),
} as const;
export type UpdateNoteBody = z.infer<typeof updateNote.body>;

// DELETE /api/aligner/notes/:noteId — sendSuccess(null).

// ===========================================================================
// BATCHES
// ===========================================================================

// POST /api/aligner/batches — fully enumerated (mirrors BatchCreateData).
//
// Deliberately ABSENT because `aligner-batch-queries.createBatch` derives them and never
// reads a client value: `batch_sequence` + the four upper/lower start/end sequences
// (computed from MAX() over the set's existing batches) and `validity_period` (a
// generated column). `AlignersInBatch` is a retired SQL-Server-era column. All six
// used to be enumerated here, so the API accepted them and silently dropped them.
//
// `is_last` IS honoured by createBatch — it was missing from this body, so the
// drawer's "Mark as Last Batch" confirm was stripped on create (it only stuck on
// a subsequent edit).
export const createBatch = {
  body: z.object({
    aligner_set_id: intId,
    is_active: z.boolean().optional(),
    is_last: z.boolean().optional(),
    notes: z.string().optional(),
    upper_aligner_count: optInt,
    lower_aligner_count: optInt,
    days: optInt,
    has_upper_template: z.boolean().optional(),
    has_lower_template: z.boolean().optional(),
  }),
  response: z.object({
    batchId: z.number(),
    deactivatedBatch: z.object({ batchId: z.number(), batchSequence: z.number() }).nullable(),
  }),
} as const;
export type CreateBatchBody = z.infer<typeof createBatch.body>;
export type CreateBatchResponse = z.infer<typeof createBatch.response>;

// PUT /api/aligner/batches/:batchId — fully enumerated (mirrors BatchUpdateData).
// Same server-derived fields as createBatch are absent here (see above) —
// `updateBatch` recomputes sequences via resequenceSet and never reads them.
//
// A PARTIAL update: an omitted field is left as stored (FE-F17-1). It was a full
// replace that the drawer seeded from the page's cached batch list, so an edit
// made from a page loaded before the doctor changed `days` in the portal wrote the
// old days back, logged a "days changed" flag and forward-synced the revert. The
// drawer now sends only what the user changed. `days: null` clears the column
// (clearableInt keeps a null distinct from an omission). `aligner_set_id` is
// optional; when present it must equal the stored set — a batch cannot move.
// Response: `deactivatedBatch` when activating this batch turned another one off.
export const updateBatch = {
  body: z.object({
    aligner_set_id: optInt,
    is_active: z.boolean().optional(),
    notes: z.string().optional(),
    upper_aligner_count: optInt,
    lower_aligner_count: optInt,
    days: clearableInt,
    is_last: z.boolean().optional(),
    has_upper_template: z.boolean().optional(),
    has_lower_template: z.boolean().optional(),
  }),
  response: z.object({
    deactivatedBatch: z.object({ batchId: z.number(), batchSequence: z.number() }).optional(),
  }),
} as const;
export type UpdateBatchBody = z.infer<typeof updateBatch.body>;
export type UpdateBatchResponse = z.infer<typeof updateBatch.response>;

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

export type ManufactureBatchResponse = z.infer<typeof manufactureBatch.response>;

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
export type DeliverBatchResponse = z.infer<typeof deliverBatch.response>;

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
// `archformId` is the Archform SQLite patient id, or null to clear the match.
export const setArchformMatch = {
  body: z.object({ archformId: z.number().int().nullable() }),
} as const;
export type SetArchformMatchBody = z.infer<typeof setArchformMatch.body>;

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
    arabicFont: z.enum(PDF_ARABIC_FONT_IDS).optional(),
  }),
} as const;
export type GenerateLabelsBody = z.infer<typeof generateLabels.body>;

// GET /api/aligner/labels/settings — what the label dialog opens with:
// `nextPosition` is where the last print ended on the OL291 sheet (1–12; stored
// after every generated PDF, so a part-used sheet is resumed instead of printed
// over — FE-F20-5); `logo` says whether the clinic logo can go on the labels (one
// is uploaded in Settings → General and is a PNG or JPEG, the formats PDFKit
// draws — FE-F20-3).
export const labelSettings = {
  response: z.object({
    nextPosition: z.number().int().min(1).max(12),
    logo: z.boolean(),
  }),
} as const;
export type LabelSettings = z.infer<typeof labelSettings.response>;

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

// GET /api/aligner/patients?search=&doctorId= — now VALIDATED (it was type-only).
// `doctorId` stays a validated STRING (the handler `parseInt`s it), so junk 400s
// instead of reaching `searchPatients` as NaN; a repeated key is rejected too.
export const patientsQuery = z.object({
  search: z.string().optional(),
  doctorId: numericParam.optional(),
});
export type AlignerQueryParams = z.infer<typeof patientsQuery>;
