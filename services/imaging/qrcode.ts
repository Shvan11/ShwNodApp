// services/imaging/qrcode.ts
import QRCode from 'qrcode';

import config from '../../config/config.js';
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
