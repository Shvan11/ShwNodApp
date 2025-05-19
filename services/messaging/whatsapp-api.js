import whatsapp from "whatsapp-web.js";
const { MessageMedia } = whatsapp;
import fs from 'fs';
import waInstance from './whatsapp.js';

/**
 * Send an image to a WhatsApp number (base64)
 */
export async function sendImg_(number, base64Image) {
  try {
    const media = new MessageMedia("image/png", base64Image);

    return waInstance.queueOperation(async (client) => {
      let targetNumber = number;
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
    if (!fs.existsSync(file)) {
      return { result: "ERROR", error: "File not found" };
    }

    return waInstance.queueOperation(async (client) => {
      const media = MessageMedia.fromFilePath(file);

      let targetNumber = number;
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
