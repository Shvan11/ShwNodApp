// services/imaging/index.ts
import path from 'path';
import fs from 'fs';
import { exec, ChildProcess } from 'child_process';
import config from '../../config/config.js';
import { QRCodetoFile } from './qrcode.js';
import { imageSizeFromFile } from 'image-size/fromFile';
import { createPathResolver } from '../../utils/path-resolver.js';
import { log } from '../../utils/logger.js';

// ===========================================
// TYPES
// ===========================================

/**
 * Image dimension result
 */
export interface ImageDimension {
  name: string;
  width: number;
  height: number;
}

/**
 * Path resolver function type
 */
type PathResolver = (relativePath: string) => string;

// ===========================================
// IMAGING FUNCTIONS
// ===========================================

/**
 * Get image sizes (async version using image-size v2 API)
 * @param pid - Patient ID
 * @param tp - Time point
 * @returns Promise resolving to array of image dimensions
 */
async function getImageSizes(pid: string, tp: string): Promise<(ImageDimension | null)[]> {
  const imegs = [
    pid + '0' + tp + '.i10',
    pid + '0' + tp + '.i12',
    pid + '0' + tp + '.i13',
    pid + '0' + tp + '.i23',
    'logo.png',
    pid + '0' + tp + '.i24',
    pid + '0' + tp + '.i20',
    pid + '0' + tp + '.i22',
    pid + '0' + tp + '.i21',
  ];

  const pathResolver: PathResolver = createPathResolver(config.fileSystem.machinePath || '');

  // Use Promise.all to read all images concurrently (non-blocking)
  const results = await Promise.all(
    imegs.map(async (fileName): Promise<ImageDimension | null> => {
      try {
        const filePath = pathResolver(`working/${fileName}`);

        // imageSizeFromFile is truly async and non-blocking
        const dimensions = await imageSizeFromFile(filePath);

        return {
          name: fileName,
          width: dimensions.width || 0,
          height: dimensions.height || 0,
        };
      } catch (err) {
        // Return null for missing or invalid images
        return null;
      }
    })
  );

  return results;
}

/**
 * Generate a QR code for a patient
 * @param pid - Patient ID
 * @returns Promise that resolves when QR code is generated
 */
async function generateQRCode(pid: string): Promise<void> {
  return QRCodetoFile(pid);
}

/**
 * Process X-ray image
 * @param pid - Patient ID
 * @param file - File name
 * @param detailsDir - Details directory
 * @returns Path to the processed image
 */
async function processXrayImage(pid: string, file: string, detailsDir: string): Promise<string> {
  const pathResolver: PathResolver = createPathResolver(config.fileSystem.machinePath || '');
  const source = pathResolver(`clinic1/${pid}/OPG/${file}`);
  const dir = pathResolver(`clinic1/${pid}/OPGIMG`);
  const destination = pathResolver(`clinic1/${pid}/OPGIMG/${path.parse(file).name}.png`);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(destination)) {
    return destination;
  }

  // Check if cs_export tool is available
  if (!config.cs_export) {
    log.warn('X-ray processing tool (cs_export) not configured. Skipping conversion', { file });
    // Return the original file path or a placeholder
    if (fs.existsSync(source)) {
      return source;
    } else {
      throw new Error(`X-ray processing tool not available and source file not found: ${source}`);
    }
  }

  const command = constructCommand(source, destination, pid, detailsDir);

  return new Promise((resolve, reject) => {
    const cmd: ChildProcess = exec(command);

    cmd.stdout?.on('data', (data: string) => log.debug('X-ray processing stdout', { data }));
    cmd.stderr?.on('data', (data: string) => log.debug('X-ray processing stderr', { data }));

    cmd.on('exit', (code: number | null) => {
      if (code === 0) {
        log.info('X-ray processed successfully', { destination });
        resolve(destination);
      } else {
        log.error('X-ray processing failed', { exitCode: code, file, command });

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

    cmd.on('error', (error: Error) => {
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
 * Construct command for X-ray processing
 * @param source - Source file path
 * @param destination - Destination file path
 * @param pid - Patient ID
 * @param detailsDir - Details directory
 * @returns Command to execute
 */
function constructCommand(
  source: string,
  destination: string,
  pid: string,
  detailsDir: string
): string {
  const pathResolver: PathResolver = createPathResolver(config.fileSystem.machinePath || '');
  const pszip = pathResolver(`clinic1/${pid}/OPG/.csi_data/.version_4.4/${detailsDir}/ps.zip`);

  if (detailsDir && detailsDir !== 'undefined' && fs.existsSync(pszip)) {
    return `${config.cs_export} ${source} -o ${destination} -i ${pszip} -p`;
  }

  return `${config.cs_export} ${source} -o ${destination}`;
}

export { getImageSizes, generateQRCode, processXrayImage };
