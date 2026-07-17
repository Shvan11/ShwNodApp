/**
 * API contract — patient endpoints (Phase 4; Phase 0 seeded phones + search).
 *
 * Imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One exported `const <action> = { body?, response } as const`
 * per endpoint (+ standalone param schemas shared across many endpoints); types
 * via `z.infer`. See docs/shared-contract-progress.md + the plan.
 *
 * Phase-4 scope decisions (see the dated Findings in the progress tracker):
 *  - **`patientSearch` is the N13 victim** → its response is TIGHTENED here: the
 *    `patients` rows now assert `{ person_id, patient_name }` (the stable ids the
 *    POS/search consumers key on), not the empty `looseObject({})` of Phase 0.
 *  - **Phase-3 hardening**: all array/object responses now carry modeled looseObject
 *    row schemas covering every field the consumer reads. Source interfaces in query
 *    modules were flipped to `type` to satisfy the looseObject index-sig rule.
 *    `patientById` is now modeled too (`patientByIdRow` = PatientDetails columns +
 *    attached `alerts`); the FK columns (gender, address_id, etc.) assert their true
 *    DB `number` type — the edit form coerces them to `<select>` strings client-side.
 *  - **Bodies**: now FULLY ENUMERATED as strict `z.object` — the route's
 *    hand-written `CreatePatientBody`/`UpdatePatientBody`/`CreateAlertBody`/
 *    `UpdateAlertStatusBody`/`UpdateAlertBody` interfaces were deleted; handlers
 *    type from the `z.infer` exports below. CREATE ids are coerced to `number`
 *    (the route's `processedData` is `number`-typed); UPDATE ids stay `string`
 *    (spread straight into `UpdatePatientData`, which accepts `string|number` and
 *    runs them through `toInt`). The `<select>` empty string maps to undefined so
 *    the service's `toInt` yields NULL, not 0. Strict `z.object` strips the extra
 *    fields the forms over-post (`alerts` on create, `person_id` on update).
 *  - `date_of_birth`/`date_added` are `date` columns (string both sides) →
 *    `optionalDateString`/plain string; no `timestampString` needed.
 */
import { z } from 'zod';
import {
  idParams,
  numericParam,
  intId,
  optionalDateString,
  dateString,
  timestampString,
  optionalPositiveIntQuery,
  optionalNonNegIntQuery,
} from '../validation.js';
import { withPendingOutcome } from './approvals.contract.js';
import { XRAY_WORK_TYPE_IDS } from '../treatment-taxonomy.js';

/** A `<select>`-backed id on the CREATE body: '' (nothing chosen) → undefined (so
 *  the service's `toInt` yields NULL, not 0); a chosen value (form string / number)
 *  → number — matching the route's `number`-typed `processedData`. */
const optionalSelectId = z
  .preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().optional())
  .optional();
/** Same, but allows a non-integer (estimated cost may carry a decimal). */
const optionalSelectAmount = z
  .preprocess((v) => (v === '' ? undefined : v), z.coerce.number().optional())
  .optional();

// ---------------------------------------------------------------------------
// Shared param schemas (referenced directly in the route's validate()).
// ---------------------------------------------------------------------------

export const personIdParams = idParams('personId');
export const alertIdParams = idParams('alertId');
export const timepointParams = z.object({ personId: numericParam, tpCode: numericParam });

// ===========================================================================
// ROW SCHEMAS (Phase 3 — all fields the consumers read)
// ===========================================================================

/** Rich patient info returned by PatientService.getPatientInfo.
 *  date_added and DateOfBirth are PG `date` columns → string (already). */
const patientInfoRow = z.looseObject({
  person_id: z.number(),
  patient_name: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone: z.string().nullable(),
  phone2: z.string().nullable(),
  email: z.string().nullable(),
  DateOfBirth: z.string().nullable(),
  gender: z.number().nullable(),
  gender_display: z.string().nullable(),
  address_name: z.string().nullable(),
  referral_source: z.string().nullable(),
  patient_type_name: z.string().nullable(),
  tag_name: z.string().nullable(),
  notes: z.string().nullable(),
  date_added: z.string().nullable(),
  country_code: z.string().nullable(),
  estimated_cost: z.number().nullable(),
  currency: z.string().nullable(),
  DolphinId: z.number().nullable(),
  language: z.number().nullable(),
  AlertCount: z.number(),
  name: z.string().nullable(),
  estimatedCost: z.number().nullable(),
  start_date: z.string().nullable(),
});

