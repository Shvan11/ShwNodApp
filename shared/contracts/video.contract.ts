/**
 * API contract — educational video endpoints (`/api/videos/*`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only. The `:id/stream` + `:id/thumbnail`
 * endpoints are EXCLUDED (binary Range streams). Phase 3 Group 4: list/categories/byId
 * are tightened with looseObject row schemas; create/update stay loose (consumer
 * doesn't use their response — calls loadVideos() after).
 */
import { z } from 'zod';

// ROW SCHEMAS (Phase 3, Group 4)
const videoCategoryRow = z.looseObject({
  id: z.number(),
  name: z.string(),
});

const videoRow = z.looseObject({
  id: z.number(),
  description: z.string(),
  Video: z.string(),
  Image: z.string(),
  category: z.number().nullable(),
  details: z.string().nullable(),
});

export type VideoCategoryRow = z.infer<typeof videoCategoryRow>;
export type VideoRow = z.infer<typeof videoRow>;

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
  response: z.array(videoRow),
} as const;

// GET /api/videos/categories → category[].
export const categories = {
  response: z.array(videoCategoryRow),
} as const;

// GET /api/videos/:id → Video (rich → nullable because getVideoById returns Video | null).
export const byId = {
  response: videoRow.nullable(),
} as const;

// GET /api/videos/:id/qr → { qr, url, title }.
export const qr = {
  response: z.looseObject({ qr: z.string(), url: z.string() }),
} as const;

// POST /api/videos → created Video (rich → preserve). Multipart body.
export const create = {
  body: createVideoBody,
  // Intentionally loose: consumer (Videos.tsx) does not read the create response — calls loadVideos() after
  response: z.unknown(),
} as const;

// PUT /api/videos/:id → updated Video (rich → preserve). Multipart body.
export const update = {
  body: updateVideoBody,
  // Intentionally loose: consumer (Videos.tsx) does not read the update response — calls loadVideos() after
  response: z.unknown(),
} as const;

// DELETE /api/videos/:id → { id }.
export const remove = {
  response: z.object({ id: z.number() }),
} as const;

// `:id` path param shared by the video routes (staff + public). Type-only.
export const videoIdParams = z.object({ id: z.string() });
export type VideoIdParams = z.infer<typeof videoIdParams>;
