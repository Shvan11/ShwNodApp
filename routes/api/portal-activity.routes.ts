/**
 * Portal-activity routes — the staff "Portal activity" header bell.
 *
 *   GET   /api/portal-activity           — feed of portal-originated flags
 *   PATCH /api/portal-activity/read      — mark a group of rows read
 *   PATCH /api/portal-activity/read-all  — mark everything read
 *
 * Rows come from `aligner_activity_flags` WHERE source='portal' (written by the
 * doctor portal on the Supabase mirror, reverse-synced home). See
 * shared/contracts/portal-activity.contract.ts.
 */
import { Router, type Request, type Response } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { sendData, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import * as portalActivityContract from '../../shared/contracts/portal-activity.contract.js';
import {
  getPortalActivityFeed,
  markActivityRead,
  markAllActivityRead,
} from '../../services/database/queries/portal-activity-queries.js';

const router = Router();

// GET /api/portal-activity?unreadOnly=true&limit=50
router.get(
  '/portal-activity',
  authenticate,
  validate({ query: portalActivityContract.portalActivityFeed.query }),
  async (
    req: Request<unknown, unknown, unknown, portalActivityContract.PortalActivityFeedQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const rows = await getPortalActivityFeed({
        unreadOnly: req.query.unreadOnly === 'true',
        limit: req.query.limit,
      });
      sendData(res, portalActivityContract.portalActivityFeed.response, rows);
    } catch (error) {
      log.error('Error fetching portal activity feed:', error);
      ErrorResponses.internalError(res, 'Failed to fetch portal activity', error as Error);
    }
  }
);

// PATCH /api/portal-activity/read — the bell groups uploads by (set, type, day);
// one click sends the whole group's ids.
router.patch(
  '/portal-activity/read',
  authenticate,
  validate({ body: portalActivityContract.markActivityRead.body }),
  async (
    req: Request<Record<string, never>, unknown, portalActivityContract.MarkActivityReadBody>,
    res: Response
  ): Promise<void> => {
    try {
      const updated = await markActivityRead(req.body.activityIds);
      sendData(res, portalActivityContract.markActivityRead.response, { updated });
    } catch (error) {
      log.error('Error marking portal activity read:', error);
      ErrorResponses.internalError(res, 'Failed to mark activity read', error as Error);
    }
  }
);

// PATCH /api/portal-activity/read-all
router.patch(
  '/portal-activity/read-all',
  authenticate,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const updated = await markAllActivityRead();
      sendData(res, portalActivityContract.markAllActivityRead.response, { updated });
    } catch (error) {
      log.error('Error marking all portal activity read:', error);
      ErrorResponses.internalError(res, 'Failed to mark all activity read', error as Error);
    }
  }
);

export default router;