/** Time-point row: three scalar fields, all strings. */
const timepointRow = z.looseObject({
  tp_code: z.string(),
  tp_date_time: z.string(),
  tp_description: z.string(),
});

/** One rendered gallery view: the working-dir JPEG's name + pixel size + mtime.
 *  `null` when that view hasn't been rendered for the timepoint. */
const galleryView = z.object({
  /** Working-dir filename, e.g. `10060.i12` — drives both the /DolImgs URL and the
   *  working-files thumbnail endpoint. */
  name: z.string(),
  width: z.number(),
  height: z.number(),
  /** File mtime (ms) — appended to the image URL as `?v=` so an overwritten render
   *  busts the browser cache instead of showing the stale image at the same URL. */
  mtime: z.number(),
}).nullable();

/** Patient phone record (id + name + phone for autocomplete). phone is nullable. */
const patientPhoneRow = z.looseObject({
  id: z.number(),
  name: z.string(),
  phone: z.string().nullable(),
});

// Alerts back two surfaces (patient-context flags + header "Tasks"). These enums
// mirror the DB CHECK constraints (migrations/pg/…_alerts-to-tasks.sql) and are
// reused by task.contract.ts.
export const surfaceMode = z.enum(['context', 'push']);
export const alertStatusEnum = z.enum(['active', 'done', 'dismissed']);

/** Alert row. creation_date is a PG `timestamp` → timestampString transform.
 *  `alert_type_id`/`AlertTypeName` are nullable since a header task may be
 *  category-less (left join). The date columns are PG `date` → 'YYYY-MM-DD' strings. */
export const alertRow = z.looseObject({
  alert_id: z.number(),
  alert_type_id: z.number().nullable(),
  AlertTypeName: z.string().nullable(),
  alert_severity: z.number(),
  alert_details: z.string().nullable(),
  creation_date: timestampString,
  surface_mode: surfaceMode,
  status: alertStatusEnum,
  snoozed_until: z.string().nullable(),
  expires_at: z.string().nullable(),
  escalate_at: z.string().nullable(),
  // Assignment (feature #4): owning staff member (FK employees.id) + their joined
  // name. Both null for unassigned tasks and patient-context alerts.
  assigned_to: z.number().nullable(),
  assignee_name: z.string().nullable(),
});

/** Single patient by id — the raw `patients` columns (getPatientById ⇒ PatientDetails)
 *  with the active `alerts` attached. The FK ids (gender, address_id, referral_source_id,
 *  patient_type_id, tag_id) and language/estimated_cost are DB **numbers**, not the edit
 *  form's `<select>` strings — the consumer coerces them client-side. `date_of_birth` is
 *  a `date` column and `date_added` is `to_char`'d → both `string`. */
