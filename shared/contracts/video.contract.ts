/**
 * API contract — educational video endpoints (`/api/videos/*`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only. The `:id/stream` + `:id/thumbnail`
 * endpoints are EXCLUDED (binary Range streams). `Video` rows are rich query
 * types → single-object payloads stay `z.unknown()` (preserve), arrays `anyArray`.
 */
import { z } from 'zod';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// Multipart bodies (multer text fields → all strings). `validate({ body })` is
// wired AFTER the multer middleware so `req.body` is populated. On CREATE,
// `description` is kept `.optional()` here (NOT min(1)) on purpose: the handler's
// own missing-description check cleans up the already-uploaded temp file before
// 400ing — a validate() 400 would orphan a 500 MB upload. Strict `z.object`
// strips any other multipart field.
const createVideoBody = z.object({
  description: z.string().optional(),
  category: z.string().optional(),
  details: z.string().optional(),
});
const updateVideoBody = z.object({
  description: z.string().optional(),
  category: z.string().optional(),
  details: z.string().optional(),
});
export type CreateVideoBody = z.infer<typeof createVideoBody>;
export type UpdateVideoBody = z.infer<typeof updateVideoBody>;

// GET /api/videos → Video[].
export const list = {
  response: anyArray,
} as const;

// GET /api/videos/categories → category[].
export const categories = {
  response: anyArray,
} as const;

// GET /api/videos/:id → Video (rich → preserve).
export const byId = {
  response: z.unknown(),
} as const;

// GET /api/videos/:id/qr → { qr, url, title }.
export const qr = {
  response: z.looseObject({ qr: z.string(), url: z.string() }),
} as const;

// POST /api/videos → created Video (rich → preserve). Multipart body.
export const create = {
  body: createVideoBody,
  response: z.unknown(),
} as const;

// PUT /api/videos/:id → updated Video (rich → preserve). Multipart body.
export const update = {
  body: updateVideoBody,
  response: z.unknown(),
} as const;

// DELETE /api/videos/:id → { id }.
export const remove = {
  response: z.object({ id: z.number() }),
} as const;
