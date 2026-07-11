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

/**
 * Active database driver. `mssql` = legacy SQL Server (default during migration);
 * `pg` = PostgreSQL (migration target). Selected by the DB_DRIVER env var.
 */
export type DbDriver = 'mssql' | 'pg';

/**
 * PostgreSQL connection configuration (node-postgres pool).
 */
export interface PgDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
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
  apiId?: number;
  apiHash?: string;
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
 * 3Shape Unite Web Service integration configuration.
 *
 * OAuth 2.0 (PKCE, public client — no secret) against `identity.3shape.com`; the
 * `/v3` REST API is served by the Unite Web Service on the workstation Host Device
 * (`webServiceBase`, e.g. `https://WORK_PC:5492`). Blank `clientId`/`webServiceBase`
 * disables the integration (status reports "not configured").
 */
export interface ThreeShapeConfig {
  /** OAuth public client id (blank disables the integration). */
  clientId?: string;
  /** OIDC issuer/authority. Defaults to https://identity.3shape.com. */
  authority: string;
  /** Space-separated OAuth scopes. */
  scopes: string;
  /** Registered redirect URI for the auth-code callback. */
  redirectUri: string;
  /** Workstation Web Service base URL, e.g. https://WORK_PC:5492 (blank disables API calls). */
  webServiceBase?: string;
  /** Shared secret 3Shape presents on webhook callbacks (blank disables the webhook). */
  webhookSecret?: string;
  /** Webhook callback URL; defaults to the redirect URI's origin + the webhook path. */
  webhookUrl?: string;
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

/**
 * LocalSend LAN file-sharing configuration
 */
export interface LocalSendConfig {
  enabled: boolean;
  port: number;
  alias: string;
  multicast: string;
}

/**
 * Cloudflare Zero Trust configuration — syncs aligner_doctors emails into the
 * Access email list gating the external aligner portal. All three blank →
 * sync disabled (see services/cloudflare/doctor-email-list.ts).
 */
export interface CloudflareZeroTrustConfig {
  /** API token with Account → Zero Trust → Edit permission. */
  apiToken?: string;
  /** Cloudflare account ID (the hex segment in dashboard URLs). */
  accountId?: string;
  /** Zero Trust list (type Email) referenced by the Access policy's "Emails in list" rule. */
  doctorEmailListId?: string;
}

// ===========================================
// MAIN CONFIG
// ===========================================

/**
 * Complete application configuration
 */
export interface AppConfig {
  database: DatabaseConfig;
  dbDriver: DbDriver;
  databasePg: PgDatabaseConfig;
  telegram: TelegramConfig;
  twilio: TwilioConfig;
  google: GoogleConfig;
  googleDrive: GoogleDriveConfig;
  fileSystem: FileSystemConfig;
  server: ServerConfig;
  urls: UrlConfig;
  webceph: WebCephConfig;
  threeshape: ThreeShapeConfig;
  localsend: LocalSendConfig;
  cloudflare: CloudflareZeroTrustConfig;
  /** Path to the `pg_dump` binary for the database-backup download (defaults to 'pg_dump' on PATH). */
  pgDumpPath: string;
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
  DB_DRIVER?: 'mssql' | 'pg';
  PG_HOST?: string;
  PG_PORT?: string;
  PG_DATABASE?: string;
  PG_USER?: string;
  PG_PASSWORD?: string;
  DATABASE_URL?: string;
  PORT?: string;
  NODE_ENV?: Environment;
  MACHINE_PATH?: string;
  TELEGRAM_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_API_ID?: string;
  TELEGRAM_API_HASH?: string;
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
  THREESHAPE_CLIENT_ID?: string;
  THREESHAPE_AUTHORITY?: string;
  THREESHAPE_SCOPES?: string;
  THREESHAPE_REDIRECT_URI?: string;
  THREESHAPE_WEBSERVICE_BASE?: string;
  THREESHAPE_WEBHOOK_SECRET?: string;
  THREESHAPE_WEBHOOK_URL?: string;
  CS_EXPORT?: string;
  GRAM_SESSION?: string;
  FAILOVER_SYNC_ENABLED?: string;
  SUPABASE_FAILOVER_DB_URL?: string;
}

/**
 * All environment variables
 */
export type EnvVars = RequiredEnvVars & OptionalEnvVars;
