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
 * Absolute path of a single file inside the working dir, addressed by its bare
 * Dolphin name (`{personId}0{tpCode}.{view}`, or the shared `logo.png`). Callers
 * MUST validate `name` first — it must never contain a path separator (each one
 * already does via a strict regex or a fixed server-built name).
 */
export function workingFilePath(name: string): string {
  return clinicPath(`working/${name}`);
}
