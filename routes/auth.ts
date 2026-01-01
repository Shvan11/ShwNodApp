/**
 * Authentication Routes
 * Login, logout, password change endpoints
 */
import { Router, type Request, type Response } from 'express';
import { verifyCredentials, hashPassword } from '../middleware/auth.js';
import { executeQuery, TYPES } from '../services/database/index.js';

const router = Router();

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

interface UserInfo {
  userId: number;
  username: string;
  fullName: string;
  role: string;
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

      // Create session
      req.session.userId = result.user!.UserID;
      req.session.username = result.user!.Username;
      req.session.fullName = result.user!.FullName;
      req.session.userRole = result.user!.Role;

      // Extend session if "Remember Me" is checked
      if (rememberMe) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      } else {
        req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days default
      }

      console.log(
        `✅ User logged in: ${result.user!.Username} (${result.user!.Role})`
      );

      // Session is automatically saved when modified (resave: false handles this)
      res.json({
        success: true,
        message: 'Login successful',
        user: {
          username: result.user!.Username,
          fullName: result.user!.FullName,
          role: result.user!.Role
        }
      });
    } catch (error) {
      console.error('Login error:', error);
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
      console.error('Logout error:', err);
      res.status(500).json({
        success: false,
        error: 'Logout failed'
      });
      return;
    }

    res.clearCookie('shwan.sid');
    console.log(`👋 User logged out: ${username}`);

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
    console.error('[Auth /me] Error:', error);
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
      await executeQuery(
        'UPDATE dbo.tblUsers SET PasswordHash = @hash WHERE UserID = @userId',
        [
          ['hash', TYPES.NVarChar, newHash],
          ['userId', TYPES.Int, req.session.userId]
        ]
      );

      console.log(`🔐 Password changed for user: ${req.session.username}`);

      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      console.error('Change password error:', error);
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
