// services/imaging/qrcode.js
import QRCode from "qrcode";
import fs from "fs";

import config from '../../config/config.js';

/**
 * Generate a QR code for a patient and save it to a file
 * @param {string} pid - Patient ID
 * @returns {Promise<void>}
 */
export async function QRCodetoFile(pid) {
    const machinePath = config.fileSystem.machinePath;
    const qrHostUrl = config.urls.qrHost || "http://192.168.100.2:80";
    const qstring = `${qrHostUrl}/front?code=${pid}`;
    const dir = `\\\\${machinePath}\\clinic1\\${pid}`;

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    return new Promise((resolve, reject) => {
        QRCode.toFile(`${dir}\\qr.png`, qstring, (err) => {
            if (err) {
                reject(err);
                return;
            }
            
            resolve();
        });
    });
}

/**
 * Generate a QR code as a data URL
 * @param {string} pid - Patient ID
 * @returns {Promise<Object>} - Object containing the QR code data URL
 */
export async function GetQRCode(pid) {
    const qrHostUrl = config.urls.qrHost || "http://192.168.100.2:80";
    const qstring = `${qrHostUrl}/front?code=${pid}`;

    try {
        return { qr: await QRCode.toDataURL(qstring) };
    } catch (err) {
        console.error(err);
        throw err;
    }
}