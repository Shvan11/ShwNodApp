/**
 * Lab case tracker routes (`/api/lab-cases*`).
 *
 * Reads ride the global `/api` `authenticate` gate only (like slideshow.routes.ts);
 * mutations add `authorize(CLINICAL_ROLES)`, hard delete adds `authorize(ADMIN_ROLES)`
 * (the approval.routes.ts pattern). Service errors carry a message-prefix that this
 * router translates to the right HTTP status — see lab-case-service.ts's header comment.
 */
import { Router, type Request, type Response } from 'express';
import { validate } from '../../middleware/validate.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES, ADMIN_ROLES } from '../../shared/auth/roles.js';
import { sendData, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import * as labCaseContract from '../../shared/contracts/lab-case.contract.js';
import {
  listLabCases,
  getLabCaseBoardRow,
  listLabCaseEvents,
  updateLabCaseMeta,
  deleteLabCase,
} from '../../services/database/queries/lab-case-queries.js';
import {
  createLabCase,
  advanceLabCase,
  remakeLabCase,
  holdLabCase,
  resumeLabCase,
  cancelLabCase,
} from '../../services/lab-cases/lab-case-service.js';

const router = Router();

/** Translates the service's message-prefix convention into an HTTP response. */
function handleServiceError(res: Response, error: unknown, fallback: string): void {
  const message = (error as Error)?.message ?? '';
  if (message.includes('[INVALID_STATE_TRANSITION]')) {
    ErrorResponses.badRequest(res, message, { code: 'INVALID_STATE_TRANSITION' });
    return;
  }
  if (message.includes('[CONFLICT]')) {
    ErrorResponses.conflict(res, message.replace('[CONFLICT] ', ''));
    return;
  }
  if (message.includes('[NOT_FOUND]')) {
    ErrorResponses.notFound(res, message.replace('[NOT_FOUND] ', ''));
    return;
  }
  log.error(fallback, error);
  ErrorResponses.internalError(res, fallback, error as Error);
}

// GET /api/lab-cases?status=&labId=&overdue=&q=&from=&to= — board/list.
router.get(
  '/lab-cases',
  validate({ query: labCaseContract.listLabCases.query }),
  async (
    req: Request<unknown, unknown, unknown, labCaseContract.ListLabCasesQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const rows = await listLabCases(req.query);
      sendData(res, labCaseContract.listLabCases.response, rows);
    } catch (error) {
      log.error('Error listing lab cases:', error);
      ErrorResponses.internalError(res, 'Failed to list lab cases', error as Error);
    }
  }
);

// GET /api/lab-cases/:id — one case + its event timeline.
router.get(
  '/lab-cases/:id',
  validate({ params: labCaseContract.getLabCase.params }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      const caseRow = await getLabCaseBoardRow(id);
      if (!caseRow) {
        ErrorResponses.notFound(res, 'Lab case');
        return;
      }
      const events = await listLabCaseEvents(id);
      sendData(res, labCaseContract.getLabCase.response, { case: caseRow, events });
    } catch (error) {
      log.error('Error fetching lab case:', error);
      ErrorResponses.internalError(res, 'Failed to fetch lab case', error as Error);
    }
  }
);

// POST /api/lab-cases — Start Lab Flow (or reactivate a cancelled case).
router.post(
  '/lab-cases',
  authorize(CLINICAL_ROLES),
  validate({ body: labCaseContract.createLabCase.body }),
  async (
    req: Request<unknown, unknown, labCaseContract.CreateLabCaseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const row = await createLabCase(req.body, req);
      sendData(res, labCaseContract.createLabCase.response, row, 'Lab case started');
    } catch (error) {
      handleServiceError(res, error, 'Failed to start lab case');
    }
  }
);

// POST /api/lab-cases/:id/advance — guarded stage transition.
router.post(
  '/lab-cases/:id/advance',
  authorize(CLINICAL_ROLES),
  validate({ params: labCaseContract.advanceLabCase.params, body: labCaseContract.advanceLabCase.body }),
  async (
    req: Request<{ id: string }, unknown, labCaseContract.AdvanceLabCaseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const row = await advanceLabCase(parseInt(req.params.id, 10), req.body, req);
      sendData(res, labCaseContract.advanceLabCase.response, row, 'Case advanced');
    } catch (error) {
      handleServiceError(res, error, 'Failed to advance lab case');
    }
  }
);

