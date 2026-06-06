/**
 * API contract — patient file-explorer endpoints (`/api/patients/:personId/files…`).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). One exported `const <action> = { body?, params?, query?, response }
 * as const` per endpoint; types via `z.infer`. See docs/shared-contract-progress.md.
 *
 * Phase 12 (Wave 2). Group A. The two file-CONTENT stream endpoints
 * (`/files/content`, `/working-files/content`) are EXCLUDED (binary `res.sendFile`
 * + Range — see CLAUDE.md). The FileEntry / FileListing / BatchDeleteResult shapes
 * are CLOSED, fully-modeled containers (plain `z.object`, not `z.looseObject`) — the
 * filesystem service emits exactly these fields, so there is no long tail to
 * preserve, and a closed schema keeps the service-side interfaces assignable to
 * `sendData` without an interface→type flip. The `z.infer` types below are the
 * single source of truth for the client (`public/js/types/api.types.ts`
 * re-exports them). Path-safety stays in file-explorer.service.ts; the
 * folder/rename bodies only assert a string TYPE.
 */
import { z } from 'zod';
import { idParams } from '../validation.js';

// Shared `:personId` numeric param (defense-in-depth ahead of the service's path
// safety; for upload, validated BEFORE any bytes are accepted).
export const personIdParams = idParams('personId');

// ── Core filesystem shapes (mirror services/files/file-explorer.service.ts) ────
// `size`/`modified` are omitted in flat-walk mode (no per-file stat), so optional.
export const fileEntry = z.object({
  name: z.string(),
  relPath: z.string(),
  type: z.enum(['file', 'dir', 'symlink']),
  size: z.number().optional(),
  modified: z.string().optional(),
  ext: z.string(),
  category: z.enum(['image', 'video', 'audio', 'pdf', 'text', 'office', 'archive', 'other']),
});
export type FileEntry = z.infer<typeof fileEntry>;
export type FileEntryType = FileEntry['type'];
export type FileCategory = FileEntry['category'];

export const fileListing = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  flat: z.boolean(),
  truncated: z.boolean(),
  entries: z.array(fileEntry),
});
export type FileListing = z.infer<typeof fileListing>;

const fileDeleteResult = z.object({
  relPath: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type FileDeleteResult = z.infer<typeof fileDeleteResult>;

const batchDeleteResult = z.object({
  results: z.array(fileDeleteResult),
  succeeded: z.number(),
  failed: z.number(),
});
export type FileBatchDeleteResult = z.infer<typeof batchDeleteResult>;

// GET /api/patients/:personId/files[?path=&flat=] → FileListing.
export const list = {
  response: fileListing,
} as const;

// GET /api/patients/:personId/working-files → FileListing (working/ dir, flat=false).
export const workingFiles = {
  response: fileListing,
} as const;

// POST /api/patients/:personId/files/upload → { files: FileEntry[] }.
export const upload = {
  params: personIdParams,
  response: z.object({ files: z.array(fileEntry) }),
} as const;

// POST /api/patients/:personId/files/folder → FileEntry.
export const folder = {
  params: personIdParams,
  body: z.object({ path: z.string().optional(), name: z.string().optional() }),
  response: fileEntry,
} as const;

// POST /api/patients/:personId/files/rename → FileEntry.
export const rename = {
  params: personIdParams,
  body: z.object({ path: z.string().optional(), newName: z.string().optional() }),
  response: fileEntry,
} as const;

// DELETE /api/patients/:personId/files[?path=] → { path }.
export const deleteEntry = {
  params: personIdParams,
  response: z.object({ path: z.string() }),
} as const;

// POST /api/patients/:personId/files/delete-batch → BatchDeleteResult.
export const deleteBatch = {
  params: personIdParams,
  response: batchDeleteResult,
} as const;
