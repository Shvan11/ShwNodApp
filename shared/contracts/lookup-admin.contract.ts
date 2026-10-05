/**
 * API contract — lookup-table admin endpoints (`/api/admin/lookups/*`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). See docs/shared-contract-progress.md.
 *
 * Phase 13 (Wave 2). Group A but RESPONSE-ONLY wiring (no client `{schema}`):
 * the lookup tables are generic/dynamic per `tableName`, so rows are loose arrays
 * and the create/update bodies stay DYNAMIC `z.looseObject({})` (columns vary per
 * table; required columns are validated in-handler from the table config). The
 * relocated `:id` guard keeps a junk id 400-ing instead of reaching the PK query.
 */
import { z } from 'zod';
import { anyArray, numericParam } from '../validation.js';

// PUT/DELETE param guard — numeric `:id` + a table name.
export const tableIdParams = z.object({ tableName: z.string().min(1), id: numericParam });
export type TableIdParams = z.infer<typeof tableIdParams>;
// Dynamic per-table key/value map; required columns validated in-handler. This is
// one of the two principled non-strict bodies (columns vary per `tableName`, so
// there is NO static field list to enumerate) — `looseObject` BY DESIGN. The
// route's hand-written `LookupItemBody` interface is dropped for this `z.infer`.
const lookupItemBody = z.looseObject({});
export type LookupItemBody = z.infer<typeof lookupItemBody>;

// GET /api/admin/lookups/tables → one descriptor per registered table
// (`LOOKUP_TABLE_CONFIG`). The column SET varies per table, but every descriptor and
// every column has this one shape, so it is modeled (it was a loose array of anything,
// and four client files each re-declared the shape by hand — audit FE-F21-15).
const lookupColumn = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(['int', 'varchar', 'nvarchar', 'bit', 'uniqueidentifier', 'date', 'reference']),
  maxLength: z.number().optional(),
  required: z.boolean().optional(),
  reference: z
    .object({ table: z.string(), idColumn: z.string(), displayColumn: z.string() })
    .optional(),
});
export type LookupColumn = z.infer<typeof lookupColumn>;

const lookupTable = z.object({
  key: z.string(),
  displayName: z.string(),
  icon: z.string(),
  idColumn: z.string(),
  columns: z.array(lookupColumn),
  // Rows the code names by id: the editor offers no Delete for them, and the server
  // refuses one anyway (FE-F21-2/-12).
  protectedIds: z.array(z.number()),
});
export type LookupTableInfo = z.infer<typeof lookupTable>;

export const tables = {
  response: z.array(lookupTable),
} as const;

// GET /api/admin/lookups/:tableName → item[].
// Intentionally loose: rows are generic per-table key/value pairs; columns vary by tableName.
export const items = {
  response: anyArray,
} as const;

// POST /api/admin/lookups/:tableName → { id }.
// Intentionally loose: the id is a uuid (string), numeric id, or null depending on
// the table — modeled loosely to preserve all id types.
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
