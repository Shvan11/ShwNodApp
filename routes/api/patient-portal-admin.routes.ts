/**
 * Patient Portal Admin API Routes (staff-facing)
 *
 * Split out of `patient.routes.ts` (C1 — pure move). The staff side of the
 * Patient Portal: enable/disable a patient's portal access, reset or unlock
 * their PIN, read the login QR, and mark individual photos private so the
 * portal never serves them. The portal's OWN endpoints (its session, its reads)
 * live in `routes/portal.ts` behind the separate portal session.
 *
 * Mounted at `/api` alongside `patient.routes.ts`, so the paths below are the
 * full ones minus that prefix — unchanged by the move.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { authorize } from '../../middleware/auth.js';
import { FINANCE_ROLES } from '../../shared/auth/roles.js';
import { ErrorResponses, sendSuccess, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import * as patientContract from '../../shared/contracts/patient.contract.js';
import * as PatientPortalService from '../../services/business/PatientPortalService.js';

const router = Router();

const { personIdParams } = patientContract;

// ============================================================================

/**
 * GET /api/patients/:personId/portal
 * Fetch portal status + QR code for staff UI.
 */
router.get(
  '/patients/:personId/portal',
  authorize(FINANCE_ROLES),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      const [status, qr] = await Promise.all([
        PatientPortalService.getStatus(personId),
        PatientPortalService.getQrDataUrl(personId),
      ]);
      sendData(res, patientContract.portalStatus.response, {
        enabled: status.enabled,
        hasPin: status.hasPin,
        lockedUntil: status.lockedUntil,
        lastLoginAt: status.lastLoginAt,
        failedAttempts: status.failedAttempts,
        qrDataUrl: qr.qr,
        portalUrl: qr.url,
      });
    } catch (error) {
      log.error('Portal status fetch error', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to load portal status', error as Error);
    }
  }
);

/**
 * POST /api/patients/:personId/portal/reset-pin
 * Regenerate default PIN (last-4-phone → DDMM-DOB fallback). Returns plaintext ONCE.
 */
router.post(
  '/patients/:personId/portal/reset-pin',
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams }),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      const pin = await PatientPortalService.resetToDefaultPin(personId);
      sendData(res, patientContract.resetPin.response, { pin });
    } catch (error) {
      const msg = (error as Error).message;
      log.warn('Portal reset-pin failed', { error: msg });
      ErrorResponses.badRequest(res, msg);
    }
  }
);

/**
 * POST /api/patients/:personId/portal/enable
 * Enable/disable portal access for the patient.
 */
router.post(
  '/patients/:personId/portal/enable',
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams, body: patientContract.portalEnable.body }),
  async (
    req: Request<{ personId: string }, unknown, patientContract.PortalEnableBody>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { enabled } = req.body;
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      if (typeof enabled !== 'boolean') {
        ErrorResponses.badRequest(res, '`enabled` must be a boolean');
        return;
      }
      await PatientPortalService.setEnabled(personId, enabled);
      sendSuccess(res, null);
    } catch (error) {
      ErrorResponses.internalError(res, 'Failed to update portal access', error as Error);
    }
  }
);

/**
 * POST /api/patients/:personId/portal/unlock
 * Clear lockout counter.
 */
router.post(
  '/patients/:personId/portal/unlock',
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams }),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      await PatientPortalService.unlock(personId);
      sendSuccess(res, null);
    } catch (error) {
      ErrorResponses.internalError(res, 'Failed to unlock portal', error as Error);
    }
  }
);

// ============================================================================
// PHOTO VISIBILITY ROUTES (staff-facing)
// ============================================================================

/**
 * GET /api/patients/:personId/photos/visibility
 * List photos currently marked private for this patient.
 */
router.get(
  '/patients/:personId/photos/visibility',
  authorize(FINANCE_ROLES),
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      const rows = await PatientPortalService.getPrivateList(personId);
      sendData(res, patientContract.photoVisibilityList.response, {
        privateImages: rows.map((r) => ({ tp: r.timepoint_code, name: r.image_name })),
      });
    } catch (error) {
      ErrorResponses.internalError(res, 'Failed to load photo visibility', error as Error);
    }
  }
);

/**
 * POST /api/patients/:personId/photos/visibility
 * Toggle private/public for a specific photo.
 * Body: { tp: string, name: string, isPrivate: boolean }
 */
router.post(
  '/patients/:personId/photos/visibility',
  authorize(FINANCE_ROLES),
  validate({ params: personIdParams, body: patientContract.photoVisibility.body }),
  async (
    req: Request<{ personId: string }, unknown, patientContract.PhotoVisibilityBody>,
    res: Response
  ): Promise<void> => {
    try {
      const personId = parseInt(req.params.personId, 10);
      const { tp, name, isPrivate } = req.body;
      if (isNaN(personId)) {
        ErrorResponses.badRequest(res, 'Invalid patient id');
        return;
      }
      if (!tp || !name || typeof isPrivate !== 'boolean') {
        ErrorResponses.badRequest(res, '`tp`, `name`, and `isPrivate` are required');
        return;
      }
      const byUserId = req.session.userId ?? null;
      await PatientPortalService.togglePhotoPrivacy(personId, tp, name, isPrivate, byUserId);
      sendSuccess(res, null);
    } catch (error) {
      ErrorResponses.internalError(res, 'Failed to update photo visibility', error as Error);
    }
  }
);
export default router;
