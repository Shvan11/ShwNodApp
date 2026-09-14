/**
 * User Management Routes (Admin Only)
 * CRUD operations for user accounts
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { hashPassword } from '../../middleware/auth.js';
import { authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { sendData, ErrorResponses } from '../../utils/error-response.js';
import {
  listUsers,
  usernameExists,
  createUser,
  setUserPassword,
  setUserRole,
  toggleUserActive,
  deleteUser,
  getUserRoleStatus,
  countOtherActiveAdmins,
} from '../../services/database/queries/user-queries.js';
import * as userManagement from '../../shared/contracts/user-management.contract.js';
import { ADMIN_ROLES, normalizeRole } from '../../shared/auth/roles.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type UserIdParams = userManagement.UserIdParams;

// Request bodies are the contract's z.infer SSoT (Phase 14 root migration).
type CreateUserBody = userManagement.CreateUserBody;
type ResetPasswordBody = userManagement.ResetPasswordBody;
type UpdateRoleBody = userManagement.UpdateRoleBody;

// Session shape (userId/username/userRole/fullName) is declared once, canonically,
// in `types/express-session.d.ts` — no local re-declaration here.

// All routes require admin role
router.use(authorize(ADMIN_ROLES));

/**
 * GET /api/users
 * List all users
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    sendData(res, userManagement.usersList.response, { users: await listUsers() });
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

      if (await usernameExists(username)) {
        ErrorResponses.badRequest(res, 'Username already exists');
        return;
      }

      await createUser({
        username,
        passwordHash: await hashPassword(password),
        fullName: fullName || '',
        role,
        createdBy: req.session.username,
      });

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

      await setUserPassword(parseInt(userId, 10), await hashPassword(newPassword));

      log.info(`Password reset for user ID ${userId} by ${req.session.username}`);

      sendData(res, userManagement.resetPassword.response, { message: 'Password reset successfully' });
    } catch (error) {
      log.error('Error resetting password', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to reset password', error as Error);
    }
  }
);

/**
 * PUT /api/users/:userId/role
 * Change a user's role (admin only) — F4: there was previously no way to
 * change a user's role short of editing the DB directly.
 */
router.put(
  '/:userId/role',
  validate({ params: userManagement.updateRole.params, body: userManagement.updateRole.body }),
  async (
    req: Request<UserIdParams, unknown, UpdateRoleBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { userId } = req.params;
      const { role } = req.body;
      const id = parseInt(userId, 10);

      const target = await getUserRoleStatus(id);
      if (!target) {
        ErrorResponses.badRequest(res, 'User not found');
        return;
      }
      if (
        target.isActive &&
        normalizeRole(target.role) === 'admin' &&
        role !== 'admin' &&
        (await countOtherActiveAdmins(id)) === 0
      ) {
        ErrorResponses.badRequest(res, 'Cannot demote the last active admin');
        return;
      }

      await setUserRole(id, role);

      log.info(`Role changed for user ID ${userId} to ${role} by ${req.session.username}`);

      sendData(res, userManagement.updateRole.response, { message: 'Role updated successfully' });
    } catch (error) {
      log.error('Error updating user role', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to update role', error as Error);
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
      const id = parseInt(userId, 10);

      // Prevent deactivating yourself
      if (id === req.session.userId) {
        ErrorResponses.badRequest(res, 'Cannot deactivate your own account');
        return;
      }

      const target = await getUserRoleStatus(id);
      if (!target) {
        ErrorResponses.badRequest(res, 'User not found');
        return;
      }
      if (target.isActive && normalizeRole(target.role) === 'admin' && (await countOtherActiveAdmins(id)) === 0) {
        ErrorResponses.badRequest(res, 'Cannot deactivate the last active admin');
        return;
      }

      await toggleUserActive(id);

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
      const id = parseInt(userId, 10);

      // Prevent deleting yourself
      if (id === req.session.userId) {
        ErrorResponses.badRequest(res, 'Cannot delete your own account');
        return;
      }

      const target = await getUserRoleStatus(id);
      if (!target) {
        ErrorResponses.badRequest(res, 'User not found');
        return;
      }
      if (target.isActive && normalizeRole(target.role) === 'admin' && (await countOtherActiveAdmins(id)) === 0) {
        ErrorResponses.badRequest(res, 'Cannot delete the last active admin');
        return;
      }

      await deleteUser(id);

      log.info(`User deleted: ID ${userId} by ${req.session.username}`);

      sendData(res, userManagement.deleteUser.response, { message: 'User deleted successfully' });
    } catch (error) {
      log.error('Error deleting user', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to delete user', error as Error);
    }
  }
);

export default router;
