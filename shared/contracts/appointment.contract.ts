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
import { idParams, intId } from '../validation.js';

// ---------------------------------------------------------------------------
// GET /api/getDailyAppointments?AppsDate=YYYY-MM-DD
// services/database/queries/appointment-queries.ts#getDailyAppointmentsOptimized
//
// Container is a closed key set → plain z.object. Rows stay z.looseObject so the
// UI keeps the long tail of row fields (core/http returns the PARSED payload, so
// looseObject is load-bearing — see the tracker's Findings log).
//
// NOTE (Phase 7): the SERVER handler keeps `sendSuccess` (not `sendData`) for this
// one endpoint — the service returns `Record<string, unknown>[]` rows, which are
// NOT assignable to this schema's `{ appointment_id: number }` row `z.input`. The
// CLIENT still validates via `useAppointments` ({ schema: dailyAppointments.response }).
// ---------------------------------------------------------------------------

const appointmentRowSchema = z.looseObject({
  appointment_id: z.number(),
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
export const appointmentDetails = {
  response: z.array(z.looseObject({ id: z.number() })),
} as const;
export type AppointmentDetailsResponse = z.infer<typeof appointmentDetails.response>;

// GET /api/getWebApps?PDate= — rich AppointmentsResponse (stats + appointments[]).
// Intentionally loose: assembled by AppointmentService from a query interface;
// the hierarchical stats+appointments shape is preserved without field enumeration.
export const webApps = {
  response: z.unknown(),
} as const;

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
export const patientAppointments = {
  response: z.object({
    appointments: z.array(z.looseObject({ appointment_id: z.number() })),
  }),
} as const;
export type PatientAppointmentsResponse = z.infer<typeof patientAppointments.response>;

// GET /api/appointments/:appointmentId — { appointment: AppointmentResult }.
export const appointmentById = {
  response: z.object({ appointment: z.looseObject({ appointment_id: z.number() }) }),
} as const;

// POST /api/appointments/quick-checkin — strict body; rich QuickCheckInResult.
// Intentionally loose: QuickCheckInResult assembled by AppointmentService contains
// a nested appointment object with patient/doctor details — not statically enumerable.
export const quickCheckin = {
  body: z.object({
    person_id: intId,
    dr_id: intId.optional(),
    app_detail: z.string().optional(),
  }),
  response: z.unknown(),
} as const;
export type QuickCheckinBody = z.infer<typeof quickCheckin.body>;

// Route-level GET query view (`?PDate=` / `?AppsDate=`). Type-only — the
// dailyAppointments/webApps reads parse the date string themselves.
export const appointmentQuery = z.object({
  PDate: z.string().optional(),
  AppsDate: z.string().optional(),
});
export type AppointmentQueryParams = z.infer<typeof appointmentQuery>;