const patientByIdRow = z.looseObject({
  person_id: z.number(),
  patient_name: z.string(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone: z.string().nullable(),
  phone2: z.string().nullable(),
  email: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  gender: z.number().nullable(),
  address_id: z.number().nullable(),
  referral_source_id: z.number().nullable(),
  patient_type_id: z.number().nullable(),
  notes: z.string().nullable(),
  language: z.number().nullable(),
  country_code: z.string().nullable(),
  estimated_cost: z.number().nullable(),
  currency: z.string().nullable(),
  tag_id: z.number().nullable(),
  date_added: z.string().nullable(),
  alerts: z.array(alertRow),
});

// ===========================================================================
// READS
// ===========================================================================

// GET /api/patients/:personId/info — rich patient info (service-typed object).
export const patientInfo = { response: patientInfoRow } as const;

// GET /api/settings/patients-folder — { patientsFolder }.
export const patientsFolder = {
  response: z.object({ patientsFolder: z.string() }),
} as const;

// GET /api/patients/:personId/timepoints — time-point rows.
export const timepoints = { response: z.array(timepointRow) } as const;

// GET /api/patients/:personId/timepoints/:tp/images — array of image-code strings.
export const timepointImages = { response: z.array(z.string()) } as const;

// GET /api/patients/:personId/timepoints/:tpCode/folder — { folder, exists }.
// `folder` is `timepointFolderName(...)` which returns `string | null` (null when
// the time-point has no resolvable folder name) → nullable.
export const timepointFolder = {
  response: z.object({ folder: z.string().nullable(), exists: z.boolean() }),
} as const;

// GET /api/patients/:personId/gallery/:tp — the 8 Dolphin photo views, KEYED BY
// VIEW CODE (not a positional array) so neither side depends on slot order. The
// keys mirror shared/photo-views.ts VIEW_CODES; the centre logo is a client-only
// layout concern and is intentionally not part of the payload.
export const gallery = {
  response: z.object({
    i10: galleryView, i12: galleryView, i13: galleryView, i23: galleryView,
    i24: galleryView, i20: galleryView, i22: galleryView, i21: galleryView,
  }),
} as const;
export type GalleryResponse = z.infer<typeof gallery.response>;
export type GalleryView = NonNullable<GalleryResponse[keyof GalleryResponse]>;

// GET /api/patients/phones — bare array of patient phone records.
export const patientPhones = { response: z.array(patientPhoneRow) } as const;
export type PatientPhonesResponse = z.infer<typeof patientPhones.response>;

// GET /api/patients/search — { patients, totalCount?, hasMore? }. TIGHTENED (N13):
// the rows assert the stable ids the consumers key on.
// Query is fully enumerated (SSoT — the route validates + z.infers from it; the
// client builds these params in PatientManagement.executeSearch). The id lists
// stay comma-separated strings (the route splits/parses them); boolean flags use
// the 'true' string convention. `lastAppointment` presets ("more than N ago")
// are mutually exclusive with the `lastAppointmentFrom`/`To` custom range
// client-side, but the server treats them as independent AND conditions.
export const patientSearch = {
  query: z.object({
    q: z.string().optional(),
    patientName: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    nameStartsWith: z.enum(['true', 'false']).optional(),
    workTypes: z.string().optional(),
    keywords: z.string().optional(),
    tags: z.string().optional(),
    patientTypes: z.string().optional(),
    lastAppointment: z.enum(['1month', '3months', '6months', '1year']).optional(),
    lastAppointmentFrom: optionalDateString,
    lastAppointmentTo: optionalDateString,
    finalPhotos: z.enum(['has', 'none']).optional(),
    hasDebt: z.enum(['true', 'false']).optional(),
    sortBy: z.enum(['name', 'date', 'lastVisit', 'id']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
    limit: optionalPositiveIntQuery,
    offset: optionalNonNegIntQuery,
  }),
  response: z.object({
    patients: z.array(z.looseObject({ person_id: z.number(), patient_name: z.string() })),
    totalCount: z.number().optional(),
    hasMore: z.boolean().optional(),
  }),
} as const;
export type PatientSearchQuery = z.infer<typeof patientSearch.query>;
export type PatientSearchResponse = z.infer<typeof patientSearch.response>;

// GET /api/patients/tag-options — [{ id, tag }] (tag_options.tag is NOT NULL).
export const tagOptions = {
  response: z.array(z.looseObject({ id: z.number(), tag: z.string() })),
} as const;

// GET /api/patients/type-options — [{ id, type }] (both fields consumed by the
// patient-management loader's react-select mapping).
export const typeOptions = {
  response: z.array(z.looseObject({ id: z.number(), type: z.string().nullable() })),
} as const;

// GET /api/patients/:personId — single patient (raw `patients` columns) + active
// alerts. Modeled from PatientDetails: FK columns (gender, address_id,
// referral_source_id, etc.) are DB numbers; the edit form coerces them to `<select>`
// strings client-side (see EditPatientComponent's form-population).
export const patientById = { response: patientByIdRow } as const;
export type PatientByIdResponse = z.infer<typeof patientByIdRow>;

// GET /api/patients/:personId/alerts — alert rows.
export const alerts = { response: z.array(alertRow) } as const;

// GET /api/patients/:personId/has-appointment — { hasAppointment }.
export const hasAppointment = {
  response: z.object({ hasAppointment: z.boolean() }),
} as const;

// GET /api/patients/:personId/portal — staff portal status + QR (inline literal).
export const portalStatus = {
  response: z.looseObject({ enabled: z.boolean() }),
} as const;

// GET /api/patients/:personId/photos/visibility — { privateImages: [{tp,name}] }.
export const photoVisibilityList = {
  response: z.object({ privateImages: z.array(z.looseObject({})) }),
} as const;

// ===========================================================================
// TIME-POINT MUTATIONS
// ===========================================================================

// PUT /api/patients/:personId/timepoints/:tpCode — { tpDescription?, tpDateTime? }
// → { tpCode, tp_description, tp_date_time } (inline literal).
export const updateTimepoint = {
  body: z.object({ tpDescription: z.string().optional(), tpDateTime: optionalDateString }),
  response: z.looseObject({ tpCode: z.number() }),
} as const;

// DELETE /api/patients/:personId/timepoints/:tpCode?scope= — { scope }.
export const deleteTimepoint = {
  response: z.object({ scope: z.string() }),
} as const;

// ===========================================================================
// PATIENT CRUD
// ===========================================================================

/** Intake selector (basic tab). The front-desk choice on a NEW patient:
 *  - 'xray'    → auto-creates a FINISHED imaging work (14/18/22) + full-payment invoice (fee > 0)
 *  - 'consult' → auto-creates a FINISHED Consult work (23); a paid consult (fee > 0)
 *    also gets a full-payment invoice, a FREE consult (fee 0) gets the work alone.
 *  (absent = 'Regular', no auto-work.) The auto-work's dr_id = the 'Clinic'
 *  pseudo-doctor. Fees arrive as form strings → z.coerce.number(); the currency
 *  drives the invoice's usd/iqd split. patient_type is DERIVED afterwards. */
const intakeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('xray'),
    // Restricted to the imaging work types (OPG/CBCT/Cephalo); form sends a string id.
    workTypeId: z.coerce
      .number()
      .refine((v) => XRAY_WORK_TYPE_IDS.includes(v), { message: 'workTypeId must be an x-ray work type' }),
    fee: z.coerce.number().positive('Fee must be greater than 0'),
    currency: z.enum(['IQD', 'USD', 'EUR']),
  }),
  z.object({
    kind: z.literal('consult'),
    // A Consult may be FREE — 0 is allowed (a 0-fee consult creates the work with no
    // invoice, since the invoices table forbids a zero/no-cash payment row).
    fee: z.coerce.number().min(0, 'Fee cannot be negative'),
    currency: z.enum(['IQD', 'USD', 'EUR']),
  }),
]);
export type PatientIntake = z.infer<typeof intakeSchema>;

