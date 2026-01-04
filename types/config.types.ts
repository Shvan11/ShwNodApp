/**
 * Configuration Types
 * Type definitions for application configuration
 */

// ===========================================
// DATABASE CONFIG
// ===========================================

/**
 * Database authentication options
 */
export interface DatabaseAuthOptions {
  userName: string;
  password: string;
}

/**
 * Database authentication configuration
 */
export interface DatabaseAuth {
  type: 'default' | 'ntlm' | 'azure-active-directory-password';
  options: DatabaseAuthOptions;
}

/**
 * Database connection options
 */
export interface DatabaseOptions {
  instanceName?: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  rowCollectionOnRequestCompletion: boolean;
  requestTimeout: number;
  connectionTimeout: number;
  useUTC: boolean;
  port?: number;
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  server: string;
  database: string;
  options: DatabaseOptions;
  authentication: DatabaseAuth;
}

// ===========================================
// SERVICE CONFIGS
// ===========================================

/**
 * Telegram configuration
 */
export interface TelegramConfig {
  token?: string;
  chatId?: string;
}

/**
 * Twilio SMS configuration
 */
export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  fromName?: string;
}

/**
 * Google OAuth configuration
 */
export interface GoogleConfig {
  clientId?: string;
  clientSecret?: string;
}

/**
 * Google Drive configuration
 */
export interface GoogleDriveConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  refreshToken?: string;
  folderId?: string;
}

/**
 * WebCeph integration configuration
 */
export interface WebCephConfig {
  partnerApiKey?: string;
  userEmail?: string;
  userApiPassword?: string;
  baseUrl: string;
}

/**
 * File system configuration
 */
export interface FileSystemConfig {
  machinePath?: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number | string;
}

/**
 * URL configuration
 */
export interface UrlConfig {
  qrHost?: string;
  publicUrl?: string;
}

// ===========================================
// MAIN CONFIG
// ===========================================

/**
 * Complete application configuration
 */
export interface AppConfig {
  database: DatabaseConfig;
  telegram: TelegramConfig;
  twilio: TwilioConfig;
  google: GoogleConfig;
  googleDrive: GoogleDriveConfig;
  fileSystem: FileSystemConfig;
  server: ServerConfig;
  urls: UrlConfig;
  webceph: WebCephConfig;
  cs_export?: string;
  gram_session?: string;
}

// ===========================================
// ENVIRONMENT
// ===========================================

/**
 * Environment type
 */
export type Environment = 'development' | 'production' | 'test';

/**
 * Required environment variables
 */
export interface RequiredEnvVars {
  DB_SERVER: string;
  DB_INSTANCE: string;
  DB_USER: string;
  DB_PASSWORD: string;
}

/**
 * Optional environment variables
 */
export interface OptionalEnvVars {
  DB_DATABASE?: string;
  PORT?: string;
  NODE_ENV?: Environment;
  MACHINE_PATH?: string;
  TELEGRAM_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NAME?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REDIRECT_URI?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
  QR_HOST_URL?: string;
  PUBLIC_URL?: string;
  WEBCEPH_PARTNER_API_KEY?: string;
  WEBCEPH_USER_EMAIL?: string;
  WEBCEPH_USER_API_PASSWORD?: string;
  WEBCEPH_API_BASE_URL?: string;
  CS_EXPORT?: string;
  GRAM_SESSION?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  REVERSE_SYNC_ENABLED?: string;
  REVERSE_SYNC_INTERVAL_MINUTES?: string;
}

/**
 * All environment variables
 */
export type EnvVars = RequiredEnvVars & OptionalEnvVars;
