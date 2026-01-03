/**
 * API Types
 * Type definitions for Express request/response handling
 */

import type { Request, Response, NextFunction } from 'express';
import type { Session } from 'express-session';
import type { UserRole, SafeUser } from './database.types.js';

// ===========================================
// SESSION TYPES
// ===========================================

/**
 * Extended Express Session with user data
 */
export interface AppSession extends Session {
  userId?: number;
  username?: string;
  userRole?: UserRole;
  fullName?: string;
}

// ===========================================
// REQUEST TYPES
// ===========================================

/**
 * Extended Express Request with typed session
 */
export interface AppRequest<
  P = Record<string, string>,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = Record<string, string | undefined>
> extends Request<P, ResBody, ReqBody, ReqQuery> {
  session: AppSession;
}

/**
 * Request with parsed person ID
 */
export interface PatientRequest extends AppRequest {
  params: {
    personId: string;
  };
}

/**
 * Request with parsed work ID
 */
export interface WorkRequest extends AppRequest {
  params: {
    workId: string;
    personId?: string;
  };
}

/**
 * Request with parsed appointment ID
 */
export interface AppointmentRequest extends AppRequest {
  params: {
    appointmentId: string;
  };
}

// ===========================================
// RESPONSE TYPES
// ===========================================

/**
 * Standard API response structure
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Error response structure
 */
export interface ApiErrorResponse {
  success: false;
  error: string;
  message?: string;
  code?: string;
  details?: Record<string, unknown>;
  redirectTo?: string;
}

/**
 * Success response structure
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

/**
 * Paginated response structure
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

// ===========================================
// HANDLER TYPES
// ===========================================

/**
 * Async route handler type
 */
export type RouteHandler<
  P = Record<string, string>,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = Record<string, string | undefined>
> = (
  req: AppRequest<P, ResBody, ReqBody, ReqQuery>,
  res: Response<ApiResponse<ResBody>>,
  next: NextFunction
) => Promise<void | Response<ApiResponse<ResBody>>> | void | Response<ApiResponse<ResBody>>;

/**
 * Middleware type - compatible with Express RequestHandler
 * Uses Request instead of AppRequest for Express compatibility
 */
export type Middleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Response | Promise<void | Response>;

/**
 * Error handling middleware type
 */
export type ErrorMiddleware = (
  error: Error,
  req: AppRequest,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

// ===========================================
// QUERY/PARAMS TYPES
// ===========================================

/**
 * Pagination query parameters
 */
export interface PaginationQuery {
  page?: string;
  limit?: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

/**
 * Date range query parameters
 */
export interface DateRangeQuery {
  startDate?: string;
  endDate?: string;
  date?: string;
}

/**
 * Search query parameters
 */
export interface SearchQuery {
  q?: string;
  query?: string;
  search?: string;
}

/**
 * Patient search query
 */
export interface PatientSearchQuery extends PaginationQuery {
  patientName?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  workTypes?: string;
  keywords?: string;
  tags?: string;
}

/**
 * Appointment query parameters
 */
export interface AppointmentQuery extends DateRangeQuery {
  AppsDate?: string;
  doctorId?: string;
  status?: string;
}

// ===========================================
// AUTH TYPES
// ===========================================

/**
 * Login request body
 */
export interface LoginRequest {
  username: string;
  password: string;
}

/**
 * Login response
 */
export interface LoginResponse {
  success: boolean;
  user?: SafeUser;
  message?: string;
  error?: string;
}

/**
 * Auth verification result
 */
export interface AuthResult {
  success: boolean;
  user?: SafeUser;
  error?: string;
}

// ===========================================
// FILE UPLOAD TYPES
// ===========================================

/**
 * Uploaded file info (from multer)
 */
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
  stream?: NodeJS.ReadableStream;
  buffer?: Buffer;
}

/**
 * Request with file upload
 */
export interface FileUploadRequest
  extends Omit<AppRequest, 'file' | 'files'> {
  file?: UploadedFile;
  files?: UploadedFile[] | Record<string, UploadedFile[]>;
}
