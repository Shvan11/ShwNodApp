/**
 * LocalSend Routes — discover LAN devices and push patient files/images to them.
 *
 * All endpoints are auth-gated (mounted on the post-auth aggregator) and follow
 * the shared-contract pattern: `validate(...)` against the contract schemas, then
 * `sendData(res, <action>.response, data)`. The actual LAN work lives in the
 * server-side sender service (services/localsend); these handlers are a thin,
 * contracted shell over it. Everything short-circuits when the feature is
 * disabled (`config.localsend.enabled`), so the picker degrades cleanly.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import config from '../../config/config.js';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { localsendService } from '../../services/localsend/index.js';
import * as localsend from '../../shared/contracts/localsend.contract.js';

const router = Router();

// GET /api/localsend/devices[?rescan=1] — discovered LAN receivers.
router.get(
  '/devices',
  validate({ query: localsend.devices.query }),
  (req: Request, res: Response): void => {
    if (!config.localsend.enabled) {
      sendData(res, localsend.devices.response, { enabled: false, devices: [] });
      return;
    }
    const { rescan } = req.query as z.infer<typeof localsend.devices.query>;
    if (rescan) localsendService.scan();
    sendData(res, localsend.devices.response, {
      enabled: true,
      devices: localsendService.getDevices(),
    });
  }
);

// POST /api/localsend/probe — add a device directly by IP (WSL-dev / segmented LAN).
router.post(
  '/probe',
  validate({ body: localsend.probe.body }),
  async (req: Request<object, object, localsend.ProbeBody>, res: Response): Promise<void> => {
    if (!config.localsend.enabled) {
      ErrorResponses.badRequest(res, 'LocalSend is disabled');
      return;
    }
    try {
      const device = await localsendService.probe(req.body.ip.trim());
      sendData(res, localsend.probe.response, { device });
    } catch (err) {
      log.warn('[LocalSend] probe failed', { ip: req.body.ip, error: (err as Error).message });
      ErrorResponses.badRequest(res, (err as Error).message || 'Could not reach that device');
    }
  }
);

// POST /api/localsend/send — start a transfer; returns immediately.
router.post(
  '/send',
  validate({ body: localsend.send.body }),
  async (req: Request<object, object, localsend.SendBody>, res: Response): Promise<void> => {
    if (!config.localsend.enabled) {
      ErrorResponses.badRequest(res, 'LocalSend is disabled');
      return;
    }
    try {
      const { deviceId, pin, files } = req.body;
      const transferId = await localsendService.send(deviceId, files, pin);
      log.info('[LocalSend] transfer started', { transferId, deviceId, fileCount: files.length });
      sendData(res, localsend.send.response, { transferId });
    } catch (err) {
      log.error('[LocalSend] send failed', { error: (err as Error).message });
      ErrorResponses.badRequest(res, (err as Error).message || 'Failed to start transfer');
    }
  }
);

// GET /api/localsend/transfers/:id — live status (polled by the modal).
router.get(
  '/transfers/:id',
  validate({ params: localsend.transfer.params }),
  (req: Request<{ id: string }>, res: Response): void => {
    const status = localsendService.getTransfer(req.params.id);
    if (!status) {
      ErrorResponses.notFound(res, 'Transfer not found');
      return;
    }
    sendData(res, localsend.transfer.response, status);
  }
);

// POST /api/localsend/transfers/:id/cancel — cancel an in-flight transfer.
router.post(
  '/transfers/:id/cancel',
  validate({ params: localsend.cancel.params }),
  (req: Request<{ id: string }>, res: Response): void => {
    const ok = localsendService.cancel(req.params.id);
    sendData(res, localsend.cancel.response, { ok });
  }
);

export default router;
