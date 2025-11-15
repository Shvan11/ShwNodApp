/**
 * Authentication Middleware
 * Session-based authentication for Shwan Orthodontics
 */
import bcrypt from 'bcryptjs';
import { executeQuery, TYPES } from '../services/database/index.js';
import { log } from '../utils/logger.js';

/**
 * Authentication middleware - checks if user is logged in
 * Redirects to login page if not authenticated
 */
export function authenticate(req, res, next) {
  // Skip authentication for auth routes
  if (req.path.startsWith('/api/auth')) {
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
 * Authorization middleware - checks user role
 * @param {Array<string>} allowedRoles - Roles that can access this endpoint
 * @example
 * router.delete('/invoice/:id', authorize(['admin', 'accountant']), handler);
 */
export function authorize(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const userRole = req.session.userRole || 'user';

    // Admin has access to everything
    if (userRole === 'admin') {
      return next();
    }

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
        required: allowedRoles,
        current: userRole
      });
    }

    next();
  };
}

/**
 * Verify username and password against database
 * @param {string} username - Username
 * @param {string} password - Plain text password
 * @returns {Promise<Object>} - Result with success flag and user data
 */
export async function verifyCredentials(username, password) {
  try {
    const users = await executeQuery(
      `SELECT UserID, Username, PasswordHash, FullName, Role, IsActive
       FROM dbo.tblUsers
       WHERE Username = @username`,
      [['username', TYPES.NVarChar, username]],
      (columns) => ({
        userId: columns[0].value,
        username: columns[1].value,
        passwordHash: columns[2].value,
        fullName: columns[3].value,
        role: columns[4].value,
        isActive: columns[5].value
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

    return {
      success: true,
      user: {
        userId: user.userId,
        username: user.username,
        fullName: user.fullName,
        role: user.role
      }
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
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hashed password
 */
export async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

/**
 * Web authentication - simple redirect to login
 * Minimal overhead for internal use
 */
export function authenticateWeb(req, res, next) {
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
