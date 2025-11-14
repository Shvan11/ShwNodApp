/**
 * User Management Routes (Admin Only)
 * CRUD operations for user accounts
 */
import express from 'express';
import { hashPassword } from '../middleware/auth.js';
import { authorize } from '../middleware/auth.js';
import { executeQuery, TYPES } from '../services/database/index.js';

const router = express.Router();

// All routes require admin role
router.use(authorize(['admin']));

/**
 * GET /api/users
 * List all users
 */
router.get('/', async (req, res) => {
  try {
    const users = await executeQuery(
      `SELECT UserID, Username, FullName, Role, IsActive, LastLogin, CreatedAt
       FROM dbo.tblUsers
       ORDER BY CreatedAt DESC`,
      [],
      (columns) => ({
        userId: columns[0].value,
        username: columns[1].value,
        fullName: columns[2].value,
        role: columns[3].value,
        isActive: columns[4].value,
        lastLogin: columns[5].value,
        createdAt: columns[6].value
      })
    );

    res.json({
      success: true,
      users: users || []
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

/**
 * POST /api/users
 * Create new user
 */
router.post('/', async (req, res) => {
  try {
    const { username, password, fullName, role } = req.body;

    // Validation
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    // Only allow admin and secretary roles
    if (!['admin', 'secretary'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role. Only admin and secretary roles are allowed.'
      });
    }

    // Check if username exists
    const existing = await executeQuery(
      'SELECT UserID FROM dbo.tblUsers WHERE Username = @username',
      [['username', TYPES.NVarChar, username]],
      (columns) => ({ userId: columns[0].value })
    );

    if (existing && existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Username already exists'
      });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    await executeQuery(
      `INSERT INTO dbo.tblUsers (Username, PasswordHash, FullName, Role, CreatedBy)
       VALUES (@username, @hash, @fullName, @role, @createdBy)`,
      [
        ['username', TYPES.NVarChar, username],
        ['hash', TYPES.NVarChar, passwordHash],
        ['fullName', TYPES.NVarChar, fullName || ''],
        ['role', TYPES.NVarChar, role],
        ['createdBy', TYPES.NVarChar, req.session.username]
      ]
    );

    console.log(`✅ User created: ${username} (${role}) by ${req.session.username}`);

    res.json({
      success: true,
      message: 'User created successfully'
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user'
    });
  }
});

/**
 * PUT /api/users/:userId/password
 * Reset user password (admin only)
 */
router.put('/:userId/password', async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword);

    // Update password
    await executeQuery(
      'UPDATE dbo.tblUsers SET PasswordHash = @hash WHERE UserID = @userId',
      [
        ['hash', TYPES.NVarChar, passwordHash],
        ['userId', TYPES.Int, parseInt(userId)]
      ]
    );

    console.log(`✅ Password reset for user ID ${userId} by ${req.session.username}`);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset password'
    });
  }
});

/**
 * PUT /api/users/:userId/toggle
 * Toggle user active status
 */
router.put('/:userId/toggle', async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent deactivating yourself
    if (parseInt(userId) === req.session.userId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot deactivate your own account'
      });
    }

    // Toggle active status
    await executeQuery(
      'UPDATE dbo.tblUsers SET IsActive = CASE WHEN IsActive = 1 THEN 0 ELSE 1 END WHERE UserID = @userId',
      [['userId', TYPES.Int, parseInt(userId)]]
    );

    console.log(`✅ User status toggled for ID ${userId} by ${req.session.username}`);

    res.json({
      success: true,
      message: 'User status updated'
    });
  } catch (error) {
    console.error('Error toggling user status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user status'
    });
  }
});

/**
 * DELETE /api/users/:userId
 * Delete user
 */
router.delete('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent deleting yourself
    if (parseInt(userId) === req.session.userId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own account'
      });
    }

    await executeQuery(
      'DELETE FROM dbo.tblUsers WHERE UserID = @userId',
      [['userId', TYPES.Int, parseInt(userId)]]
    );

    console.log(`✅ User deleted: ID ${userId} by ${req.session.username}`);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

export default router;
