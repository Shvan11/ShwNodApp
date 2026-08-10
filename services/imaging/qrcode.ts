// services/imaging/qrcode.ts
import QRCode from 'qrcode';

import config from '../../config/config.js';
import { log } from '../../utils/logger.js';

/**
 * Generate a QR code for sharing a video
 * @param videoId - Video ID
 * @returns The QR code data URL and the share URL it encodes
 */
export async function generateVideoQRCode(
  videoId: number
): Promise<{ qr: string; url: string }> {
  // config.urls.publicUrl carries its own default — never re-default it here, or the
  // deployment's URL lives in two places (this is a per-clinic install, not one domain).
  const shareUrl = `${config.urls.publicUrl}/v/${videoId}`;

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
