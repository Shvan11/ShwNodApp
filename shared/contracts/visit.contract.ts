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
 * class). Bodies stay LOOSE: add/update REST-SPREAD `...visitData` into the
 * query, but the query builders write an EXPLICIT named-column `.values()`/
 * `.set()` (over-posting closed at the query layer) AND read more fields than the
 * route's interface lists — so the contract validates only the required id + a
 * real-calendar `visit_date` and passes the rest through. Legacy paths kept.
 */
import { z } from 'zod';
import { intId, dateString, numericParam } from '../validation.js';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// GET /api/getWires — all wire types (no query).
export const getWires = {
  response: anyArray,
} as const;

// GET /api/getlatestwires?workId= — LatestWireDetails (rich single → preserve).
export const latestWires = {
  query: z.object({ workId: numericParam }),
  response: z.unknown(),
} as const;

// GET /api/getvisitsbywork?workId= — Visit[].
export const visitsByWork = {
  query: z.object({ workId: numericParam }),
  response: anyArray,
} as const;

// GET /api/getvisitbyid?visitId= — single Visit row (rich → preserve).
export const visitById = {
  query: z.object({ visitId: numericParam }),
  response: z.unknown(),
} as const;

// POST /api/addvisitbywork — { visitId } (addVisitByWorkId returns { id } | null).
export const addVisit = {
  body: z.looseObject({ work_id: intId, visit_date: dateString }),
  response: z.object({ visitId: z.number().optional() }),
} as const;

// PUT /api/updatevisitbywork — void success.
export const updateVisit = {
  body: z.looseObject({ visitId: intId, visit_date: dateString }),
} as const;

// DELETE /api/deletevisitbywork — void success (closed body, only visitId).
export const deleteVisit = {
  body: z.object({ visitId: intId }),
} as const;
