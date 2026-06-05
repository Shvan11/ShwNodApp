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

// POST /api/videos → created Video (rich → preserve).
export const create = {
  response: z.unknown(),
} as const;

// PUT /api/videos/:id → updated Video (rich → preserve).
export const update = {
  response: z.unknown(),
} as const;

// DELETE /api/videos/:id → { id }.
export const remove = {
  response: z.object({ id: z.number() }),
} as const;
