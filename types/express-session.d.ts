/**
 * Express Session Type Augmentation
 * Extends the express-session types to include our custom session properties
 */

import 'express-session';
import type { UserRole } from './database.types.js';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    userRole?: UserRole;
    fullName?: string;
  }
}
