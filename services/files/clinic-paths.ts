/**
 * Single source of truth for the patient-data volume root and the well-known
 * directories under it.
 *
 * Everything the server reads/writes for a patient lives under `clinic1/`
 * (relative to MACHINE_PATH → e.g. `C:\clinic1`): the per-patient folders
 * `clinic1/{personId}/` (timepoints, OPG x-rays, assets, …), the flat Dolphin
 * "working" gallery `clinic1/working/`, and the infra dirs `clinic1/.trash` /
 * `clinic1/.uploads`. The `clinic1` parent is named ONCE here so moving the
 * volume — or any folder under it — is a one-line change, never a codebase-wide
 * grep (the working gallery used to sit at `working/` on the share root before
 * it moved under this common parent).
 */
import path from 'path';

import config from '../../config/config.js';
import { createPathResolver } from '../../utils/path-resolver.js';

// MACHINE_PATH is validated at boot (config/config.ts throws if missing), so the
// base path is always present here — no need to re-guard at each call site.
const pathResolver = createPathResolver(config.fileSystem.machinePath || '');

/** The patient-data volume root, relative to MACHINE_PATH. Change this to move it. */
const CLINIC_ROOT_REL = 'clinic1';

/** Absolute path of the clinic volume root (`clinic1/`). */
export function clinicRoot(): string {
  return pathResolver(CLINIC_ROOT_REL);
}

/** Absolute path of `rel` joined under the clinic root (`clinic1/${rel}`). */
export function clinicPath(rel: string): string {
  return pathResolver(`${CLINIC_ROOT_REL}/${rel}`);
}

/** Absolute path of a patient's folder (`clinic1/{personId}`). */
export function patientDir(personId: string | number): string {
  return clinicPath(String(personId));
}

/** Absolute path of `rel` under a patient's folder (`clinic1/{personId}/${rel}`). */
export function patientPath(personId: string | number, rel: string): string {
  return clinicPath(`${personId}/${rel}`);
}

// ── The flat Dolphin "working" gallery (`clinic1/working`) ────────────────────
// Shared, patient-agnostic folder of rendered `.iNN` view images named
// `{personId}0{tpCode}.{view}` (e.g. `688201.i12`), served as `/DolImgs/<name>`.

/** Absolute path of the working directory (readdir / static mount / containment root). */
export function workingDir(): string {
  return clinicPath('working');
}

/**
 * The canonical working-file name for one (patient, timepoint, view) — the ONE
 * place the `{personId}0{tpCode}.{view}` convention is spelled out. `view` is a
 * full code from `shared/photo-views.ts#VIEW_CODES` (e.g. `i12`).
 *
 * Always build names with this and match them EXACTLY; never pattern-match a
 * `{personId}0…` prefix. Decimal ids prefix each other, so a prefix match is
 * ambiguous and crosses patients: patient 5's `^50\d+` also matches patient 50's
 * `5001.i12` and patient 5012's `501201.i12`. Only the patient's real set of
 * `time_points.tp_code` values disambiguates, which is why both the read path
 * (working-files.service.ts) and the delete path (photo-cleanup.service.ts) take
 * tpCodes and enumerate exact names.
 */
export function workingFileName(
  personId: string | number,
  tpCode: string | number,
  view: string
): string {
  return `${personId}0${tpCode}.${view}`;
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
  const legacyUpper = `${personId}0${tpCode}.${view.toUpperCase()}`;
  return canonical === legacyUpper ? [canonical] : [canonical, legacyUpper];
}

/**
 * Absolute path of a single file inside the working dir, addressed by its bare
 * Dolphin name (`{personId}0{tpCode}.{view}`, or the shared `logo.png`). Callers
 * MUST validate `name` first — it must never contain a path separator (each one
 * already does via a strict regex or a fixed server-built name).
 */
export function workingFilePath(name: string): string {
  return clinicPath(`working/${name}`);
}

/**
 * Containment guard for a caller-supplied absolute path: `true` only when `abs`
 * resolves inside the clinic volume (`clinic1/`).
 *
 * Needed by the few endpoints that accept a whole path from the client rather
 * than a name/id they resolve themselves (`POST /api/wa/sendmedia2`). Comparison
 * is separator- and case-insensitive because production is Windows (NTFS is
 * case-insensitive and the same path arrives with either slash) while dev is
 * WSL — a byte-comparison would reject legitimate paths on one and, worse,
 * accept escapes on the other.
 */
export function isUnderClinicRoot(abs: string): boolean {
  // Unify separators, collapse `..`/`.` segments, then compare case-insensitively.
  // Normalizing BEFORE the prefix test is the whole guard: without it
  // `C:\\clinic1\\..\\ShwNodApp\\.env` starts with the root string and passes.
  const norm = (p: string) =>
    path.posix.normalize(p.replace(/\\/g, '/')).replace(/\/+$/, '').toLowerCase();
  const root = norm(clinicRoot());
  const target = norm(abs);
  return target === root || target.startsWith(`${root}/`);
}

/**
 * Convert a `VideosPath`-style DB path to one this process can open.
 *
 * `VideosPath` stores a LOCAL Windows path (`C:\clinic1\ovideos\…`) because
 * videos stream *through* the server rather than being opened client-side, but
 * older rows can still carry the LAN UNC spelling (`\\CLINIC\Clinic1\…`). On the
 * WSL dev box both have to become `/mnt/c/clinic1/…`; on Windows the path is
 * already correct and is returned untouched.
 *
 * Lives here, not in either video router: it was copy-pasted verbatim between
 * `routes/api/video.routes.ts` and `routes/public/video.routes.ts`, whose own
 * comment pointed at the other copy instead of sharing it.
 */
export function normalizeVideoDbPath(dbPath: string): string {
  // Windows (production) needs no conversion at all.
  if (process.platform !== 'linux') return dbPath;

  let normalized = dbPath;
  if (normalized.startsWith('\\\\CLINIC\\Clinic1')) {
    normalized = normalized.replace('\\\\CLINIC\\Clinic1', '/mnt/c/clinic1');
  } else if (/^[A-Za-z]:\\/.test(normalized)) {
    const driveLetter = normalized.charAt(0).toLowerCase();
    normalized = normalized.replace(/^[A-Za-z]:\\/, `/mnt/${driveLetter}/`);
  }
  return normalized.replace(/\\/g, '/');
}
