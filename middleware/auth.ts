/**
 * Authentication Middleware
 * Session-based authentication for Shwan Orthodontics
 */
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { executeQuery, TYPES } from '../services/database/index.js';
import { log } from '../utils/logger.js';
import type { AuthResult, ApiErrorResponse } from '../types/index.js';
import type { SafeUser, UserRole } from '../types/database.types.js';

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
  // Skip authentication for public routes
  if (req.path.startsWith('/api/auth') || req.path.startsWith('/api/settings/cost-presets')) {
    return next();
  }

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
export function authorize(allowedRoles: UserRole[] = []) {
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

    const userRole = (req.session.userRole || 'user') as UserRole;

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
    const users = await executeQuery<DbUser>(
      `SELECT UserID, Username, PasswordHash, FullName, Role, IsActive
       FROM dbo.tblUsers
       WHERE Username = @username`,
      [['username', TYPES.NVarChar, username]],
      (columns) => ({
        userId: columns[0].value as number,
        username: columns[1].value as string,
        passwordHash: columns[2].value as string,
        fullName: columns[3].value as string,
        role: columns[4].value as UserRole,
        isActive: columns[5].value as boolean
      })
    );

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
    await executeQuery(
      'UPDATE dbo.tblUsers SET LastLogin = GETDATE() WHERE UserID = @userId',
      [['userId', TYPES.Int, user.userId]]
    );

    const safeUser: SafeUser = {
      UserID: user.userId,
      Username: user.username,
      FullName: user.fullName,
      Role: user.role,
      IsActive: user.isActive
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
  return await bcrypt.hash(password, 10);
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

  // If logged in, continue
  if (req.session && req.session.userId) {
    return next();
  }

  // Not logged in - redirect to login
  res.redirect('/login.html');
}
