/**
 * API contract — user-management endpoints (`/api/users/*`, admin-only).
 *
 * Single source of truth for each endpoint's request + response shapes, imported
 * by BOTH the Express routes (relative `.js`) and the React app (`@shared`
 * alias). See docs/shared-contract-progress.md.
 *
 * Phase 14 (Wave 2) — ROOT MIGRATION. This route used a MANUAL top-level envelope
 * (`{ success, users }` / `{ success, message }`) that the funnel passed through
 * untouched. It now rides `sendData` (`{ success, data }`), so the funnel unwraps
 * to the payload: `usersList.response = { users }` → consumer keeps reading
 * `.users`. Bodies are fully enumerable → `z.infer` SSoT (the route's
 * `CreateUserBody`/`ResetPasswordBody` interfaces are deleted), with the manual
 * presence/length/role checks folded into the schema; manual `4xx` JSON →
 * `ErrorResponses.*`.
 */
import { z } from 'zod';
import { timestampString } from '../validation.js';

// Numeric `:userId` path param (asserts digits without coercing — keeps it a string).
const userIdParams = z.object({ userId: z.string().regex(/^\d+$/, 'Invalid user id') });

// User row from the `users` table (aliased camelCase in the route's raw SQL query).
// `lastLogin`/`createdAt` are PG `timestamp` columns: Date on the server, ISO string
// on the client — `timestampString` handles both sides.
const userRow = z.looseObject({
  userId: z.number(),
  username: z.string(),
  fullName: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  lastLogin: timestampString.nullable(),
  createdAt: timestampString,
});
export type UserRow = z.infer<typeof userRow>;

// GET /api/users → { users }.
export const usersList = {
  response: z.object({ users: z.array(userRow) }),
} as const;

// POST /api/users → { message }. Body fully enumerated (folds the manual guards).
export const createUser = {
  body: z.object({
    username: z.string().min(1, 'Username and password are required'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    fullName: z.string().optional(),
    role: z.enum(['admin', 'secretary'], {
      message: 'Invalid role. Only admin and secretary roles are allowed.',
    }),
  }),
  response: z.object({ message: z.string() }),
} as const;
export type CreateUserBody = z.infer<typeof createUser.body>;

// PUT /api/users/:userId/password → { message }.
export const resetPassword = {
  params: userIdParams,
  body: z.object({
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
  }),
  response: z.object({ message: z.string() }),
} as const;
export type ResetPasswordBody = z.infer<typeof resetPassword.body>;

// PUT /api/users/:userId/toggle → { message }.
export const toggleUser = {
  params: userIdParams,
  response: z.object({ message: z.string() }),
} as const;

// DELETE /api/users/:userId → { message }.
export const deleteUser = {
  params: userIdParams,
  response: z.object({ message: z.string() }),
} as const;

// `:userId` path param shared by the user-management routes (type-only).
export type UserIdParams = z.infer<typeof userIdParams>;
