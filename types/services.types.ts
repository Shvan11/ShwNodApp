/**
 * Service Types
 * Type definitions for service layer operations
 */

import type { Connection, TYPES } from 'tedious';

// ===========================================
// DATABASE QUERY TYPES
// ===========================================

/**
 * Tedious SQL type - derived from the TYPES object
 */
export type TediousType = (typeof TYPES)[keyof typeof TYPES];

/**
 * SQL parameter value types that tedious accepts
 */
export type SqlParameterValue = string | number | boolean | Date | Buffer | null | undefined;

/**
 * Query parameter tuple: [name, type, value, options?]
 */
export type QueryParameter = [
  name: string,
  type: TediousType,
  value: SqlParameterValue,
  options?: { length?: number; precision?: number; scale?: number }
];

/**
 * Column metadata from tedious
 */
export interface ColumnMetadata {
  colName: string;
  type: {
    name: string;
  };
  nullable?: boolean;
  caseSensitive?: boolean;
  identity?: boolean;
  readOnly?: boolean;
}

/**
 * Column data from query result
 */
export interface ColumnData {
  value: SqlParameterValue;
  metadata: ColumnMetadata;
}

/**
 * Row mapper function - transforms columns to typed object
 */
export type RowMapper<T> = (columns: ColumnData[]) => T;

/**
 * Result mapper function - transforms array of results
 */
export type ResultMapper<T, R = T[]> = (result: T[], outputParams?: OutputParameter[]) => R;

/**
 * Output parameter from stored procedure
 */
export interface OutputParameter {
  parameterName: string;
  value: SqlParameterValue;
  type?: TediousType;
}

/**
 * Query execution options
 */
export interface QueryOptions {
  timeout?: number;
  useTransaction?: boolean;
}

// ===========================================
// CONNECTION POOL TYPES
// ===========================================

/**
 * Connection pool statistics
 */
export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  waitingRequests: number;
  maxConnections: number;
  isShuttingDown: boolean;
}

/**
 * Queue entry for waiting connection requests
 */
export interface QueueEntry {
  resolve: (connection: Connection) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  timestamp: number;
  timeoutMs: number;
}

/**
 * Connection pool interface
 */
export interface ConnectionPoolInterface {
  getConnection(timeoutMs?: number): Promise<Connection>;
  releaseConnection(connection: Connection): void;
  withConnection<T>(operation: (connection: Connection) => Promise<T>): Promise<T>;
  getStats(): PoolStats;
  cleanup(): Promise<void>;
}

// ===========================================
// SERVICE RESULT TYPES
// ===========================================

/**
 * Generic service result
 */
export interface ServiceResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Validation error
 */
export interface ValidationError {
  field: string;
  message: string;
  code?: string;
  value?: unknown;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ===========================================
// RESOURCE MANAGER TYPES
// ===========================================

/**
 * Cleanup function type
 */
export type CleanupFunction = () => Promise<void> | void;

/**
 * Registered resource
 */
export interface RegisteredResource {
  resource: unknown;
  cleanup: CleanupFunction;
  registered: number;
}

/**
 * Resource manager interface
 */
export interface ResourceManagerInterface {
  register(name: string, resource: unknown, cleanupFn: CleanupFunction): void;
  unregister(name: string): void;
  get<T>(name: string): T | undefined;
  gracefulShutdown(signal: string): Promise<void>;
}

// ===========================================
// HEALTH CHECK TYPES
// ===========================================

/**
 * Health check status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Individual health check result
 */
export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  responseTime?: number;
  lastCheck?: Date;
  details?: Record<string, unknown>;
}

/**
 * Overall health status
 */
export interface HealthReport {
  status: HealthStatus;
  timestamp: Date;
  uptime: number;
  checks: HealthCheckResult[];
  version?: string;
  environment?: string;
}

// ===========================================
// MESSAGING SERVICE TYPES
// ===========================================

/**
 * Message send options
 */
export interface SendMessageOptions {
  to: string;
  message: string;
  patientName?: string;
  appointmentId?: number;
  priority?: 'normal' | 'high';
}

/**
 * Message send result
 */
export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  status?: string;
  error?: string;
  timestamp?: number;
}

/**
 * Batch message request
 */
export interface BatchMessageRequest {
  messages: SendMessageOptions[];
  delayBetween?: number;
  stopOnError?: boolean;
}

/**
 * Batch message result
 */
export interface BatchMessageResult {
  total: number;
  sent: number;
  failed: number;
  results: SendMessageResult[];
}

// ===========================================
// PDF SERVICE TYPES
// ===========================================

/**
 * PDF generation options
 */
export interface PdfOptions {
  title?: string;
  author?: string;
  subject?: string;
  orientation?: 'portrait' | 'landscape';
  size?: 'A4' | 'A5' | 'Letter';
  margins?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
}

/**
 * PDF generation result
 */
export interface PdfResult {
  success: boolean;
  buffer?: Buffer;
  path?: string;
  error?: string;
}

// ===========================================
// SYNC SERVICE TYPES
// ===========================================

/**
 * Sync operation type
 */
export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Sync queue item
 */
export interface SyncQueueItem {
  QueueID: number;
  TableName: string;
  RecordID: number;
  Operation: SyncOperation;
  JsonData?: string | null;
  CreatedAt: Date;
  Status: 'Pending' | 'Synced' | 'Failed';
  Attempts: number;
  LastError?: string | null;
}

/**
 * Sync result
 */
export interface SyncResult {
  success: boolean;
  processed: number;
  failed: number;
  errors?: string[];
}

// ===========================================
// GOOGLE DRIVE TYPES
// ===========================================

/**
 * Drive file info
 */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  createdTime?: string;
  modifiedTime?: string;
}

/**
 * Drive upload result
 */
export interface DriveUploadResult {
  success: boolean;
  fileId?: string;
  webViewLink?: string;
  error?: string;
}
