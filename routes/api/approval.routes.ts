/**
 * Approval / Notice Routes
 *
 * Maker-checker approval queue for Front-Desk sensitive actions.
 *
 * Admin-only:
 *   GET  /api/approvals          — list rows by status (defaults to 'pending')
 *   GET  /api/approvals/history  — all non-pending rows (audit trail)
 *   POST /api/approvals/:id/approve
 *   POST /api/approvals/:id/reject
 *   POST /api/approvals/:id/acknowledge
 *
 * Any authenticated role (own rows only):
 *   GET  /api/approvals/mine
 */
import { Router, type Request, type Response } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { ADMIN_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { sendData, ErrorResponses } from '../../utils/error-response.js';
import * as approvalsContract from '../../shared/contracts/approvals.contract.js';
import {
  listApprovals,
  listHistory,
  listMine,
  approve,
  reject,
  acknowledge,
  approveAll,
  acknowledgeAll,
} from '../../services/approvals/approval-service.js';
import { log } from '../../utils/logger.js';

const router = Router();

// GET /api/approvals?status=pending — admin-only
router.get(
  '/approvals',
  authenticate,
  authorize(ADMIN_ROLES),
  validate({ query: approvalsContract.listApprovals.query }),
  async (
    req: Request<unknown, unknown, unknown, { status?: approvalsContract.ApprovalStatus }>,
    res: Response
  ): Promise<void> => {
    try {
      const rows = await listApprovals(req.query.status ?? 'pending');
      sendData(res, approvalsContract.listApprovals.response, rows);
    } catch (error) {
      log.error('Error listing approvals:', error);
      ErrorResponses.internalError(res, 'Failed to list approvals', error as Error);
    }
  }
);

// GET /api/approvals/history — admin-only
router.get(
  '/approvals/history',
  authenticate,
  authorize(ADMIN_ROLES),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const rows = await listHistory();
      sendData(res, approvalsContract.approvalsHistory.response, rows);
    } catch (error) {
      log.error('Error fetching approvals history:', error);
      ErrorResponses.internalError(res, 'Failed to fetch history', error as Error);
    }
  }
);

// GET /api/approvals/mine — any authenticated role
router.get(
  '/approvals/mine',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const username = req.session?.username ?? '';
      const rows = await listMine(username);
      sendData(res, approvalsContract.myApprovals.response, rows);
    } catch (error) {
      log.error('Error fetching own approvals:', error);
      ErrorResponses.internalError(res, 'Failed to fetch your approvals', error as Error);
    }
  }
);

// POST /api/approvals/approve-all — admin-only. Bulk-approve every pending hold.
router.post(
  '/approvals/approve-all',
  authenticate,
  authorize(ADMIN_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await approveAll(req);
      sendData(
        res,
        approvalsContract.approveAll.response,
        result,
        `Approved ${result.approved} of ${result.total}`
      );
    } catch (error) {
      log.error('Error approving all requests:', error);
      ErrorResponses.internalError(res, 'Failed to approve all requests', error as Error);
    }
  }
);

// POST /api/approvals/acknowledge-all — admin-only. Clear every pending notice.
router.post(
  '/approvals/acknowledge-all',
  authenticate,
  authorize(ADMIN_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await acknowledgeAll(req);
      sendData(
        res,
        approvalsContract.acknowledgeAll.response,
        result,
        `Cleared ${result.cleared} notice(s)`
      );
    } catch (error) {
      log.error('Error acknowledging all notices:', error);
      ErrorResponses.internalError(res, 'Failed to clear notices', error as Error);
    }
  }
);

// POST /api/approvals/:id/approve — admin-only
router.post(
  '/approvals/:id/approve',
  authenticate,
  authorize(ADMIN_ROLES),
  validate({ params: approvalsContract.approveRequest.params }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const requestId = parseInt(req.params.id);
      const result = await approve(requestId, req);

      if (result.status === 'conflict') {
        ErrorResponses.conflict(res, 'This approval was already processed');
        return;
      }
      if (result.status === 'missing') {
        sendData(res, approvalsContract.approveRequest.response, result.row);
        return;
      }
      if (result.status === 'stale') {
        sendData(res, approvalsContract.approveRequest.response, result.row);
        return;
      }
      sendData(res, approvalsContract.approveRequest.response, result.row, 'Approved and applied');
    } catch (error) {
      log.error('Error approving request:', error);
      ErrorResponses.internalError(res, 'Failed to approve request', error as Error);
    }
  }
);

// POST /api/approvals/:id/reject — admin-only
router.post(
  '/approvals/:id/reject',
  authenticate,
  authorize(ADMIN_ROLES),
  validate({ params: approvalsContract.rejectRequest.params, body: approvalsContract.rejectRequest.body }),
  async (
    req: Request<{ id: string }, unknown, approvalsContract.RejectRequestBody>,
    res: Response
  ): Promise<void> => {
    try {
      const requestId = parseInt(req.params.id);
      const row = await reject(requestId, req.body.note, req);
      if (!row) {
        ErrorResponses.notFound(res, 'Approval request');
        return;
      }
      sendData(res, approvalsContract.rejectRequest.response, row, 'Request rejected');
    } catch (error) {
      log.error('Error rejecting request:', error);
      ErrorResponses.internalError(res, 'Failed to reject request', error as Error);
    }
  }
);

// POST /api/approvals/:id/acknowledge — admin-only
router.post(
  '/approvals/:id/acknowledge',
  authenticate,
  authorize(ADMIN_ROLES),
  validate({ params: approvalsContract.acknowledgeRequest.params }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const requestId = parseInt(req.params.id);
      const row = await acknowledge(requestId, req);
      if (!row) {
        ErrorResponses.notFound(res, 'Approval request');
        return;
      }
      sendData(res, approvalsContract.acknowledgeRequest.response, row, 'Notice acknowledged');
    } catch (error) {
      log.error('Error acknowledging notice:', error);
      ErrorResponses.internalError(res, 'Failed to acknowledge notice', error as Error);
    }
  }
);

export default router;
