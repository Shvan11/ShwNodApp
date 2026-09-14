/**
 * Work/Treatment Management API Routes
 *
 * This module handles all work (treatment) related operations including:
 * - Work CRUD operations (create, read, update, delete)
 * - Work details management (treatment details)
 * - diagnosis and treatment planning (comprehensive orthodontic diagnosis)
 * - Work types and keywords lookup
 * - Active work tracking
 * - Work completion/finishing
 * - Work with invoice creation (finished work with full payment)
 *
 * Authentication & Authorization:
 * - Some routes are protected with authenticate/authorize middleware
 * - Time-based restrictions for secretaries on money fields and deletions
 */

import { Router, type Request, type Response } from 'express';
import { isUniqueViolation } from '../../utils/pg-errors.js';
import {
  getWorksByPatient,
  toWorkWire,
  getWorkDetails,
  finishWork,
  discontinueWork,
  reactivateWork,
  getActiveWork,
} from '../../services/database/queries/work-queries.js';
// tooth-number catalogue — the `/teeth` dropdown feed lives here, next to the work
// form that reads it; the work-item CRUD that consumes the ids is in work-item.routes.ts.
import { getToothNumbers } from '../../services/database/queries/work-item-queries.js';
import {
  getWorkTypes,
  getWorkKeywords,
} from '../../services/database/queries/work-lookup-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { FINANCE_ROLES, CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import {
  requireRecordAge,
  getWorkCreationDate
} from '../../middleware/time-based-auth.js';
import { sendData, sendError, ErrorResponses } from '../../utils/error-response.js';
import * as workContract from '../../shared/contracts/work.contract.js';
import { enqueueApproval, recordNotice, resolveApprovalPersonId } from '../../services/approvals/approval-service.js';
import { log } from '../../utils/logger.js';
import {
  validateAndCreateWork,
  validateAndCreateWorkWithInvoice,
  validateAndDeleteWork,
  validateAndUpdateWork,
  WorkUpdateError,
  WorkValidationError
} from '../../services/business/WorkService.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type WorkQueryParams = workContract.WorkQueryParams;

// Request schemas live in shared/contracts/work.contract.ts (imported above as
// `workContract`) — shared with the client. Every write body is now FULLY
// ENUMERATED there as a strict `z.object` and is the `z.infer` SSoT; the handlers
// below type from `workContract.*Body` (the hand-written interfaces were deleted).
// `addWork`/`addWorkWithInvoice` mirror WorkService.WorkCreateData (a strict
// known-key object stays assignable to its value-union index signature).
type WorkStatusBody = workContract.WorkStatusBody;
type DeleteWorkBody = workContract.DeleteWorkBody;

// ============================================================================
// WORK MANAGEMENT API ENDPOINTS
// ============================================================================

/**
 * Get work details (for visit page header)
 */
router.get(
  '/getworkdetails',
  validate({ query: workContract.workQuery }),
  async (
    req: Request<unknown, unknown, unknown, WorkQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.query;
      if (!workId) {
        log.warn('Work details request missing workId parameter');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }
      const work = await getWorkDetails(parseInt(workId, 10));
      if (!work) {
        log.warn('Work not found', { workId });
        ErrorResponses.notFound(res, 'Work');
        return;
      }
      sendData(res, workContract.getWorkDetails.response, toWorkWire(work));
    } catch (error) {
      log.error('Error fetching work details:', error);
      sendError(res, 500, 'Failed to fetch work details', error as Error);
    }
  }
);

/**
 * Get all works for a patient
 */
router.get(
  '/getworks',
  async (
    req: Request<unknown, unknown, unknown, WorkQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { code: personId } = req.query;
      if (!personId) {
        log.warn('Get works request missing person_id parameter');
        ErrorResponses.missingParameter(res, 'code (person_id)');
        return;
      }

      const works = await getWorksByPatient(parseInt(personId, 10));
      sendData(res, workContract.getWorks.response, works.map(toWorkWire));
    } catch (error) {
      log.error('Error fetching works:', error);
      sendError(res, 500, 'Failed to fetch works', error as Error);
    }
  }
);

/**
 * Add new work
 */
router.post(
  '/addwork',
  authenticate,
  authorize(CLINICAL_ROLES),
  validate({ body: workContract.addWork.body }),
  async (
    req: Request<unknown, unknown, workContract.AddWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      // Delegate to service layer for validation and creation
      const result = await validateAndCreateWork(req.body, req.session?.userRole);

      sendData(res, workContract.addWork.response, { workId: result.work_id }, 'Work added successfully');
    } catch (error) {
      // Handle validation errors from service layer (expected business-rule
      // rejections — log at warn, not error, and without a stack trace).
      if (error instanceof WorkValidationError) {
        log.warn('Work creation rejected by validation', {
          code: error.code,
          personId: req.body?.person_id
        });
        if (error.code === 'DUPLICATE_ACTIVE_WORK') {
          ErrorResponses.conflict(
            res,
            'Patient already has an active work',
            error.details
          );
          return;
        }
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }

      log.error('Error adding work:', error);
      sendError(res, 500, 'Failed to add work', error as Error);
    }
  }
);

