/**
 * Zod schemas for the patient-portal API boundary.
 *
 * The portal is external-facing, so every `res.json()` it consumes is untrusted
 * input and must be validated here (per CLAUDE.md). These schemas are the single
 * source of truth for the patient-facing portal response shapes — derive types
 * with `z.infer`, don't hand-write parallel interfaces.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Identity (GET /api/portal/me, POST /api/portal/login)
// ---------------------------------------------------------------------------

export const portalPatientSchema = z.object({
  personId: z.number(),
  patientName: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  language: z.number().nullable(),
});
export type PortalPatientData = z.infer<typeof portalPatientSchema>;

export const portalMeResponseSchema = z.object({
  success: z.boolean(),
  patient: portalPatientSchema.nullable().optional(),
  error: z.string().optional(),
});

export const loginResponseSchema = z.object({
  success: z.boolean(),
  patientName: z.string().nullable().optional(),
  language: z.number().nullable().optional(),
  error: z.string().optional(),
  lockedUntil: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Payments (GET /api/portal/payments)
// ---------------------------------------------------------------------------

export const portalPaymentRowSchema = z.object({
  Payment: z.number(),
  Date: z.string(),
});
export type PortalPaymentRow = z.infer<typeof portalPaymentRowSchema>;

export const portalPaymentsResponseSchema = z.object({
  success: z.boolean(),
  payments: z.array(portalPaymentRowSchema).optional(),
  error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Next appointment (GET /api/portal/appointments/next)
// ---------------------------------------------------------------------------

export const portalNextAppointmentSchema = z.object({
  appointment_id: z.number(),
  app_date: z.string(),
  app_detail: z.string().nullable(),
  DrName: z.string().nullable(),
});
export type PortalNextAppointment = z.infer<typeof portalNextAppointmentSchema>;

export const portalNextAppointmentResponseSchema = z.object({
  success: z.boolean(),
  appointment: portalNextAppointmentSchema.nullable(),
  error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Visit history (GET /api/portal/visits)
// ---------------------------------------------------------------------------

export const portalVisitSummarySchema = z.object({
  patient_name: z.string(),
  work_id: z.number(),
  id: z.number(),
  visit_date: z.string(),
  opg: z.boolean(),
  i_photo: z.boolean(),
  f_photo: z.boolean(),
  p_photo: z.boolean(),
  appliance_removed: z.boolean(),
  Summary: z.string().nullable(),
});
export type PortalVisitSummary = z.infer<typeof portalVisitSummarySchema>;

export const portalVisitsResponseSchema = z.object({
  success: z.boolean(),
  visits: z.array(portalVisitSummarySchema).optional(),
  error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Photos (GET /api/portal/timepoints, GET /api/portal/photos/:tpCode)
// ---------------------------------------------------------------------------

export const portalTimePointSchema = z.object({
  tp_code: z.string(),
  tp_date_time: z.string(),
  tp_description: z.string(),
});
export type PortalTimePoint = z.infer<typeof portalTimePointSchema>;

export const portalTimepointsResponseSchema = z.object({
  success: z.boolean(),
  timepoints: z.array(portalTimePointSchema).optional(),
  error: z.string().optional(),
});

export const portalPhotoSchema = z.object({
  name: z.string(),
  width: z.number(),
  height: z.number(),
});
export type PortalPhoto = z.infer<typeof portalPhotoSchema>;

export const portalPhotosResponseSchema = z.object({
  success: z.boolean(),
  photos: z.array(portalPhotoSchema).optional(),
  error: z.string().optional(),
});