// POST /api/lab-cases/:id/remake — refuse/remake.
router.post(
  '/lab-cases/:id/remake',
  authorize(CLINICAL_ROLES),
  validate({ params: labCaseContract.remakeLabCase.params, body: labCaseContract.remakeLabCase.body }),
  async (
    req: Request<{ id: string }, unknown, labCaseContract.RemakeLabCaseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const row = await remakeLabCase(parseInt(req.params.id, 10), req.body, req);
      sendData(res, labCaseContract.remakeLabCase.response, row, 'Case sent back for remake');
    } catch (error) {
      handleServiceError(res, error, 'Failed to remake lab case');
    }
  }
);

// POST /api/lab-cases/:id/hold
router.post(
  '/lab-cases/:id/hold',
  authorize(CLINICAL_ROLES),
  validate({ params: labCaseContract.holdLabCase.params, body: labCaseContract.holdLabCase.body }),
  async (
    req: Request<{ id: string }, unknown, labCaseContract.HoldLabCaseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const row = await holdLabCase(parseInt(req.params.id, 10), req.body, req);
      sendData(res, labCaseContract.holdLabCase.response, row, 'Case put on hold');
    } catch (error) {
      handleServiceError(res, error, 'Failed to hold lab case');
    }
  }
);

// POST /api/lab-cases/:id/resume
router.post(
  '/lab-cases/:id/resume',
  authorize(CLINICAL_ROLES),
  validate({ params: labCaseContract.resumeLabCase.params, body: labCaseContract.resumeLabCase.body }),
  async (
    req: Request<{ id: string }, unknown, labCaseContract.ResumeLabCaseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const row = await resumeLabCase(parseInt(req.params.id, 10), req.body, req);
      sendData(res, labCaseContract.resumeLabCase.response, row, 'Case resumed');
    } catch (error) {
      handleServiceError(res, error, 'Failed to resume lab case');
    }
  }
);

// PATCH /api/lab-cases/:id — edit metadata (lab/due date/rush/note).
router.patch(
  '/lab-cases/:id',
  authorize(CLINICAL_ROLES),
  validate({ params: labCaseContract.updateLabCase.params, body: labCaseContract.updateLabCase.body }),
  async (
    req: Request<{ id: string }, unknown, labCaseContract.UpdateLabCaseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const row = await updateLabCaseMeta(parseInt(req.params.id, 10), req.body);
      if (!row) {
        ErrorResponses.notFound(res, 'Lab case');
        return;
      }
      sendData(res, labCaseContract.updateLabCase.response, row, 'Case updated');
    } catch (error) {
      log.error('Error updating lab case:', error);
      ErrorResponses.internalError(res, 'Failed to update lab case', error as Error);
    }
  }
);

// POST /api/lab-cases/:id/cancel — soft close.
router.post(
  '/lab-cases/:id/cancel',
  authorize(CLINICAL_ROLES),
  validate({ params: labCaseContract.cancelLabCase.params, body: labCaseContract.cancelLabCase.body }),
  async (
    req: Request<{ id: string }, unknown, labCaseContract.CancelLabCaseBody>,
    res: Response
  ): Promise<void> => {
    try {
      const row = await cancelLabCase(parseInt(req.params.id, 10), req.body, req);
      sendData(res, labCaseContract.cancelLabCase.response, row, 'Case cancelled');
    } catch (error) {
      handleServiceError(res, error, 'Failed to cancel lab case');
    }
  }
);

// DELETE /api/lab-cases/:id — admin-only hard delete (mistakes).
router.delete(
  '/lab-cases/:id',
  authorize(ADMIN_ROLES),
  validate({ params: labCaseContract.deleteLabCase.params }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const row = await deleteLabCase(parseInt(req.params.id, 10));
      if (!row) {
        ErrorResponses.notFound(res, 'Lab case');
        return;
      }
      sendData(res, labCaseContract.deleteLabCase.response, row, 'Case deleted');
    } catch (error) {
      log.error('Error deleting lab case:', error);
      ErrorResponses.internalError(res, 'Failed to delete lab case', error as Error);
    }
  }
);

export default router;
