import whatsapp from "whatsapp-web.js";
const { MessageMedia } = whatsapp;
import fs from 'fs';
import waInstance from './whatsapp.js';
import { getPhoneCompatibleFilename } from '../../utils/filename-converter.js';

/**
 * Send an image to a WhatsApp number (base64)
 */
export async function sendImg_(number, base64Image) {
  try {
    const media = new MessageMedia("image/png", base64Image);

    return waInstance.queueOperation(async (client) => {
      // Remove + prefix if present for WhatsApp number validation
      const cleanNumber = number.startsWith('+') ? number.substring(1) : number;
      let targetNumber = cleanNumber;
      if (!targetNumber.includes('@c.us')) {
        const numberDetails = await client.getNumberId(targetNumber);
        if (!numberDetails) return "ERROR";
        targetNumber = numberDetails._serialized;
      }

      await client.sendMessage(targetNumber, media);
      return "OK";
    });
  } catch (error) {
    console.error("Error in sendImg_:", error);
    return "ERROR";
  }
}

/**
 * Send an X-ray file to a WhatsApp number
 */
export async function sendXray_(number, file) {
  try {
    // Validate file path
    if (!file || typeof file !== 'string') {
      return { result: "ERROR", error: "Invalid file path" };
    }

    // Check if file exists
    if (!fs.existsSync(file)) {
      console.error(`File not found: ${file}`);
      return { result: "ERROR", error: `File not found: ${file}` };
    }

    // Check if file is readable
    try {
      fs.accessSync(file, fs.constants.R_OK);
    } catch (accessError) {
      console.error(`File not readable: ${file}`, accessError);
      return { result: "ERROR", error: `File not readable: ${file}` };
    }

    return waInstance.queueOperation(async (client) => {
      // Create media with custom filename for phone compatibility
      const media = MessageMedia.fromFilePath(file);
      
      // Convert filename to .jpg for phone compatibility
      const originalFilename = file.split(/[/\\]/).pop(); // Get filename from path
      const convertedFilename = getPhoneCompatibleFilename(originalFilename);
      
      // Set the filename that recipients will see
      media.filename = convertedFilename;
      
      // Ensure correct MIME type for images (critical for WhatsApp to display as photo)
      media.mimetype = 'image/jpeg';
      
      console.log(`Sending file: ${originalFilename} as ${convertedFilename} with MIME type: ${media.mimetype}`);

      // Remove + prefix if present for WhatsApp number validation
      const cleanNumber = number.startsWith('+') ? number.substring(1) : number;
      let targetNumber = cleanNumber;
      if (!targetNumber.includes('@c.us')) {
        const numberDetails = await client.getNumberId(targetNumber);
        if (!numberDetails) {
          return { result: "ERROR", error: "Mobile number not registered" };
        }
        targetNumber = numberDetails._serialized;
      }

      await client.sendMessage(targetNumber, media);
      return { result: "OK" };
    });
  } catch (error) {
    console.error("Error in sendXray_:", error);
    return { result: "ERROR", error: error.message };
  }
}
