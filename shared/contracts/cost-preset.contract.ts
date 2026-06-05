/**
 * API contract — cost-preset endpoints (`/api/settings/cost-presets`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). One
 * exported `const <action> = { response } as const` per payload endpoint; types
 * via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 11 (Wave 2). Group B — RESPONSE-ONLY: the route is mounted pre-auth-gate
 * with its OWN inline validation/admin guards (no `validate()`), so no request
 * schema is authored here. The GET feed is a dropdown N13 victim (consumers key
 * on `preset_id`) → modeled `z.looseObject({ preset_id })`; the `CostPreset`
 * query interface is flipped to a `type` so it feeds the looseObject `sendData`
 * arg (the index-signature rule). PUT/DELETE stay `sendSuccess(res, null)` voids.
 */
import { z } from 'zod';

// GET /api/settings/cost-presets → CostPreset[] (dropdown feed; row-id guard).
export const getPresets = {
  response: z.array(z.looseObject({ preset_id: z.number() })),
} as const;
export type GetPresetsResponse = z.infer<typeof getPresets.response>;

// POST /api/settings/cost-presets → { presetId } (the new id).
export const createPreset = {
  response: z.object({ presetId: z.number() }),
} as const;
