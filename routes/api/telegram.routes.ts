/**
 * Telegram Routes — share patient files/images to a contact via Telegram.
 *
 * Auth-gated (mounted on the post-auth aggregator) and follows the shared-contract
 * pattern: `validate(...)` against the contract schemas, then `sendData(res,
 * <action>.response, data)`. The actual MTProto upload lives in the messaging
 * service (`services/messaging/telegram.ts`); these handlers resolve the client
 * `SendFileRef`s to safe disk paths (shared with LocalSend) and fan the recipient
 * phone out across them. Degrades cleanly when Telegram isn't configured.
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import config from '../../config/config.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { resolveShareRef } from '../../services/files/share-ref.js';
import { sendgramfile, getGramSession } from '../../services/messaging/telegram.js';
import { PhoneFormatter } from '../../utils/phoneFormatter.js';
import * as telegram from '../../shared/contracts/telegram.contract.js';

const router = Router();

/**
 * Telegram file-send needs the app credentials + a (runtime-managed) user
 * session. The session is re-authenticated from Settings → Integrations and
 * persisted in the `options` table, so check that — not the static env var.
 */
async function telegramEnabled(): Promise<boolean> {
  if (!config.telegram.apiId || !config.telegram.apiHash) return false;
  return Boolean(await getGramSession());
}

// GET /api/telegram/status — whether the server can send via Telegram.
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  sendData(res, telegram.status.response, { enabled: await telegramEnabled() });
});

// POST /api/telegram/send — push the given file(s) to one recipient phone.
router.post(
  '/send',
  validate({ body: telegram.send.body }),
  async (req: Request<object, object, telegram.SendBody>, res: Response): Promise<void> => {
    if (!(await telegramEnabled())) {
      ErrorResponses.badRequest(res, 'Telegram is not configured on the server');
      return;
    }

    const { phone, files } = req.body;
    const formattedPhone = PhoneFormatter.forTelegram(phone);
    if (!formattedPhone) {
      ErrorResponses.badRequest(res, 'A valid phone number is required');
      return;
    }

    const errors: string[] = [];
    let sent = 0;

    for (const ref of files) {
      try {
        const { abs, name } = await resolveShareRef(ref);
        const result = await sendgramfile(formattedPhone, abs);
        if (result.result === 'OK') {
          sent += 1;
        } else {
          errors.push(`${name}: ${result.error || 'send failed'}`);
        }
      } catch (err) {
        const name = ref.displayName || ref.ref;
        errors.push(`${name}: ${(err as Error).message}`);
      }
    }

    log.info('[Telegram] share complete', {
      phone: formattedPhone,
      total: files.length,
      sent,
      failed: errors.length,
    });

    sendData(res, telegram.send.response, {
      enabled: true,
      sent,
      total: files.length,
      errors,
    });
  }
);

export default router;
