/**
 * API contract — utility endpoints (`/api/google`, `/api/convert-path`).
 *
 * Single source of truth for each endpoint's response shapes, imported by BOTH
 * the Express routes (relative `.js`) and the React app (`@shared` alias). See
 * docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group B — response-only (no client `{schema}`). The
 * `/sendtwilio` + `/checktwilio` endpoints are EXCLUDED (`res.send` plain text).
 */
import { z } from 'zod';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// GET /api/google?source= → contacts[].
export const google = {
  response: anyArray,
} as const;

// GET /api/convert-path?path= → { webPath, fullPath }.
export const convertPath = {
  response: z.object({ webPath: z.string(), fullPath: z.string() }),
} as const;
