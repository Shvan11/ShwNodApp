/**
 * Configuration Types
 *
 * `AppConfig` is the ONLY export — it is what `config/config.ts` imports, and the
 * `*Config` interfaces below exist to describe its fields. They were all exported
 * once, but nothing outside this file ever imported one by name, and an exported
 * name that nothing consumes is free to drift from the shape actually in force:
 * `DatabaseConfig` here is a different type from the `DatabaseConfig` that
 * `services/settings/EnvironmentManager.ts` declares and the Settings screen
 * really uses. Keep them module-private so that stays impossible.
 *
 * The `Environment` / `RequiredEnvVars` / `OptionalEnvVars` / `EnvVars` block that
 * used to close this file is gone: nothing referenced it, and it still listed the
 * retired SQL Server vars (`DB_SERVER`, `DB_INSTANCE`, …) as REQUIRED, which has
 * not been true since the PostgreSQL migration. `config/config.ts`'s Zod
 * `envSchema` is the real env contract.
 */

// ===========================================
// DATABASE CONFIG
// ===========================================

/**
 * Database authentication options
 */
interface DatabaseAuthOptions {
  userName: string;
  password: string;
}

/**
 * Database authentication configuration
 */
interface DatabaseAuth {
  type: 'default' | 'ntlm' | 'azure-active-directory-password';
  options: DatabaseAuthOptions;
}

/**
 * Database connection options
 */
interface DatabaseOptions {
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
interface DatabaseConfig {
  server: string;
  database: string;
  options: DatabaseOptions;
  authentication: DatabaseAuth;
}

/**
 * PostgreSQL connection configuration (node-postgres pool).
 */
interface PgDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** From `sslmode` (DATABASE_URL query or PG_SSLMODE); absent = plaintext, the local default. */
  ssl?: false | { rejectUnauthorized: boolean };
  /** From `application_name`; surfaces in `pg_stat_activity`. */
  application_name?: string;
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
interface TelegramConfig {
  apiId?: number;
  apiHash?: string;
}

/**
 * Twilio SMS configuration
 */
interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  fromName?: string;
}


/**
 * Google Drive configuration
 */
interface GoogleDriveConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  refreshToken?: string;
  folderId?: string;
}

/**
 * Google Contacts configuration (message-recipient phone book).
 *
 * `redirectUri` is always resolved (env or the PORT-derived default), so it is
 * non-optional. `explicit` records whether contacts-specific credentials were
 * deliberately set — only those may override a pre-existing credentials.json,
 * whose client issued any grants already on disk.
 */
interface GoogleContactsConfig {
  explicit: boolean;
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
}

/**
 * WebCeph integration configuration
 */
interface WebCephConfig {
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
interface ThreeShapeConfig {
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
interface FileSystemConfig {
  machinePath?: string;
}

/**
 * Server configuration
 */
interface ServerConfig {
  port: number;
}

/**
 * URL configuration
 */
interface UrlConfig {
  /** Always set — config.ts supplies the default, so consumers must not re-default it. */
  publicUrl: string;
}

/**
 * LocalSend LAN file-sharing configuration
 */
interface LocalSendConfig {
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
interface CloudflareZeroTrustConfig {
  /** API token with Account → Zero Trust → Edit permission. */
  apiToken?: string;
  /** Cloudflare account ID (the hex segment in dashboard URLs). */
  accountId?: string;
  /** Zero Trust list (type Email) referenced by the Access policy's "Emails in list" rule. */
  doctorEmailListId?: string;
}

/**
 * Cloudflare R2 bucket configuration (for aligner case photos).
 */
interface R2Config {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Always set — config.ts supplies the default, so consumers must not re-default it. */
  bucketName: string;
}

// ===========================================
// MAIN CONFIG
// ===========================================

/**
 * Complete application configuration
 */
export interface AppConfig {
  database: DatabaseConfig;
  databasePg: PgDatabaseConfig;
  telegram: TelegramConfig;
  twilio: TwilioConfig;
  googleDrive: GoogleDriveConfig;
  googleContacts: GoogleContactsConfig;
  fileSystem: FileSystemConfig;
  server: ServerConfig;
  urls: UrlConfig;
  webceph: WebCephConfig;
  threeshape: ThreeShapeConfig;
  localsend: LocalSendConfig;
  cloudflare: CloudflareZeroTrustConfig;
  r2: R2Config;
  /** Path to the `pg_dump` binary for the database-backup download (defaults to 'pg_dump' on PATH). */
  pgDumpPath: string;
  cs_export?: string;
  gram_session?: string;
}
