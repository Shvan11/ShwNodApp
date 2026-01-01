/**
 * Visit Routes
 *
 * This module handles all visit-related API endpoints including:
 * - Visit management (CRUD operations)
 * - Wire tracking (upper/lower wire management)
 * - Visit summaries and details
 * - Work-specific visit operations
 */

import { Router, type Request, type Response } from 'express';
import {
  getWires,
  getVisitsSummary,
  addVisit,
  updateVisit,
  deleteVisit,
  getVisitDetailsByID,
  getLatestWire,
  getVisitsByWorkId,
  getVisitById,
  addVisitByWorkId,
  updateVisitByWorkId,
  deleteVisitByWorkId,
  getLatestWiresByWorkId
} from '../../services/database/queries/visit-queries.js';
import { ErrorResponses } from '../../utils/error-response.js';
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

interface AddVisitBody {
  PID: string | number;
  visitDate: string;
  upperWireID?: number;
  lowerWireID?: number;
  others?: string;
  next?: string;
}

interface UpdateVisitBody {
  VID: string | number;
  visitDate: string;
  upperWireID?: number;
  lowerWireID?: number;
  others?: string;
  next?: string;
}

interface DeleteVisitBody {
  VID: string | number;
}

interface AddVisitByWorkBody {
  WorkID: number;
  VisitDate: string;
  UpperWireID?: number;
  LowerWireID?: number;
  Others?: string;
  Next?: string;
}

interface UpdateVisitByWorkBody {
  visitId: number;
  VisitDate: string;
  UpperWireID?: number;
  LowerWireID?: number;
  Others?: string;
  Next?: string;
}

interface DeleteVisitByWorkBody {
  visitId: number;
}

// ============================================================================
// Visit Summary Routes
// ============================================================================

/**
 * GET /visitsSummary
 * Get summary of all visits for a specific patient
 * Query params: PID (Patient ID)
 */
router.get(
  '/visitsSummary',
  async (
    req: Request<unknown, unknown, unknown, VisitQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { PID } = req.query;
      if (!PID) {
        ErrorResponses.missingParameter(res, 'PID');
        return;
      }

      const visitsSummary = await getVisitsSummary(parseInt(PID, 10));
      res.json(visitsSummary);
    } catch (error) {
      log.error('Error fetching visits summary:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch visits summary',
        error as Error
      );
    }
  }
);

/**
 * GET /getVisitDetailsByID
 * Get detailed information for a specific visit
 * Query params: VID (Visit ID)
 */
router.get(
  '/getVisitDetailsByID',
  async (
    req: Request<unknown, unknown, unknown, VisitQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { VID } = req.query;
      if (!VID) {
        ErrorResponses.missingParameter(res, 'VID');
        return;
      }

      const visitDetails = await getVisitDetailsByID(parseInt(VID, 10));
      res.json(visitDetails);
    } catch (error) {
      log.error('Error fetching visit details:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch visit details',
        error as Error
      );
    }
  }
);

// ============================================================================
// Wire Management Routes
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
      res.json(wires);
    } catch (error) {
      log.error('Error fetching wires:', error);
      ErrorResponses.internalError(res, 'Failed to fetch wires', error as Error);
    }
  }
);

/**
 * GET /getlatestwires
 * Get latest wires (upper and lower) for a specific work ID
 * Query params: workId
 */
router.get(
  '/getlatestwires',
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
      res.json(latestWires);
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

/**
 * GET /getLatestwire
 * Get latest wire for a specific patient
 * Query params: PID (Patient ID)
 */
router.get(
  '/getLatestwire',
  async (
    req: Request<unknown, unknown, unknown, VisitQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { PID } = req.query;
      if (!PID) {
        ErrorResponses.missingParameter(res, 'PID');
        return;
      }

      const latestWire = await getLatestWire(parseInt(PID, 10));
      res.json(latestWire);
    } catch (error) {
      log.error('Error fetching latest wire:', error);
      ErrorResponses.internalError(
        res,
        'Failed to fetch latest wire',
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
 * Get all visits for a specific work ID
 * Query params: workId
 */
router.get(
  '/getvisitsbywork',
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
      res.json(visits);
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
 * Get a single visit by ID
 * Query params: visitId
 */
router.get(
  '/getvisitbyid',
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
      const visit = await getVisitById(parseInt(visitId));
      if (!visit) {
        ErrorResponses.notFound(res, 'Visit');
        return;
      }
      res.json(visit);
    } catch (error) {
      log.error('Error fetching visit by ID:', error);
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
 * Body: visitData (must include WorkID and VisitDate)
 */
router.post(
  '/addvisitbywork',
  async (
    req: Request<unknown, unknown, AddVisitByWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      const visitData = req.body;
      if (!visitData.WorkID || !visitData.VisitDate) {
        ErrorResponses.badRequest(
          res,
          'Missing required fields: WorkID and VisitDate'
        );
        return;
      }
      // Convert string date to Date object for database query
      const visitDataWithDate = {
        ...visitData,
        VisitDate: new Date(visitData.VisitDate)
      };
      const result = await addVisitByWorkId(visitDataWithDate);
      res.json({ success: true, visitId: result?.ID });
    } catch (error) {
      log.error('Error adding visit:', error);
      ErrorResponses.internalError(res, 'Failed to add visit', error as Error);
    }
  }
);

/**
 * PUT /updatevisitbywork
 * Update a visit
 * Body: visitId, visitData (must include VisitDate)
 */
router.put(
  '/updatevisitbywork',
  async (
    req: Request<unknown, unknown, UpdateVisitByWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { visitId, ...visitData } = req.body;
      if (!visitId || !visitData.VisitDate) {
        ErrorResponses.badRequest(
          res,
          'Missing required fields: visitId and VisitDate'
        );
        return;
      }
      // Convert string date to Date object for database query
      const visitDataWithDate = {
        ...visitData,
        VisitDate: new Date(visitData.VisitDate)
      };
      await updateVisitByWorkId(visitId, visitDataWithDate);
      res.json({ success: true });
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
      res.json({ success: true });
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
