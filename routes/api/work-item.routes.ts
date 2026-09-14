/**
 * Work ITEM (treatment-detail) API Routes
 *
 * Split out of work.routes.ts (S2/C5). One work item is one line of treatment on a
 * work — a filling, a canal, an implant, a crown — with its own teeth. These four
 * endpoints are the CRUD over `work_items`; they touch no `works` row directly.
 *
 * Mounted at the same `/api` prefix as work.routes.ts, immediately after it, so the
 * registration order of the route table is unchanged by the split.
 */

import { Router, type Request, type Response } from 'express';
import {
  getWorkDetailsList,
  addWorkDetail,
  updateWorkDetail,
  deleteWorkDetail,
} from '../../services/database/queries/work-item-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { FINANCE_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { sendData, sendError, ErrorResponses } from '../../utils/error-response.js';
import * as workContract from '../../shared/contracts/work.contract.js';
import { log } from '../../utils/logger.js';

type WorkQueryParams = workContract.WorkQueryParams;

const router = Router();


// ============================================================================
// WORK DETAILS API ENDPOINTS
// ============================================================================

/**
 * Get work details list for a specific work
 */
router.get(
  '/getworkdetailslist',
  validate({ query: workContract.workQuery }),
  async (
    req: Request<unknown, unknown, unknown, WorkQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.query;
      if (!workId) {
        log.warn('Get work details list request missing workId');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      const workDetailsList = await getWorkDetailsList(parseInt(workId, 10));
      sendData(res, workContract.getWorkDetailsList.response, workDetailsList);
    } catch (error) {
      log.error('Error fetching work details list:', error);
      sendError(res, 500, 'Failed to fetch work details list', error as Error);
    }
  }
);

/**
 * Add new work detail (work item)
 */
router.post(
  '/addworkdetail',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ body: workContract.addWorkDetail.body }),
  async (
    req: Request<unknown, unknown, workContract.AddWorkDetailBody>,
    res: Response
  ): Promise<void> => {
    try {
      const workDetailData = req.body;

      // work_id validated + coerced to a positive int by workContract.addWorkDetail.body.

      // Validate canals_no if provided
      if (
        workDetailData.canals_no &&
        isNaN(parseInt(String(workDetailData.canals_no), 10))
      ) {
        log.warn('Add work detail invalid canals_no', { canals_no: workDetailData.canals_no });
        ErrorResponses.badRequest(res, 'canals_no must be a valid number');
        return;
      }

      // Validate item_cost if provided
      if (
        workDetailData.item_cost &&
        isNaN(parseInt(String(workDetailData.item_cost), 10))
      ) {
        log.warn('Add work detail invalid item_cost', { item_cost: workDetailData.item_cost });
        ErrorResponses.badRequest(res, 'item_cost must be a valid number');
        return;
      }

      // Validate TeethIds if provided
      if (workDetailData.TeethIds && !Array.isArray(workDetailData.TeethIds)) {
        log.warn('Add work detail invalid TeethIds', { TeethIds: workDetailData.TeethIds });
        ErrorResponses.badRequest(
          res,
          'TeethIds must be an array of tooth IDs'
        );
        return;
      }

      // Create item data with required work_id (validated + coerced by the schema above).
      const itemData = {
        ...workDetailData,
        work_id: parseInt(String(workDetailData.work_id), 10)
      };

      const result = await addWorkDetail(itemData);
      sendData(
        res,
        workContract.addWorkDetail.response,
        { detailId: result?.id, itemId: result?.id },
        'Work item added successfully'
      );
    } catch (error) {
      log.error('Error adding work item:', error);
      sendError(res, 500, 'Failed to add work item', error as Error);
    }
  }
);

/**
 * Update existing work detail (work item)
 */
router.put(
  '/updateworkdetail',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ body: workContract.updateWorkDetail.body }),
  async (
    req: Request<unknown, unknown, workContract.UpdateWorkDetailBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { detailId, itemId, ...workDetailData } = req.body;
      const id = detailId ?? itemId; // Support both naming conventions (`??`: id 0 is not "absent")

      if (id === undefined) {
        log.warn('Update work detail missing detailId/itemId');
        ErrorResponses.missingParameter(res, 'detailId or itemId');
        return;
      }

      // Validate data types
      if (isNaN(parseInt(String(id), 10))) {
        log.warn('Update work detail invalid id', { detailId, itemId });
        ErrorResponses.badRequest(
          res,
          'detailId/itemId must be a valid number'
        );
        return;
      }

      // Validate canals_no if provided
      if (
        workDetailData.canals_no &&
        isNaN(parseInt(String(workDetailData.canals_no), 10))
      ) {
        log.warn('Update work detail invalid canals_no', { id, canals_no: workDetailData.canals_no });
        ErrorResponses.badRequest(res, 'canals_no must be a valid number');
        return;
      }

      // Validate item_cost if provided
      if (
        workDetailData.item_cost &&
        isNaN(parseInt(String(workDetailData.item_cost), 10))
      ) {
        log.warn('Update work detail invalid item_cost', { id, item_cost: workDetailData.item_cost });
        ErrorResponses.badRequest(res, 'item_cost must be a valid number');
        return;
      }

      // Validate TeethIds if provided
      if (workDetailData.TeethIds && !Array.isArray(workDetailData.TeethIds)) {
        log.warn('Update work detail invalid TeethIds', { id, TeethIds: workDetailData.TeethIds });
        ErrorResponses.badRequest(
          res,
          'TeethIds must be an array of tooth IDs'
        );
        return;
      }

      const result = await updateWorkDetail(parseInt(String(id), 10), workDetailData);
      sendData(res, workContract.updateWorkDetail.response, { rowsAffected: result.rowCount }, 'Work item updated successfully');
    } catch (error) {
      log.error('Error updating work item:', error);
      sendError(res, 500, 'Failed to update work item', error as Error);
    }
  }
);

/**
 * Delete work detail (work item)
 */
router.delete(
  '/deleteworkdetail',
  authenticate,
  authorize(FINANCE_ROLES),
  validate({ body: workContract.deleteWorkDetail.body }),
  async (
    req: Request<unknown, unknown, workContract.WorkDetailIdBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { detailId, itemId } = req.body;
      const id = detailId ?? itemId; // Support both naming conventions (`??`: id 0 is not "absent")

      if (id === undefined) {
        log.warn('Delete work detail missing detailId/itemId');
        ErrorResponses.missingParameter(res, 'detailId or itemId');
        return;
      }

      if (isNaN(parseInt(String(id), 10))) {
        log.warn('Delete work detail invalid id', { detailId, itemId });
        ErrorResponses.badRequest(
          res,
          'detailId/itemId must be a valid number'
        );
        return;
      }

      const result = await deleteWorkDetail(parseInt(String(id), 10));
      sendData(res, workContract.deleteWorkDetail.response, { rowsAffected: result.rowCount }, 'Work item deleted successfully');
    } catch (error) {
      log.error('Error deleting work item:', error);
      sendError(res, 500, 'Failed to delete work item', error as Error);
    }
  }
);


export default router;
