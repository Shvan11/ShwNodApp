/**
 * API contract — media / WebCeph endpoints (`/api/webceph/*`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). The two write bodies are now ENUMERATED + wired via
 * `validate({ body })` (the route's `CreateWebCephPatientBody`/`WebCephPatientData`/
 * `UploadImageBody` interfaces were deleted). `patientData` is modelled on the
 * webceph service's own `PatientData` (the actual consumer — the route interface's
 * `dateOfBirth` was a phantom; the client + service use `birthday`). The
 * upload-image body validates AFTER the multer middleware. The patient-link "not
 * found" case is a proper 404 (`sendData(…, null)` can't express it — `sendSuccess`
 * omits a null `data`); the found path returns the link row as a loose guard.
 */
import { z } from 'zod';
import { intId } from '../validation.js';

// Patient block forwarded to `webcephService.{validate,create}Patient` — mirrors
// that service's `PatientData` (all-optional strings; the client sends all six).
const webcephPatientData = z.object({
  patientID: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  gender: z.string().optional(),
  birthday: z.string().optional(),
  race: z.string().optional(),
});

// POST /api/webceph/create-patient → { webcephPatientId, link, linkId }.
export const createPatient = {
  body: z.object({ personId: intId, patientData: webcephPatientData }),
  response: z.looseObject({}),
} as const;
export type CreateWebCephPatientBody = z.infer<typeof createPatient.body>;

// POST /api/webceph/upload-image → { big, thumbnail, link }. Multipart body, so
// `validate({ body })` runs AFTER the multer middleware (which populates the text
// fields onto req.body). The client appends `patient_id` to match this contract +
// the handler's destructure — previously it sent a stray `patientID` the handler
// never read, which is why `validate()` was deferred; the field names are now aligned.
export const uploadImage = {
  body: z.object({
    patient_id: z.string(),
    recordDate: z.string(),
    targetClass: z.string(),
  }),
  response: z.looseObject({}),
} as const;
export type UploadImageBody = z.infer<typeof uploadImage.body>;

// GET /api/webceph/patient-link/:personId → link object | null (404 when not found).
// Intentionally loose: the WebCeph patient link row schema comes from the webceph
// service and contains a variable set of API-specific fields.
export const patientLink = {
  response: z.unknown(),
} as const;

// GET /api/webceph/photo-types → PhotoType[] (the webceph service's static list).
export const photoTypes = {
  response: z.array(z.object({ class: z.string(), name: z.string() })),
} as const;

// `:personId` path param shared by the media routes (type-only).
export const personIdParams = z.object({ personId: z.string() });
export type PersonIdParams = z.infer<typeof personIdParams>;
