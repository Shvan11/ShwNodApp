/**
 * Integrations Routes — manage external-service authentication (`/api/integrations/*`).
 *
 * Currently Telegram only: drive the interactive MTProto user login (request
 * code → submit code → optional 2FA password) and surface live status. The whole
 * router is admin-gated (`authorize(ADMIN_ROLES)`) — it logs into the clinic's
 * Telegram account. Follows the shared-contract pattern: `validate(...)` against
 * the contract schemas, then `sendData(res, <action>.response, data)`. The stateful
 * login lives in `services/messaging/telegram-auth.ts`; these handlers are a thin,
 * contracted shell over it.
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { authorize } from '../../middleware/auth.js';
import { ADMIN_ROLES } from '../../shared/auth/roles.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import config from '../../config/config.js';
import * as telegramAuth from '../../services/messaging/telegram-auth.js';
import {
  getGeminiStatus,
  setGeminiConfig,
  clearGeminiConfig,
  testGeminiConnection,
} from '../../services/business/gemini-config.js';
import * as threeShapeOAuth from '../../services/threeshape/oauth.js';
import * as threeShapeClient from '../../services/threeshape/client.js';
import { sendThreeShapeError } from '../../services/threeshape/route-helpers.js';
import * as googleDriveOAuth from '../../services/google-drive/oauth.js';
import * as integrations from '../../shared/contracts/integrations.contract.js';

const router = Router();

/** Effective webhook callback URL: explicit config, else the redirect URI's origin. */
function webhookCallbackUrl(): string {
  if (config.threeshape.webhookUrl) return config.threeshape.webhookUrl;
  return `${new URL(config.threeshape.redirectUri).origin}/api/integrations/3shape/webhook`;
}

// Every integration-management action is admin-only.
router.use(authorize(ADMIN_ROLES));

// GET /api/integrations/telegram/status — live auth status.
router.get('/telegram/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await telegramAuth.getStatus();
    sendData(res, integrations.telegramStatus.response, status);
  } catch (err) {
    log.error('[Integrations] telegram status failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Failed to read Telegram status');
  }
});

// POST /api/integrations/telegram/auth/start — request a login code.
router.post(
  '/telegram/auth/start',
  validate({ body: integrations.telegramAuthStart.body }),
  async (
    req: Request<object, object, integrations.TelegramAuthStartBody>,
    res: Response
  ): Promise<void> => {
    try {
      await telegramAuth.startLogin(req.body.phone);
      sendData(res, integrations.telegramAuthStart.response, { codeSent: true });
    } catch (err) {
      ErrorResponses.badRequest(res, (err as Error).message || 'Could not request a login code');
    }
  }
);

// POST /api/integrations/telegram/auth/code — submit the received code.
router.post(
  '/telegram/auth/code',
  validate({ body: integrations.telegramAuthCode.body }),
  async (
    req: Request<object, object, integrations.TelegramAuthCodeBody>,
    res: Response
  ): Promise<void> => {
    try {
      const result = await telegramAuth.submitCode(req.body.code);
      sendData(res, integrations.telegramAuthCode.response, result);
    } catch (err) {
      ErrorResponses.badRequest(res, (err as Error).message || 'Could not verify the code');
    }
  }
);

// POST /api/integrations/telegram/auth/password — submit the 2FA password.
router.post(
  '/telegram/auth/password',
  validate({ body: integrations.telegramAuthPassword.body }),
  async (
    req: Request<object, object, integrations.TelegramAuthPasswordBody>,
    res: Response
  ): Promise<void> => {
    try {
      const result = await telegramAuth.submitPassword(req.body.password);
      sendData(res, integrations.telegramAuthPassword.response, result);
    } catch (err) {
      ErrorResponses.badRequest(res, (err as Error).message || 'Could not verify the password');
    }
  }
);

// POST /api/integrations/telegram/auth/cancel — abort an in-progress login.
router.post('/telegram/auth/cancel', async (_req: Request, res: Response): Promise<void> => {
  await telegramAuth.cancelLogin();
  sendData(res, integrations.telegramAuthCancel.response, { ok: true });
});

// POST /api/integrations/telegram/logout — clear the stored session.
router.post('/telegram/logout', async (_req: Request, res: Response): Promise<void> => {
  try {
    await telegramAuth.logout();
    sendData(res, integrations.telegramLogout.response, { ok: true });
  } catch (err) {
    log.error('[Integrations] telegram logout failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Failed to log out of Telegram');
  }
});

// ── Gemini (Google GenAI) ──

// GET /api/integrations/gemini/status — configuration status (masked key).
router.get('/gemini/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    sendData(res, integrations.geminiStatus.response, await getGeminiStatus());
  } catch (err) {
    log.error('[Integrations] gemini status failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Failed to read Gemini status');
  }
});

