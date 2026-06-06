/**
 * API contract — visit endpoints.
 *
 * Single source of truth for each visit endpoint's request + response shapes,
 * imported by BOTH the Express routes (relative `.js`) and the React app
 * (`@shared` alias). One exported `const <action> = { body?, params?, query?,
 * response } as const` per endpoint; types via `z.infer`. See
 * docs/shared-contract-progress.md.
 *
 * Phase 10 (Wave 2). Adds the previously-missing GET query schemas (the
 * `workId`/`visitId` filters were read with manual `parseInt`, the H10 silent-NaN
 * class). Bodies are now FULLY ENUMERATED as strict `z.object` (the route's
 * `AddVisitByWorkBody`/`UpdateVisitByWorkBody`/`DeleteVisitByWorkBody` interfaces
 * were deleted; handlers type from the `z.infer` exports below). The add/update
 * handlers REST-SPREAD the body into `VisitData`, so EVERY field the client
 * (`NewVisitComponent`) posts is enumerated here (the old route interface was both
 * incomplete and used a stale `Next` key — the real column is `next_visit`).
 */
import { z } from 'zod';
import { intId, dateString, numericParam } from '../validation.js';

// A `<select>`-backed wire/operator id: '' → undefined; chosen value → number
// (the form sends '' for "none" and the service column is a nullable int).
const optionalCoercedInt = z
  .preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().optional())
  .optional();

// Everything NewVisitComponent posts besides the leading id — shared by add+update
// (all forwarded into the query's `VisitData` via the handler's `...spread`).
const visitFields = {
  visit_date: dateString,
  upper_wire_id: optionalCoercedInt,
  lower_wire_id: optionalCoercedInt,
  bracket_change: z.string().optional(),
  wire_bending: z.string().optional(),
  elastics: z.string().optional(),
  opg: z.boolean().optional(),
  p_photo: z.boolean().optional(),
  i_photo: z.boolean().optional(),
  f_photo: z.boolean().optional(),
  others: z.string().optional(),
  next_visit: z.string().optional(),
  appliance_removed: z.boolean().optional(),
  operator_id: optionalCoercedInt,
} as const;

// GET /api/getWires — all wire types (no query).
// wire row: { id, name } (visit-queries.ts#wire — type, non-exported).
export const getWires = {
  response: z.array(z.looseObject({ id: z.number() })),
} as const;

// GET /api/getlatestwires?workId= — { upper_wire_id, lower_wire_id, UpperWireName, LowerWireName }.
// getLatestWiresByWorkId always returns a LatestWireDetails (with null fallback for no wires).
export const latestWires = {
  query: z.object({ workId: numericParam }),
  response: z.looseObject({
    upper_wire_id: z.number().nullable(),
    lower_wire_id: z.number().nullable(),
    UpperWireName: z.string().nullable(),
    LowerWireName: z.string().nullable(),
  }),
} as const;
export type LatestWiresResponse = z.infer<typeof latestWires.response>;

// GET /api/getvisitsbywork?workId= — Visit[].
// Visit row: { id, visit_date, … } (visit-queries.ts#Visit — type, non-exported).
export const visitsByWork = {
  query: z.object({ workId: numericParam }),
  response: z.array(z.looseObject({ id: z.number() })),
} as const;

// GET /api/getvisitbyid?visitId= — single Visit row or null.
export const visitById = {
  query: z.object({ visitId: numericParam }),
  response: z.looseObject({ id: z.number() }).nullable(),
} as const;

// POST /api/addvisitbywork — { visitId } (addVisitByWorkId returns { id } | null).
export const addVisit = {
  body: z.object({ work_id: intId, ...visitFields }),
  response: z.object({ visitId: z.number().optional() }),
} as const;
export type AddVisitBody = z.infer<typeof addVisit.body>;
export type AddVisitResponse = z.infer<typeof addVisit.response>;

// PUT /api/updatevisitbywork — void success. Client posts { visitId, ...formData },
// so `work_id` rides along (optional; `updateVisitByWorkId` ignores it).
export const updateVisit = {
  body: z.object({ visitId: intId, work_id: intId.optional(), ...visitFields }),
} as const;
export type UpdateVisitBody = z.infer<typeof updateVisit.body>;

// DELETE /api/deletevisitbywork — void success (closed body, only visitId).
export const deleteVisit = {
  body: z.object({ visitId: intId }),
} as const;
export type DeleteVisitBody = z.infer<typeof deleteVisit.body>;

// Shared GET query for the visit read endpoints. Type-only (handlers parse manually;
// the per-endpoint numericParam query schemas above stay the validated boundary).
export const visitQuery = z.object({
  PID: z.string().optional(),
  VID: z.string().optional(),
  workId: z.string().optional(),
  visitId: z.string().optional(),
});
export type VisitQueryParams = z.infer<typeof visitQuery>;
