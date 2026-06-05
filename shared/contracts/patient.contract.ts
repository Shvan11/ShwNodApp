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
 *  - **Other responses are minimal**: arrays use `z.array(z.unknown())` (asserts
 *    array-vs-object — the N13 class — and, crucially, accepts an `interface[]`
 *    source with NO query-interface flip, since everything is assignable to
 *    `unknown`); single rich objects from a service/query type use `z.unknown()`;
 *    inline-literal handler payloads use a closed `z.object`/`looseObject` modeling
 *    the keys actually built. Consumers keep their generics; `{ schema }` adds the
 *    runtime boundary guard.
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
import { idParams, numericParam, intId, optionalDateString } from '../validation.js';

/** Minimal array guard: asserts the container is an array (the N13 array-vs-object
 *  class) while accepting any element — including an `interface[]` source, with no
 *  query-row `interface`→`type` flip (everything is assignable to `unknown`). */
const anyArray = z.array(z.unknown());

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
// READS
// ===========================================================================

// GET /api/patients/:personId/info — rich patient info (service-typed object).
export const patientInfo = { response: z.unknown() } as const;

// GET /api/settings/patients-folder — { patientsFolder }.
export const patientsFolder = {
  response: z.object({ patientsFolder: z.string() }),
} as const;

// GET /api/patients/:personId/timepoints — time-point rows.
export const timepoints = { response: anyArray } as const;

// GET /api/patients/:personId/timepoints/:tp/images — image rows.
export const timepointImages = { response: anyArray } as const;

// GET /api/patients/:personId/timepoints/:tpCode/folder — { folder, exists }.
// `folder` is `timepointFolderName(...)` which returns `string | null` (null when
// the time-point has no resolvable folder name) → nullable.
export const timepointFolder = {
  response: z.object({ folder: z.string().nullable(), exists: z.boolean() }),
} as const;

// GET /api/patients/:personId/gallery/:tp — processed gallery image sizes.
export const gallery = { response: z.unknown() } as const;

// GET /api/patients/phones — bare array of patient phone records.
export const patientPhones = { response: anyArray } as const;
export type PatientPhonesResponse = z.infer<typeof patientPhones.response>;

// GET /api/patients/search — { patients, totalCount?, hasMore? }. TIGHTENED (N13):
// the rows assert the stable ids the consumers key on.
export const patientSearch = {
  response: z.object({
    patients: z.array(z.looseObject({ person_id: z.number(), patient_name: z.string() })),
    totalCount: z.number().optional(),
    hasMore: z.boolean().optional(),
  }),
} as const;
export type PatientSearchResponse = z.infer<typeof patientSearch.response>;

// GET /api/patients/tag-options — [{ id, tag }].
export const tagOptions = {
  response: z.array(z.looseObject({ id: z.number() })),
} as const;

// GET /api/patients/type-options — [{ id, type }].
export const typeOptions = {
  response: z.array(z.looseObject({ id: z.number() })),
} as const;

// GET /api/patients/:personId — single patient + alerts (rich, query-typed).
export const patientById = { response: z.unknown() } as const;

// GET /api/patients/:personId/alerts — alert rows.
export const alerts = { response: anyArray } as const;

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

// POST /api/patients — fully enumerated (camelCase, ids→number) → { personId }.
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
    patientTypeID: optionalSelectId,
    tagID: optionalSelectId,
    notes: z.string().optional(),
    language: z.string().optional(),
    countryCode: z.string().optional(),
    estimatedCost: optionalSelectAmount,
    currency: z.string().optional(),
  }),
  response: z.object({ personId: z.number() }),
} as const;
export type CreatePatientBody = z.infer<typeof createPatient.body>;

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
    patient_type_id: z.string().optional(),
    tag_id: z.string().optional(),
    notes: z.string().optional(),
    language: z.string().optional(),
    country_code: z.string().optional(),
    estimated_cost: z.string().optional(),
    currency: z.string().optional(),
  }),
} as const;
export type UpdatePatientBody = z.infer<typeof updatePatient.body>;

// DELETE /api/patients/:personId — { folderRemoved }.
export const deletePatient = {
  response: z.object({ folderRemoved: z.boolean() }),
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

// Shared body for POST /alerts + PUT /alerts/:alertId. Fully enumerated: the
// client (AlertModal) sends both ids as parseInt'd numbers, and `updateAlert`
// requires `number`s — so `alertSeverity` is now an enumerated coerced int
// alongside `alertTypeId`. Both endpoints sendSuccess(null).
export const alertBody = z.object({
  alertTypeId: intId,
  alertSeverity: intId,
  alertDetails: z.string().min(1),
});
export type AlertBody = z.infer<typeof alertBody>;

// PUT /api/alerts/:alertId/status — { isActive } (fully enumerated → SSoT).
export const alertStatus = {
  body: z.object({ isActive: z.boolean() }),
} as const;
export type AlertStatusBody = z.infer<typeof alertStatus.body>;

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