// POST /api/integrations/gemini/config — save API key and/or model.
router.post(
  '/gemini/config',
  validate({ body: integrations.geminiConfig.body }),
  async (
    req: Request<object, object, integrations.GeminiConfigBody>,
    res: Response
  ): Promise<void> => {
    try {
      await setGeminiConfig(req.body);
      sendData(res, integrations.geminiConfig.response, await getGeminiStatus());
    } catch (err) {
      log.error('[Integrations] gemini config failed', { error: (err as Error).message });
      ErrorResponses.internalError(res, 'Failed to save Gemini configuration');
    }
  }
);

// POST /api/integrations/gemini/test — lightweight connectivity check.
router.post('/gemini/test', async (_req: Request, res: Response): Promise<void> => {
  const result = await testGeminiConnection();
  sendData(res, integrations.geminiTest.response, {
    ok: result.ok,
    model: result.model,
    error: result.error ?? null,
  });
});

// POST /api/integrations/gemini/clear — drop the DB overrides (revert to env).
router.post('/gemini/clear', async (_req: Request, res: Response): Promise<void> => {
  try {
    await clearGeminiConfig();
    sendData(res, integrations.geminiClear.response, await getGeminiStatus());
  } catch (err) {
    log.error('[Integrations] gemini clear failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Failed to clear Gemini configuration');
  }
});

// GET /api/integrations/3shape/status — connection status (the connect flow itself
// is the browser redirect at /api/auth/3shape/login).
router.get('/3shape/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await threeShapeOAuth.getStatus();
    sendData(res, integrations.threeshapeStatus.response, status);
  } catch (err) {
    log.error('[Integrations] 3shape status failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Failed to read 3Shape status');
  }
});

// POST /api/integrations/3shape/disconnect — clear the stored tokens.
router.post('/3shape/disconnect', async (_req: Request, res: Response): Promise<void> => {
  try {
    await threeShapeOAuth.disconnect();
    sendData(res, integrations.threeshapeDisconnect.response, { ok: true });
  } catch (err) {
    log.error('[Integrations] 3shape disconnect failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Failed to disconnect 3Shape');
  }
});

// POST /api/integrations/3shape/webhook/register — subscribe the workstation to scan
// events (CallbackUrl + shared secret as Bearer). Requires THREESHAPE_WEBHOOK_SECRET.
router.post('/3shape/webhook/register', async (_req: Request, res: Response): Promise<void> => {
  try {
    const secret = config.threeshape.webhookSecret;
    if (!secret) {
      ErrorResponses.badRequest(res, 'Set THREESHAPE_WEBHOOK_SECRET before registering a webhook.');
      return;
    }
    const callbackUrl = webhookCallbackUrl();
    await threeShapeClient.registerWebhook({ callbackUrl, authSchema: 'Bearer', authValue: secret });
    sendData(res, integrations.threeshapeWebhookRegister.response, { ok: true, callbackUrl });
  } catch (err) {
    sendThreeShapeError(res, err, 'Failed to register the 3Shape webhook');
  }
});

// GET /api/integrations/3shape/webhooks — current subscriptions.
router.get('/3shape/webhooks', async (_req: Request, res: Response): Promise<void> => {
  try {
    const subscriptions = await threeShapeClient.listWebhooks();
    sendData(res, integrations.threeshapeWebhookList.response, { subscriptions });
  } catch (err) {
    sendThreeShapeError(res, err, 'Failed to list 3Shape webhooks');
  }
});

// DELETE /api/integrations/3shape/webhooks/:subscriptionId — remove a subscription.
router.delete(
  '/3shape/webhooks/:subscriptionId',
  validate({ params: integrations.threeshapeWebhookDelete.params }),
  async (req: Request<integrations.ThreeShapeWebhookDeleteParams>, res: Response): Promise<void> => {
    try {
      await threeShapeClient.deleteWebhook(req.params.subscriptionId);
      sendData(res, integrations.threeshapeWebhookDelete.response, { ok: true });
    } catch (err) {
      sendThreeShapeError(res, err, 'Failed to delete the 3Shape webhook');
    }
  }
);

// ── Google Drive (aligner PDF storage) ──

// GET /api/integrations/google-drive/status — connection status (the connect flow
// itself is the browser redirect at /api/admin/google-drive/auth-url).
router.get('/google-drive/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await googleDriveOAuth.getStatus();
    sendData(res, integrations.googleDriveStatus.response, status);
  } catch (err) {
    log.error('[Integrations] google-drive status failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Failed to read Google Drive status');
  }
});

// POST /api/integrations/google-drive/disconnect — clear the stored tokens.
router.post('/google-drive/disconnect', async (_req: Request, res: Response): Promise<void> => {
  try {
    await googleDriveOAuth.disconnect();
    sendData(res, integrations.googleDriveDisconnect.response, { ok: true });
  } catch (err) {
    log.error('[Integrations] google-drive disconnect failed', { error: (err as Error).message });
    ErrorResponses.internalError(res, 'Failed to disconnect Google Drive');
  }
});

export default router;
