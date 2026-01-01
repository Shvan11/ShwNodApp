// services/messaging/telegram.ts
import TelegramBot from 'node-telegram-bot-api';
import { TelegramClient, Api } from 'telegram';
import { CustomFile } from 'telegram/client/uploads.js';
import { StringSession } from 'telegram/sessions/index.js';
import bigInt from 'big-integer';
import fs from 'fs/promises';
import config from '../../config/config.js';
import { getPhoneCompatibleFilename } from '../../utils/filename-converter.js';
import { log } from '../../utils/logger.js';

// ===========================================
// TYPES
// ===========================================

/**
 * Result of sending a file via Telegram
 */
interface SendGramResult {
  result: 'OK' | 'ERROR';
  messageId?: number;
  error?: string;
}

/**
 * Extended TelegramClient with internal connection
 * Uses intersection type instead of extends to avoid type conflicts
 */
type ExtendedTelegramClient = TelegramClient & {
  _connection?: {
    close(): void;
  };
};

// ===========================================
// CONSTANTS
// ===========================================

const TELEGRAM_API_ID = 22110800;
const TELEGRAM_API_HASH = 'c0611e1cf17abb5e98607e38f900641e';

// ===========================================
// FUNCTIONS
// ===========================================

/**
 * Send a document via Telegram bot
 * @param filePath - Path to the file to send
 * @returns Promise resolving to the sent message
 */
export async function sendDocument(filePath: string): Promise<TelegramBot.Message> {
  try {
    const token = config.telegram.token;
    const chatId = config.telegram.chatId;

    if (!token) {
      throw new Error('Telegram token not configured');
    }

    if (!chatId) {
      throw new Error('Telegram chatId not configured');
    }

    const bot = new TelegramBot(token);
    return await bot.sendDocument(chatId, filePath);
  } catch (error) {
    log.error('Error sending document via Telegram bot:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Send a file using Telegram API
 * @param phone - The recipient's phone number
 * @param filepath - Path to the file to send
 * @returns Promise resolving to the result object
 */
export async function sendgramfile(phone: string, filepath: string): Promise<SendGramResult> {
  const gramSession = config.gram_session;

  log.info(`Telegram sendgramfile called - Phone: ${phone}, File: ${filepath}`);

  // Validate inputs
  if (!phone) {
    return { result: 'ERROR', error: 'Phone number is required' };
  }

  if (!filepath) {
    return { result: 'ERROR', error: 'File path is required' };
  }

  if (!gramSession) {
    log.error('Telegram session not configured in environment variables');
    return {
      result: 'ERROR',
      error: 'Telegram session not configured. Please set GRAM_SESSION environment variable.',
    };
  }

  // Validate phone number format
  if (!phone.startsWith('+')) {
    log.error(`Invalid phone number format: ${phone}. Must start with +`);
    return {
      result: 'ERROR',
      error: `Invalid phone number format: ${phone}. Must include country code with +.`,
    };
  }

  let client: ExtendedTelegramClient | undefined;
  try {
    const stringSession = new StringSession(gramSession);
    client = new TelegramClient(stringSession, TELEGRAM_API_ID, TELEGRAM_API_HASH, {
      connectionRetries: 5,
      timeout: 30000, // 30 second timeout
      autoReconnect: false, // Disable auto-reconnect to prevent hanging
      maxConcurrentDownloads: 1,
      requestRetries: 3,
    }) as ExtendedTelegramClient;

    log.info('Connecting to Telegram...');
    await client.connect();
    log.info('Connected to Telegram successfully');
    log.info('Sending to phone:', phone);

    // Validate file path
    if (!filepath || typeof filepath !== 'string') {
      return { result: 'ERROR', error: 'Invalid file path' };
    }

    // Check if file exists and is readable (non-blocking async)
    try {
      await fs.access(filepath);
    } catch (accessError) {
      log.error(`File not found or not readable: ${filepath}`, { error: accessError instanceof Error ? accessError.message : String(accessError) });
      return { result: 'ERROR', error: `File not found or not readable: ${filepath}` };
    }

    // Convert filename to phone-compatible format
    const originalFilename = filepath.split(/[/\\]/).pop() || ''; // Get filename from path
    const convertedFilename = getPhoneCompatibleFilename(originalFilename);

    // Force as photo using CustomFile with .jpg extension and InputMediaUploadedPhoto
    // Non-blocking async stat operation
    const fileStats = await fs.stat(filepath);

    log.info(`=== TELEGRAM PHOTO FORCE ===`);
    log.info(`Original file: ${originalFilename}`);
    log.info(`Converted filename: ${convertedFilename}`);
    log.info(`File size: ${fileStats.size} bytes`);

    // Create CustomFile with .jpg filename to force photo recognition
    const customFile = new CustomFile(convertedFilename, fileStats.size, filepath);

    // Upload file first
    const uploadedFile = await client.uploadFile({
      file: customFile,
      workers: 1,
    });

    // Send as photo using InputMediaUploadedPhoto
    const result = (await client.invoke(
      new Api.messages.SendMedia({
        peer: phone,
        media: new Api.InputMediaUploadedPhoto({
          file: uploadedFile,
        }),
        message: '', // Required message parameter (empty string for no caption)
        // Use big-integer library's bigInt which is what telegram expects
        randomId: bigInt(Math.floor(Math.random() * 1000000000)),
      })
    )) as { id?: number };

    log.info(`File sent successfully: ${filepath}`);
    log.info(`Message ID: ${result?.id}`);

    // Gracefully disconnect with timeout
    try {
      await Promise.race([
        client.disconnect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Disconnect timeout')), 5000)
        ),
      ]);
      log.info('Telegram client disconnected successfully');
    } catch (disconnectError) {
      log.warn('Telegram disconnect timeout (non-critical):', (disconnectError as Error).message);
      // Force close if needed
      if (client._connection) {
        try {
          client._connection.close();
        } catch {
          // Ignore force close errors
        }
      }
    }

    return { result: 'OK', messageId: result?.id };
  } catch (error) {
    log.error('Error sending file via Telegram API:', { error: error instanceof Error ? error.message : String(error) });

    // More specific error handling
    let errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('PHONE_NUMBER_INVALID')) {
      errorMessage = `Invalid phone number: ${phone}. Please check the format.`;
    } else if (errorMessage.includes('FILE_REFERENCE_EXPIRED')) {
      errorMessage = 'File reference expired. Please try again.';
    } else if (errorMessage.includes('NETWORK_ERROR')) {
      errorMessage = 'Network error. Please check internet connection.';
    } else if (errorMessage.includes('AUTH_KEY_UNREGISTERED')) {
      errorMessage = 'Telegram session expired. Please regenerate session.';
    } else if (errorMessage.includes('ENOENT')) {
      errorMessage = `File not found: ${filepath}`;
    }

    // Ensure client is disconnected even on error
    if (client) {
      try {
        await Promise.race([
          client.disconnect(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Disconnect timeout')), 3000)
          ),
        ]);
      } catch (disconnectError) {
        log.warn(
          'Telegram disconnect timeout on error (non-critical):',
          (disconnectError as Error).message
        );
        // Force close if needed
        if (client._connection) {
          try {
            client._connection.close();
          } catch {
            // Ignore force close errors
          }
        }
      }
    }

    return { result: 'ERROR', error: errorMessage };
  }
}
