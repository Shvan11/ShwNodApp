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
 * + Range — see CLAUDE.md). `FileListing`/`FileEntry` are rich service types, so
 * single-object payloads are `z.unknown()` (no-op guard, preserves payload — avoids
 * flipping the service types) and containers wrap an array field in `anyArray`.
 * Path-safety stays in file-explorer.service.ts; the folder/rename bodies only
 * assert a string TYPE.
 */
import { z } from 'zod';
import { idParams } from '../validation.js';

// "is it an array" guard — flip-free (every type is assignable to `unknown`).
const anyArray = z.array(z.unknown());

// Shared `:personId` numeric param (defense-in-depth ahead of the service's path
// safety; for upload, validated BEFORE any bytes are accepted).
export const personIdParams = idParams('personId');

// GET /api/patients/:personId/files[?path=&flat=] → FileListing (rich → preserve).
export const list = {
  response: z.unknown(),
} as const;

// GET /api/patients/:personId/working-files → { path, parent, flat, truncated, entries }.
export const workingFiles = {
  response: z.looseObject({ entries: anyArray }),
} as const;

// POST /api/patients/:personId/files/upload → { files: FileEntry[] }.
export const upload = {
  params: personIdParams,
  response: z.object({ files: anyArray }),
} as const;

// POST /api/patients/:personId/files/folder → FileEntry (rich → preserve).
export const folder = {
  params: personIdParams,
  body: z.object({ path: z.string().optional(), name: z.string().optional() }),
  response: z.unknown(),
} as const;

// POST /api/patients/:personId/files/rename → FileEntry (rich → preserve).
export const rename = {
  params: personIdParams,
  body: z.object({ path: z.string().optional(), newName: z.string().optional() }),
  response: z.unknown(),
} as const;

// DELETE /api/patients/:personId/files[?path=] → { path }.
export const deleteEntry = {
  params: personIdParams,
  response: z.object({ path: z.string() }),
} as const;

// POST /api/patients/:personId/files/delete-batch → BatchDeleteResult (rich → preserve).
export const deleteBatch = {
  params: personIdParams,
  response: z.unknown(),
} as const;
