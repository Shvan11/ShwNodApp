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
 * DB-config responses are dynamic masked objects — intentionally left as loose guards.
 */
import { z } from 'zod';

// The option `value` is stored as TEXT; both the single + bulk services want a
// `string`. `z.coerce.string()` accepts the old scalar union (string/number/
// boolean a caller might send) and OUTPUTS the string the service requires.
const optionValue = z.coerce.string();

// Option row from the `options` table (options-queries.ts#Option — type, non-exported).
const optionRow = z.looseObject({
  option_name: z.string(),
  option_value: z.string().nullable(),
});

// ===== Options / settings =====

// GET /api/options → { options: Option[] }.
export const getOptions = {
  response: z.object({ options: z.array(optionRow) }),
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
// Intentionally loose: DatabaseConfigService returns a sanitized free-form config map;
// the exact key set varies by configuration and cannot be statically enumerated.
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
// Intentionally loose: same dynamic shape as getDatabaseConfig (sanitized for export).
export const exportDatabaseConfig = {
  response: z.object({ config: z.unknown() }),
} as const;

// `:optionName` path param, shared by the option read/update routes.
export type OptionNameParams = z.infer<typeof getOptionByName.params>;

// ===== Database backup to Google Drive =====
// (`services/google-drive/drive-backup.ts`; the download itself, GET /config/database/backup, is a
// raw stream with no contract.)

const driveBackupJob = z.object({
  state: z.enum(['running', 'succeeded', 'failed']),
  phase: z.enum(['preparing', 'uploading', 'verifying', 'replacing']).nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  bytes: z.number(),
  fileName: z.string(),
  replaced: z.number(),
  error: z.string().nullable(),
  warning: z.string().nullable(),
});
export type DriveBackupJob = z.infer<typeof driveBackupJob>;

// GET /api/config/database/backup/drive → the connection, the folder, the backup in it, the latest run.
export const driveBackupStatus = {
  response: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    folder: z.object({ id: z.string(), name: z.string(), url: z.string().nullable() }).nullable(),
    latest: z
      .object({
        name: z.string(),
        size: z.number().nullable(),
        createdTime: z.string().nullable(),
        url: z.string().nullable(),
      })
      .nullable(),
    driveError: z.string().nullable(),
    job: driveBackupJob.nullable(),
  }),
} as const;
export type DriveBackupStatusResponse = z.infer<typeof driveBackupStatus.response>;

// POST /api/config/database/backup/drive → { job } (starts in the background; 409 while one runs).
export const startDriveBackup = {
  response: z.object({ job: driveBackupJob }),
} as const;
export type StartDriveBackupResponse = z.infer<typeof startDriveBackup.response>;
