/**
 * Announcement routes — staff-side management of doctor announcements
 * (`doctor_announcements`; the aligner portal reads them from the Supabase
 * mirror under RLS).
 *
 *   GET    /api/announcements              — list (?includeExpired=true)
 *   POST   /api/announcements              — compose (targeted or broadcast)
 *   PUT    /api/announcements/:id          — edit
 *   DELETE /api/announcements/:id          — delete (+ receipts via FK CASCADE)
 *   GET    /api/announcements/:id/receipts — who has read/dismissed it
 *
 * See shared/contracts/announcement.contract.ts.
 */
import { Router, type Request, type Response } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { sendData, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import * as announcementContract from '../../shared/contracts/announcement.contract.js';
import {
  listAnnouncements,
  getAnnouncementById,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getAnnouncementReceipts,
  type AnnouncementInput,
} from '../../services/database/queries/announcement-queries.js';

const router = Router();

// Contract body → normalized query input ('' → null/broadcast, defaults filled).
function toInput(body: announcementContract.CreateAnnouncementBody): AnnouncementInput {
  return {
    title: body.title,
    message: body.message,
    announcementType: body.announcementType ?? 'info',
    targetDoctorId: body.targetDoctorId === '' || body.targetDoctorId == null ? null : body.targetDoctorId,
    isDismissible: body.isDismissible ?? true,
    linkUrl: body.linkUrl?.trim() || null,
    linkText: body.linkText?.trim() || null,
    expiresAt: body.expiresAt || null,
  };
}

// GET /api/announcements?includeExpired=true
router.get(
  '/announcements',
  authenticate,
  validate({ query: announcementContract.listAnnouncements.query }),
  async (
    req: Request<unknown, unknown, unknown, announcementContract.ListAnnouncementsQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const rows = await listAnnouncements(req.query.includeExpired === 'true');
      sendData(res, announcementContract.listAnnouncements.response, rows);
    } catch (error) {
      log.error('Error listing announcements:', error);
      ErrorResponses.internalError(res, 'Failed to list announcements', error as Error);
    }
  }
);

// POST /api/announcements
router.post(
  '/announcements',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ body: announcementContract.createAnnouncement.body }),
  async (
    req: Request<Record<string, never>, unknown, announcementContract.CreateAnnouncementBody>,
    res: Response
  ): Promise<void> => {
    try {
      const created = await createAnnouncement(toInput(req.body), req.session?.username ?? 'staff');
      sendData(res, announcementContract.createAnnouncement.response, created, null, 201);
    } catch (error) {
      log.error('Error creating announcement:', error);
      ErrorResponses.internalError(res, 'Failed to create announcement', error as Error);
    }
  }
);

// PUT /api/announcements/:id
router.put(
  '/announcements/:id',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({
    params: announcementContract.updateAnnouncement.params,
    body: announcementContract.updateAnnouncement.body,
  }),
  async (
    req: Request<{ id: string }, unknown, announcementContract.UpdateAnnouncementBody>,
    res: Response
  ): Promise<void> => {
    try {
      const updated = await updateAnnouncement(parseInt(req.params.id, 10), toInput(req.body));
      if (!updated) {
        ErrorResponses.notFound(res, 'Announcement not found');
        return;
      }
      sendData(res, announcementContract.updateAnnouncement.response, updated);
    } catch (error) {
      log.error('Error updating announcement:', error);
      ErrorResponses.internalError(res, 'Failed to update announcement', error as Error);
    }
  }
);

// DELETE /api/announcements/:id
router.delete(
  '/announcements/:id',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ params: announcementContract.deleteAnnouncement.params }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      const deleted = await deleteAnnouncement(id);
      if (!deleted) {
        ErrorResponses.notFound(res, 'Announcement not found');
        return;
      }
      sendData(res, announcementContract.deleteAnnouncement.response, { announcement_id: id });
    } catch (error) {
      log.error('Error deleting announcement:', error);
      ErrorResponses.internalError(res, 'Failed to delete announcement', error as Error);
    }
  }
);

// GET /api/announcements/:id/receipts
router.get(
  '/announcements/:id/receipts',
  authenticate,
  validate({ params: announcementContract.announcementReceipts.params }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!(await getAnnouncementById(id))) {
        ErrorResponses.notFound(res, 'Announcement not found');
        return;
      }
      const receipts = await getAnnouncementReceipts(id);
      sendData(res, announcementContract.announcementReceipts.response, receipts);
    } catch (error) {
      log.error('Error fetching announcement receipts:', error);
      ErrorResponses.internalError(res, 'Failed to fetch receipts', error as Error);
    }
  }
);

export default router;
