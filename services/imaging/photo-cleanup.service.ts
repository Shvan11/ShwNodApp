/**
 * Time-point cleanup helpers — locating and removing a timepoint's on-disk
 * artifacts when it is edited (folder rename) or deleted.
 *
 * A timepoint has two footprints (see docs/photo-sessions.md):
 *   1. Rendered gallery files in the shared `working/` dir, named
 *      `{pid}0{tpCode}.i{view}` — keyed by tpCode, what getImageSizes reads.
 *   2. An optional originals folder `clinic1/{pid}/{tpName}_{DD-MM-YYYY}/` —
 *      keyed by name + date (the rename/delete of THAT folder is done via the
 *      file-explorer service; this module only computes its name).
 */
import fs from 'fs/promises';
import config from '../../config/config.js';
import { createPathResolver } from '../../utils/path-resolver.js';
import { log } from '../../utils/logger.js';

/** The 8 patient view codes the photo grid renders (logo.png is shared — never touched). */
const VIEW_CODES = ['10', '12', '13', '20', '21', '22', '23', '24'];

/**
 * Originals-folder convention on the share: `{tpName}_{DD-MM-YYYY}`. Mirrors
 * `public/js/components/react/photo-editor/PhotoEditor.tsx#folderName` so the
 * server can locate the folder a timepoint's source photos were uploaded into.
 * Returns null when the date isn't a valid 'YYYY-MM-DD' (no deterministic
 * folder name → caller skips the filesystem step).
 */
export function timepointFolderName(tpName: string, tpDate: string): string | null {
  const name = (tpName || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tpDate || '');
  if (!name || !m) return null;
  return `${name}_${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Permanently remove a timepoint's rendered gallery files from the shared
 * `working/` dir: `working/{pid}0{tpCode}.i{view}` for every known view code.
 * Best-effort per file (`force` ⇒ a missing file is fine); a real error (e.g.
 * a locked file) is logged but never thrown, so DB-authoritative deletion isn't
 * blocked by a filesystem hiccup. The lowercase `.i{view}` matches the render
 * output (photo-render.service.ts) and getImageSizes.
 */
export async function deleteWorkingFilesForTimepoint(
  personId: number,
  tpCode: number
): Promise<void> {
  const pathResolver = createPathResolver(config.fileSystem.machinePath || '');
  await Promise.all(
    VIEW_CODES.map(async (code) => {
      const file = pathResolver(`working/${personId}0${tpCode}.i${code}`);
      try {
        await fs.rm(file, { force: true });
      } catch (err) {
        log.warn('[TimePoint] failed to remove working file', {
          file,
          error: (err as Error).message,
        });
      }
    })
  );
}
