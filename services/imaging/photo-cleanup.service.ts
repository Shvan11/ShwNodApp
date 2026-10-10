/**
 * Time-point cleanup helpers — locating and removing a timepoint's on-disk
 * artifacts when it is edited (folder rename) or deleted.
 *
 * A timepoint has two footprints (see docs/photo-sessions.md):
 *   1. Slot files in the shared `working/` dir, named `{pid}{tpCode:02}.{slot}`
 *      — keyed by tpCode: each slot's image (`.iNN`, what getImageSizes reads) and,
 *      for a slot Dolphin filled, its untouched original (`.vNN`).
 *   2. An optional originals folder `clinic1/{pid}/{tpName}_{DD-MM-YYYY}/` —
 *      keyed by name + date (the rename/delete of THAT folder is done via the
 *      file-explorer service; this module only computes its name).
 */
import fs from 'fs/promises';
import { log } from '../../utils/logger.js';
import { workingFilePath } from '../files/clinic-paths.js';
import { listSlotFiles, moveWorkingFilesToTrash } from '../files/working-files.service.js';
import { VIEW_CODES } from '../../shared/photo-views.js';
import { sessionFolderName } from '../../shared/photo-session-folder.js';

/**
 * Originals-folder convention on the share: `{tpName}_{DD-MM-YYYY}`. The rule itself
 * lives in `shared/photo-session-folder.ts` so the photo editor's *Rename folder* list
 * and the server's rename guard classify folders by the same name. Null when the date
 * is missing or isn't a valid 'YYYY-MM-DD' (no deterministic folder name → caller skips
 * the filesystem step).
 */
export function timepointFolderName(tpName: string | null, tpDate: string | null): string | null {
  return sessionFolderName(tpName, tpDate);
}

/**
 * Move a timepoint's slot files from the shared `working/` dir to the patient's trash
 * (`clinic1/.trash/{pid}/{stamp}/working/`, restorable): each slot's image AND Dolphin's
 * original of it, so a delete never leaves a `.vNN` behind without its image.
 *
 * `slots` — `'views'`: the 8 grid views only (the session's *Delete cropped photos*,
 * which keeps the session and its X-rays); `'all'`: every slot of the session, X-rays
 * and Dolphin's other slots too (the session itself goes, and an image left under its
 * code would turn up in the next session given that code).
 *
 * Best-effort per file: a locked file is logged and left, never thrown, so the
 * DB-authoritative deletion isn't blocked by a filesystem hiccup. Names are the
 * session's exact stem (working-files.service.ts#listSlotFiles), any spelling.
 */
export async function trashWorkingFilesForTimepoint(
  personId: number,
  tpCode: number,
  slots: 'views' | 'all'
): Promise<string[]> {
  const names = await listSlotFiles(personId, [tpCode], slots === 'views' ? VIEW_CODES : undefined);
  return moveWorkingFilesToTrash(personId, names, { allOrNothing: false });
}

/**
 * Permanently remove ALL of a patient's slot files from `working/` — every slot of
 * every session, images and Dolphin's originals alike (used by the patient delete —
 * patient-queries.ts#deletePatient only removes DB rows, and the patient folder goes
 * for good, so these do too). Takes the patient's tpCodes (read before the DB cascade
 * dropped them) and matches exact stems, never a `{personId}*` glob, because personIds
 * can prefix each other (e.g. 71 vs 710) and collide in that scheme.
 */
export async function deleteWorkingFilesForPatient(
  personId: number,
  tpCodes: number[]
): Promise<void> {
  const names = await listSlotFiles(personId, tpCodes);
  await Promise.all(
    names.map(async (name) => {
      try {
        await fs.rm(workingFilePath(name), { force: true });
      } catch (err) {
        log.warn('[TimePoint] failed to remove working file', {
          name,
          error: (err as Error).message,
        });
      }
    })
  );
}
