/**
 * Admin Routes
 * Admin-only endpoints for configuration and management
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../utils/logger.js';
import { ErrorResponses } from '../utils/error-response.js';
import { authorize } from '../middleware/auth.js';
import { ADMIN_ROLES } from '../shared/auth/roles.js';
import driveUploadService from '../services/google-drive/drive-upload.js';
import * as googleDriveOAuth from '../services/google-drive/oauth.js';
import * as googleContactsOAuth from '../services/google-contacts/oauth.js';
import { isGoogleContactAccountId } from '../shared/google-contacts-accounts.js';
import { validate } from '../middleware/validate.js';
import {
  oauthCallbackQuery,
  type OAuthCallbackQuery,
} from '../shared/contracts/oauth-callback.contract.js';

const router = Router();

// Every route in this file is admin-only, and this pathless gate is now SAFE —
// but only because the router is mounted AT `/api/admin` (index.ts) and its routes
// are relative. Read this before changing either.
//
// It used to be mounted at the app ROOT with self-prefixed `/api/admin/...` paths,
// so every request no earlier route handled fell through it (all /dist assets and
// the SPA catch-all mount AFTER it). A pathless gate in that position gates the
// ENTIRE app: the 2026-07-11 deploy shipped exactly that, 403'ing every page +
// asset for non-admin staff and 401'ing the public portal's shared /assets chunks.
// The fix then was to path-scope the gate; the fix now (audit R9(a), 2026-09-12) is
// to remove the mismatch that made scoping necessary — a router's effective URL and
// its gate no longer live in two files ordered by hand.
//
// House rule: a router must NOT self-prefix absolute paths. Mount it where it
// belongs and keep its own paths relative — then a pathless gate covers exactly the
// router, which is what it looks like it does.
//
// The public OAuth *redirect URIs registered in Google Cloud Console are unchanged*:
// `/api/admin/google-drive/callback` etc. still resolve, because the mount supplies
// the prefix the paths used to carry.
router.use(authorize(ADMIN_ROLES));

// Kept at this existing path (not /api/auth/google-drive/*, the convention used by
// 3Shape) — it's the redirect URI already registered against this Google Cloud
// OAuth client; moving it would require a matching change in Google Cloud Console.
const SETTINGS_INTEGRATIONS_URL = '/settings/integrations';
const GOOGLE_DRIVE_STATE_TTL_MS = 10 * 60 * 1000; // login → callback round-trip window

/**
 * GET /api/admin/google-drive/auth-url — generate state, stash in the session, and
 * 302 to Google's consent screen. (Full-page redirect, not a JSON endpoint — the
 * Settings → Integrations "Connect" button navigates here directly.)
 */
router.get(
  '/google-drive/auth-url',
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
      ErrorResponses.internalError(res, 'Could not start Google Drive sign-in.', error as Error);
    }
  }
);

/**
 * GET /api/admin/google-drive/callback — exchange the code for tokens, persist
 * them, and redirect back to the Settings → Integrations card with a flag.
 */
router.get(
  '/google-drive/callback',
  validate({ query: oauthCallbackQuery }),
  async (
    req: Request<unknown, unknown, unknown, OAuthCallbackQuery>,
    res: Response
  ): Promise<void> => {
    const back = (params: string): void => res.redirect(`${SETTINGS_INTEGRATIONS_URL}?${params}`);
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

// ============================================================================
// GOOGLE CONTACTS OAUTH (message-recipient phone book)
// ============================================================================
// Same redirect shape as Google Drive above, but multi-account: the account being
// connected rides along in the session next to the anti-CSRF state, because the
// callback is a fresh request with no other way to tell which grant the code is for.

const GOOGLE_CONTACTS_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * GET /api/admin/google-contacts/auth-url?account=<id> — stash state + account in
 * the session and 302 to Google's consent screen. (Full-page redirect, not JSON —
 * the Settings → Integrations "Connect" button navigates here directly.)
 */
router.get(
  '/google-contacts/auth-url',
  async (
    req: Request<unknown, unknown, unknown, { account?: string }>,
    res: Response
  ): Promise<void> => {
    const accountId = req.query.account;
    if (!accountId || !isGoogleContactAccountId(accountId)) {
      res.status(400).json({ success: false, error: 'Unknown Google Contacts account.' });
      return;
    }
    if (!(await googleContactsOAuth.isConfigured())) {
      res
        .status(503)
        .json({ success: false, error: 'Google Contacts is not configured on this server.' });
      return;
    }
    try {
      const state = googleContactsOAuth.generateState();
      const url = await googleContactsOAuth.buildAuthorizeUrl(accountId, state);
      req.session.googleContacts = { state, accountId, createdAt: Date.now() };
      // Persist BEFORE redirecting — the callback reads it back from the store.
      req.session.save((err) => {
        if (err) {
          log.error('[GoogleContacts] failed to persist OAuth session', { error: err.message });
          res
            .status(500)
            .json({ success: false, error: 'Could not start Google Contacts sign-in.' });
          return;
        }
        res.redirect(url);
      });
    } catch (error) {
      log.error('[GoogleContacts] error generating auth URL', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Could not start Google Contacts sign-in.', error as Error);
    }
  }
);

/**
 * GET /api/admin/google-contacts/callback — exchange the code for tokens against
 * the account stashed at auth-url time, then redirect back to the Settings card.
 */
router.get(
  '/google-contacts/callback',
  validate({ query: oauthCallbackQuery }),
  async (
    req: Request<unknown, unknown, unknown, OAuthCallbackQuery>,
    res: Response
  ): Promise<void> => {
    const back = (params: string): void =>
      res.redirect(`${SETTINGS_INTEGRATIONS_URL}?${params}`);
    const fail = (reason: string): void =>
      back(`googleContacts=error&reason=${encodeURIComponent(reason)}`);

    const { code, state, error: oauthError } = req.query;

    // One-shot: consume the stashed state regardless of outcome.
    const pending = req.session.googleContacts;
    delete req.session.googleContacts;

    if (oauthError) {
      log.warn('[GoogleContacts] authorize returned an error', { error: oauthError });
      fail(oauthError);
      return;
    }
    if (!pending || !state || state !== pending.state) {
      fail('invalid_state');
      return;
    }
    if (Date.now() - pending.createdAt > GOOGLE_CONTACTS_STATE_TTL_MS) {
      fail('expired');
      return;
    }
    if (!code) {
      fail('missing_code');
      return;
    }

    try {
      await googleContactsOAuth.exchangeCode(pending.accountId, code);
      back(`googleContacts=connected&account=${encodeURIComponent(pending.accountId)}`);
    } catch (error) {
      log.error('[GoogleContacts] error in OAuth callback', { error: (error as Error).message });
      fail('exchange_failed');
    }
  }
);

/**
 * Test Google Drive connection
 */
router.get(
  '/google-drive/test',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await driveUploadService.testConnection();
      res.json(result);
    } catch (error) {
      log.error('Error testing connection', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Google Drive connection test failed', error as Error);
    }
  }
);

// Full configuration + connection status now lives at the contracted
// GET /api/integrations/google-drive/status (routes/api/integrations.routes.ts),
// which backs the Settings → Integrations card.

export default router;
