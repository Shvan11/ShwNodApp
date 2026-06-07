// services/messaging/telegram.ts
import TelegramBot from 'node-telegram-bot-api';
import { TelegramClient, Api } from 'telegram';
import { CustomFile } from 'telegram/client/uploads.js';
import { StringSession } from 'telegram/sessions/index.js';
import bigInt from 'big-integer';
import fs from 'fs/promises';
import config from '../../config/config.js';
import { getPhoneCompatibleFilename } from '../../utils/filename-converter.js';
import { getOption, upsertOption } from '../database/queries/options-queries.js';
import { log } from '../../utils/logger.js';

// The MTProto user session is runtime-managed (re-authenticated from Settings →
// Integrations) and persisted in the `options` table, so it survives without an
// env change/restart. The `GRAM_SESSION` env var is only a legacy fallback.
const GRAM_SESSION_OPTION = 'gram_session';

/** Current Telegram user session string: DB-persisted value, else env fallback. */
export async function getGramSession(): Promise<string> {
  try {
    const stored = await getOption(GRAM_SESSION_OPTION);
    if (stored) return stored;
  } catch (error) {
    log.warn('Failed to read gram_session option; falling back to env', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return config.gram_session || '';
}

/** Persist a freshly-authenticated Telegram user session. */
export async function setGramSession(session: string): Promise<void> {
  await upsertOption(GRAM_SESSION_OPTION, session);
}

/** Clear the persisted Telegram user session (logout). */
export async function clearGramSession(): Promise<void> {
  await upsertOption(GRAM_SESSION_OPTION, '');
}

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

// Telegram MTProto app credentials (api_id/api_hash from my.telegram.org).
// Sourced from env (config.telegram) so they are not committed to source.

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
 * Fully tear a one-shot client down. `destroy()` sets `_destroyed`, which is what
 * actually stops GramJS's background update loop — `disconnect()` alone leaves it
 * spinning, pinging a dead connection and logging `Error: TIMEOUT` every ~30s
 * forever (one leaked loop per send). See updates.js `_updateLoop` (`while (!_destroyed)`).
 */
async function teardownClient(client: ExtendedTelegramClient): Promise<void> {
  try {
    await Promise.race([
      client.destroy(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Destroy timeout')), 5000)),
    ]);
  } catch (err) {
    log.warn('Telegram client teardown timeout (non-critical):', (err as Error).message);
    // Last-resort force close so a hung socket can't keep the loop alive.
    if (client._connection) {
      try {
        client._connection.close();
      } catch {
        // Ignore force close errors
      }
    }
  }
}

/**
 * Send a file using Telegram API
 * @param phone - The recipient's phone number
 * @param filepath - Path to the file to send
 * @returns Promise resolving to the result object
 */
export async function sendgramfile(phone: string, filepath: string): Promise<SendGramResult> {
  const gramSession = await getGramSession();

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

  const apiId = config.telegram.apiId;
  const apiHash = config.telegram.apiHash;
  if (!apiId || !apiHash) {
    log.error('Telegram API credentials not configured in environment variables');
    return {
      result: 'ERROR',
      error: 'Telegram API credentials not configured. Please set TELEGRAM_API_ID and TELEGRAM_API_HASH.',
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
    client = new TelegramClient(stringSession, apiId, apiHash, {
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

    // destroy() (not disconnect()) so the background update loop actually stops.
    await teardownClient(client);

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

    // Ensure the client is fully torn down even on error (stops the update loop).
    if (client) {
      await teardownClient(client);
    }

    return { result: 'ERROR', error: errorMessage };
  }
}
