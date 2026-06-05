/**
 * Visit Routes
 *
 * This module handles all visit-related API endpoints including:
 * - Visit management (CRUD operations)
 * - wire tracking (upper/lower wire management)
 * - Visit summaries and details
 * - Work-specific visit operations
 */

import { Router, type Request, type Response } from 'express';
import {
  getWires,
  getVisitsByWorkId,
  getVisitById,
  addVisitByWorkId,
  updateVisitByWorkId,
  deleteVisitByWorkId,
  getLatestWiresByWorkId
} from '../../services/database/queries/visit-queries.js';
import { ErrorResponses, sendSuccess, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import * as visit from '../../shared/contracts/visit.contract.js';
import { log } from '../../utils/logger.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface VisitQueryParams {
  PID?: string;
  VID?: string;
  workId?: string;
  visitId?: string;
}

interface AddVisitByWorkBody {
  work_id: number;
  visit_date: string;
  upper_wire_id?: number;
  lower_wire_id?: number;
  others?: string;
  Next?: string;
}

interface UpdateVisitByWorkBody {
  visitId: number;
  visit_date: string;
  upper_wire_id?: number;
  lower_wire_id?: number;
  others?: string;
  Next?: string;
}

interface DeleteVisitByWorkBody {
  visitId: number;
}

// ============================================================================
// wire Management Routes
// ============================================================================

/**
 * GET /getWires
 * Get all available wire types
 */
router.get(
  '/getWires',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const wires = await getWires();
      sendData(res, visit.getWires.response, wires);
    } catch (error) {
      log.error('Error fetching wires:', error);
      ErrorResponses.internalError(res, 'Failed to fetch wires', error as Error);
    }
  }
);

/**
 * GET /getlatestwires
 * Get latest wires (upper and lower) for a specific work id
 * Query params: workId
 */
router.get(
  '/getlatestwires',
  validate({ query: visit.latestWires.query }),
  async (
    req: Request<unknown, unknown, unknown, VisitQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.query;
      if (!workId) {
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }
      const latestWires = await getLatestWiresByWorkId(parseInt(workId));
      sendData(res, visit.latestWires.response, latestWires);
    } catch (error) {
      log.error('Error fetching latest wires:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch latest wires',
        error as Error
      );
    }
  }
);

// ============================================================================
// Work-Based Visit Routes
// ============================================================================

/**
 * GET /getvisitsbywork
 * Get all visits for a specific work id
 * Query params: workId
 */
router.get(
  '/getvisitsbywork',
  validate({ query: visit.visitsByWork.query }),
  async (
    req: Request<unknown, unknown, unknown, VisitQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.query;
      if (!workId) {
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }
      const visits = await getVisitsByWorkId(parseInt(workId));
      sendData(res, visit.visitsByWork.response, visits);
    } catch (error) {
      log.error('Error fetching visits by work:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch visits',
        error as Error
      );
    }
  }
);

/**
 * GET /getvisitbyid
 * Get a single visit by id
 * Query params: visitId
 */
router.get(
  '/getvisitbyid',
  validate({ query: visit.visitById.query }),
  async (
    req: Request<unknown, unknown, unknown, VisitQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { visitId } = req.query;
      if (!visitId) {
        ErrorResponses.missingParameter(res, 'visitId');
        return;
      }
      // `visitRow` (not `visit`) to avoid shadowing the contract import.
      const visitRow = await getVisitById(parseInt(visitId));
      if (!visitRow) {
        ErrorResponses.notFound(res, 'Visit');
        return;
      }
      sendData(res, visit.visitById.response, visitRow);
    } catch (error) {
      log.error('Error fetching visit by id:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch visit',
        error as Error
      );
    }
  }
);

/**
 * POST /addvisitbywork
 * Add a new visit for a specific work
 * Body: visitData (must include work_id and visit_date)
 */
router.post(
  '/addvisitbywork',
  validate({ body: visit.addVisit.body }),
  async (
    req: Request<unknown, unknown, AddVisitByWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      const visitData = req.body;
      if (!visitData.work_id || !visitData.visit_date) {
        ErrorResponses.badRequest(
          res,
          'Missing required fields: work_id and visit_date'
        );
        return;
      }
      // Convert string date to Date object for database query
      const visitDataWithDate = {
        ...visitData,
        visit_date: new Date(visitData.visit_date)
      };
      const result = await addVisitByWorkId(visitDataWithDate);
      sendData(res, visit.addVisit.response, { visitId: result?.id });
    } catch (error) {
      log.error('Error adding visit:', error);
      ErrorResponses.internalError(res, 'Failed to add visit', error as Error);
    }
  }
);

/**
 * PUT /updatevisitbywork
 * Update a visit
 * Body: visitId, visitData (must include visit_date)
 */
router.put(
  '/updatevisitbywork',
  validate({ body: visit.updateVisit.body }),
  async (
    req: Request<unknown, unknown, UpdateVisitByWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { visitId, ...visitData } = req.body;
      if (!visitId || !visitData.visit_date) {
        ErrorResponses.badRequest(
          res,
          'Missing required fields: visitId and visit_date'
        );
        return;
      }
      // Convert string date to Date object for database query
      const visitDataWithDate = {
        ...visitData,
        visit_date: new Date(visitData.visit_date)
      };
      await updateVisitByWorkId(visitId, visitDataWithDate);
      sendSuccess(res, null);
    } catch (error) {
      log.error('Error updating visit:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update visit',
        error as Error
      );
    }
  }
);

/**
 * DELETE /deletevisitbywork
 * Delete a visit
 * Body: visitId
 */
router.delete(
  '/deletevisitbywork',
  validate({ body: visit.deleteVisit.body }),
  async (
    req: Request<unknown, unknown, DeleteVisitByWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { visitId } = req.body;
      if (!visitId) {
        ErrorResponses.badRequest(res, 'Missing required field: visitId');
        return;
      }
      await deleteVisitByWorkId(visitId);
      sendSuccess(res, null);
    } catch (error) {
      log.error('Error deleting visit:', error);
      ErrorResponses.internalError(
        res,
        'Failed to delete visit',
        error as Error
      );
    }
  }
);

export default router;
