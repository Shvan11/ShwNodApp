/**
 * Middleware-layer types.
 *
 * The four app-level auth/HTTP shapes this directory needs, plus a `UserRole`
 * re-export. They lived in `types/api.types.ts`, re-exported through
 * `types/index.ts`, until R9(d) — but the middleware layer was the ONLY consumer
 * of either file, so the indirection just put the middleware's own types two
 * directories away from the code that uses them. `types/` is now what its name
 * suggests: generated (`db.d.ts`) and ambient (`express-session.d.ts`,
 * `modules.d.ts`) declarations plus the boot-config shape.
 *
 * `api.types.ts` used to carry 22 more — request/response/query/handler
 * interfaces from an earlier design that nothing ever imported, several of them
 * (`ApiResponse`, `ApiSuccessResponse`, `UploadedFile`, `WorkRelatedCounts`)
 * re-declared independently elsewhere and therefore free to drift from the shape
 * actually in force. They are gone; the live declarations are:
 *
 * - the client-facing envelope → `public/js/types/api.types.ts#ApiResponse`
 *   (the one CLAUDE.md names)
 * - every request/response body → `shared/contracts/*.contract.ts` (Zod SSoT)
 * - multer's upload shape → `services/business/AlignerPdfService.ts#UploadedFile`
 *
 * Add nothing here that a contract could own.
 */

import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../shared/auth/roles.js';

/**
 * Application user roles — re-exported from the `shared/auth/roles.ts` SSoT
 * (the DB `users.role` column is a free-form `citext`, so this narrowed union
 * is the API contract's authority, not the generated DB row types).
 */
export type { UserRole };

/**
 * User without sensitive data — the sanitized shape returned to clients
 * (camelCase DTO, never a raw DB row).
 */
export interface SafeUser {
  userId: number;
  username: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
}

/**
 * Error response structure. What `utils/error-response.ts` writes and what the
 * `authorize()` / `requireRecordAge` gates type their `Response` as.
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
 * Middleware type - compatible with Express RequestHandler
 */
export type Middleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Response | Promise<void | Response>;

/**
 * Auth verification result (`middleware/auth.ts#verifyCredentials`).
 */
export interface AuthResult {
  success: boolean;
  user?: SafeUser;
  error?: string;
}
