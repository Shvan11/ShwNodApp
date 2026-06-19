/**
 * API contract — 3Shape Unite Web Service actions (`/api/threeshape/*`).
 *
 * These are the app's OWN endpoints (staff app → our server). The server then
 * calls the 3Shape `/v3` API server-side (services/threeshape/client.ts); the raw
 * 3Shape response DTOs are validated separately at the boundary in
 * services/threeshape/dtos.ts and are NOT app contracts. Closed `z.object` shapes
 * — fully modeled, no long tail (keeps the D2 loose-response baseline unchanged).
 *
 * Connect/status/disconnect live in integrations.contract.ts; the OAuth redirect
 * flow itself is browser routes under /api/auth/3shape (no contract).
 */
import { z } from 'zod';

// POST /api/threeshape/patients/:personId/initiate-workflow — push the patient and
// start a scan workflow on the scanner. The server builds PatientDetails from the
// DB (IntegrationId = person_id), so there is no request body.
export const initiateWorkflow = {
  params: z.object({ personId: z.string().regex(/^\d+$/, 'personId must be numeric') }),
  response: z.object({ ok: z.boolean() }),
} as const;
export type InitiateWorkflowParams = z.infer<typeof initiateWorkflow.params>;

// Normalized (camelCase) shapes the server maps the raw 3Shape DTOs into.
const personIdParam = z.object({ personId: z.string().regex(/^\d+$/, 'personId must be numeric') });

const scanCase = z.object({
  id: z.string(),
  name: z.string().nullable(),
  workflowId: z.string().nullable(),
  itemNames: z.array(z.string()),
  isScanned: z.boolean(),
  isModelled: z.boolean(),
});

const scanMedia = z.object({
  id: z.string(),
  name: z.string().nullable(),
  type: z.string().nullable(),
  fileName: z.string().nullable(),
  createdAt: z.string().nullable(),
});

// GET /api/threeshape/patients/:personId/cases — finished cases pulled live.
export const listCases = {
  params: personIdParam,
  query: z.object({ workflowStatus: z.string().optional() }),
  response: z.object({ cases: z.array(scanCase) }),
} as const;
export type ListCasesParams = z.infer<typeof listCases.params>;
export type ListCasesQuery = z.infer<typeof listCases.query>;

// GET /api/threeshape/patients/:personId/media — downloadable media files.
export const listMedia = {
  params: personIdParam,
  query: z.object({ type: z.string().optional() }),
  response: z.object({ media: z.array(scanMedia) }),
} as const;
export type ListMediaParams = z.infer<typeof listMedia.params>;
export type ListMediaQuery = z.infer<typeof listMedia.query>;
