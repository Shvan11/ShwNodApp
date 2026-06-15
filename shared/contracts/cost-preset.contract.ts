/**
 * API contract — cost-preset endpoints (`/api/settings/cost-presets`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). One
 * exported `const <action> = { response } as const` per payload endpoint; types
 * via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 11 (Wave 2). The route is mounted pre-auth-gate with its OWN inline
 * admin guards. The create/update BODY is now fully enumerated here as a strict
 * `z.object` and wired via `validate({ body })` AFTER the admin guard (the
 * hand-written `CostPresetBody` interface in the route was deleted; the handler
 * types from `CostPresetBody = z.infer` below). The GET feed is a dropdown N13
 * victim (consumers key on `preset_id`) → modeled `z.looseObject({ preset_id })`;
 * the `CostPreset` query interface is flipped to a `type` so it feeds the
 * looseObject `sendData` arg (the index-signature rule). PUT/DELETE responses
 * stay `sendSuccess(res, null)` voids.
 */
import { z } from 'zod';
import { idParams } from '../validation.js';

// Shared body for create + update (admin). The client (`CostPresetsSettings.tsx`)
// always sends all three: amount (>0), currency (one of the three), displayOrder
// (handler defaults 0 when omitted). Strip via `z.object` — over-posting can't
// reach the DB, valid form payload is never 400'd.
const costPresetBody = z.object({
  amount: z.coerce.number().positive(),
  currency: z.enum(['IQD', 'USD', 'EUR']),
  displayOrder: z.coerce.number().int().optional(),
});
export type CostPresetBody = z.infer<typeof costPresetBody>;

// GET /api/settings/cost-presets → CostPreset[] (dropdown feed). Fully modeled:
// `currency` is the controlled 3-value vocabulary (enum → precise client type +
// runtime validation); `amount`/`display_order` are non-null numbers (the query
// asserts both, and the consumer sorts on display_order).
export const getPresets = {
  response: z.array(
    z.looseObject({
      preset_id: z.number(),
      amount: z.number(),
      currency: z.enum(['IQD', 'USD', 'EUR']),
      display_order: z.number(),
    })
  ),
} as const;
export type GetPresetsResponse = z.infer<typeof getPresets.response>;

// POST /api/settings/cost-presets → { presetId } (the new id).
export const createPreset = {
  body: costPresetBody,
  response: z.object({ presetId: z.number() }),
} as const;

// PUT /api/settings/cost-presets/:id — void success.
export const updatePreset = {
  params: idParams('id'),
  body: costPresetBody,
} as const;

// DELETE /api/settings/cost-presets/:id — void success.
export const deletePreset = {
  params: idParams('id'),
} as const;

// GET /api/settings/cost-presets?currency= — type-only (handler reads currency directly).
export const getPresetsQuery = z.object({ currency: z.string().optional() });
export type CostPresetQuery = z.infer<typeof getPresetsQuery>;
