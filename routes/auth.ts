/**
 * Authentication Routes
 * Login, logout, password change endpoints
 */
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyCredentials, hashPassword } from '../middleware/auth.js';
import { sql } from 'kysely';
import { getKysely } from '../services/database/kysely.js';
import { log } from '../utils/logger.js';

const router = Router();

/**
 * Rate-limit /api/auth/login to slow brute-force attempts. 5 attempts per
 * 15 minutes per IP — mirrors the patient-portal limiter. trust proxy is set
 * to 'loopback' in setupMiddleware so the real client IP is read from
 * X-Forwarded-For (Caddy).
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many login attempts. Please try again later.',
  },
});

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface LoginBody {
  username: string;
  password: string;
  rememberMe?: boolean;
}

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

// Extend Express Session
declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    fullName?: string;
    userRole?: string;
  }
}

/**
 * POST /api/auth/login
 * Login endpoint - creates session on successful authentication
 *
 * Body: { username, password, rememberMe }
 * Response: { success, message, user }
 */
router.post(
  '/login',
  loginLimiter,
  async (
    req: Request<unknown, unknown, LoginBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { username, password, rememberMe } = req.body;

      // Validate input
      if (!username || !password) {
        res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
        return;
      }

      // Verify credentials
      const result = await verifyCredentials(username, password);

      if (!result.success) {
        res.status(401).json({
          success: false,
          error: result.error
        });
        return;
      }

      // Regenerate the session id on privilege escalation to prevent session
      // fixation — a pre-auth (potentially attacker-supplied) session id must
      // not carry over into the authenticated session.
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });

      // Create session
      req.session.userId = result.user!.userId;
      req.session.username = result.user!.username;
      req.session.fullName = result.user!.fullName;
      req.session.userRole = result.user!.role;

      // Extend session if "Remember Me" is checked
      if (rememberMe) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      } else {
        req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days default
      }

      // Persist the regenerated, populated session before responding so the new
      // id is stored server-side before the client starts using it.
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      log.info('User logged in', {
        username: result.user!.username,
        role: result.user!.role
      });

      res.json({
        success: true,
        message: 'Login successful',
        user: {
          username: result.user!.username,
          fullName: result.user!.fullName,
          role: result.user!.role
        }
      });
    } catch (error) {
      log.error('Login error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Login failed. Please try again.'
      });
    }
  }
);

/**
 * POST /api/auth/logout
 * Logout endpoint - destroys session
 */
router.post('/logout', (req: Request, res: Response): void => {
  const username = req.session?.username || 'unknown';

  req.session.destroy((err) => {
    if (err) {
      log.error('Logout error', { error: err.message });
      res.status(500).json({
        success: false,
        error: 'Logout failed'
      });
      return;
    }

    res.clearCookie('shwan.sid');
    log.info('User logged out', { username });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  });
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', (req: Request, res: Response): void => {
  try {
    if (!req.session || !req.session.userId) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
      return;
    }

    res.json({
      success: true,
      user: {
        username: req.session.username,
        fullName: req.session.fullName,
        role: req.session.userRole
      }
    });
  } catch (error) {
    log.error('[Auth /me] Error', { error: (error as Error).message });
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/change-password
 * Change password for current user
 *
 * Body: { currentPassword, newPassword }
 */
router.post(
  '/change-password',
  async (
    req: Request<unknown, unknown, ChangePasswordBody>,
    res: Response
  ): Promise<void> => {
    try {
      if (!req.session || !req.session.userId) {
        res.status(401).json({
          success: false,
          error: 'Not authenticated'
        });
        return;
      }

      const { currentPassword, newPassword } = req.body;

      // Validate input
      if (!currentPassword || !newPassword) {
        res.status(400).json({
          success: false,
          error: 'Current password and new password are required'
        });
        return;
      }

      if (newPassword.length < 6) {
        res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters long'
        });
        return;
      }

      // Verify current password
      const result = await verifyCredentials(
        req.session.username!,
        currentPassword
      );
      if (!result.success) {
        res.status(401).json({
          success: false,
          error: 'Current password is incorrect'
        });
        return;
      }

      // Hash new password
      const newHash = await hashPassword(newPassword);

      // Update password in database
      const db = getKysely();
      await sql`UPDATE "users" SET "password_hash" = ${newHash} WHERE "user_id" = ${req.session.userId}`.execute(db);

      log.info('Password changed', { username: req.session.username });

      // Regenerate session ID to invalidate the old session cookie; preserve login data
      const { userId, username, userRole, fullName } = req.session as typeof req.session & {
        userId: number; username: string; userRole: string; fullName: string;
      };
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });
      req.session.userId = userId;
      req.session.username = username;
      req.session.userRole = userRole;
      req.session.fullName = fullName;

      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      log.error('Change password error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to change password. Please try again.'
      });
    }
  }
);

/**
 * GET /api/auth/status
 * Check authentication status (useful for frontend)
 */
router.get('/status', (req: Request, res: Response): void => {
  const isAuthenticated = !!(req.session && req.session.userId);

  res.json({
    success: true,
    authenticated: isAuthenticated,
    user: isAuthenticated
      ? {
          username: req.session.username,
          fullName: req.session.fullName,
          role: req.session.userRole
        }
      : null
  });
});

export default router;
