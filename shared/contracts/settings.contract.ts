/**
 * API contract — settings / configuration endpoints (`/api/options`,
 * `/api/config/database`, `/api/system/restart`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). One exported `const <action> = { body?, params?, query?, response }
 * as const` per endpoint; types via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 11 (Wave 2). Group A — relocates the four inline boundary schemas
 * (`bulkOptions` / `optionName` params / `updateOption` / `restart`) verbatim;
 * `restart` (trivially enumerable, no service forward) becomes the `z.infer`
 * SSoT. The DB-config bodies stay DYNAMIC `z.looseObject({})` — they are free-form
 * key/value maps validated field-by-field by `DatabaseConfigService` (loose so no
 * config key is stripped before reaching the service). DB-config RESPONSES are
 * `z.unknown()`/`z.looseObject` for the same dynamic-map reason.
 */
import { z } from 'zod';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// The option `value` is a scalar the options table stores as text.
const optionScalar = z.union([z.string(), z.number(), z.boolean()]);

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

// PUT /api/options/bulk → { updated, failed }. Body loose (value passthrough to
// the service); the local `BulkUpdateBody` interface stays.
export const bulkOptions = {
  body: z.object({ options: z.array(z.looseObject({ name: z.string() })) }),
  response: z.object({ updated: z.number(), failed: z.array(z.string()) }),
} as const;

// PUT /api/options/:optionName — void success. Body keeps the scalar union
// (route's `UpdateOptionBody` interface stays — service wants a string).
export const updateOption = {
  params: z.object({ optionName: z.string().min(1) }),
  body: z.object({ value: optionScalar }),
} as const;

// POST /api/system/restart → { message }. Fully enumerable → z.infer SSoT.
export const restart = {
  body: z.object({ reason: z.string().optional() }),
  response: z.object({ message: z.string() }),
} as const;
export type RestartBody = z.infer<typeof restart.body>;

// ===== Database configuration (dynamic key/value maps) =====

// Free-form db-config body — assert a JSON object, let no key be stripped before
// `DatabaseConfigService` validates it field-by-field.
const dbConfigBody = z.looseObject({});

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
