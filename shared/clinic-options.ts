/**
 * Names of the `options` rows that point at a clinic's own machines — read by the
 * server and by the browser, so the name is written once.
 *
 * Each is this install's configuration, never a literal in the code (CLAUDE.md's
 * identity corollary): an empty or missing row means "not set up here", and the
 * screens that need it say so instead of reaching for another clinic's machine.
 * `npm run db:setup` creates them empty so they show in Settings → General.
 */

/**
 * The share holding the per-set aligner folders, `<root>\<doctor id>\<person id>\<set #>`
 * (e.g. `\\WORK_PC\Aligner_Sets`). Client-facing: the browser opens it with the
 * `explorer:` handler, like `PatientsFolder`, so it stays a UNC path (FE-F17-7).
 */
export const ALIGNER_SETS_FOLDER_OPTION = 'AlignerSetsFolder';

/**
 * The Archform database file the server reads (FE-F18-4). Server-side; empty means
 * the Archform matcher is not offered on this install.
 */
export const ARCHFORM_DB_PATH_OPTION = 'ARCHFORM_DB_PATH';

/** The last segment of a Windows/UNC path (`\\WORK_PC\Aligner_Sets` → `Aligner_Sets`). */
export function lastPathSegment(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}
