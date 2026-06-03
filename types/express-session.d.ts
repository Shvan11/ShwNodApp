/**
 * Express Session Type Augmentation
 * Extends the express-session types to include our custom session properties
 */

import 'express-session';
import type { UserRole } from './api.types.js';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    userRole?: UserRole;
    fullName?: string;
    // Patient portal session fields (separate cookie `shwan.portal`)
    patientId?: number;
    patientName?: string;
  }
}
