// services/imaging/qrcode.ts
import QRCode from 'qrcode';
import fs from 'fs';

import config from '../../config/config.js';
import { createPathResolver } from '../../utils/path-resolver.js';
import { log } from '../../utils/logger.js';

// ===========================================
// TYPES
// ===========================================

/**
 * QR code result
 */
export interface QRCodeResult {
  qr: string;
}

// ===========================================
// QR CODE FUNCTIONS
// ===========================================

/**
 * Generate a QR code for a patient and save it to a file
 * @param pid - Patient ID
 * @returns Promise that resolves when file is saved
 */
export async function QRCodetoFile(pid: string): Promise<void> {
  const pathResolver = createPathResolver(config.fileSystem.machinePath || '');
  const qrHostUrl = config.urls.qrHost || 'http://192.168.100.2:80';
  const qstring = `${qrHostUrl}/front?code=${pid}`;
  const dir = pathResolver(`clinic1/${pid}`);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    QRCode.toFile(pathResolver(`clinic1/${pid}/qr.png`), qstring, (err) => {
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
 * @param pid - Patient ID
 * @returns Object containing the QR code data URL
 */
export async function GetQRCode(pid: string): Promise<QRCodeResult> {
  const qrHostUrl = config.urls.qrHost || 'http://192.168.100.2:80';
  const qstring = `${qrHostUrl}/front?code=${pid}`;

  try {
    return { qr: await QRCode.toDataURL(qstring) };
  } catch (err) {
    log.error('Failed to generate QR code', { error: (err as Error).message });
    throw err;
  }
}

/**
 * Generate a QR code for sharing a video
 * @param videoId - Video ID
 * @returns Object containing the QR code data URL and the share URL
 */
export async function generateVideoQRCode(videoId: number): Promise<QRCodeResult & { url: string }> {
  const publicUrl = config.urls.publicUrl || 'https://remote.shwan-orthodontics.com';
  const shareUrl = `${publicUrl}/v/${videoId}`;

  try {
    const qr = await QRCode.toDataURL(shareUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
    return { qr, url: shareUrl };
  } catch (err) {
    log.error('Failed to generate video QR code', { error: (err as Error).message, videoId });
    throw err;
  }
}
