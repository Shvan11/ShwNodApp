/**
 * API contract — settings / configuration endpoints (`/api/options`,
 * `/api/config/database`, `/api/system/restart`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). One exported `const <action> = { body?, params?, query?, response }
 * as const` per endpoint; types via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 11 (Wave 2). The `bulkOptions` / `updateOption` / `restart` bodies are
 * FULLY ENUMERATED strict `z.object` and the `z.infer` SSoT (the route's
 * `BulkUpdateBody`/`UpdateOptionBody` interfaces were deleted). The DB-config
 * bodies stay DYNAMIC `z.looseObject({})` — free-form key/value maps validated
 * field-by-field by `DatabaseConfigService` (loose so no config key is stripped
 * before reaching the service); the route's `DatabaseConfigBody` interface is
 * dropped in favour of `z.infer<typeof dbConfigBody>` (structurally identical).
 * DB-config RESPONSES are `z.unknown()`/`z.looseObject` for the same reason.
 */
import { z } from 'zod';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// The option `value` is stored as TEXT; both the single + bulk services want a
// `string`. `z.coerce.string()` accepts the old scalar union (string/number/
// boolean a caller might send) and OUTPUTS the string the service requires.
const optionValue = z.coerce.string();

// ===== Options / settings =====

// GET /api/options → { options: Option[] }.
export const getOptions = {
  response: z.object({ options: anyArray }),
} as const;
export type GetOptionsResponse = z.infer<typeof getOptions.response>;

// GET /api/options/:optionName → { optionName, value } (null value 404s first).
export const getOptionByName = {
  params: z.object({ optionName: z.string().min(1) }),
  response: z.object({ optionName: z.string(), value: z.string() }),
} as const;

// PUT /api/options/bulk → { updated, failed }. Each row fully enumerated
// ({ name, value }) → strict — matches the service's `{ name, value: string }[]`.
export const bulkOptions = {
  body: z.object({ options: z.array(z.object({ name: z.string(), value: optionValue })) }),
  response: z.object({ updated: z.number(), failed: z.array(z.string()) }),
} as const;
export type BulkUpdateBody = z.infer<typeof bulkOptions.body>;

// PUT /api/options/:optionName — void success. `value` outputs the string the
// service requires.
export const updateOption = {
  params: z.object({ optionName: z.string().min(1) }),
  body: z.object({ value: optionValue }),
} as const;
export type UpdateOptionBody = z.infer<typeof updateOption.body>;

// POST /api/system/restart → { message }. Fully enumerable → z.infer SSoT.
export const restart = {
  body: z.object({ reason: z.string().optional() }),
  response: z.object({ message: z.string() }),
} as const;
export type RestartBody = z.infer<typeof restart.body>;

// ===== Database configuration (dynamic key/value maps) =====

// Free-form db-config body — assert a JSON object, let no key be stripped before
// `DatabaseConfigService` validates it field-by-field. Genuinely dynamic: there
// is no static field list to enumerate, so this stays `looseObject` BY DESIGN
// (the route's hand-written interface is dropped for this `z.infer` instead).
const dbConfigBody = z.looseObject({});
export type DatabaseConfigBody = z.infer<typeof dbConfigBody>;

// GET /api/config/database → { config } (masked config object, dynamic shape).
export const getDatabaseConfig = {
  response: z.object({ config: z.unknown() }),
} as const;

// POST /api/config/database/test → { connectionOk, message, details }.
export const testDatabaseConnection = {
  body: dbConfigBody,
  response: z.looseObject({ connectionOk: z.boolean() }),
} as const;

// PUT /api/config/database → { config, requiresRestart, message } (success path).
export const updateDatabaseConfig = {
  body: dbConfigBody,
  response: z.looseObject({ requiresRestart: z.boolean().optional() }),
} as const;

// GET /api/config/database/export → { config } (sanitized export blob).
export const exportDatabaseConfig = {
  response: z.object({ config: z.unknown() }),
} as const;
