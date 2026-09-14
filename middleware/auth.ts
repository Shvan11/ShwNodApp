/**
 * Authentication Middleware
 * Session-based authentication for Shwan Orthodontics
 */
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import {
  getUserCredentials,
  stampLastLogin,
} from '../services/database/queries/user-queries.js';
import { log } from '../utils/logger.js';
import { ErrorResponses } from '../utils/error-response.js';
import { normalizeRole } from '../shared/auth/roles.js';
import type { AuthResult, ApiErrorResponse, SafeUser, UserRole } from './types.js';

/**
 * User data from database
 */

/**
 * Authentication middleware - checks if user is logged in
 * Redirects to login page if not authenticated
 */
export function authenticate(
  req: Request,
  res: Response<ApiErrorResponse>,
  next: NextFunction
): void | Response<ApiErrorResponse> {
  if (req.session && req.session.userId) {
    // A session minted before a role rename can carry a role value the
    // registry no longer knows (e.g. the pre-rename 'secretary'). Such a
    // session can never pass any authorize() gate, yet `rolling: true`
    // refreshes its expiry on every request — including the rejected ones —
    // so it would otherwise strand the workstation on 403s forever. Treat it
    // as an invalid session: destroy it and 401, which the SPA answers with
    // a redirect to the login page (fresh session, current role).
    if (normalizeRole(req.session.userRole) === undefined) {
      const staleRole = String(req.session.userRole);
      log.warn(
        `Stale session role '${staleRole}' for user ${req.session.userId} on ${req.method} ${req.path} - forcing re-login`
      );
      req.session.destroy(err => {
        if (err) log.error('Failed to destroy stale-role session:', err);
        ErrorResponses.unauthorized(res, 'Your session is no longer valid. Please log in again.');
      });
      return;
    }
    // User is authenticated
    return next();
  }

  // Not authenticated - return 401. The SPA drives the login redirect off the
  // 401 status itself (route loaders), so no `redirectTo` field is needed.
  log.warn(`Authentication failed for ${req.method} ${req.path}`);
  return ErrorResponses.unauthorized(res, 'Authentication required');
}

/**
 * Authorization middleware factory - checks user role
 * @param allowedRoles - Roles that can access this endpoint
 * @example
 * router.delete('/invoice/:id', authorize(['admin', 'accountant']), handler);
 */
export function authorize(allowedRoles: readonly UserRole[] = []) {
  return (
    req: Request,
    res: Response<ApiErrorResponse>,
    next: NextFunction
  ): void | Response<ApiErrorResponse> => {
    if (!req.session || !req.session.userId) {
      return ErrorResponses.unauthorized(res, 'Authentication required');
    }

    const userRole = req.session.userRole;
    if (!userRole) {
      // req.originalUrl, not req.path — under a path-scoped router.use() Express
      // strips the mount prefix from req.path, which hides the /api/admin context.
      log.warn(
        `Authorization denied (no role on session) for user ${req.session.userId} on ${req.method} ${req.originalUrl}`
      );
      return ErrorResponses.forbidden(res, 'Insufficient permissions', {
        reason: 'No role assigned to this session',
      });
    }

    // Admin has access to everything
    if (userRole === 'admin') {
      return next();
    }

    if (!allowedRoles.includes(userRole)) {
      // Log every denial — sendError doesn't log, so these were invisible
      // server-side. A burst of them (especially on non-API paths) is the
      // loudest signal of a route-mount/gating regression. originalUrl, not
      // req.path: path-scoped mounts strip their prefix from req.path.
      log.warn(
        `Authorization denied for ${req.method} ${req.originalUrl}: user ${req.session.userId} (role '${userRole}') requires [${allowedRoles.join(', ')}]`
      );
      return ErrorResponses.forbidden(res, 'Insufficient permissions', {
        required: allowedRoles,
        current: userRole,
      });
    }

    next();
  };
}

/**
 * Verify username and password against database
 * @param username - Username
 * @param password - Plain text password
 * @returns Result with success flag and user data
 */
/**
 * A real cost-12 bcrypt hash of a value no one can log in with, compared against
 * when the username misses so both failure paths cost the same. Cost must match
 * `hashPassword` below, or the timings diverge again.
 */
const DUMMY_PASSWORD_HASH = '$2b$12$uFkOm6XezkwlqY/58ndCwu4v1wQXvDBAe8dGMG1U/xk87x4KxuNLq';

export async function verifyCredentials(
  username: string,
  password: string,
  options: { touchLastLogin?: boolean } = {}
): Promise<AuthResult> {
  const { touchLastLogin = true } = options;
  try {
    const user = await getUserCredentials(username);

    if (!user) {
      // Burn a bcrypt compare against a fixed hash before answering. Returning
      // immediately made "no such user" measurably faster than "wrong password",
      // which is a username-enumeration oracle (the 15-min/IP login limiter caps
      // how fast it can be sampled, but doesn't remove the signal).
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return {
        success: false,
        error: 'Invalid username or password'
      };
    }

    if (!user.isActive) {
      return {
        success: false,
        error: 'Account is disabled. Please contact administrator.'
      };
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return {
        success: false,
        error: 'Invalid username or password'
      };
    }

    // Update last login timestamp. Re-verification that is NOT a login (the
    // change-password confirmation) passes `touchLastLogin: false` so it doesn't
    // record itself as a sign-in.
    if (touchLastLogin) {
      await stampLastLogin(user.userId);
    }

    const safeUser: SafeUser = {
      userId: user.userId,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive
    };

    return {
      success: true,
      user: safeUser
    };

  } catch (error) {
    log.error('Error verifying credentials:', error);
    return {
      success: false,
      error: 'Authentication failed. Please try again.'
    };
  }
}

/**
 * Hash password for storage
 * @param password - Plain text password
 * @returns Hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 12);
}

/**
 * Web authentication - simple redirect to login
 * Minimal overhead for internal use
 */
export function authenticateWeb(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip for API routes - they have their own auth middleware. Segment-bounded:
  // a bare `startsWith('/api')` also matches `/apifoo`, which would skip the web
  // gate and fall through to the SPA catch-all (cf. the /api/portal session trap
  // documented in CLAUDE.md).
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return next();
  }

  // Skip for patient portal (has its own session and login UI)
  if (req.path === '/portal' || req.path.startsWith('/portal/')) {
    return next();
  }

  // Skip for Vite-built static assets. The portal SPA (public) and staff SPA
  // share /dist/assets/*; gating these behind staff auth redirects module
  // script requests to /login.html and breaks strict-MIME loading.
  if (req.path.startsWith('/assets/')) {
    return next();
  }

  // If logged in, continue
  if (req.session && req.session.userId) {
    return next();
  }

  // Not logged in - redirect to login
  res.redirect('/login.html');
}
