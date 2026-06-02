/**
 * User Management Routes (Admin Only)
 * CRUD operations for user accounts
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../utils/logger.js';
import { hashPassword } from '../middleware/auth.js';
import { authorize } from '../middleware/auth.js';
import { sql } from 'kysely';
import { getKysely } from '../services/database/kysely.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface UserIdParams {
  userId: string;
}

interface CreateUserBody {
  username: string;
  password: string;
  fullName?: string;
  role: 'admin' | 'secretary';
}

interface ResetPasswordBody {
  newPassword: string;
}

interface UserResult {
  userId: number;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLogin: Date | null;
  createdAt: Date;
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

// All routes require admin role
router.use(authorize(['admin']));

/**
 * GET /api/users
 * List all users
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const db = getKysely();
    const { rows } = await sql<UserResult>`
      SELECT "user_id" AS "userId", "username" AS "username", "full_name" AS "fullName",
             "role" AS "role", "is_active" AS "isActive", "last_login" AS "lastLogin",
             "created_at" AS "createdAt"
      FROM "users"
      ORDER BY "created_at" DESC`.execute(db);

    res.json({
      success: true,
      users: rows
    });
  } catch (error) {
    log.error('Error fetching users', { error: (error as Error).message });
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
router.post(
  '/',
  async (
    req: Request<unknown, unknown, CreateUserBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { username, password, fullName, role } = req.body;

      // Validation
      if (!username || !password) {
        res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
        return;
      }

      if (password.length < 6) {
        res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters'
        });
        return;
      }

      // Only allow admin and secretary roles
      if (!['admin', 'secretary'].includes(role)) {
        res.status(400).json({
          success: false,
          error: 'Invalid role. Only admin and secretary roles are allowed.'
        });
        return;
      }

      const db = getKysely();

      // Check if username exists
      const { rows: existing } = await sql<{ userId: number }>`
        SELECT "user_id" AS "userId" FROM "users" WHERE "username" = ${username}`.execute(db);

      if (existing.length > 0) {
        res.status(400).json({
          success: false,
          error: 'Username already exists'
        });
        return;
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      // Create user
      await sql`
        INSERT INTO "users" ("username", "password_hash", "full_name", "role", "created_by")
        VALUES (${username}, ${passwordHash}, ${fullName || ''}, ${role}, ${req.session.username})`.execute(db);

      log.info(`User created: ${username} (${role}) by ${req.session.username}`);

      res.json({
        success: true,
        message: 'User created successfully'
      });
    } catch (error) {
      log.error('Error creating user', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to create user'
      });
    }
  }
);

/**
 * PUT /api/users/:userId/password
 * Reset user password (admin only)
 */
router.put(
  '/:userId/password',
  async (
    req: Request<UserIdParams, unknown, ResetPasswordBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { userId } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 6) {
        res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters'
        });
        return;
      }

      // Hash new password
      const passwordHash = await hashPassword(newPassword);

      // Update password
      const db = getKysely();
      await sql`UPDATE "users" SET "password_hash" = ${passwordHash} WHERE "user_id" = ${parseInt(userId)}`.execute(db);

      log.info(`Password reset for user ID ${userId} by ${req.session.username}`);

      res.json({
        success: true,
        message: 'Password reset successfully'
      });
    } catch (error) {
      log.error('Error resetting password', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to reset password'
      });
    }
  }
);

/**
 * PUT /api/users/:userId/toggle
 * Toggle user active status
 */
router.put(
  '/:userId/toggle',
  async (req: Request<UserIdParams>, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;

      // Prevent deactivating yourself
      if (parseInt(userId) === req.session.userId) {
        res.status(400).json({
          success: false,
          error: 'Cannot deactivate your own account'
        });
        return;
      }

      // Toggle active status
      const db = getKysely();
      await sql`UPDATE "users" SET "is_active" = NOT "is_active" WHERE "user_id" = ${parseInt(userId)}`.execute(db);

      log.info(`User status toggled for ID ${userId} by ${req.session.username}`);

      res.json({
        success: true,
        message: 'User status updated'
      });
    } catch (error) {
      log.error('Error toggling user status', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to update user status'
      });
    }
  }
);

/**
 * DELETE /api/users/:userId
 * Delete user
 */
router.delete(
  '/:userId',
  async (req: Request<UserIdParams>, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;

      // Prevent deleting yourself
      if (parseInt(userId) === req.session.userId) {
        res.status(400).json({
          success: false,
          error: 'Cannot delete your own account'
        });
        return;
      }

      const db = getKysely();
      await sql`DELETE FROM "users" WHERE "user_id" = ${parseInt(userId)}`.execute(db);

      log.info(`User deleted: ID ${userId} by ${req.session.username}`);

      res.json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      log.error('Error deleting user', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to delete user'
      });
    }
  }
);

export default router;
