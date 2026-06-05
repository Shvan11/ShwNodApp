/**
 * API contract — lookup-table admin endpoints (`/api/admin/lookups/*`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). See docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group A but RESPONSE-ONLY wiring (no client `{schema}`):
 * the lookup tables are generic/dynamic per `tableName`, so rows are `anyArray`
 * and the create/update bodies stay DYNAMIC `z.looseObject({})` (columns vary per
 * table; required columns are validated in-handler from the table config). The
 * relocated `:id` guard keeps a junk id 400-ing instead of reaching the PK query.
 */
import { z } from 'zod';
import { numericParam } from '../validation.js';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// PUT/DELETE param guard — numeric `:id` + a table name.
const tableIdParams = z.object({ tableName: z.string().min(1), id: numericParam });
// Dynamic per-table key/value map; required columns validated in-handler. This is
// one of the two principled non-strict bodies (columns vary per `tableName`, so
// there is NO static field list to enumerate) — `looseObject` BY DESIGN. The
// route's hand-written `LookupItemBody` interface is dropped for this `z.infer`.
const lookupItemBody = z.looseObject({});
export type LookupItemBody = z.infer<typeof lookupItemBody>;

// GET /api/admin/lookups/tables → LookupTableConfig[].
export const tables = {
  response: anyArray,
} as const;

// GET /api/admin/lookups/:tableName → item[].
export const items = {
  response: anyArray,
} as const;

// POST /api/admin/lookups/:tableName → { id }. The id is a uuid (string),
// numeric id, or null depending on the table → modeled loosely (preserve).
export const createItem = {
  body: lookupItemBody,
  response: z.object({ id: z.unknown() }),
} as const;

// PUT /api/admin/lookups/:tableName/:id — void success.
export const updateItem = {
  params: tableIdParams,
  body: lookupItemBody,
} as const;

// DELETE /api/admin/lookups/:tableName/:id — void success.
export const deleteItem = {
  params: tableIdParams,
} as const;

// GET /api/admin/lookups/:tableName — table-name-only param (type-only).
export const tableParams = z.object({ tableName: z.string().min(1) });
export type TableNameParams = z.infer<typeof tableParams>;