// POST /api/patients — fully enumerated (camelCase, ids→number). `patientTypeID` is
// GONE (type is derived from works); an optional `intake` auto-creates the first work.
// → { personId, workId?, invoiceId? } (the ids present only on an intake create).
export const createPatient = {
  body: z.object({
    patientName: z.string().min(1, 'Patient name is required'),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    phone2: z.string().optional(),
    email: z.string().optional(),
    dateOfBirth: optionalDateString,
    gender: optionalSelectId,
    addressID: optionalSelectId,
    referralSourceID: optionalSelectId,
    tagID: optionalSelectId,
    notes: z.string().optional(),
    language: z.string().optional(),
    countryCode: z.string().optional(),
    estimatedCost: optionalSelectAmount,
    currency: z.string().optional(),
    intake: intakeSchema.optional(),
  }),
  response: z.object({
    personId: z.number(),
    workId: z.number().optional(),
    invoiceId: z.number().optional(),
  }),
} as const;
export type CreatePatientBody = z.infer<typeof createPatient.body>;
export type CreatePatientResponse = z.infer<typeof createPatient.response>;

// PUT /api/patients/:personId — fully enumerated (snake_case, ids stay strings:
// spread straight into UpdatePatientData → toInt). sendSuccess(null), no resp key.
export const updatePatient = {
  body: z.object({
    patient_name: z.string().min(1, 'Patient name is required'),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
    phone2: z.string().optional(),
    email: z.string().optional(),
    date_of_birth: optionalDateString,
    gender: z.string().optional(),
    address_id: z.string().optional(),
    referral_source_id: z.string().optional(),
    // patient_type_id removed — derived from works. A plain z.object strips it if an
    // older client still posts it (patientByIdRow keeps it for read-only display).
    tag_id: z.string().optional(),
    notes: z.string().optional(),
    language: z.string().optional(),
    country_code: z.string().optional(),
    estimated_cost: z.string().optional(),
    currency: z.string().optional(),
  }),
} as const;
export type UpdatePatientBody = z.infer<typeof updatePatient.body>;

