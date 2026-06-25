/**
 * Authentication Middleware
 * Session-based authentication for Shwan Orthodontics
 */
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { sql } from 'kysely';
import { getKysely } from '../services/database/kysely.js';
import { log } from '../utils/logger.js';
import type { AuthResult, ApiErrorResponse, SafeUser, UserRole } from '../types/index.js';

/**
 * User data from database
 */
interface DbUser {
  userId: number;
  username: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
}

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
    // User is authenticated
    return next();
  }

  // Not authenticated - return 401
  log.warn(`Authentication failed for ${req.method} ${req.path}`);
  return res.status(401).json({
    success: false,
    error: 'Authentication required',
    message: 'Please login to continue',
    redirectTo: '/login.html'
  });
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
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const userRole = req.session.userRole;
    if (!userRole) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: 'No role assigned to this session'
      });
    }

    // Admin has access to everything
    if (userRole === 'admin') {
      return next();
    }

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
        details: {
          required: allowedRoles,
          current: userRole
        }
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
export async function verifyCredentials(
  username: string,
  password: string
): Promise<AuthResult> {
  try {
    const { rows: users } = await sql<DbUser>`
      SELECT "user_id" AS "userId", "username" AS "username", "password_hash" AS "passwordHash",
             "full_name" AS "fullName", "role" AS "role", "is_active" AS "isActive"
      FROM "users"
      WHERE "username" = ${username}
    `.execute(getKysely());

    if (!users || users.length === 0) {
      return {
        success: false,
        error: 'Invalid username or password'
      };
    }

    const user = users[0];

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

    // Update last login timestamp
    await sql`UPDATE "users" SET "last_login" = LOCALTIMESTAMP WHERE "user_id" = ${user.userId}`.execute(getKysely());

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
  // Skip for API routes - they have their own auth middleware
  if (req.path.startsWith('/api')) {
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