/**
 * Add work with invoice (finished work with full payment)
 */
router.post(
  '/addWorkWithInvoice',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ body: workContract.addWorkWithInvoice.body }),
  async (
    req: Request<unknown, unknown, workContract.AddWorkWithInvoiceBody>,
    res: Response
  ): Promise<void> => {
    try {
      // Delegate to service layer for validation and creation
      const result = await validateAndCreateWorkWithInvoice(req.body);

      sendData(
        res,
        workContract.addWorkWithInvoice.response,
        { workId: result.workId, invoiceId: result.invoiceId },
        'Work and invoice created successfully'
      );
    } catch (error) {
      // Handle validation errors from service layer (expected business-rule
      // rejections — log at warn, not error, and without a stack trace).
      if (error instanceof WorkValidationError) {
        log.warn('Work-with-invoice creation rejected by validation', {
          code: error.code,
          personId: req.body?.person_id
        });
        if (error.code === 'DUPLICATE_ACTIVE_WORK') {
          ErrorResponses.conflict(
            res,
            'Patient already has an active work',
            error.details
          );
          return;
        }
        ErrorResponses.badRequest(res, error.message, {
          code: error.code,
          ...error.details
        });
        return;
      }

      log.error('Error adding work with invoice:', error);
      sendError(res, 500, 'Failed to add work with invoice', error as Error);
    }
  }
);

/**
 * Update existing work - Protected: Secretary cannot edit money fields for old works
 */
router.put(
  '/updatework',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ body: workContract.updateWork.body }),
  async (req: Request<unknown, unknown, workContract.UpdateWorkBody>, res: Response): Promise<void> => {
    try {
      // workId + dr_id validated and coerced to positive ints by the schema;
      // all other work fields pass through untouched (loose schema). All update
      // rules (dates, status, financial/discount permissions, total-vs-paid guard)
      // live in WorkService.validateAndUpdateWork — this handler only maps outcomes.
      const { workId, ...workData } = req.body;

      const result = await validateAndUpdateWork({
        workId,
        userRole: req.session?.userRole,
        workData
      });

      // Notify tier: only when a money field actually CHANGED (computed in the
      // service against the current row) and the caller is non-admin — write an
      // informational notice. recordNotice no-ops for admin callers.
      if (result.moneyChanged) {
        await recordNotice('work.update', req.body as Record<string, unknown>, req);
      }
      sendData(res, workContract.updateWork.response, { outcome: 'applied', rowsAffected: result.rowsAffected }, 'Work updated successfully');
    } catch (error) {
      if (error instanceof WorkUpdateError) {
        const details = error.details ?? null;
        switch (error.kind) {
          case 'notFound':
            // For notFound the error message is the resource noun; notFound appends " not found".
            ErrorResponses.notFound(res, error.message, details);
            return;
          case 'conflict':
            ErrorResponses.conflict(res, error.message, details);
            return;
          case 'forbidden': {
            // A Front-Desk user tried to edit discount or old-record financial fields.
            // Divert to the approval queue instead of returning 403.
            const actionType = (error.details?.restrictedFields as string[] | undefined)
              ?.some(f => f === 'discount' || f === 'discount_date')
              ? 'work.discount' as const
              : 'work.update' as const;
            const { requestId } = await enqueueApproval(actionType, req.body as Record<string, unknown>, req);
            sendData(res, workContract.updateWork.response, {
              outcome: 'pending',
              requestId,
              message: 'Submitted for admin approval',
            });
            return;
          }
          case 'badRequest':
            ErrorResponses.badRequest(res, error.message, details);
            return;
        }
      }
      log.error('Error updating work:', error);
      sendError(res, 500, 'Failed to update work', error as Error);
    }
  }
);

/**
 * Finish/Complete work
 */
router.post(
  '/finishwork',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ body: workContract.finishWork.body }),
  async (
    req: Request<unknown, unknown, WorkStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.body;
      const result = await finishWork(workId);
      sendData(res, workContract.finishWork.response, { rowsAffected: result.rowCount }, 'Work completed successfully');
    } catch (error) {
      log.error('Error finishing work:', error);
      sendError(res, 500, 'Failed to finish work', error as Error);
    }
  }
);

/**
 * Discontinue work (patient abandoned treatment)
 */
router.post(
  '/discontinuework',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ body: workContract.discontinueWork.body }),
  async (
    req: Request<unknown, unknown, WorkStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.body;
      const result = await discontinueWork(workId);
      sendData(res, workContract.discontinueWork.response, { rowsAffected: result.rowCount }, 'Work discontinued successfully');
    } catch (error) {
      log.error('Error discontinuing work:', error);
      sendError(res, 500, 'Failed to discontinue work', error as Error);
    }
  }
);

