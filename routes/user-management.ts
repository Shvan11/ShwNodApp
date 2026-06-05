/**
 * User Management Routes (Admin Only)
 * CRUD operations for user accounts
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../utils/logger.js';
import { hashPassword } from '../middleware/auth.js';
import { authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendData, ErrorResponses } from '../utils/error-response.js';
import { sql } from 'kysely';
import { getKysely } from '../services/database/kysely.js';
import * as userManagement from '../shared/contracts/user-management.contract.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface UserIdParams {
  userId: string;
}

// Request bodies are the contract's z.infer SSoT (Phase 14 root migration).
type CreateUserBody = userManagement.CreateUserBody;
type ResetPasswordBody = userManagement.ResetPasswordBody;

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

    sendData(res, userManagement.usersList.response, { users: rows });
  } catch (error) {
    log.error('Error fetching users', { error: (error as Error).message });
    ErrorResponses.internalError(res, 'Failed to fetch users', error as Error);
  }
});

/**
 * POST /api/users
 * Create new user
 */
router.post(
  '/',
  validate({ body: userManagement.createUser.body }),
  async (
    req: Request<unknown, unknown, CreateUserBody>,
    res: Response
  ): Promise<void> => {
    try {
      // Presence/length/role already enforced by validate() (the contract body).
      const { username, password, fullName, role } = req.body;

      const db = getKysely();

      // Check if username exists
      const { rows: existing } = await sql<{ userId: number }>`
        SELECT "user_id" AS "userId" FROM "users" WHERE "username" = ${username}`.execute(db);

      if (existing.length > 0) {
        ErrorResponses.badRequest(res, 'Username already exists');
        return;
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      // Create user
      await sql`
        INSERT INTO "users" ("username", "password_hash", "full_name", "role", "created_by")
        VALUES (${username}, ${passwordHash}, ${fullName || ''}, ${role}, ${req.session.username})`.execute(db);

      log.info(`User created: ${username} (${role}) by ${req.session.username}`);

      sendData(res, userManagement.createUser.response, { message: 'User created successfully' });
    } catch (error) {
      log.error('Error creating user', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to create user', error as Error);
    }
  }
);

/**
 * PUT /api/users/:userId/password
 * Reset user password (admin only)
 */
router.put(
  '/:userId/password',
  validate({ params: userManagement.resetPassword.params, body: userManagement.resetPassword.body }),
  async (
    req: Request<UserIdParams, unknown, ResetPasswordBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { userId } = req.params;
      const { newPassword } = req.body; // length enforced by validate()

      // Hash new password
      const passwordHash = await hashPassword(newPassword);

      // Update password
      const db = getKysely();
      await sql`UPDATE "users" SET "password_hash" = ${passwordHash} WHERE "user_id" = ${parseInt(userId)}`.execute(db);

      log.info(`Password reset for user ID ${userId} by ${req.session.username}`);

      sendData(res, userManagement.resetPassword.response, { message: 'Password reset successfully' });
    } catch (error) {
      log.error('Error resetting password', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to reset password', error as Error);
    }
  }
);

/**
 * PUT /api/users/:userId/toggle
 * Toggle user active status
 */
router.put(
  '/:userId/toggle',
  validate({ params: userManagement.toggleUser.params }),
  async (req: Request<UserIdParams>, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;

      // Prevent deactivating yourself
      if (parseInt(userId) === req.session.userId) {
        ErrorResponses.badRequest(res, 'Cannot deactivate your own account');
        return;
      }

      // Toggle active status
      const db = getKysely();
      await sql`UPDATE "users" SET "is_active" = NOT "is_active" WHERE "user_id" = ${parseInt(userId)}`.execute(db);

      log.info(`User status toggled for ID ${userId} by ${req.session.username}`);

      sendData(res, userManagement.toggleUser.response, { message: 'User status updated' });
    } catch (error) {
      log.error('Error toggling user status', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to update user status', error as Error);
    }
  }
);

/**
 * DELETE /api/users/:userId
 * Delete user
 */
router.delete(
  '/:userId',
  validate({ params: userManagement.deleteUser.params }),
  async (req: Request<UserIdParams>, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;

      // Prevent deleting yourself
      if (parseInt(userId) === req.session.userId) {
        ErrorResponses.badRequest(res, 'Cannot delete your own account');
        return;
      }

      const db = getKysely();
      await sql`DELETE FROM "users" WHERE "user_id" = ${parseInt(userId)}`.execute(db);

      log.info(`User deleted: ID ${userId} by ${req.session.username}`);

      sendData(res, userManagement.deleteUser.response, { message: 'User deleted successfully' });
    } catch (error) {
      log.error('Error deleting user', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to delete user', error as Error);
    }
  }
);

export default router;
