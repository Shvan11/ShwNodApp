// services/messaging/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import config from '../../config/config.js';


/**
 * Send a document via Telegram bot
 * @param {string} filePath - Path to the file to send
 * @returns {Promise<Object>} - Promise resolving to the sent message
 */
export async function sendDocument(filePath) {
    try {
        const token = config.telegram.token;
        const chatId = config.telegram.chatId;
        
        if (!token) {
            throw new Error('Telegram token not configured');
        }
        
        const bot = new TelegramBot(token);
        return await bot.sendDocument(chatId, filePath);
    } catch (error) {
        console.error('Error sending document via Telegram bot:', error);
        throw error;
    }
}

/**
 * Send a file using Telegram API
 * @param {string} phone - The recipient's phone number
 * @param {string} filepath - Path to the file to send
 * @returns {Promise<Object>} - Promise resolving to the result object
 */
export async function sendgramfile(phone, filepath) {
    const apiId = 22110800;
    const apiHash = "c0611e1cf17abb5e98607e38f900641e";
    const gramSession = config.gram_session;
    
    if (!gramSession) {
        return { "result": "ERROR", "error": "Telegram session not configured" };
    }
    
    const stringSession = new StringSession(gramSession);
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.connect();
    console.log('Sending to phone:', phone);

    try {
        // Send the file with force document option to prevent image compression
        const result = await client.sendFile(phone, {
            file: filepath,
            forceDocument: true,
            progressCallback: (progress) => console.log('Upload progress:', progress),
            workers: 1 // Limit concurrent uploads
        });

        console.log(`File sent successfully: ${filepath}`);
        console.log(`Message ID: ${result?.id}`);

        await client.disconnect();
        return { "result": "OK", "messageId": result?.id };
    } catch (error) {
        console.error('Error sending file via Telegram API:', error);
        await client.disconnect();
        return { "result": "ERROR", "error": error.message };
    }
}