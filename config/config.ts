/**
 * Main configuration file
 * Loads environment variables and provides configuration for the application
 */
import dotenv from 'dotenv';
import type { AppConfig } from '../types/config.types.js';
import { log } from '../utils/logger.js';

// Load base .env file first (shared configuration) - silent mode for production
dotenv.config({ path: '.env', debug: false });

// Then load environment-specific overrides
if (process.env.NODE_ENV === 'development') {
  dotenv.config({ path: '.env.development', override: true, debug: false });
}

// Check for required environment variables
const requiredEnvVars: string[] = [
  'DB_SERVER',
  'DB_INSTANCE',
  'DB_USER',
  'DB_PASSWORD'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    log.warn(`Missing environment variable ${envVar}`);
  }
}

// Port configuration - always use 3000
function getDefaultPort(): number {
  return 3000;
}

const config: AppConfig = {
  database: {
    server: process.env.DB_SERVER || '',
    database: process.env.DB_DATABASE || 'ShwanNew',
    options: {
      instanceName: process.env.DB_INSTANCE,
      encrypt: false,
      trustServerCertificate: true,
      rowCollectionOnRequestCompletion: true,
      requestTimeout: 60000,
      connectionTimeout: 30000,
      useUTC: false,
    },
    authentication: {
      type: 'default',
      options: {
        userName: process.env.DB_USER || '',
        password: process.env.DB_PASSWORD || '',
      },
    },
  },
  telegram: {
    token: process.env.TELEGRAM_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromName: process.env.TWILIO_FROM_NAME
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET
  },
  googleDrive: {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/api/admin/google-drive/callback`,
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID
  },
  fileSystem: {
    machinePath: process.env.MACHINE_PATH
  },
  server: {
    port: process.env.PORT || getDefaultPort()
  },
  urls: {
    qrHost: process.env.QR_HOST_URL,
    publicUrl: process.env.PUBLIC_URL || 'https://remote.shwan-orthodontics.com'
  },
  webceph: {
    partnerApiKey: process.env.WEBCEPH_PARTNER_API_KEY,
    userEmail: process.env.WEBCEPH_USER_EMAIL,
    userApiPassword: process.env.WEBCEPH_USER_API_PASSWORD,
    baseUrl: process.env.WEBCEPH_API_BASE_URL || 'https://api.webceph.com'
  },
  cs_export: process.env.CS_EXPORT,
  gram_session: process.env.GRAM_SESSION,
};

export default config;
