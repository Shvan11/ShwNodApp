/**
 * Express Session Type Augmentation
 * Extends the express-session types to include our custom session properties
 */

import 'express-session';
import type { UserRole } from '../shared/auth/roles.js';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    userRole?: UserRole;
    fullName?: string;
    // Patient portal session fields (separate cookie `shwan.portal`)
    patientId?: number;
    patientName?: string;
    // Short-lived 3Shape OAuth PKCE state, set by /api/auth/3shape/login and
    // consumed (one-shot) by /api/auth/3shape/callback.
    threeshape?: { state: string; verifier: string; createdAt: number };
    // Short-lived Google Drive OAuth state, set by /api/admin/google-drive/auth-url
    // and consumed (one-shot) by /api/admin/google-drive/callback.
    googleDrive?: { state: string; createdAt: number };
    // Short-lived Google Contacts OAuth state, set by
    // /api/admin/google-contacts/auth-url and consumed (one-shot) by
    // /api/admin/google-contacts/callback. Carries the account being connected —
    // the callback has no other way to know which grant the code belongs to.
    googleContacts?: { state: string; accountId: string; createdAt: number };
  }
}
