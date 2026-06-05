/**
 * Zod schemas for the STAFF API boundary (audit H11).
 *
 * The patient portal already validates every response it consumes
 * (portal.schemas.ts); the staff app historically trusted the wire, so a
 * renamed field or broken query surfaced as `undefined` in the UI instead of a
 * caught error. These schemas restore the same fail-loud guarantee at the staff
 * fetch boundary for the highest-traffic list / search / appointment / payment
 * responses — pass one as `fetchJSON(url, { schema })` and core/http throws on a
 * mismatch (the "always throw" policy).
 *
 * Design: validate the CONTAINER shape + the stable identifier of each row
 * (`appointment_id`, etc.), but stay `looseObject` on the long tail of optional
 * row fields. That catches the real drift class this audit cites (a renamed/
 * removed top-level key, an array-vs-object swap — cf. H5/H8/N13) without
 * fail-loud false-positives on a benign new optional column. Tighten row schemas
 * once each is runtime-verified.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Daily appointments (GET /api/getDailyAppointments)
// services/database/queries/appointment-queries.ts#getDailyAppointmentsOptimized
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

export const dailyAppointmentsSchema = z.object({
  allAppointments: z.array(appointmentRowSchema),
  checkedInAppointments: z.array(appointmentRowSchema),
  stats: appointmentStatsSchema,
});
export type DailyAppointmentsResponse = z.infer<typeof dailyAppointmentsSchema>;

// ---------------------------------------------------------------------------
// Patient list — phones (GET /api/patients/phones) — a bare array.
// ---------------------------------------------------------------------------

export const patientListSchema = z.array(z.looseObject({}));

// ---------------------------------------------------------------------------
// Patient search (GET /api/patients/search) — { patients, totalCount, hasMore }
// (the object shape post-H4; consumers also tolerate a bare array historically).
// Validating `patients: array` is exactly the guard the N13 POS bug needed.
// ---------------------------------------------------------------------------

export const patientSearchSchema = z.object({
  patients: z.array(z.looseObject({})),
  totalCount: z.number().optional(),
  hasMore: z.boolean().optional(),
});
export type PatientSearchResponse = z.infer<typeof patientSearchSchema>;

// ---------------------------------------------------------------------------
// Payment history (GET /api/getpaymenthistory) — a bare array of records.
// ---------------------------------------------------------------------------

export const paymentHistorySchema = z.array(z.looseObject({}));
