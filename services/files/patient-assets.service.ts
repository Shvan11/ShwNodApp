/**
 * Patient on-disk asset discovery — the X-ray files under `{patient}/OPG` and the loose
 * files under `{patient}/assets`, plus the CS-Imaging preview/metadata that hangs off
 * each X-ray in `OPG/.csi_data/.version_4.4/`.
 *
 * This is pure filesystem I/O and lives here rather than in `services/database/queries/`:
 * a query module talks to PostgreSQL, and mixing `readdir`/`access`/`createReadStream`
 * into it hid a disk dependency behind what reads like a DB call. `getInfos`
 * (patient-queries.ts) composes this with its row read.
 *
 * Filesystem discipline (CLAUDE.md): the per-X-ray details directory is read ONCE up
 * front instead of re-running `pathExists` + `readdir` inside the per-file loop — bulk
 * per-file stat is what makes this path crawl on WSL `/mnt/c` drvfs and on a
 * network-mounted server.
 */
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as readline from 'node:readline';
import { patientPath } from './clinic-paths.js';
import { log } from '../../utils/logger.js';

/** One X-ray file plus whatever CS-Imaging preview/date metadata we could resolve. */
export interface XrayInfo {
  name: string;
  detailsDirName?: string;
  previewImagePartialPath?: string;
  date?: string | null;
}

// `type`, not `interface`: this flows into a `sendData` payload validated against a
// `z.looseObject` contract, and only a type alias gets the implicit string index
// signature that assignment needs (see CLAUDE.md — TS2345).
export type PatientAssets = {
  xrays: XrayInfo[];
  assets: string[];
};

/** X-ray file extensions CS-Imaging writes, plus its in-progress `TASK_` markers. */
const XRAY_SUFFIXES = ['.dcm', '.pano', '.ceph', '.rvg'];

/** Relative path (under the patient dir) of the CS-Imaging per-image details root. */
const CSI_DETAILS_REL = 'OPG/.csi_data/.version_4.4';

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract the `seriesDate` value from a CS-Imaging `meta` file.
 *
 * The format puts the value two lines after the line ending in `'seriesDate'`.
 * Resolves null when the file has no such key (the `close` handler) — and ALSO on
 * a read error, so one unreadable file degrades to "no date" instead of failing
 * the caller. CS-Imaging writes into this directory while the app reads it (hence
 * the `TASK_` in-progress markers), so a locked or half-written `meta` is normal;
 * rejecting here used to propagate through getXrays → getPatientAssets → getInfos
 * and 500 the entire patient-info request over one unreadable sidecar file.
 */
async function extractDate(metaFile: string): Promise<string | null> {
  return new Promise((resolve) => {
    const fileStream = createReadStream(metaFile);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let dateString: string | null = null;
    let targetLine: number | null = null;
    let lineCount = 0;

    rl.on('line', (line: string) => {
      lineCount++;
      if (targetLine === null && line.endsWith("'seriesDate'")) {
        targetLine = lineCount + 2;
      } else if (lineCount === targetLine) {
        // A malformed line (no quoted value) yields undefined → normalize to null
        // so the resolved type is honest.
        dateString = line.split("'")[1] ?? null;
        rl.close();
        fileStream.close();
        resolve(dateString);
      }
    });

    rl.on('error', (err: Error) => {
      log.warn('[Files] unreadable CS-Imaging meta file; treating as undated', {
        file: metaFile,
        error: err.message,
      });
      rl.close();
      fileStream.close();
      resolve(null);
    });

    rl.on('close', () => {
      if (!dateString) {
        resolve(null);
      }
    });
  });
}

/**
 * List a patient's X-rays, resolving each one's CS-Imaging details dir, preview
 * thumbnail and capture date where present.
 */
async function getXrays(xrayDir: string, pid: number): Promise<XrayInfo[]> {
  const allFiles = await fs.readdir(xrayDir);
  const xrayNames = allFiles.filter(
    (xrayName) => XRAY_SUFFIXES.some((s) => xrayName.endsWith(s)) || xrayName.startsWith('TASK_')
  );

  // The details dir is the same for every xray of this patient, so read it ONCE
  // up front rather than re-running pathExists + readdir inside the per-file map.
  const parentDetailsDirPath = patientPath(pid, CSI_DETAILS_REL);
  const detailsSubDirs = (await pathExists(parentDetailsDirPath))
    ? await fs.readdir(parentDetailsDirPath)
    : [];

  return Promise.all(
    xrayNames.map(async (xrayName) => {
      const xray: XrayInfo = { name: xrayName };

      for (const subDir of detailsSubDirs) {
        if (subDir.endsWith(xrayName)) {
          xray.detailsDirName = subDir;

          const previewPath = patientPath(pid, `${CSI_DETAILS_REL}/${subDir}/t.png`);
          if (await pathExists(previewPath)) {
            xray.previewImagePartialPath = `/${CSI_DETAILS_REL}/${subDir}/t.png`;
          }

          xray.date = await extractDate(patientPath(pid, `${CSI_DETAILS_REL}/${subDir}/meta`));
        }
      }
      return xray;
    })
  );
}

/**
 * Retrieves asset information (X-rays and other assets) for a given patient id.
 * Missing directories are normal (not every patient has imaging) → empty arrays.
 */
export async function getPatientAssets(pid: number): Promise<PatientAssets> {
  const xrayDir = patientPath(pid, 'OPG');
  const assetsDir = patientPath(pid, 'assets');

  const [xrays, assets] = await Promise.all([
    pathExists(xrayDir).then((ok) => (ok ? getXrays(xrayDir, pid) : [])),
    pathExists(assetsDir).then((ok) => (ok ? fs.readdir(assetsDir) : [])),
  ]);

  return { xrays, assets };
}
