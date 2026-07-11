/**
 * Main configuration file
 * Loads environment variables and provides configuration for the application
 */
import dotenv from 'dotenv';
import { z } from 'zod';
import type { AppConfig } from '../types/config.types.js';
import { log } from '../utils/logger.js';

// Load base .env file first (shared configuration) - silent mode for production
dotenv.config({ path: '.env', debug: false });

// Then load environment-specific overrides
if (process.env.NODE_ENV === 'development') {
  dotenv.config({ path: '.env.development', override: true, debug: false });
}

// ---------------------------------------------------------------------------
// Boot environment validation (fail fast)
//
// Validates only the vars genuinely required to boot (per CLAUDE.md): the PG
// connection (DATABASE_URL *or* the discrete PG_* block), SESSION_SECRET, and
// MACHINE_PATH (the patient-data share). A missing/invalid one throws here at
// import time with a clear message, instead of a silent warning followed by a
// confusing downstream crash.
//
// Legacy DB_* (SQL Server — migration tooling + Dolphin sink only) and every
// optional service block (Telegram/Twilio/Google/WebCeph/Gemini/Supabase) stay
// out of this schema so they remain blank-able.
// ---------------------------------------------------------------------------
const envSchema = z
  .object({
    MACHINE_PATH: z.string().min(1, 'MACHINE_PATH is required (patient-data share path)'),
    SESSION_SECRET: z.string().min(1, 'SESSION_SECRET is required'),
    PORT: z.coerce.number().int().positive().optional(),
    DATABASE_URL: z.string().optional(),
    PG_HOST: z.string().optional(),
    PG_PORT: z.coerce.number().int().positive().optional(),
    PG_DATABASE: z.string().optional(),
    PG_USER: z.string().optional(),
    PG_PASSWORD: z.string().optional(),
    PG_DUMP_PATH: z.string().optional(),
    // Optional block, but a malformed port must fail loud: parseInt garbage → NaN
    // → dgram binds an ephemeral port and discovery silently finds nothing.
    LOCALSEND_PORT: z.preprocess(
      (v) => (v === '' || v == null ? undefined : v),
      z.coerce.number().int().min(1).max(65535).optional()
    ),
  })
  .refine(
    (env) => !!env.DATABASE_URL || !!(env.PG_HOST && env.PG_DATABASE && env.PG_USER),
    {
      message:
        'PostgreSQL connection is required: set DATABASE_URL or the full PG_HOST/PG_DATABASE/PG_USER/PG_PASSWORD block.',
    }
  );

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  const detail = envResult.error.issues
    .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n');
  log.error(`Invalid environment configuration:\n${detail}`);
  throw new Error('Invalid environment configuration — see logs above. Fix .env before starting.');
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
  // PostgreSQL is the only runtime driver as of migration Phase 9. The flag is kept
  // (defaulting to 'pg') for config-shape continuity; the mssql code path is gone, so
  // setting DB_DRIVER=mssql no longer changes runtime behavior.
  dbDriver: (process.env.DB_DRIVER as 'mssql' | 'pg') || 'pg',
  databasePg: {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    database: process.env.PG_DATABASE || 'shwan_test',
    user: process.env.PG_USER || 'shwan_app',
    password: process.env.PG_PASSWORD || '',
    max: 10,
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
  },
  // Path to the `pg_dump` binary used by the database-backup download. Defaults to
  // resolving `pg_dump` on PATH (correct on Linux/WSL); Windows prod should set
  // PG_DUMP_PATH to the install bin, e.g. C:\Program Files\PostgreSQL\18\bin\pg_dump.exe.
  // NOTE: pg_dump's version must be >= the server's PostgreSQL major version.
  pgDumpPath: process.env.PG_DUMP_PATH || 'pg_dump',
  telegram: {
    token: process.env.TELEGRAM_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    apiId: process.env.TELEGRAM_API_ID ? parseInt(process.env.TELEGRAM_API_ID, 10) : undefined,
    apiHash: process.env.TELEGRAM_API_HASH
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
  // 3Shape Unite Web Service (OAuth PKCE public client — no secret). Blank
  // THREESHAPE_CLIENT_ID / THREESHAPE_WEBSERVICE_BASE leaves it disabled.
  threeshape: {
    clientId: process.env.THREESHAPE_CLIENT_ID,
    authority: process.env.THREESHAPE_AUTHORITY || 'https://identity.3shape.com',
    scopes:
      process.env.THREESHAPE_SCOPES ||
      'openid api profile api.workflow.init api.media.read api.media.download api.cases.read license.read offline_access',
    redirectUri:
      process.env.THREESHAPE_REDIRECT_URI ||
      'https://local.shwan-orthodontics.com/api/auth/3shape/callback',
    webServiceBase: process.env.THREESHAPE_WEBSERVICE_BASE,
    webhookSecret: process.env.THREESHAPE_WEBHOOK_SECRET,
    webhookUrl: process.env.THREESHAPE_WEBHOOK_URL,
  },
  localsend: {
    enabled: process.env.LOCALSEND_ENABLED === 'true',
    port: parseInt(process.env.LOCALSEND_PORT || '53317', 10),
    alias: process.env.LOCALSEND_ALIAS || 'Shwan Clinic Server',
    multicast: process.env.LOCALSEND_MULTICAST || '224.0.0.167',
  },
  // Cloudflare Zero Trust — syncs aligner_doctors emails into the Access email
  // list gating the external aligner portal. All three blank → sync disabled.
  cloudflare: {
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    doctorEmailListId: process.env.CLOUDFLARE_DOCTOR_EMAIL_LIST_ID,
  },
  cs_export: process.env.CS_EXPORT,
  gram_session: process.env.GRAM_SESSION,
};

export default config;
