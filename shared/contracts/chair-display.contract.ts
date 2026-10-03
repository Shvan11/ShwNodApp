/**
 * API contract — chair-side public display beacons (`/api/chair-display/*`).
 *
 * Both endpoints are hit by `navigator.sendBeacon` (a JSON Blob body) from the
 * staff app and answer 202 immediately; the client never reads the response, so
 * only the REQUEST bodies are contracted. They are fully enumerated strict
 * `z.object`s wired via `validate({ body })` (the route is public + CSRF-skipped,
 * but the beacon still carries a JSON body, so body validation applies). The
 * handlers keep their own defensive re-parse (`parseChairId`, personId coercion)
 * — `chairId` arrives as a string from localStorage but a number is tolerated,
 * and `personId` as a number — so both fields accept the string|number union. The
 * route's hand-written `PatientLoadedBody`/`PatientClearedBody` interfaces are
 * dropped for these `z.infer` exports. See docs/shared-contract-progress.md.
 */
import { z } from 'zod';

// chairId comes from localStorage (string); a number is also accepted.
const chairId = z.union([z.string(), z.number()]);

// Transport ordering (audit FE-F4-10): the sending tab's random id + its
// increasing counter, so the server can drop a beacon that arrives after a newer
// one from the same tab. Optional — a tab still running an older build sends
// neither and is ordered by arrival, as before.
const ordering = {
  src: z.string().min(1).max(64).optional(),
  seq: z.number().int().nonnegative().optional(),
};

// POST /api/chair-display/patient-loaded — { chairId, personId, src?, seq? }.
export const patientLoaded = {
  body: z.object({ chairId, personId: z.union([z.number(), z.string()]), ...ordering }),
} as const;
export type PatientLoadedBody = z.infer<typeof patientLoaded.body>;

// POST /api/chair-display/patient-cleared — { chairId, src?, seq? }.
export const patientCleared = {
  body: z.object({ chairId, ...ordering }),
} as const;
export type PatientClearedBody = z.infer<typeof patientCleared.body>;
