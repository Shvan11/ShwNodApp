/**
 * Dolphin's naming rule for the flat working gallery (`clinic1/working`), and the ONE
 * place it is spelled out. Import-free on purpose, so its test runs without the boot
 * config; `clinic-paths.ts` re-exports these next to the folder they name.
 *
 * A rendered view is `{personId}{tpCode as two digits}.{view}`: patient 888's session 2
 * is `88802.i21`, patient 634's session 12 is `63412.i10`. Dolphin Imaging derives the
 * name from the patient and session numbers itself (see the Dolphin sink), so the app
 * must produce exactly what Dolphin would. This used to be written `{personId}0{tpCode}`,
 * which is the same name for sessions 0–9 but not from 10 on: `634012.i10` instead of
 * Dolphin's `63412.I10`. The app then showed sessions 10+ as empty, and the names it
 * wrote for them are, by Dolphin's rule, another patient's (`634012` = patient 6340,
 * session 12).
 *
 * Always build names with these and match them EXACTLY; never pattern-match a
 * `{personId}…` prefix. Decimal ids prefix each other (patient 63's `6304.i10` and
 * patient 630's `63004.i10`), so only the patient's real set of `time_points.tp_code`
 * values disambiguates, which is why both the read path (working-files.service.ts)
 * and the delete path (photo-cleanup.service.ts) take tpCodes and enumerate names.
 */

function stem(personId: string | number, tpCode: string | number): string {
  return `${personId}${String(tpCode).padStart(2, '0')}`;
}

/**
 * The canonical working-file name for one (patient, timepoint, view). `view` is a full
 * code from `shared/photo-views.ts#VIEW_CODES` (e.g. `i12`); the app writes it lowercase.
 */
export function workingFileName(
  personId: string | number,
  tpCode: string | number,
  view: string
): string {
  return `${stem(personId, tpCode)}.${view}`;
}

/**
 * The same name with Dolphin's uppercase extension (`88802.I21`): the form stored in
 * `time_point_images.image_file`, which the Dolphin sink copies into Dolphin's
 * `tpiImageFile`.
 */
export function dolphinImageFileName(
  personId: string | number,
  tpCode: string | number,
  view: string
): string {
  return `${stem(personId, tpCode)}.${view.toUpperCase()}`;
}

/**
 * Every on-disk spelling one (patient, timepoint, view) can have, canonical FIRST.
 *
 * Our renderer always writes the lowercase `.iNN` form, but Dolphin-era files on the
 * share carry an uppercase extension (`.INN`). On the Windows/NTFS production box
 * that distinction is invisible — the two names resolve to the same file — so the
 * lowercase-only paths worked by accident. On a case-SENSITIVE volume (the WSL dev
 * box today, the planned Linux server tomorrow) they are two different files, and a
 * legacy `.INN` becomes both unreadable by the gallery and undeletable.
 *
 * So read paths probe these in order and use whichever exists (returning the REAL
 * name, which the `/DolImgs` URL and the working-file endpoints need), and delete
 * paths remove all of them. Deleting every variant is safe on NTFS too: the second
 * `rm` just no-ops on the already-removed file.
 *
 * NOT for the write path — a renderer that "cleaned up" the other variant after
 * writing would delete its own output on NTFS, where both names are the same file.
 */
export function workingFileNameVariants(
  personId: string | number,
  tpCode: string | number,
  view: string
): string[] {
  const canonical = workingFileName(personId, tpCode, view);
  const legacyUpper = dolphinImageFileName(personId, tpCode, view);
  return canonical === legacyUpper ? [canonical] : [canonical, legacyUpper];
}
