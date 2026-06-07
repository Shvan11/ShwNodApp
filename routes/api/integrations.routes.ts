/**
 * Integrations Routes — manage external-service authentication (`/api/integrations/*`).
 *
 * Currently Telegram only: drive the interactive MTProto user login (request
 * code → submit code → optional 2FA password) and surface live status. The whole
 * router is admin-gated (`authorize(['admin'])`) — it logs into the clinic's
 * Telegram account. Follows the shared-contract pattern: `validate(...)` against
 * the contract schemas, then `sendData(res, <action>.response, data)`. The stateful
 * login lives in `services/messaging/telegram-auth.ts`; these handlers are a thin,
 * contracted shell over it.
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { authorize } from '../../middleware/auth.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import * as telegramAuth from '../../services/messaging/telegram-auth.js';
import * as integrations from '../../shared/contracts/integrations.contract.js';

const router = Router();

// Every integration-management action is admin-only.
router.use(authorize(['admin']));

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

export default router;
