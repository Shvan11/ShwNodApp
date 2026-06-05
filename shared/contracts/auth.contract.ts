/**
 * API contract — auth endpoints (`/api/auth/*`).
 *
 * REQUEST-TYPE source for the login + change-password bodies. These handlers keep
 * their own manual validation, rate limiting, and security-specific raw error
 * responses, so the schemas here are the `z.infer` SSoT for the handler generics
 * but are deliberately NOT wired to `validate()` (no boundary behaviour change).
 * The route's hand-written `LoginBody`/`ChangePasswordBody` interfaces are dropped
 * for these exports. See docs/shared-contract-progress.md.
 */
import { z } from 'zod';

// POST /api/auth/login — { username, password, rememberMe? }.
export const login = {
  body: z.object({
    username: z.string(),
    password: z.string(),
    rememberMe: z.boolean().optional(),
  }),
} as const;
export type LoginBody = z.infer<typeof login.body>;

// POST /api/auth/change-password — { currentPassword, newPassword }.
export const changePassword = {
  body: z.object({
    currentPassword: z.string(),
    newPassword: z.string(),
  }),
} as const;
export type ChangePasswordBody = z.infer<typeof changePassword.body>;
