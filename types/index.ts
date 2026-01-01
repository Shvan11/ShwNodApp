/**
 * Type Definitions Index
 * Re-exports all types for convenient importing
 *
 * Usage:
 *   import type { Patient, Appointment, ApiResponse } from '../types/index.js';
 *   // or
 *   import type { Patient } from '../types/database.types.js';
 */

// Database entity types
export type {
  // Patient types
  Patient,
  PatientInfo,
  PatientAlert,
  XrayFile,
  TimePoint,

  // Appointment types
  Appointment,
  AppointmentStatus,
  AppointmentStateField,
  DailyAppointmentsResponse,
  AppointmentStats,
  DailyAppointmentsData,

  // Work types
  Work,
  WorkWithDetails,
  WorkStatusValue,

  // Payment types
  Invoice,
  InvoiceCreateData,
  Payment,
  WorkForInvoice,

  // User types
  User,
  SafeUser,
  UserRole,

  // Visit types
  Visit,

  // Wire types
  Wire,

  // Expense types
  Expense,

  // Employee types
  Employee,

  // Lookup types
  WorkType,
  Keyword,
  PatientType,
  AlertType,

  // Aligner types
  AlignerSet,
  AlignerBatch,
  AlignerPartner,

  // Template types
  Template,

  // Messaging types
  MessageRecord,
  MessageStatus,

  // Holiday types
  Holiday,
} from './database.types.js';

// Re-export constants
export { WORK_STATUS } from './database.types.js';

// API types
export type {
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

// WebSocket types
export type {
  // Connection types
  ConnectionStatus,
  ConnectionState,

  // Message types
  WebSocketMessage,
  AckMessage,

  // Event types
  WebSocketEventName,

  // Event data types
  ConnectionEstablishedData,
  AppointmentUpdateData,
  PatientLoadedData,
  PatientUnloadedData,

  // WhatsApp types
  WhatsAppMessageStatusValue,
  WhatsAppMessageStatus,
  WhatsAppBatchStatus,
  WhatsAppQRData,
  WhatsAppClientState,
  WhatsAppSessionStatus,

  // Client types
  WebSocketConfig,
  EventHandler,
  EventListenerMap,

  // Server types
  WSClientInfo,
  BroadcastOptions,
} from './websocket.types.js';

// Re-export WebSocket event constants
export { WebSocketEvents } from './websocket.types.js';

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
  // Query types
  TediousType,
  QueryParameter,
  ColumnMetadata,
  ColumnData,
  RowMapper,
  ResultMapper,
  OutputParameter,
  QueryOptions,

  // Pool types
  PoolStats,
  QueueEntry,
  ConnectionPoolInterface,

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

  // Sync types
  SyncOperation,
  SyncQueueItem,
  SyncResult,

  // Google Drive types
  DriveFile,
  DriveUploadResult,
} from './services.types.js';
