/**
 * API contract — appointment endpoints.
 *
 * Single source of truth for an endpoint's request/response shapes, imported by
 * BOTH the Express routes (relative `.js`) and the React app (`@shared` alias).
 * One exported `const <action> = { body?, params?, query?, response } as const`
 * per endpoint; types via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 0: response-only (migrated from the deleted public/js/core/api.schemas.ts).
 */
import { z } from 'zod';
import {
  idParams,
  intId,
  optionalDateString,
} from '../validation.js';

// ---------------------------------------------------------------------------
// GET /api/getDailyAppointments?AppsDate=YYYY-MM-DD
// services/database/queries/appointment-queries.ts#getDailyAppointmentsOptimized
//
// Container is a closed key set → plain z.object. Rows stay z.looseObject so the
// UI keeps the long tail of row fields (core/http returns the PARSED payload, so
// looseObject is load-bearing — see the tracker's Findings log).
//
// The SERVER handler returns via `sendData` (dev-parse fail-loud) — the query's
// `DailyAppointmentsOptimizedResult` types each row as `{ appointment_id: number;
// [k: string]: unknown }`, which IS assignable to this schema's looseObject row
// `z.input`. The CLIENT also validates via `useAppointments` ({ schema }).
// ---------------------------------------------------------------------------

// A 24-hour wall-clock time, `HH:MM` or `HH:MM:SS` (a PG `time`, or the time of
// a `timestamp`). The CLIENT formats it for display, with the active language's
// AM/PM marker. It used to leave the server as 12-hour `hh:mm` with no marker,
// and the card then guessed the marker from that hour, so every stamp after noon
// read "AM" (audit FE-F11-1). Declared, so a regression to 12-hour fails loud.
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected a 24-hour HH:MM[:SS] time');

// One row of either list. Every field the daily board reads is declared here
// (the card's view-model is this type, no hand-written interface or cast); the
// looseObject tail still carries the rest (`app_date`, `app_cost`).
const appointmentRowSchema = z.looseObject({
  appointment_id: z.number(),
  person_id: z.number(),
  patient_name: z.string().nullable(),
  // Assigned doctor (employees.id), nullable — drives the daily page's doctor
  // filter + per-doctor card tint.
  dr_id: z.number().nullable().optional(),
  app_detail: z.string().nullable(),
  // The booked time; null when the appointment has no time (booked at midnight).
  apptime: clockTime.nullable(),
  // Patient-type lookup: base value + its optional Arabic display name (the card
  // picks one via useLocalizedName). `patient_type_id` is the DERIVED type id — the
  // card hides the badge for ACTIVE_ORTHO by id (rename-proof), not by label text.
  patient_type: z.string().nullable().optional(),
  patient_type_id: z.number().nullable().optional(),
  patient_type_name_ar: z.string().nullable().optional(),
  hasActiveAlert: z.boolean(),
  has_visit: z.boolean(),
  // Checked-in rows only: the three workflow stamps + whether the active work is
  // orthodontic (the visit-notes marker).
  present_time: clockTime.nullable().optional(),
  seated_time: clockTime.nullable().optional(),
  dismissed_time: clockTime.nullable().optional(),
  is_ortho_visit: z.boolean().optional(),
});

const appointmentStatsSchema = z.object({
  total: z.number(),
  checkedIn: z.number(),
  absent: z.number(),
  waiting: z.number(),
});

export const dailyAppointments = {
  response: z.object({
    allAppointments: z.array(appointmentRowSchema),
    checkedInAppointments: z.array(appointmentRowSchema),
    stats: appointmentStatsSchema,
  }),
} as const;
export type DailyAppointmentsResponse = z.infer<typeof dailyAppointments.response>;
/** One daily-board row as the client receives it (the card's view-model). */
export type DailyAppointmentRow = DailyAppointmentsResponse['allAppointments'][number];
/** The same row as the server may build it (`sendData`'s input side). */
export type DailyAppointmentRowInput = z.input<typeof appointmentRowSchema>;
export type DailyAppointmentStats = z.infer<typeof appointmentStatsSchema>;

// ===========================================================================
// Phase 7 (Wave 2) — the remaining appointment endpoints.
//
// Bodies are now FULLY ENUMERATED as strict `z.object` (the hand-written
// `AppointmentStateBody`/`CreateAppointmentBody`/`UpdateAppointmentBody`
// interfaces in the route were deleted; handlers type from the `z.infer` exports
// below). `app_date` stays a plain `z.string().min(1)` (NOT `dateString`): the
// AppointmentService owns multi-format date parsing + holiday/conflict rules, so
// a strict date regex would 400 a currently-valid payload. Strict `z.object`
// strips any other posted field — the handlers forward only the listed scalars.
// ===========================================================================

// GET /api/appointment-details — [{ id, detail }] (dropdown feed, inline SQL).
// details.detail is nullable in the DB → modeled nullable (rendered directly).
export const appointmentDetails = {
  response: z.array(z.looseObject({ id: z.number(), detail: z.string().nullable() })),
} as const;
export type AppointmentDetailsResponse = z.infer<typeof appointmentDetails.response>;

