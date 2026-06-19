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
// Lenient on purpose: we read only the fields the UI needs and `safeParse` each
// element (skipping ones that don't match), so an unexpected shape degrades to a
// shorter list instead of a hard failure. The exact 3Shape field casing/names
// (PascalCase per the handoff) should be confirmed against the live workstation.
const idLike = z.union([z.string(), z.number()]);

/** A 3Shape case (`GET /v3/patients/{id}/cases` element). */
export const v3Case = z.object({
  Id: idLike.optional(),
  Name: z.string().nullish(),
  WorkflowId: idLike.nullish(),
  ItemNames: z.array(z.string()).nullish(),
  IsScanned: z.boolean().nullish(),
  IsModelled: z.boolean().nullish(),
});

/** A 3Shape media file (`GET /v3/patients/{id}/media` element). */
export const v3Media = z.object({
  Id: idLike.optional(),
  Name: z.string().nullish(),
  Type: z.string().nullish(),
  FileName: z.string().nullish(),
  CreatedAt: z.string().nullish(),
});

/** A 3Shape webhook subscription (`GET /v3/webhooks` element). */
export const v3Webhook = z.object({
  SubscriptionId: idLike.optional(),
  CallbackUrl: z.string().nullish(),
  SubscribedEvents: z.array(z.string()).nullish(),
});
