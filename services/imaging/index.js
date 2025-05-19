// services/imaging/index.js
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import config from '../../config/config.js';
import { QRCodetoFile } from './qrcode.js';
import sizeOf from "image-size";

/**
 * Get image sizes
 * @param {string} pid - Patient ID
 * @param {string} tp - Time point
 * @returns {Array} Array of image dimensions
 */
function getImageSizes(pid, tp) {
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

    const machinePath = config.fileSystem.machinePath;
    const imegsdims = [];


    for (let i = 0; i < imegs.length; i++) {
        try {
            const filePath = `\\\\${machinePath}\\working\\${imegs[i]}`;
            const dimensions = sizeOf(filePath); // Get image dimensions
            
            // Implement logic to get dimensions (you might need a library like image-size)
            imegsdims[i] = {
                name: imegs[i],
                width : dimensions.width,
                height: dimensions.height,
            };
        } catch (err) {
            imegsdims[i] = null;
        }
    }

    return imegsdims;
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
    const machinePath = config.fileSystem.machinePath;
    const source = `\\\\${machinePath}\\clinic1\\${pid}\\OPG\\${file}`;
    const dir = `\\\\${machinePath}\\clinic1\\${pid}\\OPGIMG`;
    const destination = `${dir}\\${path.parse(file).name}.png`;

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    if (fs.existsSync(destination)) {
        return destination;
    }

    const command = constructCommand(source, destination, pid, detailsDir);
    
    return new Promise((resolve, reject) => {
        const cmd = exec(command);
        
        cmd.stdout.on("data", (data) => console.log("stdout: " + data));
        cmd.stderr.on("data", (data) => console.log("stderr: " + data));
        
        cmd.on("exit", (code) => {
            if (code === 0) {
                resolve(destination);
            } else {
                reject(new Error(`Command exited with code ${code}`));
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
    const machinePath = config.fileSystem.machinePath;
    const pszip = `\\\\${machinePath}\\clinic1\\${pid}\\OPG\\.csi_data\\.version_4.4\\${detailsDir}\\ps.zip`;
    
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