// services/imaging/index.ts
import path from 'path';
import fs from 'fs';
import { execFile, ChildProcess } from 'child_process';
import config from '../../config/config.js';
import { imageSizeFromFile } from 'image-size/fromFile';
import { workingFilePath, patientPath } from '../files/clinic-paths.js';
import { VIEW_CODES, type PhotoViewCode } from '../../shared/photo-views.js';
import { log } from '../../utils/logger.js';

// ===========================================
// TYPES
// ===========================================

/**
 * Image dimension result
 */
export type ImageDimension = {
  name: string;
  width: number;
  height: number;
  /**
   * File modification time (ms, integer) — a content-version token the gallery
   * appends to the image URL as `?v=`. An edited slot is re-rendered to the SAME
   * `working/{pid}0{tp}.iNN` filename, so without a changing URL the browser keeps
   * showing the stale cached image; mtime changes only when the file actually
   * changes, so unchanged slots stay cached (no needless refetch).
   */
  mtime: number;
};

// ===========================================
// IMAGING FUNCTIONS
// ===========================================

/**
 * Probe a time-point's rendered photo views, KEYED BY VIEW CODE (derived from the
 * shared VIEW_CODES SSoT) so no consumer depends on array position. Each value is
 * the view's pixel size + mtime, or `null` when that view hasn't been rendered.
 * The centre logo is a client-only layout concern and is not included.
 * @param pid - Patient ID
 * @param tp - Time point code
 */
async function getImageSizes(
  pid: string,
  tp: string
): Promise<Record<PhotoViewCode, ImageDimension | null>> {
  const probe = async (view: PhotoViewCode): Promise<ImageDimension | null> => {
    const name = `${pid}0${tp}.${view}`;
    try {
      const filePath = workingFilePath(name);
      // imageSizeFromFile is truly async and non-blocking; stat runs alongside it
      // to capture the mtime cache-bust token (see ImageDimension.mtime).
      const [dimensions, stat] = await Promise.all([
        imageSizeFromFile(filePath),
        fs.promises.stat(filePath),
      ]);
      return {
        name,
        width: dimensions.width || 0,
        height: dimensions.height || 0,
        mtime: Math.round(stat.mtimeMs),
      };
    } catch {
      return null; // missing or unreadable slot
    }
  };

  // All views probed concurrently (non-blocking).
  const entries = await Promise.all(
    VIEW_CODES.map(async (view) => [view, await probe(view)] as const)
  );
  return Object.fromEntries(entries) as Record<PhotoViewCode, ImageDimension | null>;
}

/**
 * Process X-ray image
 * @param pid - Patient ID
 * @param file - File name
 * @param detailsDir - Details directory
 * @returns Path to the processed image
 */
async function processXrayImage(pid: string, file: string, detailsDir: string): Promise<string> {
  // Strict allowlists on inputs that flow into filesystem paths AND a child-
  // process invocation. Reject path separators, traversal sequences, and
  // anything that could ever survive into a shell — we use execFile (no shell)
  // below, but defense-in-depth.
  if (!/^\d+$/.test(pid)) {
    throw new Error('Invalid patient ID');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(file)) {
    throw new Error('Invalid X-ray file name');
  }
  if (detailsDir && detailsDir !== 'undefined' && !/^[A-Za-z0-9._-]+$/.test(detailsDir)) {
    throw new Error('Invalid X-ray details directory');
  }

  const source = patientPath(pid, `OPG/${file}`);
  const dir = patientPath(pid, 'OPGIMG');
  const destination = patientPath(pid, `OPGIMG/${path.parse(file).name}.png`);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(destination)) {
    return destination;
  }

  // Check if cs_export tool is available
  const csExport = config.cs_export;
  if (!csExport) {
    log.warn('X-ray processing tool (cs_export) not configured. Skipping conversion', { file });
    // Return the original file path or a placeholder
    if (fs.existsSync(source)) {
      return source;
    } else {
      throw new Error(`X-ray processing tool not available and source file not found: ${source}`);
    }
  }

  const args = constructArgs(source, destination, pid, detailsDir);

  return new Promise((resolve, reject) => {
    const child: ChildProcess = execFile(csExport, args);

    child.stdout?.on('data', (data: string) => log.debug('X-ray processing stdout', { data }));
    child.stderr?.on('data', (data: string) => log.debug('X-ray processing stderr', { data }));

    child.on('exit', (code: number | null) => {
      if (code === 0) {
        log.info('X-ray processed successfully', { destination });
        resolve(destination);
      } else {
        log.error('X-ray processing failed', { exitCode: code, file, args });

        // Graceful fallback - return original file if it exists
        if (fs.existsSync(source)) {
          log.info('Falling back to original file', { source });
          resolve(source);
        } else {
          reject(
            new Error(
              `X-ray processing failed (exit code ${code}) and source file not found: ${source}`
            )
          );
        }
      }
    });

    child.on('error', (error: Error) => {
      log.error('X-ray processing command error', { error: error.message });
      // Graceful fallback - return original file if it exists
      if (fs.existsSync(source)) {
        log.info('Falling back to original file', { source });
        resolve(source);
      } else {
        reject(new Error(`X-ray processing command failed: ${error.message}`));
      }
    });
  });
}

/**
 * Build argv for the cs_export invocation. Each element is passed as a
 * separate argument to execFile, so no shell metacharacters can be injected.
 */
function constructArgs(
  source: string,
  destination: string,
  pid: string,
  detailsDir: string
): string[] {
  const pszip = patientPath(pid, `OPG/.csi_data/.version_4.4/${detailsDir}/ps.zip`);

  if (detailsDir && detailsDir !== 'undefined' && fs.existsSync(pszip)) {
    return [source, '-o', destination, '-i', pszip, '-p'];
  }

  return [source, '-o', destination];
}

export { getImageSizes, processXrayImage };
