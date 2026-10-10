/**
 * Photo slot names — the clinic's own name for each of Dolphin's photo slots outside the 8 grid
 * views (Settings → Lookups → Photo Slot Names).
 *
 *   GET /api/photo-slots        — the slots, with Dolphin's name, the clinic's and a photo count
 *   PUT /api/photo-slots/:code  — set the clinic's name, or clear it (blank or null)
 *
 * Behind the staff gate (routes/api/index.ts). FINANCE_ROLES (admin + front desk): the tier of
 * every other reference-data edit (lookup-admin.routes.ts) and of the Lookups tab
 * (`manageLookups`) that hosts the editor. The names reach the screens through the
 * working-files listing (file-explorer.routes.ts), not through these routes.
 */
import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { FINANCE_ROLES } from '../../shared/auth/roles.js';
import { isViewCode } from '../../shared/photo-views.js';
import * as photoSlot from '../../shared/contracts/photo-slot.contract.js';
import { listPhotoSlots, setPhotoSlotLabel } from '../../services/database/queries/photo-slot-queries.js';

const router = Router();

router.get('/photo-slots', authorize(FINANCE_ROLES), async (_req: Request, res: Response): Promise<void> => {
  try {
    sendData(res, photoSlot.listSlots.response, await listPhotoSlots());
  } catch (error) {
    log.error('[PhotoSlots] list failed', { error: (error as Error).message });
    ErrorResponses.internalError(res, 'Failed to load the photo slots', error as Error);
  }
});

router.put(
  '/photo-slots/:code',
  authorize(FINANCE_ROLES),
  validate({ params: photoSlot.updateSlot.params, body: photoSlot.updateSlot.body }),
  async (
    req: Request<photoSlot.UpdateSlotParams, unknown, photoSlot.UpdateSlotBody>,
    res: Response
  ): Promise<void> => {
    const { code } = req.params;
    try {
      if (isViewCode(`i${code}`)) {
        ErrorResponses.badRequest(res, "The grid views' names can't be changed.");
        return;
      }
      // A blank name clears it: the slot goes back to the app's built-in name.
      const label = req.body.label || null;
      const slot = await setPhotoSlotLabel(code, label);
      if (!slot) {
        ErrorResponses.notFound(res, 'Photo slot');
        return;
      }
      log.info('[PhotoSlots] renamed', { userId: req.session?.userId, code, label });
      sendData(res, photoSlot.updateSlot.response, slot);
    } catch (error) {
      log.error('[PhotoSlots] rename failed', { code, error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to save the slot name', error as Error);
    }
  }
);

export default router;