/**
 * Reactivate work (change from discontinued/finished back to active)
 */
router.post(
  '/reactivatework',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ body: workContract.reactivateWork.body }),
  async (
    req: Request<unknown, unknown, WorkStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId, personId } = req.body;

      // Check if patient already has an active work
      if (personId) {
        const activeWork = await getActiveWork(personId);
        if (activeWork && activeWork.work_id !== workId) {
          ErrorResponses.conflict(
            res,
            'Patient already has an active work. Please finish or discontinue it first.',
            {
              existingWorkId: activeWork.work_id,
              existingWorkType: activeWork.type_name
            }
          );
          return;
        }
      }

      const result = await reactivateWork(workId);
      sendData(res, workContract.reactivateWork.response, { rowsAffected: result.rowCount }, 'Work reactivated successfully');
    } catch (error) {
      // Reactivating sets status=1, which can collide with the patient's existing
      // active work (partial unique index unq_tblwork_active → pg SQLSTATE 23505).
      if (isUniqueViolation(error, 'unq_tblwork_active')) {
        ErrorResponses.conflict(
          res,
          'Cannot reactivate: Patient already has an active work'
        );
        return;
      }
      log.error('Error reactivating work:', error);
      sendError(res, 500, 'Failed to reactivate work', error as Error);
    }
  }
);

/**
 * Delete work - Protected: Secretary can only delete works created today
 */
router.delete(
  '/deletework',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ body: workContract.deleteWork.body }),
  requireRecordAge({
    resourceType: 'work',
    operation: 'delete',
    getRecordDate: getWorkCreationDate,
    enqueueIfRestricted: async (req, res) => {
      const { requestId } = await enqueueApproval('work.delete', req.body as Record<string, unknown>, req);
      sendData(res, workContract.deleteWork.response, {
        outcome: 'pending',
        requestId,
        message: 'Submitted for admin approval',
      });
    },
  }),
  async (
    req: Request<unknown, unknown, DeleteWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.body;
      const workIdNum = parseInt(String(workId), 10);

      // Resolve the patient BEFORE deleting — the notice fires post-delete, when
      // the work row (and its person_id) is already gone.
      const personId = await resolveApprovalPersonId('work.delete', workIdNum);

      // workId validated + coerced to a positive int by workContract.deleteWork.body.
      const result = await validateAndDeleteWork(workIdNum);

      // validateAndDeleteWork only returns on the applied path (a blocked or missing
      // work throws), so rowCount is the real deleted-row count — 1.
      // Notify tier: same-day admin-visible FYI; recordNotice no-ops for admin callers.
      await recordNotice('work.delete', { workId: workIdNum, person_id: personId }, req);
      sendData(res, workContract.deleteWork.response, { outcome: 'applied', rowsAffected: result.rowCount ?? 0 }, 'Work deleted successfully');
    } catch (error) {
      // Handle validation errors from service layer (expected business-rule
      // rejections — log at warn, not error, and without a stack trace).
      if (error instanceof WorkValidationError) {
        log.warn('Work deletion rejected by validation', {
          code: error.code,
          workId: req.body?.workId
        });
        // A bogus/already-deleted work id is a 404, not a business-rule conflict.
        // notFound takes the resource NOUN — it appends " not found".
        if (error.code === 'WORK_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Work', error.details);
          return;
        }
        ErrorResponses.conflict(res, error.message, error.details);
        return;
      }

      log.error('Error deleting work:', error);
      sendError(res, 500, 'Failed to delete work', error as Error);
    }
  }
);

/**
 * Get work types for dropdown
 */
router.get(
  '/getworktypes',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const workTypes = await getWorkTypes();
      sendData(res, workContract.getWorkTypes.response, workTypes);
    } catch (error) {
      log.error('Error fetching work types:', error);
      sendError(res, 500, 'Failed to fetch work types', error as Error);
    }
  }
);

/**
 * Get work keywords for dropdown
 */
router.get(
  '/getworkkeywords',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const keywords = await getWorkKeywords();
      sendData(res, workContract.getWorkKeywords.response, keywords);
    } catch (error) {
      log.error('Error fetching work keywords:', error);
      sendError(res, 500, 'Failed to fetch work keywords', error as Error);
    }
  }
);

/**
 * Get tooth numbers for dropdown/selection
 */
router.get(
  '/teeth',
  async (
    req: Request<unknown, unknown, unknown, WorkQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { permanent, deciduous } = req.query;
      const includePermanent = permanent !== 'false';
      const includeDeciduous = deciduous !== 'false';

      const teeth = await getToothNumbers(includePermanent, includeDeciduous);
      sendData(res, workContract.teeth.response, { teeth, count: teeth.length });
    } catch (error) {
      log.error('Error fetching tooth numbers:', error);
      sendError(res, 500, 'Failed to fetch tooth numbers', error as Error);
    }
  }
);

export default router;
