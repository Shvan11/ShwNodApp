/**
 * Which top-level folders in a patient's file tree belong to something.
 *
 * A photo session keeps its source originals in `clinic1/{personId}/{name}_{DD-MM-YYYY}/`
 * — the name + date of the session row, so renaming or re-dating the session renames the
 * folder (patient-timepoint.routes.ts) and the editor finds its originals by it. A few
 * other top-level names are read by fixed path: the X-ray card lists `OPG`, the X-ray
 * renderer writes `OPGIMG`, and CBCT studies sit in `CBCT`.
 *
 * Renaming one of those folders silently detaches it from its owner: the session loses
 * *Restore original* and *Open original folder*, or the X-ray card goes empty. The
 * photo editor's *Rename folder* used to offer every top-level folder as a target
 * (FE-F14-5) — this module is what both that dialog and the server's rename guard
 * classify folders with.
 *
 * Lives in `shared/` so the Express side (relative `.js`) and the React bundle
 * (`@shared`) compute the same name.
 */

/**
 * `{name}_{DD-MM-YYYY}` — the originals-folder convention. Null when the date is not a
 * valid `YYYY-MM-DD` or the name is blank (no deterministic folder → callers skip the
 * filesystem step).
 */
export function sessionFolderName(name: string | null | undefined, date: string | null | undefined): string | null {
  const n = (name ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!n || !m) return null;
  return `${n}_${m[3]}-${m[2]}-${m[1]}`;
}

/** Top-level patient folders the app reads by fixed name. */
export const RESERVED_PATIENT_FOLDERS = ['OPG', 'OPGIMG', 'CBCT'] as const;

/** Case-insensitive (the clinic volume is NTFS). */
export function isReservedPatientFolder(folder: string): boolean {
  const f = folder.toLowerCase();
  return RESERVED_PATIENT_FOLDERS.some((r) => r.toLowerCase() === f);
}

/** Who owns a top-level folder, if anyone. */
export type FolderOwner =
  | { kind: 'session'; tpCode: string; name: string; date: string }
  | { kind: 'reserved' }
  | null;

/**
 * Classify `folder` against the patient's sessions (`{ tp_code, tp_description,
 * tp_date_time }`, as the timepoints list returns them). Matching is case-insensitive.
 */
export function folderOwner(
  folder: string,
  sessions: ReadonlyArray<{ tp_code: string | number; tp_description: string; tp_date_time: string }>
): FolderOwner {
  if (isReservedPatientFolder(folder)) return { kind: 'reserved' };
  const f = folder.toLowerCase();
  for (const s of sessions) {
    const own = sessionFolderName(s.tp_description, s.tp_date_time);
    if (own && own.toLowerCase() === f) {
      return { kind: 'session', tpCode: String(s.tp_code), name: s.tp_description, date: s.tp_date_time };
    }
  }
  return null;
}
