/**
 * API contract — saved slideshow configurations (`slideshow_configs`, LOCAL-ONLY
 * table; see migrations/pg/1782600000000_slideshow-configs.sql).
 *
 * Imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One `export const <action> = { … } as const` per endpoint;
 * types via `z.infer`.
 *
 * The `config` jsonb payload is a CLOSED `z.discriminatedUnion` on `kind`
 * (fully modeled) — NOT a D2 loose-response marker. `configRow` is a loose object
 * (the container default) — also not a D2 marker (only the raw-unknown / any-array
 * escape hatches count). A slide carries 1–3 photos, mirroring the client's
 * SlideItem (primary + extras).
 */
import { z } from 'zod';
import { idParams, timestampString } from '../validation.js';

// ── config payload (stored verbatim in the `config` jsonb column) ─────────────

// LITERAL (per-patient): the exact picked photos, rebuilt verbatim on apply.
const literalGalleryRef = z.object({
  source: z.literal('gallery'),
  tp: z.string(),
  name: z.string(),
  label: z.string(),
  tpDescription: z.string(),
  tpDate: z.string(),
});
const literalFolderRef = z.object({
  source: z.literal('folder'),
  path: z.string(),
  name: z.string(),
  label: z.string(),
});
const literalPhotoRef = z.discriminatedUnion('source', [literalGalleryRef, literalFolderRef]);
const literalSlide = z.object({ photos: z.array(literalPhotoRef).min(1).max(3) });

// TEMPLATE (generic): photo-type + first/latest session, resolved per patient.
const templatePhotoRef = z.object({
  tp: z.enum(['first', 'latest']),
  type: z.string(), // image-type code, e.g. 'i13' (see slideshow/photoTypes.ts)
});
const templateSlide = z.object({ photos: z.array(templatePhotoRef).min(1).max(3) });

export const configPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), slides: z.array(literalSlide).min(1) }),
  z.object({ kind: z.literal('template'), slides: z.array(templateSlide).min(1) }),
]);
export type ConfigPayload = z.infer<typeof configPayload>;
export type ConfigKind = ConfigPayload['kind'];

// A row as read back by the slideshow config bar.
export const configRow = z.looseObject({
  id: z.number(),
  person_id: z.number().nullable(),
  name: z.string(),
  kind: z.enum(['literal', 'template']),
  config: configPayload,
  created_at: timestampString,
});
export type ConfigRow = z.infer<typeof configRow>;

// GET /api/slideshow-configs?personId= — that patient's configs + generic templates.
export const listConfigs = {
  query: z.object({ personId: z.coerce.number().int().positive().optional() }),
  response: z.array(configRow),
} as const;
export type ListConfigsQuery = z.infer<typeof listConfigs.query>;

// POST /api/slideshow-configs — create. `kind` is derived server-side from config.kind.
export const createConfig = {
  body: z.object({
    personId: z.number().int().positive().nullable(),
    name: z.string().min(1).max(120),
    config: configPayload,
  }),
  response: configRow,
} as const;
export type CreateConfigBody = z.infer<typeof createConfig.body>;

// PUT /api/slideshow-configs/:id — rename and/or overwrite the saved sequence.
export const updateConfig = {
  params: idParams('id'),
  body: z.object({
    name: z.string().min(1).max(120).optional(),
    config: configPayload.optional(),
  }),
  response: configRow,
} as const;
export type UpdateConfigBody = z.infer<typeof updateConfig.body>;

// DELETE /api/slideshow-configs/:id
export const deleteConfig = {
  params: idParams('id'),
  response: z.object({ id: z.number() }),
} as const;
