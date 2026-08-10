/**
 * Time-point cleanup helpers — locating and removing a timepoint's on-disk
 * artifacts when it is edited (folder rename) or deleted.
 *
 * A timepoint has two footprints (see docs/photo-sessions.md):
 *   1. Rendered gallery files in the shared `working/` dir, named
 *      `{pid}0{tpCode}.{view}` — keyed by tpCode, what getImageSizes reads.
 *   2. An optional originals folder `clinic1/{pid}/{tpName}_{DD-MM-YYYY}/` —
 *      keyed by name + date (the rename/delete of THAT folder is done via the
 *      file-explorer service; this module only computes its name).
 */
import fs from 'fs/promises';
import { log } from '../../utils/logger.js';
import { workingFileNameVariants, workingFilePath } from '../files/clinic-paths.js';
import { VIEW_CODES } from '../../shared/photo-views.js';

/**
 * Originals-folder convention on the share: `{tpName}_{DD-MM-YYYY}`. Mirrors
 * `public/js/components/react/photo-editor/PhotoEditor.tsx#folderName` so the
 * server can locate the folder a timepoint's source photos were uploaded into.
 * Returns null when the date is missing or isn't a valid 'YYYY-MM-DD' (no
 * deterministic folder name → caller skips the filesystem step). The nullable params
 * are for CLIENT input, not DB nullability: `time_points.tp_description`/`tp_date_time`
 * are NOT NULL (migrations/pg/1785700253568), but photo-editor.routes.ts feeds this
 * helper the request body's optional `tpName`/`tpDate` (photo-editor.contract.ts).
 */
export function timepointFolderName(
  tpName: string | null,
  tpDate: string | null
): string | null {
  const name = (tpName || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tpDate || '');
  if (!name || !m) return null;
  return `${name}_${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Permanently remove a timepoint's rendered gallery files from the shared
 * `working/` dir: `working/{pid}0{tpCode}.{view}` for every known view code.
 * Best-effort per file (`force` ⇒ a missing file is fine); a real error (e.g.
 * a locked file) is logged but never thrown, so DB-authoritative deletion isn't
 * blocked by a filesystem hiccup. Names come from `workingFileNameVariants` over
 * the shared VIEW_CODES, so this clears exactly what the renderer
 * (photo-render.service.ts) and getImageSizes write/read — including the legacy
 * uppercase `.INN` spelling, and adding a view code to the SSoT can never leave
 * an orphan here.
 */
export async function deleteWorkingFilesForTimepoint(
  personId: number,
  tpCode: number
): Promise<void> {
  const files = VIEW_CODES.flatMap((view) =>
    workingFileNameVariants(personId, tpCode, view).map(workingFilePath)
  );
  await Promise.all(
    files.map(async (file) => {
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

/**
 * Remove the rendered `working/` gallery files for ALL of a patient's timepoints
 * (used by the patient delete — patient-queries.ts#deletePatient only removes DB
 * rows + the originals folder, not these flat shared files). Takes the patient's
 * tpCodes (read before the DB cascade dropped them) and clears each via the
 * exact-filename helper — exact names, never a `{personId}0*` glob, because
 * personIds can prefix each other (e.g. 71 vs 710) and collide in that scheme.
 */
export async function deleteWorkingFilesForPatient(
  personId: number,
  tpCodes: number[]
): Promise<void> {
  await Promise.all(tpCodes.map((tpCode) => deleteWorkingFilesForTimepoint(personId, tpCode)));
}