// Shared body for the two state mutations. `time` (read by updateAppointmentState
// as the optional client-supplied clock value) is now enumerated; undo ignores it.
const appointmentStateBody = z.object({
  appointment_id: intId,
  state: z.string().min(1),
  time: z.string().optional(),
});
export type AppointmentStateBody = z.infer<typeof appointmentStateBody>;

// POST /api/updateAppointmentState — echoes { appointment_id, state, time }.
export const updateAppointmentState = {
  body: appointmentStateBody,
  response: z.object({ appointment_id: z.number(), state: z.string(), time: z.string() }),
} as const;
export type UpdateAppointmentStateResponse = z.infer<typeof updateAppointmentState.response>;

// POST /api/undoAppointmentState — { appointment_id, stateCleared, success }.
export const undoAppointmentState = {
  body: appointmentStateBody,
  response: z.object({
    appointment_id: z.number(),
    stateCleared: z.string(),
    success: z.boolean(),
  }),
} as const;
export type UndoAppointmentStateResponse = z.infer<typeof undoAppointmentState.response>;

// Shared body for create (POST /api/appointments) + update (PUT /:id).
// `app_detail` required non-empty; ids NaN-proofed; `app_date` a non-empty string
// (multi-format — see header). All four are everything the handlers read.
const createAppointmentBody = z.object({
  person_id: intId,
  dr_id: intId,
  app_detail: z.string().min(1),
  app_date: z.string().min(1),
});
export type CreateAppointmentBody = z.infer<typeof createAppointmentBody>;
export type UpdateAppointmentBody = CreateAppointmentBody;

// POST /api/appointments — { appointment_id, appointment }.
// `appointment` is the rich CreatedAppointment object — preserved by looseObject.
export const createAppointment = {
  body: createAppointmentBody,
  response: z.looseObject({ appointment_id: z.number().optional() }),
} as const;

// PUT /api/appointments/:appointmentId — void success (shared create body + id param).
export const updateAppointment = {
  params: idParams('appointmentId'),
  body: createAppointmentBody,
} as const;

// DELETE /api/appointments/:appointmentId — void success.
export const deleteAppointment = {
  params: idParams('appointmentId'),
} as const;

// GET /api/patient-appointments/:personId — { appointments: AppointmentResult[] }.
// app_date is a to_char'd string; app_detail (appointments.app_detail) and the
// joined DrName (employees.employee_name) are both nullable.
export const patientAppointments = {
  response: z.object({
    appointments: z.array(
      z.looseObject({
        appointment_id: z.number(),
        app_date: z.string(),
        app_detail: z.string().nullable(),
        DrName: z.string().nullable(),
      })
    ),
  }),
} as const;
export type PatientAppointmentsResponse = z.infer<typeof patientAppointments.response>;

// GET /api/appointments/:appointmentId — { appointment: AppointmentResult }.
export const appointmentById = {
  // Every field the edit form seeds from is declared: the form used to trust a
  // calendar row handed over as router state, which named them `appDetail`/`drID`,
  // and opened with Doctor and Type blank (audit FE-F10-1). It now always reads
  // this, and these fields are what it reads.
  response: z.object({
    appointment: z.looseObject({
      appointment_id: z.number(),
      person_id: z.number(),
      // Local wall-clock 'YYYY-MM-DDTHH:MM:SS' (to_char), never a UTC ISO string.
      app_date: z.string(),
      app_detail: z.string().nullable(),
      dr_id: z.number().nullable(),
    }),
  }),
} as const;
export type AppointmentByIdResponse = z.infer<typeof appointmentById.response>;

// POST /api/appointments/quick-checkin — strict body; QuickCheckInResult.
// Modeled from AppointmentService's QuickCheckInResult (closed → the interface stays
// assignable to sendData). `appointment_id` is `number | undefined` → optional;
// `present` is a wall-clock 'HH:MM:SS' string on every branch (it was string|Date →
// timestampString, so the Date branch serialized as a UTC ISO timestamp instead).
export const quickCheckin = {
  body: z.object({
    person_id: intId,
    dr_id: intId.optional(),
    app_detail: z.string().optional(),
  }),
  response: z.object({
    success: z.boolean(),
    alreadyCheckedIn: z.boolean().optional(),
    checkedIn: z.boolean().optional(),
    created: z.boolean().optional(),
    appointment_id: z.number().optional(),
    message: z.string(),
    appointment: z.object({
      appointment_id: z.number().optional(),
      person_id: z.number(),
      app_date: z.string(),
      app_detail: z.string().optional(),
      dr_id: z.number().nullable().optional(),
      present: z.string().optional(),
    }),
  }),
} as const;
export type QuickCheckinBody = z.infer<typeof quickCheckin.body>;
export type QuickCheckinResponse = z.infer<typeof quickCheckin.response>;

// GET /api/getDailyAppointments?AppsDate= — now VALIDATED (it was type-only).
// `optionalDateString` admits absent/'' so the handler's own "AppsDate query
// parameter is required" 400 still fires, while a repeated key (`?AppsDate=a&
// AppsDate=b`, an ARRAY in Express) or a non-calendar date is rejected at the
// boundary instead of being handed to the daily-appointments read as a `string[]`
// the handler generic swore was a `string`.
export const appointmentQuery = z.object({
  AppsDate: optionalDateString,
});
export type AppointmentQueryParams = z.infer<typeof appointmentQuery>;
