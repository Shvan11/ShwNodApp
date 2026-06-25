/**
 * Authentication Routes
 * Login, logout, password change endpoints
 */
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyCredentials, hashPassword, authenticate, authorize } from '../middleware/auth.js';
import { sql } from 'kysely';
import { getKysely } from '../services/database/kysely.js';
import { log } from '../utils/logger.js';
import type { LoginBody, ChangePasswordBody } from '../shared/contracts/auth.contract.js';
import * as threeShapeOAuth from '../services/threeshape/oauth.js';
import { ThreeShapeError } from '../services/threeshape/errors.js';
import { normalizeRole, ADMIN_ROLES } from '../shared/auth/roles.js';

const router = Router();

/**
 * Rate-limit /api/auth/login to slow brute-force attempts. 5 attempts per
 * 15 minutes per IP — mirrors the patient-portal limiter. trust proxy is set
 * to 'loopback' in setupMiddleware so the real client IP is read from
 * X-Forwarded-For (Caddy).
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many login attempts. Please try again later.',
  },
});

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// Body shapes (LoginBody / ChangePasswordBody) come from the auth contract — these
// handlers keep their own manual checks + rate limiting + security-specific error
// responses, so the contract is the type SSoT but isn't wired to `validate()`.
// Session shape (userId/username/userRole/fullName) is declared once, canonically,
// in `types/express-session.d.ts` — no local re-declaration here.

/**
 * POST /api/auth/login
 * Login endpoint - creates session on successful authentication
 *
 * Body: { username, password, rememberMe }
 * Response: { success, message, user }
 */
router.post(
  '/login',
  loginLimiter,
  async (
    req: Request<unknown, unknown, LoginBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { username, password, rememberMe } = req.body;

      // Validate input
      if (!username || !password) {
        res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
        return;
      }

      // Verify credentials
      const result = await verifyCredentials(username, password);

      if (!result.success) {
        res.status(401).json({
          success: false,
          error: result.error
        });
        return;
      }

      // Regenerate the session id on privilege escalation to prevent session
      // fixation — a pre-auth (potentially attacker-supplied) session id must
      // not carry over into the authenticated session.
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });

      // Create session
      req.session.userId = result.user!.userId;
      req.session.username = result.user!.username;
      req.session.fullName = result.user!.fullName;
      req.session.userRole = normalizeRole(result.user!.role);

      // Extend session if "Remember Me" is checked
      if (rememberMe) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      } else {
        req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days default
      }

      // Persist the regenerated, populated session before responding so the new
      // id is stored server-side before the client starts using it.
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      log.info('User logged in', {
        username: result.user!.username,
        role: result.user!.role
      });

      res.json({
        success: true,
        message: 'Login successful',
        user: {
          username: result.user!.username,
          fullName: result.user!.fullName,
          role: result.user!.role
        }
      });
    } catch (error) {
      log.error('Login error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Login failed. Please try again.'
      });
    }
  }
);

/**
 * POST /api/auth/logout
 * Logout endpoint - destroys session
 */
router.post('/logout', (req: Request, res: Response): void => {
  const username = req.session?.username || 'unknown';

  req.session.destroy((err) => {
    if (err) {
      log.error('Logout error', { error: err.message });
      res.status(500).json({
        success: false,
        error: 'Logout failed'
      });
      return;
    }

    res.clearCookie('shwan.sid');
    log.info('User logged out', { username });

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
router.get('/me', (req: Request, res: Response): void => {
  try {
    if (!req.session || !req.session.userId) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated'
      });
      return;
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
    log.error('[Auth /me] Error', { error: (error as Error).message });
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
router.post(
  '/change-password',
  async (
    req: Request<unknown, unknown, ChangePasswordBody>,
    res: Response
  ): Promise<void> => {
    try {
      if (!req.session || !req.session.userId) {
        res.status(401).json({
          success: false,
          error: 'Not authenticated'
        });
        return;
      }

      const { currentPassword, newPassword } = req.body;

      // Validate input
      if (!currentPassword || !newPassword) {
        res.status(400).json({
          success: false,
          error: 'Current password and new password are required'
        });
        return;
      }

      if (newPassword.length < 6) {
        res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters long'
        });
        return;
      }

      // Verify current password
      const result = await verifyCredentials(
        req.session.username!,
        currentPassword
      );
      if (!result.success) {
        res.status(401).json({
          success: false,
          error: 'Current password is incorrect'
        });
        return;
      }

      // Hash new password
      const newHash = await hashPassword(newPassword);

      // Update password in database
      const db = getKysely();
      await sql`UPDATE "users" SET "password_hash" = ${newHash} WHERE "user_id" = ${req.session.userId}`.execute(db);

      log.info('Password changed', { username: req.session.username });

      // Regenerate session ID to invalidate the old session cookie; preserve login data
      const { userId, username, userRole, fullName } = req.session;
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
      });
      req.session.userId = userId;
      req.session.username = username;
      req.session.userRole = userRole;
      req.session.fullName = fullName;

      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      log.error('Change password error', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: 'Failed to change password. Please try again.'
      });
    }
  }
);

