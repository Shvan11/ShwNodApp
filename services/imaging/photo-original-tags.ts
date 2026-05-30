/**
 * Original-photo "view tags" — the app's equivalent of Dolphin's `.v{view}` files,
 * done our way. The timepoint's source original for a view is renamed in-place to
 * carry a readable `{view}-` prefix (e.g. `IMG_001.jpg` → `i12-IMG_001.jpg`), so on
 * reopen the photo editor knows which original produced which cropped view and can
 * reload it for re-editing — no manifest / DB needed.
 *
 * Convention: `{viewCode}-{originalName}` (code prefix, hyphen, no spaces). Exactly
 * one file is tagged per view; a file carries at most one view tag. The client mirror
 * of `parseViewTag` lives in `public/js/components/react/photo-editor/photoEditorTypes.ts`
 * (`parseOriginalViewTag`) — keep the two regexes in sync.
 */
import fs from 'fs/promises';
import path from 'path';
import { resolveSafe, FileExplorerError } from '../files/file-explorer.service.js';
import { log } from '../../utils/logger.js';

/** The 8 editable Dolphin view codes (mirrors photoEditorTypes VIEW_CODES on the client). */
const VIEW_CODES = ['i10', 'i12', 'i13', 'i20', 'i21', 'i22', 'i23', 'i24'] as const;
type ViewCode = (typeof VIEW_CODES)[number];
const TAG_RE = /^(i10|i12|i13|i20|i21|i22|i23|i24)-(.+)$/;

export interface ViewTag {
  view: ViewCode;
  /** The original filename with the `{view}-` prefix stripped. */
  original: string;
}

/** Parse a `{view}-{original}` filename, or null if it carries no view tag. */
export function parseViewTag(name: string): ViewTag | null {
  const m = TAG_RE.exec(name);
  return m ? { view: m[1] as ViewCode, original: m[2] } : null;
}

/** Strip a leading `{view}-` tag (if any) → the clean original basename. */
function stripTag(name: string): string {
  const m = TAG_RE.exec(name);
  return m ? m[2] : name;
}

function isViewCode(v: string): v is ViewCode {
  return (VIEW_CODES as readonly string[]).includes(v);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Pick a name in `dirAbs` that doesn't already exist, appending ` (n)` before the ext. */
async function uniqueName(dirAbs: string, desired: string): Promise<string> {
  const ext = path.extname(desired);
  const stem = desired.slice(0, desired.length - ext.length);
  let candidate = desired;
  let i = 1;
  while (await pathExists(path.join(dirAbs, candidate))) {
    candidate = `${stem} (${i++})${ext}`;
  }
  return candidate;
}

async function safeRename(dirAbs: string, from: string, to: string): Promise<void> {
  if (from === to) return;
  await fs.rename(path.join(dirAbs, from), path.join(dirAbs, to));
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Tag `sourceRelPath`'s file in `folderRel` as the original for `view`: untag any
 * previous holder of `view`, strip any other-view tag from the source, then rename
 * it to `{view}-{clean}`. Returns the new patient-root-relative path. The source must
 * already live directly inside `folderRel`; a cross-folder source is left as-is
 * (not auto-restorable — see the plan). Best-effort by design — the caller logs and
 * continues on failure so a tag hiccup never fails a render.
 */
export async function tagOriginalForView(
  personId: number | string,
  folderRel: string,
  sourceRelPath: string,
  view: string
): Promise<string> {
  if (!isViewCode(view)) throw new FileExplorerError(`Invalid view code: ${view}`, 400);

  const normFolder = normalizeRel(folderRel);
  const normSrcDir = path.posix.dirname(normalizeRel(sourceRelPath));
  if (normSrcDir !== normFolder) {
    log.warn('[PhotoEditor] original not in timepoint folder; skipping tag', { sourceRelPath, folderRel });
    return sourceRelPath;
  }

  const srcBase = path.basename(sourceRelPath);
  if (srcBase.startsWith(`${view}-`)) return sourceRelPath; // already tagged for this view

  const { abs: folderAbs } = resolveSafe(personId, normFolder);

  let entries: string[] = [];
  try {
    entries = await fs.readdir(folderAbs);
  } catch {
    return sourceRelPath; // folder vanished — nothing to do
  }

  // 1. Untag the previous holder of this view (if any, and not the source itself).
  for (const name of entries) {
    const tag = parseViewTag(name);
    if (tag && tag.view === view && name !== srcBase) {
      await safeRename(folderAbs, name, await uniqueName(folderAbs, tag.original));
    }
  }

  // 2. Tag the source (strip any other-view tag first).
  const tagged = await uniqueName(folderAbs, `${view}-${stripTag(srcBase)}`);
  await safeRename(folderAbs, srcBase, tagged);

  return `${normFolder}/${tagged}`;
}

/** Untag every file tagged for `view` in `folderRel` (rename back to the clean name). */
export async function untagOriginalForView(
  personId: number | string,
  folderRel: string,
  view: string
): Promise<void> {
  if (!isViewCode(view)) return;
  const normFolder = normalizeRel(folderRel);
  const { abs: folderAbs } = resolveSafe(personId, normFolder);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(folderAbs);
  } catch {
    return;
  }
  for (const name of entries) {
    const tag = parseViewTag(name);
    if (tag && tag.view === view) {
      await safeRename(folderAbs, name, await uniqueName(folderAbs, tag.original));
    }
  }
}
