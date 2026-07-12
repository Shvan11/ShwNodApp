/**
 * Admin Routes
 * Admin-only endpoints for configuration and management
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../utils/logger.js';
import { authorize } from '../middleware/auth.js';
import { ADMIN_ROLES } from '../shared/auth/roles.js';
import driveUploadService from '../services/google-drive/drive-upload.js';
import * as googleDriveOAuth from '../services/google-drive/oauth.js';

const router = Router();

// Every route in this file is admin-only — but the gate MUST stay path-scoped.
// This router is mounted at the app ROOT (index.ts), not under /api/admin, so
// the Google OAuth callback keeps its redirect URL as registered in Google
// Cloud Console — which means every request no earlier route handled falls
// through it (all /dist assets and the SPA catch-all mount AFTER it). A
// pathless router.use(authorize(...)) here gates the ENTIRE app: the
// 2026-07-11 deploy shipped exactly that, 403'ing every page + asset for
// non-admin staff and 401'ing the public portal's shared /assets chunks.
// House rule for root-mounted routers: path-scoped or per-route gates only
// (see routes/api/appointment.routes.ts).
router.use('/api/admin', authorize(ADMIN_ROLES));

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// OAuth callback query (Google Drive setup; not part of the staff-app contract
// surface, so kept as a local type rather than a contract export).
type OAuthCallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
};

// Kept at this existing path (not /api/auth/google-drive/*, the convention used by
// 3Shape) — it's the redirect URI already registered against this Google Cloud
// OAuth client; moving it would require a matching change in Google Cloud Console.
const GOOGLE_DRIVE_SETTINGS_URL = '/settings/integrations';
const GOOGLE_DRIVE_STATE_TTL_MS = 10 * 60 * 1000; // login → callback round-trip window

/**
 * GET /api/admin/google-drive/auth-url — generate state, stash in the session, and
 * 302 to Google's consent screen. (Full-page redirect, not a JSON endpoint — the
 * Settings → Integrations "Connect" button navigates here directly.)
 */
router.get(
  '/api/admin/google-drive/auth-url',
  (req: Request, res: Response): void => {
    if (!googleDriveOAuth.isConfigured()) {
      res.status(503).json({ success: false, error: 'Google Drive is not configured on this server.' });
      return;
    }
    try {
      const state = googleDriveOAuth.generateState();
      const url = googleDriveOAuth.buildAuthorizeUrl(state);
      req.session.googleDrive = { state, createdAt: Date.now() };
      // Persist the state BEFORE redirecting — the callback (a fresh request after
      // the round-trip to Google) must read it back from the store.
      req.session.save((err) => {
        if (err) {
          log.error('[GoogleDrive] failed to persist OAuth session', { error: err.message });
          res.status(500).json({ success: false, error: 'Could not start Google Drive sign-in.' });
          return;
        }
        res.redirect(url);
      });
    } catch (error) {
      log.error('Error generating auth URL', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        error: (error as Error).message
      });
    }
  }
);

/**
 * GET /api/admin/google-drive/callback — exchange the code for tokens, persist
 * them, and redirect back to the Settings → Integrations card with a flag.
 */
router.get(
  '/api/admin/google-drive/callback',
  async (
    req: Request<unknown, unknown, unknown, OAuthCallbackQuery>,
    res: Response
  ): Promise<void> => {
    const back = (params: string): void => res.redirect(`${GOOGLE_DRIVE_SETTINGS_URL}?${params}`);
    const fail = (reason: string): void => back(`googleDrive=error&reason=${encodeURIComponent(reason)}`);

    const { code, state, error: oauthError } = req.query;

    // One-shot: consume the stashed state regardless of outcome.
    const pending = req.session.googleDrive;
    delete req.session.googleDrive;

    if (oauthError) {
      log.warn('[GoogleDrive] authorize returned an error', { error: oauthError });
      fail(oauthError);
      return;
    }
    if (!pending || !state || state !== pending.state) {
      fail('invalid_state');
      return;
    }
    if (Date.now() - pending.createdAt > GOOGLE_DRIVE_STATE_TTL_MS) {
      fail('expired');
      return;
    }
    if (!code) {
      fail('missing_code');
      return;
    }

    try {
      await googleDriveOAuth.exchangeCode(code);
      back('googleDrive=connected');
    } catch (error) {
      log.error('Error in OAuth callback', { error: (error as Error).message });
      fail('exchange_failed');
    }
  }
);

/**
 * Test Google Drive connection
 */
router.get(
  '/api/admin/google-drive/test',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await driveUploadService.testConnection();
      res.json(result);
    } catch (error) {
      log.error('Error testing connection', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        message: (error as Error).message
      });
    }
  }
);

// Full configuration + connection status now lives at the contracted
// GET /api/integrations/google-drive/status (routes/api/integrations.routes.ts),
// which backs the Settings → Integrations card.

export default router;