// ============================================================================
// 3Shape Unite — OAuth 2.0 (Authorization Code + PKCE) connect flow
// ============================================================================
// Mounted pre-gate under /api/auth (index.ts) so the browser redirect lands
// OUTSIDE the staff/admin gate. `/login` self-guards as admin (it is started from
// inside the app); `/callback` is gate-exempt and validated by `state` + the
// session-held PKCE verifier. Both are GET ⇒ CSRF-safe, so they pass
// staffCsrfProtection. The callback's registered redirect URI is exactly
// `/api/auth/3shape/callback` (config.threeshape.redirectUri).

const THREESHAPE_SETTINGS_URL = '/settings/integrations';
const THREESHAPE_PKCE_TTL_MS = 10 * 60 * 1000; // login → callback round-trip window

/**
 * GET /api/auth/3shape/login — admin-only. Generate PKCE + state, stash in the
 * session, and 302 to the 3Shape authorize endpoint.
 */
router.get(
  '/3shape/login',
  authenticate,
  authorize(ADMIN_ROLES),
  (req: Request, res: Response): void => {
    if (!threeShapeOAuth.isConfigured()) {
      res.status(503).json({ success: false, error: '3Shape is not configured on this server.' });
      return;
    }
    const state = threeShapeOAuth.generateState();
    const verifier = threeShapeOAuth.generateVerifier();
    const challenge = threeShapeOAuth.challengeFromVerifier(verifier);
    req.session.threeshape = { state, verifier, createdAt: Date.now() };
    const url = threeShapeOAuth.buildAuthorizeUrl(state, challenge);
    // Persist the PKCE state BEFORE redirecting — the callback (a fresh request
    // after the round-trip to 3Shape) must read it back from the store.
    req.session.save((err) => {
      if (err) {
        log.error('[3Shape] failed to persist OAuth session', { error: err.message });
        res.status(500).json({ success: false, error: 'Could not start 3Shape sign-in.' });
        return;
      }
      res.redirect(url);
    });
  }
);

/**
 * GET /api/auth/3shape/callback — gate-exempt; validated by `state`. Exchange the
 * code for tokens, then redirect to the Settings → Integrations card with a flag.
 */
router.get('/3shape/callback', async (req: Request, res: Response): Promise<void> => {
  const back = (params: string): void => res.redirect(`${THREESHAPE_SETTINGS_URL}?${params}`);
  const fail = (reason: string): void => back(`threeshape=error&reason=${encodeURIComponent(reason)}`);

  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined;

  // One-shot: consume the stashed PKCE state regardless of outcome.
  const pkce = req.session.threeshape;
  delete req.session.threeshape;

  if (oauthError) {
    log.warn('[3Shape] authorize returned an error', { error: oauthError });
    fail(oauthError);
    return;
  }
  if (!pkce || !state || state !== pkce.state) {
    fail('invalid_state');
    return;
  }
  if (Date.now() - pkce.createdAt > THREESHAPE_PKCE_TTL_MS) {
    fail('expired');
    return;
  }
  if (!code) {
    fail('missing_code');
    return;
  }

  try {
    await threeShapeOAuth.exchangeCode(code, pkce.verifier);
    back('threeshape=connected');
  } catch (err) {
    log.error('[3Shape] token exchange failed', { error: (err as Error).message });
    fail(err instanceof ThreeShapeError ? err.code : 'exchange_failed');
  }
});

export default router;
