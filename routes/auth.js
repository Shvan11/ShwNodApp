/**
 * Authentication Routes
 * Login, logout, password change endpoints
 */
import express from 'express';
import { verifyCredentials, hashPassword } from '../middleware/auth.js';
import { executeQuery, TYPES } from '../services/database/index.js';

const router = express.Router();

/**
 * POST /api/auth/login
 * Login endpoint - creates session on successful authentication
 *
 * Body: { username, password, rememberMe }
 * Response: { success, message, user }
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password, rememberMe } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    // Verify credentials
    const result = await verifyCredentials(username, password);

    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: result.error
      });
    }

    // Create session
    req.session.userId = result.user.userId;
    req.session.username = result.user.username;
    req.session.fullName = result.user.fullName;
    req.session.userRole = result.user.role;

    // Extend session if "Remember Me" is checked
    if (rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    } else {
      req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days default
    }

    console.log(`✅ User logged in: ${result.user.username} (${result.user.role})`);

    // Session is automatically saved when modified (resave: false handles this)
    res.json({
      success: true,
      message: 'Login successful',
      user: {
        username: result.user.username,
        fullName: result.user.fullName,
        role: result.user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed. Please try again.'
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout endpoint - destroys session
 */
router.post('/logout', (req, res) => {
  const username = req.session?.username || 'unknown';

  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({
        success: false,
        error: 'Logout failed'
      });
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
router.get('/me', (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
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
router.post('/change-password', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
    }

    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long'
      });
    }

    // Verify current password
    const result = await verifyCredentials(req.session.username, currentPassword);
    if (!result.success) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
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
});

/**
 * GET /api/auth/status
 * Check authentication status (useful for frontend)
 */
router.get('/status', (req, res) => {
  const isAuthenticated = !!(req.session && req.session.userId);

  res.json({
    success: true,
    authenticated: isAuthenticated,
    user: isAuthenticated ? {
      username: req.session.username,
      fullName: req.session.fullName,
      role: req.session.userRole
    } : null
  });
});

export default router;
