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
import { authenticate, authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import * as visit from '../../shared/contracts/visit.contract.js';
import { log } from '../../utils/logger.js';
import { isCheckViolation, isUniqueViolation } from '../../utils/pg-errors.js';

const router = Router();

/**
 * A visit's photo flags roll up into its WORK (visit-queries.ts: Initial Photo →
 * i_photo_date, Final Photo → finished + f_photo_date, Appliance Removed →
 * debond_date; un-ticking or deleting reverses them). When that roll-up breaks
 * a works constraint the whole visit write rolls back — and used to surface as a
 * generic "Failed to add/update visit", so the form could not say why. These are
 * the two states a user can actually cause; answer them as 409s the form shows.
 */
function visitRollupConflict(error: unknown): string | null {
  // One Initial-Photo and one Final-Photo visit per work (partial unique indexes
  // `photo_index` / `photof_index`). Reachable from the UI: finish a work through a
  // Final-Photo visit, Reactivate it on the Works page, then tick Final Photo on a
  // later visit.
  if (isUniqueViolation(error, 'photof_index')) {
    return 'This treatment already has a Final Photo visit. Untick Final Photo here, or edit that visit instead.';
  }
  if (isUniqueViolation(error, 'photo_index')) {
    return 'This treatment already has an Initial Photo visit. Untick Initial Photo here, or edit that visit instead.';
  }
  if (isUniqueViolation(error, 'unq_tblwork_active')) {
    return 'This patient already has another active treatment, so this one cannot be reopened. Finish or discontinue the other treatment first.';
  }
  if (
    isCheckViolation(error, 'ck_works')
    || isCheckViolation(error, 'ck_works_deb')
    || isCheckViolation(error, 'ck_works_debiph')
  ) {
    return "These photo dates conflict with the treatment's dates: the initial photo must come before both the final photo and appliance removal (so the two can't share a visit), and appliance removal can't come after the final photo.";
  }
  return null;
}

// Every visit/wire route is clinical (visit CRUD, wire tracking), but the
// gate is attached PER ROUTE, never via a pathless router.use(): this router
// is mounted at the /api root (routes/api/index.ts), so a router-level gate
// would also run for every /api/* request merely passing through to a
// later-mounted router — it once 403'd the entire API for a session carrying
// a stale role.
const clinicalOnly = [authenticate, authorize(CLINICAL_ROLES)];

// ============================================================================
// wire Management Routes
// ============================================================================

/**
 * GET /getWires
 * Get all available wire types
 */
router.get(
  '/getWires',
  clinicalOnly,
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
  clinicalOnly,
  validate({ query: visit.latestWires.query }),
  async (
    req: Request<unknown, unknown, unknown, visit.LatestWiresQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.query;
      if (!workId) {
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }
      const latestWires = await getLatestWiresByWorkId(parseInt(workId, 10));
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
  clinicalOnly,
  validate({ query: visit.visitsByWork.query }),
  async (
    req: Request<unknown, unknown, unknown, visit.VisitsByWorkQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.query;
      if (!workId) {
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }
      const visits = await getVisitsByWorkId(parseInt(workId, 10));
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
  clinicalOnly,
  validate({ query: visit.visitById.query }),
  async (
    req: Request<unknown, unknown, unknown, visit.VisitByIdQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const { visitId } = req.query;
      if (!visitId) {
        ErrorResponses.missingParameter(res, 'visitId');
        return;
      }
      // `visitRow` (not `visit`) to avoid shadowing the contract import.
      const visitRow = await getVisitById(parseInt(visitId, 10));
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
  clinicalOnly,
  validate({ body: visit.addVisit.body }),
  async (
    req: Request<unknown, unknown, visit.AddVisitBody>,
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
      // `visit_date` is passed THROUGH as the contract's 'YYYY-MM-DD' string.
      // `VisitData.visit_date` accepts `Date | string` and the query layer runs it
      // through `toDateOnly`, whose pass-through guard keeps a plain date string
      // verbatim — whereas `new Date('YYYY-MM-DD')` parses UTC midnight, which the
      // local getters then shift back a day on a negative-UTC-offset host.
      const result = await addVisitByWorkId(visitData);
      sendData(res, visit.addVisit.response, { visitId: result?.id });
    } catch (error) {
      const conflict = visitRollupConflict(error);
      if (conflict) {
        ErrorResponses.conflict(res, conflict);
        return;
      }
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
  clinicalOnly,
  validate({ body: visit.updateVisit.body }),
  async (
    req: Request<unknown, unknown, visit.UpdateVisitBody>,
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
      // Date string passed through verbatim — see the add handler above.
      const result = await updateVisitByWorkId(visitId, visitData);
      if (!result.success) {
        ErrorResponses.notFound(res, 'Visit');
        return;
      }
      sendSuccess(res, null);
    } catch (error) {
      const conflict = visitRollupConflict(error);
      if (conflict) {
        ErrorResponses.conflict(res, conflict);
        return;
      }
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
  clinicalOnly,
  validate({ body: visit.deleteVisit.body }),
  async (
    req: Request<unknown, unknown, visit.DeleteVisitBody>,
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
      const conflict = visitRollupConflict(error);
      if (conflict) {
        ErrorResponses.conflict(res, conflict);
        return;
      }
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