// POST /api/patients/transliterate-name — on-demand romanization of an Arabic
// patient name for the Edit Patient form's "Translate with AI" button. Returns
// the suggested first/last for the user to review before saving (empty strings
// when the model is unconfigured/unavailable or can't produce a clean Latin name).
export const transliterateName = {
  body: z.object({ patientName: z.string().min(1, 'patientName is required') }),
  response: z.object({ firstName: z.string(), lastName: z.string() }),
} as const;
export type TransliterateNameBody = z.infer<typeof transliterateName.body>;
export type TransliterateNameResult = z.infer<typeof transliterateName.response>;

// DELETE /api/patients/:personId — { folderRemoved }. A Front-Desk delete of a
// patient not created today routes through admin approval instead — see
// `services/approvals/`.
export const deletePatient = {
  response: withPendingOutcome({ folderRemoved: z.boolean() }),
} as const;

// PUT /api/patients/:personId/estimated-cost — { estimatedCost, currency };
// sendSuccess(null) (no response key). Both fields are everything the handler reads.
export const estimatedCost = {
  body: z.object({ estimatedCost: z.coerce.number(), currency: z.string() }),
} as const;
export type EstimatedCostBody = z.infer<typeof estimatedCost.body>;

// ===========================================================================
// ALERTS
// ===========================================================================

// Shared body for POST /patients/:id/alerts + PUT /alerts/:alertId (patient-context
// alerts). Fully enumerated: the client (AlertModal) sends ids as parseInt'd numbers.
// The optional fields drive the dual-surface behavior: `surfaceMode='push'` also
// shows the alert in the header; `escalateAt` makes a context alert surface in the
// header from that day; `expiresAt` auto-hides it everywhere after that day. Both
// endpoints sendSuccess(null).
export const alertBody = z.object({
  // Optional so a category-less header task can be edited via PUT /api/alerts/:id;
  // the patient AlertModal still always sends one (client-side required field).
  alertTypeId: intId.optional(),
  alertSeverity: intId,
  alertDetails: z.string().min(1),
  surfaceMode: surfaceMode.optional(),
  expiresAt: optionalDateString,
  escalateAt: optionalDateString,
  // Assignment (feature #4) — task edit only. `null` unassigns; omitted leaves the
  // current assignee untouched (updateAlert writes only the keys provided). The
  // patient AlertModal omits it, so context alerts stay unassigned.
  assignedTo: intId.nullable().optional(),
});
export type AlertBody = z.infer<typeof alertBody>;

// PUT /api/alerts/:alertId/status — { status } (active|done|dismissed). `done`
// stamps completed_at + completed_by server-side. Replaces the old { isActive }.
export const alertStatus = {
  body: z.object({ status: alertStatusEnum }),
} as const;
export type AlertStatusBody = z.infer<typeof alertStatus.body>;

// PUT /api/alerts/:alertId/snooze — header "dead time": hide in the header until
// `snoozedUntil` (a 'YYYY-MM-DD' date), or null to clear the snooze.
export const alertSnooze = {
  body: z.object({ snoozedUntil: dateString.nullable() }),
} as const;
export type AlertSnoozeBody = z.infer<typeof alertSnooze.body>;

// ===========================================================================
// PORTAL (staff-facing)
// ===========================================================================

// POST /api/patients/:personId/portal/reset-pin — { pin } (plaintext, once).
export const resetPin = {
  response: z.object({ pin: z.string() }),
} as const;

// POST /api/patients/:personId/portal/enable — { enabled } (fully enumerated → SSoT).
export const portalEnable = {
  body: z.object({ enabled: z.boolean() }),
} as const;
export type PortalEnableBody = z.infer<typeof portalEnable.body>;

// ===========================================================================
// PHOTO VISIBILITY (staff-facing)
// ===========================================================================

// POST /api/patients/:personId/photos/visibility — { tp, name, isPrivate }; fully
// enumerated. `tp` is `z.coerce.string()` — the client sends the numeric tpCode,
// `togglePhotoPrivacy` wants a `string`. sendSuccess(null).
export const photoVisibility = {
  body: z.object({ tp: z.coerce.string(), name: z.string().min(1), isPrivate: z.boolean() }),
} as const;
export type PhotoVisibilityBody = z.infer<typeof photoVisibility.body>;
