/**
 * WhatsApp MEDIA sending routes — base64 images from the browser (`/sendmedia`) and
 * on-disk clinic files (`/sendmedia2`, which also fans out to Telegram).
 *
 * Split out of whatsapp.routes.ts (S2/C6).
 *
 * Mounted at `/api/wa`, immediately after whatsapp.routes.ts and in the order the
 * sections appeared in that file, so the route table's registration order is unchanged.
 *
 * Responses stay RAW (the client reads top-level fields via the raw apiClient — not
 * the `core/http` funnel), so these handlers deliberately do NOT wrap in `sendData`
 * where the original didn't.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';

// Services
import { sendImg_, sendXray_ } from '../../services/messaging/whatsapp-api.js';
import { sendgramfile } from '../../services/messaging/telegram.js';
import { isUnderClinicRoot } from '../../services/files/clinic-paths.js';

// Utilities
import config from '../../config/config.js';
import PhoneFormatter from '../../utils/phone-formatter.js';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import { timeouts } from '../../middleware/timeout.js';
import { validate } from '../../middleware/validate.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import * as waContract from '../../shared/contracts/whatsapp.contract.js';

const router = Router();
const upload = multer();


interface SendMediaResult {
  result: string;
  sentMessages?: number;
}

/** Thrown by `/sendmedia2` when a requested path escapes the clinic volume. */
class OutOfTreePathError extends Error {
  constructor() {
    super('File is outside the clinic folder');
    this.name = 'OutOfTreePathError';
  }
}

// ============================================================================
// MEDIA SENDING ROUTES
// ============================================================================

/**
 * Send media (base64 encoded image) via WhatsApp
 * POST /sendmedia
 * Body: { file: base64Image, phone: phoneNumber }
 * note: Uses extended timeout (2 minutes) for file upload
 */
router.post(
  '/sendmedia',
  authorize(CLINICAL_ROLES),
  timeouts.long,
  validate({ body: waContract.sendMedia.body }),
  async (
    req: Request<unknown, unknown, waContract.SendMediaBody>,
    res: Response
  ): Promise<void> => {
    const { file: imgData, phone } = req.body;
    const base64Data = imgData.replace(/^data:image\/png;base64,/, '');
    const formattedPhone = PhoneFormatter.forWhatsApp(phone);
    try {
      await sendImg_(formattedPhone, base64Data);
      res.send('OK');
    } catch (error) {
      log.warn('WhatsApp send image failed', { phone, error: (error as Error).message });
      // The error object, not a hand-built `{ details: err.message }`: only the
      // `instanceof Error` branch of `sendError` is dev-gated, so a wrapper object
      // shipped the raw message to the browser in production. 'operation failed'
      // told the user nothing anyway.
      ErrorResponses.badRequest(res, 'Failed to send image', error as Error);
    }
  }
);

/**
 * Send multiple media files via WhatsApp or Telegram
 * POST /sendmedia2
 * Body: { file: comma-separated paths, phone: phoneNumber, prog: "WhatsApp"|"Telegram" }
 * note: Uses extended timeout (2 minutes) for multiple file uploads
 */
router.post(
  '/sendmedia2',
  authorize(CLINICAL_ROLES),
  timeouts.long,
  upload.none(),
  validate({ body: waContract.sendMedia2.body }),
  async (
    req: Request<unknown, unknown, waContract.SendMedia2Body>,
    res: Response
  ): Promise<void> => {
    try {
      const paths = req.body.file.split(',');
      let phone = req.body.phone;
      const prog = req.body.prog;

      log.info(
        `Sendmedia2 request - Program: ${prog}, phone: ${phone}, Files: ${paths.length}`
      );

      if (!phone || !prog || !paths.length) {
        log.warn('Send media2 missing parameters', { phone, prog, pathCount: paths.length });
        ErrorResponses.badRequest(res, 'Missing required parameters', {
          required: ['phone', 'prog', 'file']
        });
        return;
      }

      // Resolve each requested file and CONTAIN it under the clinic volume.
      //
      // The body carries whole filesystem paths (the client hands back what
      // `/api/convert-path` gave it), so without the containment check this
      // endpoint reads ANY readable file on the server — `.env`, logs, the
      // Windows tree (the service runs as Administrator) — and ships it to a
      // phone number also taken from the body. Every legitimate caller sends a
      // path under `clinic1/`, so the guard costs nothing.
      const resolveSendablePath = (inputPath: string): string => {
        const trimmedPath = inputPath.trim();
        const isAbsolute =
          trimmedPath.startsWith('\\\\') ||
          /^[A-Za-z]:/.test(trimmedPath) ||
          trimmedPath.startsWith('/');

        const resolved = isAbsolute
          ? trimmedPath
          : path.win32.join(config.fileSystem.machinePath || '', trimmedPath);

        if (!isUnderClinicRoot(resolved)) {
          log.warn('Send media2 rejected an out-of-tree path', { requested: trimmedPath });
          throw new OutOfTreePathError();
        }
        return resolved;
      };

      let sentMessages = 0;
      let state: SendMediaResult = { result: '' };

      if (prog === 'WhatsApp') {
        phone = PhoneFormatter.forWhatsApp(phone);
        log.info(`WhatsApp - Formatted phone: ${phone}`);

        for (const filePath of paths) {
          // Resolve Windows path
          const resolvedPath = resolveSendablePath(filePath);
          log.info(`Sending WhatsApp file: ${filePath} -> ${resolvedPath}`);
          state = await sendXray_(phone, resolvedPath);
          log.info(`WhatsApp result:`, state);
          if (state.result === 'OK') {
            sentMessages += 1;
          }
        }
      } else if (prog === 'Telegram') {
        const originalPhone = phone;
        phone = PhoneFormatter.forTelegram(phone);
        log.info(
          `Telegram - Original phone: ${originalPhone}, Formatted phone: ${phone}`
        );

        for (const filePath of paths) {
          // Resolve Windows path
          const resolvedPath = resolveSendablePath(filePath);
          log.info(`Sending Telegram file: ${filePath} -> ${resolvedPath}`);
          state = await sendgramfile(phone, resolvedPath);
          log.info(`Telegram result:`, state);
          if (state.result === 'OK') {
            sentMessages += 1;
          }
        }
      } else {
        log.warn('Send media2 unsupported program', { prog, phone });
        ErrorResponses.badRequest(res, 'Invalid input', {
          details: `Unsupported program: ${prog}. Use 'WhatsApp' or 'Telegram'`
        });
        return;
      }

      state.sentMessages = sentMessages;
      log.info(
        `Final result - Sent: ${sentMessages}/${paths.length}, state:`,
        state
      );
      res.json(state);
    } catch (error) {
      if (error instanceof OutOfTreePathError) {
        ErrorResponses.badRequest(res, 'Invalid file path', {
          details: 'Only files inside the clinic folder can be sent'
        });
        return;
      }
      log.error('Error in sendmedia2:', error);
      ErrorResponses.internalError(res, 'Error processing media files', error as Error);
    }
  }
);


export default router;
