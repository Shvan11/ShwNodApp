// services/imaging/index.js
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import config from '../../config/config.js';
import { QRCodetoFile } from './qrcode.js';
import { imageSizeFromFile } from "image-size/fromFile";
import { createPathResolver } from '../../utils/path-resolver.js';

/**
 * Get image sizes (async version using image-size v2 API)
 * @param {string} pid - Patient ID
 * @param {string} tp - Time point
 * @returns {Promise<Array>} Promise resolving to array of image dimensions
 */
async function getImageSizes(pid, tp) {
    const imegs = [
        pid + "0" + tp + ".i10",
        pid + "0" + tp + ".i12",
        pid + "0" + tp + ".i13",
        pid + "0" + tp + ".i23",
        "logo.png",
        pid + "0" + tp + ".i24",
        pid + "0" + tp + ".i20",
        pid + "0" + tp + ".i22",
        pid + "0" + tp + ".i21",
    ];

    const pathResolver = createPathResolver(config.fileSystem.machinePath);

    // Use Promise.all to read all images concurrently (non-blocking)
    const results = await Promise.all(
        imegs.map(async (fileName) => {
            try {
                const filePath = pathResolver(`working/${fileName}`);

                // imageSizeFromFile is truly async and non-blocking
                const dimensions = await imageSizeFromFile(filePath);

                return {
                    name: fileName,
                    width: dimensions.width,
                    height: dimensions.height,
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
 * @param {string} pid - Patient ID
 * @returns {Promise<void>}
 */
async function generateQRCode(pid) {
    return QRCodetoFile(pid);
}

/**
 * Process X-ray image
 * @param {string} pid - Patient ID
 * @param {string} file - File name
 * @param {string} detailsDir - Details directory
 * @returns {Promise<string>} - Path to the processed image
 */
async function processXrayImage(pid, file, detailsDir) {
    const pathResolver = createPathResolver(config.fileSystem.machinePath);
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
        console.warn(`⚠️  X-ray processing tool (cs_export) not configured. Skipping conversion for ${file}`);
        // Return the original file path or a placeholder
        if (fs.existsSync(source)) {
            return source;
        } else {
            throw new Error(`X-ray processing tool not available and source file not found: ${source}`);
        }
    }

    const command = constructCommand(source, destination, pid, detailsDir);
    
    return new Promise((resolve, reject) => {
        const cmd = exec(command);
        
        cmd.stdout.on("data", (data) => console.log("X-ray processing stdout:", data));
        cmd.stderr.on("data", (data) => console.log("X-ray processing stderr:", data));
        
        cmd.on("exit", (code) => {
            if (code === 0) {
                console.log(`✅ X-ray processed successfully: ${destination}`);
                resolve(destination);
            } else {
                console.error(`❌ X-ray processing failed with exit code ${code} for file: ${file}`);
                console.error(`Command: ${command}`);
                
                // Graceful fallback - return original file if it exists
                if (fs.existsSync(source)) {
                    console.log(`📄 Falling back to original file: ${source}`);
                    resolve(source);
                } else {
                    reject(new Error(`X-ray processing failed (exit code ${code}) and source file not found: ${source}`));
                }
            }
        });

        cmd.on("error", (error) => {
            console.error(`❌ X-ray processing command error:`, error);
            // Graceful fallback - return original file if it exists
            if (fs.existsSync(source)) {
                console.log(`📄 Falling back to original file: ${source}`);
                resolve(source);
            } else {
                reject(new Error(`X-ray processing command failed: ${error.message}`));
            }
        });
    });
}

/**
 * Construct command for X-ray processing
 * @param {string} source - Source file path
 * @param {string} destination - Destination file path
 * @param {string} pid - Patient ID
 * @param {string} detailsDir - Details directory
 * @returns {string} - Command to execute
 */
function constructCommand(source, destination, pid, detailsDir) {
    const pathResolver = createPathResolver(config.fileSystem.machinePath);
    const pszip = pathResolver(`clinic1/${pid}/OPG/.csi_data/.version_4.4/${detailsDir}/ps.zip`);
    
    if (detailsDir && detailsDir !== "undefined" && fs.existsSync(pszip)) {
        return `${config.cs_export} ${source} -o ${destination} -i ${pszip} -p`;
    }
    
    return `${config.cs_export} ${source} -o ${destination}`;
}

export { 
    getImageSizes, 
    generateQRCode, 
    processXrayImage 
};