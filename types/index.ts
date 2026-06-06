/**
 * Type Definitions Index
 * Re-exports all types for convenient importing
 *
 * Usage:
 *   import type { ApiResponse, SafeUser } from '../types/index.js';
 *
 * Note: there is no hand-written "database entity types" module. Table-row
 * shapes are owned by the generated `types/db.d.ts` (`Database` via
 * `services/database/kysely.ts`) and query-result projections live alongside
 * their query module in `services/database/queries/*`. Only app-level contract
 * types (API, config, services) are re-exported here.
 */

// API types
export type {
  // User / auth domain types
  UserRole,
  SafeUser,

  // Session types
  AppSession,

  // Request types
  AppRequest,
  PatientRequest,
  WorkRequest,
  AppointmentRequest,

  // Response types
  ApiResponse,
  ApiErrorResponse,
  ApiSuccessResponse,
  PaginatedResponse,

  // Handler types
  RouteHandler,
  Middleware,
  ErrorMiddleware,

  // Query types
  PaginationQuery,
  DateRangeQuery,
  SearchQuery,
  PatientSearchQuery,
  AppointmentQuery,

  // Auth types
  LoginRequest,
  LoginResponse,
  AuthResult,

  // File types
  UploadedFile,
  FileUploadRequest,
} from './api.types.js';

// Config types
export type {
  // Database config
  DatabaseAuthOptions,
  DatabaseAuth,
  DatabaseOptions,
  DatabaseConfig,

  // Service configs
  TelegramConfig,
  TwilioConfig,
  GoogleConfig,
  GoogleDriveConfig,
  WebCephConfig,
  FileSystemConfig,
  ServerConfig,
  UrlConfig,

  // Main config
  AppConfig,

  // Environment types
  Environment,
  RequiredEnvVars,
  OptionalEnvVars,
  EnvVars,
} from './config.types.js';

// Service types
export type {
  // Pool stats (cross-cutting consumers like HealthCheck)
  PoolStats,

  // Service result types
  ServiceResult,
  ValidationError,
  ValidationResult,

  // Resource manager types
  CleanupFunction,
  RegisteredResource,
  ResourceManagerInterface,

  // Health check types
  HealthStatus,
  HealthCheckResult,
  HealthReport,

  // Messaging types
  SendMessageOptions,
  SendMessageResult,
  BatchMessageRequest,
  BatchMessageResult,

  // PDF types
  PdfOptions,
  PdfResult,

  // Google Drive types
  DriveFile,
  DriveUploadResult,
} from './services.types.js';
