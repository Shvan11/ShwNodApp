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
export type PersonIdParams = z.infer<typeof personIdParams>;

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
// GET /api/patients/:personId/working-files → the patient's images in Dolphin's
// working gallery: every slot of every session, the 8 grid views and the rest
// (OPG, ceph, …). Each entry carries the session and the slot its name encodes,
// so the client groups and labels without parsing filenames.
export const workingFileEntry = fileEntry.extend({
  tpCode: z.number(),
  /** Dolphin slot code, lower-case: `i12` (a grid view), `i51` (an OPG), … */
  view: z.string(),
});
export type WorkingFileEntry = z.infer<typeof workingFileEntry>;

export const workingFiles = {
  response: fileListing.extend({ entries: z.array(workingFileEntry) }),
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
// A top-level folder that a photo session or the X-ray card owns is refused with a
// 409 (`details.code` 'SESSION_FOLDER' | 'RESERVED_FOLDER') unless `force` is set —
// renaming it silently detaches it from its owner (FE-F14-5). The client confirms,
// then resends with `force: true`.
export const rename = {
  params: personIdParams,
  body: z.object({ path: z.string().optional(), newName: z.string().optional(), force: z.boolean().optional() }),
  response: fileEntry,
} as const;
export type RenameBody = z.infer<typeof rename.body>;

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

/** Matches the listing cap — a "select all" can't exceed it. */
export const MAX_TRANSFER_ITEMS = 5000;

const transferItemResult = z.object({
  relPath: z.string(),
  ok: z.boolean(),
  newPath: z.string().optional(),
  renamed: z.boolean().optional(),
  skipped: z.boolean().optional(),
  error: z.string().optional(),
});
export type FileTransferItemResult = z.infer<typeof transferItemResult>;

const transferResult = z.object({
  results: z.array(transferItemResult),
  succeeded: z.number(),
  failed: z.number(),
});
export type FileTransferResult = z.infer<typeof transferResult>;

// `paths` are entries under the patient folder; `dest` is an existing folder there
// ('' = the patient folder itself). Path safety stays in the service.
const transferBody = z.object({
  paths: z.array(z.string().min(1)).min(1).max(MAX_TRANSFER_ITEMS),
  dest: z.string(),
});

// POST /api/patients/:personId/files/move → TransferResult. Like rename, moving a
// top-level folder that a photo session or the X-ray card owns is refused with a 409
// (`details.code` 'SESSION_FOLDER' | 'RESERVED_FOLDER') unless `force` is set.
export const move = {
  params: personIdParams,
  body: transferBody.extend({ force: z.boolean().optional() }),
  response: transferResult,
} as const;
export type MoveBody = z.infer<typeof move.body>;

// POST /api/patients/:personId/files/copy → TransferResult.
export const copy = {
  params: personIdParams,
  body: transferBody,
  response: transferResult,
} as const;
export type CopyBody = z.infer<typeof copy.body>;
