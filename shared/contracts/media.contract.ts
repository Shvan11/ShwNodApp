/**
 * API contract — media / WebCeph endpoints (`/api/webceph/*`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only (no client `{schema}`). The
 * patient-link "not found" case used to be a RAW `res.json({ success:false,
 * data:null })`; it is now a proper 404 (`sendData(…, null)` can't express it —
 * `sendSuccess` omits a null `data`, so the funnel would return the whole
 * envelope, truthy, instead of null). The found path returns the link row →
 * `z.unknown()` (rich → preserve).
 */
import { z } from 'zod';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// POST /api/webceph/create-patient → { webcephPatientId, link, linkId }.
export const createPatient = {
  response: z.looseObject({}),
} as const;

// POST /api/webceph/upload-image → { big, thumbnail, link }.
export const uploadImage = {
  response: z.looseObject({}),
} as const;

// GET /api/webceph/patient-link/:personId → link object | null.
export const patientLink = {
  response: z.unknown(),
} as const;

// GET /api/webceph/photo-types → PhotoType[].
export const photoTypes = {
  response: anyArray,
} as const;
