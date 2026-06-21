/**
 * Zod schemas for data crossing the 3Shape boundary (OAuth token endpoint +
 * the Unite `/v3` API). These validate UNTRUSTED external responses where we
 * read them — the "validate input at the boundary" rule. They are NOT app
 * contracts (those live in shared/contracts and govern our own endpoints).
 */
import { z } from 'zod';

/** OAuth token endpoint success response (`/connect/token`). */
export const tokenResponse = z.object({
  access_token: z.string(),
  // Absent on a refresh that doesn't rotate — caller keeps the existing one.
  refresh_token: z.string().optional(),
  expires_in: z.coerce.number(),
  token_type: z.string().default('Bearer'),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof tokenResponse>;

/** OAuth token endpoint error response (RFC 6749 §5.2). */
export const tokenError = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

// ── /v3 list items ──
// Field names/casing are CONFIRMED against the official 3Shape Web Service API v3
// docs (camelCase — see docs/3shape-integration.md). Still lenient on purpose: the
// API's forward-compatibility rule requires tolerant readers (silently ignore
// unknown fields), so we read only what the UI needs and `safeParse` each element,
// skipping any that don't match — an unexpected shape degrades to a shorter list
// instead of a hard failure.
const idLike = z.union([z.string(), z.number()]);

/** A file inside a media item (`media[].mediaFiles[]`). */
export const v3MediaFile = z.object({
  id: idLike.optional(),
  name: z.string().nullish(),
  downloadLink: z.string().nullish(),
  size: z.union([z.string(), z.number()]).nullish(),
  fileType: z.string().nullish(),
  metadata: z.object({ scanType: z.string().nullish() }).nullish(),
});

/** A 3Shape media item (`GET /v3/patients/{id}/media` → `media[]`). */
export const v3Media = z.object({
  id: idLike.optional(),
  mediaType: z.string().nullish(), // Image | SurfaceScan | VolumeScan | Pdf | Video
  captureDate: z.string().nullish(),
  thumbnailLink: z.string().nullish(),
  uniteCloudLink: z.string().nullish(),
  mediaFiles: z.array(v3MediaFile).nullish(),
});

/** A case indication (`cases[].indications[]`). */
export const v3Indication = z.object({
  from: z.number().nullish(), // tooth number (UNN)
  to: z.number().nullish(),
  type: z.string().nullish(), // Crown | CrownPontic | Bridge | ConnectorBridge | OrthoAppliances | …
  material: z.string().nullish(),
});

/** A 3Shape case (`GET /v3/patients/{id}/cases` → `cases[]`). */
export const v3Case = z.object({
  caseId: idLike.optional(),
  creationDate: z.string().nullish(),
  deliveryDate: z.string().nullish(),
  lastModifiedDate: z.string().nullish(),
  workflowStatus: z.string().nullish(), // Unsent | Sent | Received | Accepted | Rejected | Shipped | Unknown
  thumbnailLink: z.string().nullish(),
  uniteCloudLink: z.string().nullish(),
  indications: z.array(v3Indication).nullish(),
});

/** A 3Shape webhook subscription (`GET /v3/webhooks` element — camelCase). */
export const v3Webhook = z.object({
  subscriptionId: idLike.optional(),
  callbackUrl: z.string().nullish(),
  authSchema: z.string().nullish(),
  subscribedEvents: z.array(z.string()).nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
});
