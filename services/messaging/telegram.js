// services/messaging/telegram.js
import TelegramBot from 'node-telegram-bot-api';
import { TelegramClient, Api } from "telegram";
import { CustomFile } from "telegram/client/uploads.js";
import { StringSession } from "telegram/sessions/index.js";
import fs from 'fs';
import config from '../../config/config.js';
import { getPhoneCompatibleFilename } from '../../utils/filename-converter.js';

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
    
    console.log(`Telegram sendgramfile called - Phone: ${phone}, File: ${filepath}`);
    
    // Validate inputs
    if (!phone) {
        return { "result": "ERROR", "error": "Phone number is required" };
    }
    
    if (!filepath) {
        return { "result": "ERROR", "error": "File path is required" };
    }
    
    if (!gramSession) {
        console.error('Telegram session not configured in environment variables');
        return { "result": "ERROR", "error": "Telegram session not configured. Please set GRAM_SESSION environment variable." };
    }
    
    // Validate phone number format
    if (!phone.startsWith('+')) {
        console.error(`Invalid phone number format: ${phone}. Must start with +`);
        return { "result": "ERROR", "error": `Invalid phone number format: ${phone}. Must include country code with +.` };
    }
    
    let client;
    try {
        const stringSession = new StringSession(gramSession);
        client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
            timeout: 30000, // 30 second timeout
            autoReconnect: false, // Disable auto-reconnect to prevent hanging
            receiveUpdates: false, // Disable receiving updates to prevent timeout issues
            maxConcurrentDownloads: 1,
            requestRetries: 3,
        });

        console.log('Connecting to Telegram...');
        await client.connect();
        console.log('Connected to Telegram successfully');
        console.log('Sending to phone:', phone);

        // Validate file path
        if (!filepath || typeof filepath !== 'string') {
            return { result: "ERROR", error: "Invalid file path" };
        }

        // Check if file exists
        if (!fs.existsSync(filepath)) {
            console.error(`File not found: ${filepath}`);
            return { result: "ERROR", error: `File not found: ${filepath}` };
        }

        // Check if file is readable
        try {
            fs.accessSync(filepath, fs.constants.R_OK);
        } catch (accessError) {
            console.error(`File not readable: ${filepath}`, accessError);
            return { result: "ERROR", error: `File not readable: ${filepath}` };
        }

        // Convert filename to phone-compatible format
        const originalFilename = filepath.split(/[/\\]/).pop(); // Get filename from path
        const convertedFilename = getPhoneCompatibleFilename(originalFilename);
        
        // Force as photo using CustomFile with .jpg extension and InputMediaUploadedPhoto
        const fileStats = fs.statSync(filepath);
        
        console.log(`=== TELEGRAM PHOTO FORCE ===`);
        console.log(`Original file: ${originalFilename}`);
        console.log(`Converted filename: ${convertedFilename}`);
        console.log(`File size: ${fileStats.size} bytes`);

        // Create CustomFile with .jpg filename to force photo recognition
        const customFile = new CustomFile(convertedFilename, fileStats.size, filepath);
        
        // Upload file first
        const uploadedFile = await client.uploadFile({
            file: customFile,
            workers: 1
        });

        // Send as photo using InputMediaUploadedPhoto
        const result = await client.invoke(new Api.messages.SendMedia({
            peer: phone,
            media: new Api.InputMediaUploadedPhoto({
                file: uploadedFile
            }),
            message: "", // Required message parameter (empty string for no caption)
            randomId: Math.floor(Math.random() * 1000000000) // Required random ID
        }));

        console.log(`File sent successfully: ${filepath}`);
        console.log(`Message ID: ${result?.id}`);

        // Gracefully disconnect with timeout
        try {
            await Promise.race([
                client.disconnect(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Disconnect timeout')), 5000)
                )
            ]);
            console.log('Telegram client disconnected successfully');
        } catch (disconnectError) {
            console.warn('Telegram disconnect timeout (non-critical):', disconnectError.message);
            // Force close if needed
            if (client._connection) {
                try {
                    client._connection.close();
                } catch (e) {
                    // Ignore force close errors
                }
            }
        }
        
        return { "result": "OK", "messageId": result?.id };
    } catch (error) {
        console.error('Error sending file via Telegram API:', error);
        
        // More specific error handling
        let errorMessage = error.message;
        if (error.message.includes('PHONE_NUMBER_INVALID')) {
            errorMessage = `Invalid phone number: ${phone}. Please check the format.`;
        } else if (error.message.includes('FILE_REFERENCE_EXPIRED')) {
            errorMessage = 'File reference expired. Please try again.';
        } else if (error.message.includes('NETWORK_ERROR')) {
            errorMessage = 'Network error. Please check internet connection.';
        } else if (error.message.includes('AUTH_KEY_UNREGISTERED')) {
            errorMessage = 'Telegram session expired. Please regenerate session.';
        } else if (error.message.includes('ENOENT')) {
            errorMessage = `File not found: ${filepath}`;
        }
        
        // Ensure client is disconnected even on error
        if (client) {
            try {
                await Promise.race([
                    client.disconnect(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Disconnect timeout')), 3000)
                    )
                ]);
            } catch (disconnectError) {
                console.warn('Telegram disconnect timeout on error (non-critical):', disconnectError.message);
                // Force close if needed
                if (client._connection) {
                    try {
                        client._connection.close();
                    } catch (e) {
                        // Ignore force close errors
                    }
                }
            }
        }
        
        return { "result": "ERROR", "error": errorMessage };
    }
}