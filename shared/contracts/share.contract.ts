/**
 * API contract — ad-hoc share staging (`/api/share/*`).
 *
 * Single source of truth for the endpoint's request + response shapes, imported
 * by BOTH the Express route (relative `.js`) and the React app (`@shared` alias).
 * See docs/shared-contract-progress.md.
 *
 * The share targets (LocalSend, Telegram) resolve files by an on-disk path via
 * `services/files/share-ref.ts`. A screen like Compare produces an image only in
 * the browser (a canvas montage), so it first uploads the bytes here; the server
 * stages them to a short-lived temp dir and returns a `ref` token the client then
 * passes back as a `{ source: 'staged' }` SendFileRef. Response is a CLOSED
 * `z.object` — the server builds it field-for-field, so there is no long tail.
 */
import { z } from 'zod';
import { intId } from '../validation.js';

// POST /api/share/stage — multipart/form-data: file field `image` (PNG/JPEG) +
// the text fields below. Returns the staged token + its display name.
export const stage = {
  body: z.object({
    personId: intId,
    displayName: z.string().max(200).optional(),
  }),
  response: z.object({
    ref: z.string(),
    displayName: z.string(),
  }),
} as const;
export type StageBody = z.infer<typeof stage.body>;
export type StageResponse = z.infer<typeof stage.response>;
