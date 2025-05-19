/**
 * Main configuration file
 * Loads environment variables and provides configuration for the application
 */
import dotenv from 'dotenv';
dotenv.config();

// Check for required environment variables
const requiredEnvVars = [
  'DB_SERVER', 
  'DB_INSTANCE', 
  'DB_USER', 
  'DB_PASSWORD'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`Warning: Missing environment variable ${envVar}`);
  }
}

export default {
  database: {
    server: process.env.DB_SERVER,
    options: {
      instanceName: process.env.DB_INSTANCE,
      encrypt: false,
      trustServerCertificate: true,
      rowCollectionOnRequestCompletion: true,
    },
    authentication: {
      type: 'default',
      options: {
        userName: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
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
  fileSystem: {
    machinePath: process.env.MACHINE_PATH
  },
  server: {
    port: process.env.PORT || 80
  },
  urls: {
    qrHost: process.env.QR_HOST_URL
  },
  cs_export: process.env.CS_EXPORT,
gram_session: process.env.GRAM_SESSION,
};
