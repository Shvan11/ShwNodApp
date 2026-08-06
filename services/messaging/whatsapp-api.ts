// services/messaging/whatsapp-api.ts
import whatsapp from 'whatsapp-web.js';
import fs from 'fs';
import waInstance, { type WhatsAppClient } from './whatsapp.js';
import { getPhoneCompatibleFilename } from '../../utils/filename-converter.js';
import { log } from '../../utils/logger.js';

const { MessageMedia } = whatsapp;

/**
 * Files WhatsApp should receive as a photo. Covers ordinary image extensions plus
 * the clinic's Dolphin naming convention (`.i10`, `.i22`, …), which are JPEGs
 * behind a non-standard extension — hence the rename + explicit mimetype below.
 * Anything else keeps its real name and detected type so it arrives intact.
 */
const PHOTO_EXT_RE = /\.(i\d{2}|jpe?g|png|webp|gif|bmp)$/i;

// ===========================================
// TYPES
// ===========================================

/**
 * Result of sending an image
 */
type SendImageResult = 'OK' | 'ERROR';

/**
 * Result of sending an X-ray file
 */
interface SendXrayResult {
  result: 'OK' | 'ERROR';
  error?: string;
}

// ===========================================
// FUNCTIONS
// ===========================================

/**
 * Send an image to a WhatsApp number (base64)
 */
export async function sendImg_(number: string, base64Image: string): Promise<SendImageResult> {
  try {
    const media = new MessageMedia('image/png', base64Image);

    return await waInstance.queueOperation(async (client: WhatsAppClient) => {
      // Remove + prefix if present for WhatsApp number validation
      const cleanNumber = number.startsWith('+') ? number.substring(1) : number;
      let targetNumber = cleanNumber;
      if (!targetNumber.includes('@c.us')) {
        try {
          const numberDetails = await client.getNumberId(targetNumber);
          if (!numberDetails) {
            log.warn('sendImg_: getNumberId returned null', { number: targetNumber });
            return 'ERROR';
          }
          targetNumber = numberDetails._serialized;
        } catch (lookupError) {
          log.error('sendImg_: getNumberId threw', {
            number: targetNumber,
            error: lookupError instanceof Error ? lookupError.message : String(lookupError),
            stack: lookupError instanceof Error ? lookupError.stack : undefined,
            raw: lookupError,
          });
          throw lookupError;
        }
      }

      await client.sendMessage(targetNumber, media);
      return 'OK';
    }, 'sendImg');
  } catch (error) {
    log.error('Error in sendImg_:', {
      number,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      raw: error,
    });
    throw error;
  }
}

/**
 * Send an X-ray file to a WhatsApp number
 */
export async function sendXray_(number: string, file: string): Promise<SendXrayResult> {
  try {
    // Validate file path
    if (!file || typeof file !== 'string') {
      return { result: 'ERROR', error: 'Invalid file path' };
    }

    // Check if file exists
    if (!fs.existsSync(file)) {
      log.error(`File not found: ${file}`);
      return { result: 'ERROR', error: `File not found: ${file}` };
    }

    // Check if file is readable
    try {
      fs.accessSync(file, fs.constants.R_OK);
    } catch (accessError) {
      log.error(`File not readable: ${file}`, { error: accessError instanceof Error ? accessError.message : String(accessError) });
      return { result: 'ERROR', error: `File not readable: ${file}` };
    }

    return waInstance.queueOperation(async (client: WhatsAppClient) => {
      // Create media with custom filename for phone compatibility
      const media = MessageMedia.fromFilePath(file);

      const originalFilename = file.split(/[/\\]/).pop() || ''; // Get filename from path

      // Only photos get renamed to .jpg and stamped image/jpeg (critical for
      // WhatsApp to display them inline). Anything else keeps the name and type
      // MessageMedia detected — forcing jpeg on, say, a PDF delivered a file the
      // recipient couldn't open.
      if (PHOTO_EXT_RE.test(originalFilename)) {
        media.filename = getPhoneCompatibleFilename(originalFilename);
        media.mimetype = 'image/jpeg';
      }

      log.info(
        `Sending file: ${originalFilename} as ${media.filename} with MIME type: ${media.mimetype}`
      );

      // Remove + prefix if present for WhatsApp number validation
      const cleanNumber = number.startsWith('+') ? number.substring(1) : number;
      let targetNumber = cleanNumber;
      if (!targetNumber.includes('@c.us')) {
        const numberDetails = await client.getNumberId(targetNumber);
        if (!numberDetails) {
          return { result: 'ERROR' as const, error: 'Mobile number not registered' };
        }
        targetNumber = numberDetails._serialized;
      }

      await client.sendMessage(targetNumber, media);
      return { result: 'OK' as const };
    });
  } catch (error) {
    log.error('Error in sendXray_:', { error: error instanceof Error ? error.message : String(error) });
    return { result: 'ERROR', error: error instanceof Error ? error.message : String(error) };
  }
}
