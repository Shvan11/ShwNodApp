/**
 * API contract — native photo-editor endpoints (`/api/photo-editor/:personId/…`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). One exported `const <action> = { body?, params?, query?, response }
 * as const` per endpoint; types via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 12 (Wave 2). Group A. `POST /:personId/render` is EXCLUDED from the
 * envelope (it answers a raw 202 + finishes in the background, announcing over
 * SSE — see CLAUDE.md); its body schema stays inline in the route, but it shares
 * the `personIdParams` guard authored here. `/prepare` returns a discriminated
 * `PhotoPrepareResult` ({ tp_code } | { conflict … } | { needsName … }) — modeled
 * as a `looseObject` with the three discriminants optional so each branch's
 * literal validates and the consumer keeps branching on them.
 */
import { z } from 'zod';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Shared `:personId` numeric param (also referenced by the excluded /render).
export const personIdParams = z.object({
  personId: z.string().regex(/^\d+$/, 'Invalid patient id'),
});

// POST /api/photo-editor/:personId/prepare → discriminated PhotoPrepareResult.
export const prepare = {
  params: personIdParams,
  body: z.object({
    tpDescription: z.string().min(1, 'tpDescription is required'),
    tpDate: z.string().regex(YMD, 'Invalid tpDate (expected YYYY-MM-DD)'),
    overrideDate: z.boolean().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
  }),
  response: z.looseObject({
    tp_code: z.number().optional(),
    conflict: z.boolean().optional(),
    needsName: z.boolean().optional(),
  }),
} as const;
export type PrepareBody = z.infer<typeof prepare.body>;

// DELETE /api/photo-editor/:personId/view → { removed }.
export const view = {
  params: personIdParams,
  body: z.object({
    tpCode: z.coerce.number().int().nonnegative(),
    tpName: z.string().optional(),
    tpDate: z.string().optional(),
    view: z.string().regex(/^i(10|12|13|20|21|22|23|24)$/, 'Invalid view code'),
  }),
  response: z.object({ removed: z.string() }),
} as const;
export type DeleteViewBody = z.infer<typeof view.body>;

// GET /api/photo-editor/:personId/photo-dates → { appointments, visits }.
export const photoDates = {
  params: personIdParams,
  response: z.object({ appointments: anyArray, visits: anyArray }),
} as const;
