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
import { z } from 'zod';
import { sql } from 'kysely';
import { isUniqueViolation } from '../../utils/pg-errors.js';
import { getKysely } from '../../services/database/kysely.js';
import {
  getWorksByPatient,
  toWorkWire,
  getWorkDetails,
  finishWork,
  discontinueWork,
  reactivateWork,
  getActiveWork,
  getWorkTypes,
  getWorkKeywords,
  getWorkDetailsList,
  addWorkDetail,
  updateWorkDetail,
  deleteWorkDetail,
  WORK_STATUS,
  // New aliases for tblWorkItems
  getWorkItems,
  addWorkItem,
  updateWorkItem,
  deleteWorkItem,
  // tooth number functions
  getToothNumbers,
  getWorkItemTeeth
} from '../../services/database/queries/work-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  requireRecordAge,
  getWorkCreationDate
} from '../../middleware/time-based-auth.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import {
  validateAndCreateWork,
  validateAndCreateWorkWithInvoice,
  validateAndDeleteWork,
  validateAndTransferWork,
  getTransferPreview,
  validateAndUpdateWork,
  WorkUpdateError,
  WorkValidationError,
  type WorkStatusType
} from '../../services/business/WorkService.js';
import { getWorkDetails as getWorkDetailsFromQueries } from '../../services/database/queries/work-queries.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface WorkQueryParams {
  code?: string;
  workId?: string;
  permanent?: string;
  deciduous?: string;
}

interface WorkResult {
  work_id: number;
  person_id: number;
  total_required: number;
  currency: string;
  type_of_work: number;
  notes: string | null;
  status: number;
  dr_id: number;
  doctor_name: string | null;
  type_name: string | null;
  status_name: string | null;
  [key: string]: string | number | null;
}

interface AddWorkBody {
  person_id: number;
  total_required: number;
  currency: string;
  type_of_work: number;
  dr_id: number;
  notes?: string;
  start_date?: string;
  keyword_id_1?: number;
  keyword_id_2?: number;
  keyword_id_3?: number;
  keyword_id_4?: number;
  keyword_id_5?: number;
  [key: string]: string | number | boolean | Date | null | undefined;
}

interface AddWorkWithInvoiceBody extends AddWorkBody {
  paymentDate: string;
  usdReceived?: number;
  iqdReceived?: number;
  change?: number;
  [key: string]: string | number | boolean | Date | null | undefined;
}

interface UpdateWorkBody {
  workId: number;
  person_id?: number;
  total_required?: number;
  currency?: string;
  type_of_work?: number;
  dr_id: number;
  notes?: string;
  status?: WorkStatusType;
  start_date?: string;
  debond_date?: string;
  f_photo_date?: string;
  i_photo_date?: string;
  notes_date?: string;
  keyword_id_1?: number;
  keyword_id_2?: number;
  keyword_id_3?: number;
  keyword_id_4?: number;
  keyword_id_5?: number;
  discount?: number | null;
  discount_date?: string | null;
  discount_reason?: string | null;
}

// Boundary guard for PUT /updatework. Deliberately a *loose* schema: this is a
// lenient, mutation-heavy financial handler that rest-spreads `...workData` to the
// updater and converts date fields in place, so we validate only the two required
// scalars (workId, dr_id) and pass every other field through UNTOUCHED — a strict
// schema would silently strip work fields on write-back. See CLAUDE.md (Zod = boundaries).
const updateWorkBodySchema = z.looseObject({
  workId: z.coerce.number().int().positive(),
  dr_id: z.coerce.number().int().positive(),
});

// Boundary guard for the work-lifecycle POSTs (/finishwork, /discontinuework,
// /reactivatework). workId required; personId optional (reactivate uses it to
// detect a pre-existing active work). Coercion means handlers read real numbers.
const workStatusBodySchema = z.object({
  workId: z.coerce.number().int().positive(),
  personId: z.coerce.number().int().positive().optional(),
});
type WorkStatusBody = z.infer<typeof workStatusBodySchema>;

interface DeleteWorkBody {
  workId: number;
}

interface WorkDetailBody {
  work_id?: number;
  detailId?: number;
  itemId?: number;
  canals_no?: number;
  item_cost?: number;
  TeethIds?: number[];
  filling_type?: string;
  filling_depth?: string;
  working_length?: string;
  implant_length?: number;
  implant_diameter?: number;
  implant_manufacturer_id?: number;
  material?: string;
  lab_name?: string;
  start_date?: string;
  completed_date?: string;
  note?: string;
}

interface DiagnosisData {
  work_id: number;
  dx_date?: string;
  diagnosis: string;
  treatment_plan: string;
  chief_complain?: string;
  appliance?: string;
  f_antero_posterior?: string;
  f_vertical?: string;
  f_transverse?: string;
  f_lip_competence?: string;
  f_naso_labial_angle?: string;
  f_upper_incisor_show_rest?: string;
  f_upper_incisor_show_smile?: string;
  i_teeth_present?: string;
  i_dental_health?: string;
  i_lower_crowding?: string;
  i_lower_incisor_inclination?: string;
  i_curveof_spee?: string;
  i_upper_crowding?: string;
  i_upper_incisor_inclination?: string;
  o_incisor_relation?: string;
  o_overjet?: string;
  o_overbite?: string;
  o_centerlines?: string;
  o_molar_relation?: string;
  o_canine_relation?: string;
  o_functional_occlusion?: string;
  c_sna?: string;
  c_snb?: string;
  c_anb?: string;
  c_sn_mx?: string;
  c_wits?: string;
  c_fma?: string;
  c_mma?: string;
  c_uimx?: string;
  c_li_md?: string;
  c_ui_li?: string;
  c_li_a_po?: string;
  c_ulip_e?: string;
  c_llip_e?: string;
  c_naso_lip?: string;
  c_tafh?: string;
  c_uafh?: string;
  c_lafh?: string;
  c_percent_lafh?: string;
}

// ============================================================================
// WORK MANAGEMENT API ENDPOINTS
// ============================================================================

/**
 * Get work details (for visit page header)
 */
router.get(
  '/getworkdetails',
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
      const work = await getWorkDetails(parseInt(workId));
      if (!work) {
        log.warn('Work not found', { workId });
        ErrorResponses.notFound(res, 'Work');
        return;
      }
      res.json(toWorkWire(work));
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

      const works = await getWorksByPatient(parseInt(personId));
      res.json(works.map(toWorkWire));
    } catch (error) {
      log.error('Error fetching works:', error);
      sendError(res, 500, 'Failed to fetch works', error as Error);
    }
  }
);

/**
 * Get single work by id
 */
router.get(
  '/getwork/:workId',
  async (req: Request<{ workId: string }>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;
      if (!workId) {
        log.warn('Get work request missing workId parameter');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      const { rows } = await sql<WorkResult>`
            SELECT
                w."work_id",
                w."person_id",
                w."total_required",
                w."currency",
                w."type_of_work",
                w."notes",
                w."status",
                w."dr_id",
                e."employee_name" as "doctor_name",
                wt."work_type" as "type_name",
                ws."status_name"
            FROM "works" w
            LEFT JOIN "employees" e ON w."dr_id" = e."id"
            LEFT JOIN "work_types" wt ON w."type_of_work" = wt."id"
            LEFT JOIN "work_statuses" ws ON w."status" = ws."status_id"
            WHERE w."work_id" = ${parseInt(workId)}
        `.execute(getKysely());

      const work = rows.length > 0 ? rows[0] : null;

      if (!work) {
        log.warn('Work not found by id', { workId });
        ErrorResponses.notFound(res, 'Work');
        return;
      }

      res.json({ success: true, work });
    } catch (error) {
      log.error('Error fetching work:', error);
      sendError(res, 500, 'Failed to fetch work', error as Error);
    }
  }
);

/**
 * Add new work
 */
router.post(
  '/addwork',
  async (
    req: Request<unknown, unknown, AddWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      // Delegate to service layer for validation and creation
      const result = await validateAndCreateWork(req.body);

      res.json({
        success: true,
        workId: result.work_id,
        message: 'Work added successfully'
      });
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
  async (
    req: Request<unknown, unknown, AddWorkWithInvoiceBody>,
    res: Response
  ): Promise<void> => {
    try {
      // Delegate to service layer for validation and creation
      const result = await validateAndCreateWorkWithInvoice(req.body);

      res.json({
        success: true,
        workId: result.workId,
        invoiceId: result.invoiceId,
        message: 'Work and invoice created successfully'
      });
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
  authorize(['admin', 'secretary']),
  validate({ body: updateWorkBodySchema }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      // workId + dr_id validated and coerced to positive ints by the schema;
      // all other work fields pass through untouched (loose schema). All update
      // rules (dates, status, financial/discount permissions, total-vs-paid guard)
      // live in WorkService.validateAndUpdateWork — this handler only maps outcomes.
      const { workId, ...workData } = req.body as UpdateWorkBody;

      const result = await validateAndUpdateWork({
        workId,
        userRole: req.session?.userRole,
        workData
      });

      res.json({
        success: true,
        message: 'Work updated successfully',
        rowsAffected: result.rowsAffected
      });
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
          case 'forbidden':
            ErrorResponses.forbidden(res, error.message, details);
            return;
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
  validate({ body: workStatusBodySchema }),
  async (
    req: Request<unknown, unknown, WorkStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.body;
      const result = await finishWork(workId);
      res.json({
        success: true,
        message: 'Work completed successfully',
        rowsAffected: result.rowCount
      });
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
  validate({ body: workStatusBodySchema }),
  async (
    req: Request<unknown, unknown, WorkStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.body;
      const result = await discontinueWork(workId);
      res.json({
        success: true,
        message: 'Work discontinued successfully',
        rowsAffected: result.rowCount
      });
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
  validate({ body: workStatusBodySchema }),
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
      res.json({
        success: true,
        message: 'Work reactivated successfully',
        rowsAffected: result.rowCount
      });
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
 * Get work status constants (for frontend reference)
 */
router.get('/workstatuses', (_req: Request, res: Response): void => {
  res.json({
    ACTIVE: WORK_STATUS.ACTIVE,
    FINISHED: WORK_STATUS.FINISHED,
    DISCONTINUED: WORK_STATUS.DISCONTINUED,
    labels: {
      [WORK_STATUS.ACTIVE]: 'Active',
      [WORK_STATUS.FINISHED]: 'Finished',
      [WORK_STATUS.DISCONTINUED]: 'Discontinued'
    }
  });
});

/**
 * Delete work - Protected: Secretary can only delete works created today
 */
router.delete(
  '/deletework',
  authenticate,
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'work',
    operation: 'delete',
    getRecordDate: getWorkCreationDate
  }),
  async (
    req: Request<unknown, unknown, DeleteWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.body;

      if (!workId) {
        log.warn('Delete work request missing workId');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      if (isNaN(parseInt(String(workId)))) {
        log.warn('Delete work invalid workId', { workId });
        ErrorResponses.badRequest(res, 'workId must be a valid number');
        return;
      }

      // Delegate to service layer for validation and deletion
      const result = await validateAndDeleteWork(parseInt(String(workId)));

      res.json({
        success: true,
        message: 'Work deleted successfully',
        rowsAffected: result.rowsAffected
      });
    } catch (error) {
      // Handle validation errors from service layer (expected business-rule
      // rejections — log at warn, not error, and without a stack trace).
      if (error instanceof WorkValidationError) {
        log.warn('Work deletion rejected by validation', {
          code: error.code,
          workId: req.body?.workId
        });
        ErrorResponses.conflict(res, error.message, error.details);
        return;
      }

      log.error('Error deleting work:', error);
      sendError(res, 500, 'Failed to delete work', error as Error);
    }
  }
);

/**
 * Get active work for a patient
 */
router.get(
  '/getactivework',
  async (
    req: Request<unknown, unknown, unknown, WorkQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { code: personId } = req.query;
      if (!personId) {
        log.warn('Get active work request missing person_id');
        ErrorResponses.missingParameter(res, 'code (person_id)');
        return;
      }

      const activeWork = await getActiveWork(parseInt(personId));
      res.json(activeWork);
    } catch (error) {
      log.error('Error fetching active work:', error);
      sendError(res, 500, 'Failed to fetch active work', error as Error);
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
      res.json(workTypes);
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
      res.json(keywords);
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
      res.json({
        success: true,
        teeth,
        count: teeth.length
      });
    } catch (error) {
      log.error('Error fetching tooth numbers:', error);
      sendError(res, 500, 'Failed to fetch tooth numbers', error as Error);
    }
  }
);

/**
 * Get teeth for a specific work item
 */
router.get(
  '/work/item/:itemId/teeth',
  async (req: Request<{ itemId: string }>, res: Response): Promise<void> => {
    try {
      const { itemId } = req.params;

      if (!itemId || isNaN(parseInt(itemId))) {
        log.warn('Get work item teeth invalid itemId', { itemId });
        ErrorResponses.badRequest(res, 'itemId must be a valid number');
        return;
      }

      const teeth = await getWorkItemTeeth(parseInt(itemId));
      res.json({
        success: true,
        teeth,
        count: teeth.length
      });
    } catch (error) {
      log.error('Error fetching work item teeth:', error);
      sendError(res, 500, 'Failed to fetch work item teeth', error as Error);
    }
  }
);

// ============================================================================
// WORK DETAILS API ENDPOINTS
// ============================================================================

/**
 * Get work details list for a specific work
 */
router.get(
  '/getworkdetailslist',
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

      const workDetailsList = await getWorkDetailsList(parseInt(workId));
      res.json(workDetailsList);
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
  async (
    req: Request<unknown, unknown, WorkDetailBody>,
    res: Response
  ): Promise<void> => {
    try {
      const workDetailData = req.body;

      // Validate required fields
      if (!workDetailData.work_id) {
        log.warn('Add work detail missing work_id');
        ErrorResponses.missingParameter(res, 'work_id');
        return;
      }

      // Validate data types
      if (isNaN(parseInt(String(workDetailData.work_id)))) {
        log.warn('Add work detail invalid work_id', { work_id: workDetailData.work_id });
        ErrorResponses.badRequest(res, 'work_id must be a valid number');
        return;
      }

      // Validate canals_no if provided
      if (
        workDetailData.canals_no &&
        isNaN(parseInt(String(workDetailData.canals_no)))
      ) {
        log.warn('Add work detail invalid canals_no', { canals_no: workDetailData.canals_no });
        ErrorResponses.badRequest(res, 'canals_no must be a valid number');
        return;
      }

      // Validate item_cost if provided
      if (
        workDetailData.item_cost &&
        isNaN(parseInt(String(workDetailData.item_cost)))
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

      // Create item data with required work_id
      const itemData = {
        work_id: workDetailData.work_id,
        ...workDetailData
      };

      const result = await addWorkDetail(itemData);
      res.json({
        success: true,
        detailId: result?.id,
        itemId: result?.id, // Alias for new naming
        message: 'Work item added successfully'
      });
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
  async (
    req: Request<unknown, unknown, WorkDetailBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { detailId, itemId, ...workDetailData } = req.body;
      const id = detailId || itemId; // Support both naming conventions

      if (!id) {
        log.warn('Update work detail missing detailId/itemId');
        ErrorResponses.missingParameter(res, 'detailId or itemId');
        return;
      }

      // Validate data types
      if (isNaN(parseInt(String(id)))) {
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
        isNaN(parseInt(String(workDetailData.canals_no)))
      ) {
        log.warn('Update work detail invalid canals_no', { id, canals_no: workDetailData.canals_no });
        ErrorResponses.badRequest(res, 'canals_no must be a valid number');
        return;
      }

      // Validate item_cost if provided
      if (
        workDetailData.item_cost &&
        isNaN(parseInt(String(workDetailData.item_cost)))
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

      const result = await updateWorkDetail(parseInt(String(id)), workDetailData);
      res.json({
        success: true,
        message: 'Work item updated successfully',
        rowsAffected: result.rowCount
      });
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
  async (
    req: Request<unknown, unknown, WorkDetailBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { detailId, itemId } = req.body;
      const id = detailId || itemId; // Support both naming conventions

      if (!id) {
        log.warn('Delete work detail missing detailId/itemId');
        ErrorResponses.missingParameter(res, 'detailId or itemId');
        return;
      }

      if (isNaN(parseInt(String(id)))) {
        log.warn('Delete work detail invalid id', { detailId, itemId });
        ErrorResponses.badRequest(
          res,
          'detailId/itemId must be a valid number'
        );
        return;
      }

      const result = await deleteWorkDetail(parseInt(String(id)));
      res.json({
        success: true,
        message: 'Work item deleted successfully',
        rowsAffected: result.rowCount
      });
    } catch (error) {
      log.error('Error deleting work item:', error);
      sendError(res, 500, 'Failed to delete work item', error as Error);
    }
  }
);

// ============================================================================
// WORK ITEMS API ENDPOINTS (New RESTful Routes)
// ============================================================================

/**
 * GET /api/work/:workId/items
 * Get all work items for a specific work
 */
router.get(
  '/work/:workId/items',
  async (req: Request<{ workId: string }>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;

      if (!workId || isNaN(parseInt(workId))) {
        log.warn('Get work items invalid workId', { workId });
        ErrorResponses.badRequest(res, 'workId must be a valid number');
        return;
      }

      const items = await getWorkItems(parseInt(workId));
      res.json({
        success: true,
        items,
        count: items.length
      });
    } catch (error) {
      log.error('Error fetching work items:', error);
      sendError(res, 500, 'Failed to fetch work items', error as Error);
    }
  }
);

/**
 * POST /api/work/:workId/items
 * Add a new work item to a work
 */
router.post(
  '/work/:workId/items',
  async (
    req: Request<{ workId: string }, unknown, WorkDetailBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.params;
      const itemData = req.body;

      if (!workId || isNaN(parseInt(workId))) {
        log.warn('Add work item invalid workId', { workId });
        ErrorResponses.badRequest(res, 'workId must be a valid number');
        return;
      }

      // Validate TeethIds if provided
      if (itemData.TeethIds && !Array.isArray(itemData.TeethIds)) {
        log.warn('Add work item invalid TeethIds', { workId, TeethIds: itemData.TeethIds });
        ErrorResponses.badRequest(
          res,
          'TeethIds must be an array of tooth IDs'
        );
        return;
      }

      // Create item data with required work_id from url
      const workItemData = {
        ...itemData,
        work_id: parseInt(workId)
      };

      const result = await addWorkItem(workItemData);
      res.json({
        success: true,
        itemId: result?.id,
        message: 'Work item added successfully'
      });
    } catch (error) {
      log.error('Error adding work item:', error);
      sendError(res, 500, 'Failed to add work item', error as Error);
    }
  }
);

/**
 * PUT /api/work/item/:itemId
 * Update a specific work item
 */
router.put(
  '/work/item/:itemId',
  async (
    req: Request<{ itemId: string }, unknown, WorkDetailBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { itemId } = req.params;
      const itemData = req.body;

      if (!itemId || isNaN(parseInt(itemId))) {
        log.warn('Update work item invalid itemId', { itemId });
        ErrorResponses.badRequest(res, 'itemId must be a valid number');
        return;
      }

      // Validate TeethIds if provided
      if (itemData.TeethIds && !Array.isArray(itemData.TeethIds)) {
        log.warn('Update work item invalid TeethIds', { itemId, TeethIds: itemData.TeethIds });
        ErrorResponses.badRequest(
          res,
          'TeethIds must be an array of tooth IDs'
        );
        return;
      }

      const result = await updateWorkItem(parseInt(itemId), itemData);
      res.json({
        success: true,
        message: 'Work item updated successfully',
        rowsAffected: result.rowCount
      });
    } catch (error) {
      log.error('Error updating work item:', error);
      sendError(res, 500, 'Failed to update work item', error as Error);
    }
  }
);

/**
 * DELETE /api/work/item/:itemId
 * Delete a specific work item
 */
router.delete(
  '/work/item/:itemId',
  async (req: Request<{ itemId: string }>, res: Response): Promise<void> => {
    try {
      const { itemId } = req.params;

      if (!itemId || isNaN(parseInt(itemId))) {
        log.warn('Delete work item invalid itemId', { itemId });
        ErrorResponses.badRequest(res, 'itemId must be a valid number');
        return;
      }

      const result = await deleteWorkItem(parseInt(itemId));
      res.json({
        success: true,
        message: 'Work item deleted successfully',
        rowsAffected: result.rowCount
      });
    } catch (error) {
      log.error('Error deleting work item:', error);
      sendError(res, 500, 'Failed to delete work item', error as Error);
    }
  }
);

// ============================================================================
// DIAGNOSIS & TREATMENT PLANNING API ENDPOINTS
// ============================================================================

/**
 * GET /api/diagnosis/:workId
 * Get comprehensive diagnosis data for a specific work
 */
router.get(
  '/diagnosis/:workId',
  async (req: Request<{ workId: string }>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;

      if (!workId) {
        log.warn('Get diagnosis request missing workId');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      const { rows } = await sql`
            SELECT
                "id",
                to_char("dx_date", 'YYYY-MM-DD') as "dx_date",
                "work_id",
                "diagnosis",
                "treatment_plan",
                "chief_complain",
                "f_antero_posterior",
                "f_vertical",
                "f_transverse",
                "f_lip_competence",
                "f_naso_labial_angle",
                "f_upper_incisor_show_rest",
                "f_upper_incisor_show_smile",
                "i_teeth_present",
                "i_dental_health",
                "i_lower_crowding",
                "i_lower_incisor_inclination",
                "i_curveof_spee",
                "i_upper_crowding",
                "i_upper_incisor_inclination",
                "o_incisor_relation",
                "o_overjet",
                "o_overbite",
                "o_centerlines",
                "o_molar_relation",
                "o_canine_relation",
                "o_functional_occlusion",
                "c_sna",
                "c_snb",
                "c_anb",
                "c_sn_mx",
                "c_wits",
                "c_fma",
                "c_mma",
                "c_uimx",
                "c_li_md",
                "c_ui_li",
                "c_li_a_po",
                "c_ulip_e",
                "c_llip_e",
                "c_naso_lip",
                "c_tafh",
                "c_uafh",
                "c_lafh",
                "c_percent_lafh",
                "appliance"
            FROM "diagnoses"
            WHERE "work_id" = ${parseInt(workId)}
        `.execute(getKysely());

      // Return null if no diagnosis found (not an error)
      if (rows.length === 0) {
        res.json(null);
        return;
      }

      res.json(rows[0]);
    } catch (error) {
      log.error('Error fetching diagnosis:', error);
      sendError(res, 500, 'Failed to fetch diagnosis', error as Error);
    }
  }
);

/**
 * POST /api/diagnosis
 * Create or update diagnosis (upsert operation)
 */
router.post(
  '/diagnosis',
  async (
    req: Request<unknown, unknown, DiagnosisData>,
    res: Response
  ): Promise<void> => {
    try {
      const diagnosisData = req.body;

      // Validate required fields
      if (!diagnosisData.work_id) {
        log.warn('Save diagnosis missing work_id');
        ErrorResponses.missingParameter(res, 'work_id');
        return;
      }
      if (!diagnosisData.diagnosis || !diagnosisData.diagnosis.trim()) {
        log.warn('Save diagnosis missing diagnosis', { work_id: diagnosisData.work_id });
        ErrorResponses.missingParameter(res, 'diagnosis');
        return;
      }
      if (!diagnosisData.treatment_plan || !diagnosisData.treatment_plan.trim()) {
        log.warn('Save diagnosis missing treatment_plan', { work_id: diagnosisData.work_id });
        ErrorResponses.missingParameter(res, 'treatment_plan');
        return;
      }

      const db = getKysely();
      const workIdNum = parseInt(String(diagnosisData.work_id));

      // Normalized column values (null for empty strings — preserves original semantics).
      const dxDate = diagnosisData.dx_date
        ? new Date(diagnosisData.dx_date)
        : new Date();
      const diagnosis = diagnosisData.diagnosis;
      const treatmentPlan = diagnosisData.treatment_plan;
      const chiefComplain = diagnosisData.chief_complain || null;
      const appliance = diagnosisData.appliance || null;
      // Facial Analysis
      const fAnteroPosterior = diagnosisData.f_antero_posterior || null;
      const fVertical = diagnosisData.f_vertical || null;
      const fTransverse = diagnosisData.f_transverse || null;
      const fLipCompetence = diagnosisData.f_lip_competence || null;
      const fNasoLabialAngle = diagnosisData.f_naso_labial_angle || null;
      const fUpperIncisorShowRest = diagnosisData.f_upper_incisor_show_rest || null;
      const fUpperIncisorShowSmile = diagnosisData.f_upper_incisor_show_smile || null;
      // Intraoral Analysis
      const iTeethPresent = diagnosisData.i_teeth_present || null;
      const iDentalHealth = diagnosisData.i_dental_health || null;
      const iLowerCrowding = diagnosisData.i_lower_crowding || null;
      const iLowerIncisorInclination = diagnosisData.i_lower_incisor_inclination || null;
      const iCurveofSpee = diagnosisData.i_curveof_spee || null;
      const iUpperCrowding = diagnosisData.i_upper_crowding || null;
      const iUpperIncisorInclination = diagnosisData.i_upper_incisor_inclination || null;
      // Occlusion Analysis
      const oIncisorRelation = diagnosisData.o_incisor_relation || null;
      const oOverjet = diagnosisData.o_overjet || null;
      const oOverbite = diagnosisData.o_overbite || null;
      const oCenterlines = diagnosisData.o_centerlines || null;
      const oMolarRelation = diagnosisData.o_molar_relation || null;
      const oCanineRelation = diagnosisData.o_canine_relation || null;
      const oFunctionalOcclusion = diagnosisData.o_functional_occlusion || null;
      // Cephalometric Analysis
      const c_SNA = diagnosisData.c_sna || null;
      const c_SNB = diagnosisData.c_snb || null;
      const c_ANB = diagnosisData.c_anb || null;
      const c_SNMx = diagnosisData.c_sn_mx || null;
      const c_Wits = diagnosisData.c_wits || null;
      const c_FMA = diagnosisData.c_fma || null;
      const c_MMA = diagnosisData.c_mma || null;
      const c_UIMX = diagnosisData.c_uimx || null;
      const c_LIMd = diagnosisData.c_li_md || null;
      const c_UI_LI = diagnosisData.c_ui_li || null;
      const c_LI_APo = diagnosisData.c_li_a_po || null;
      const c_Ulip_E = diagnosisData.c_ulip_e || null;
      const c_Llip_E = diagnosisData.c_llip_e || null;
      const c_Naso_lip = diagnosisData.c_naso_lip || null;
      const c_TAFH = diagnosisData.c_tafh || null;
      const c_UAFH = diagnosisData.c_uafh || null;
      const c_LAFH = diagnosisData.c_lafh || null;
      const c_PercentLAFH = diagnosisData.c_percent_lafh || null;

      // Upsert: try UPDATE first; INSERT only if no existing row was updated.
      // (The original IF-EXISTS check at L1460 collapses into the rowCount test.)
      const updateResult = await sql`
                UPDATE "diagnoses"
                SET
                    "dx_date" = ${dxDate},
                    "diagnosis" = ${diagnosis},
                    "treatment_plan" = ${treatmentPlan},
                    "chief_complain" = ${chiefComplain},
                    "appliance" = ${appliance},
                    "f_antero_posterior" = ${fAnteroPosterior},
                    "f_vertical" = ${fVertical},
                    "f_transverse" = ${fTransverse},
                    "f_lip_competence" = ${fLipCompetence},
                    "f_naso_labial_angle" = ${fNasoLabialAngle},
                    "f_upper_incisor_show_rest" = ${fUpperIncisorShowRest},
                    "f_upper_incisor_show_smile" = ${fUpperIncisorShowSmile},
                    "i_teeth_present" = ${iTeethPresent},
                    "i_dental_health" = ${iDentalHealth},
                    "i_lower_crowding" = ${iLowerCrowding},
                    "i_lower_incisor_inclination" = ${iLowerIncisorInclination},
                    "i_curveof_spee" = ${iCurveofSpee},
                    "i_upper_crowding" = ${iUpperCrowding},
                    "i_upper_incisor_inclination" = ${iUpperIncisorInclination},
                    "o_incisor_relation" = ${oIncisorRelation},
                    "o_overjet" = ${oOverjet},
                    "o_overbite" = ${oOverbite},
                    "o_centerlines" = ${oCenterlines},
                    "o_molar_relation" = ${oMolarRelation},
                    "o_canine_relation" = ${oCanineRelation},
                    "o_functional_occlusion" = ${oFunctionalOcclusion},
                    "c_sna" = ${c_SNA},
                    "c_snb" = ${c_SNB},
                    "c_anb" = ${c_ANB},
                    "c_sn_mx" = ${c_SNMx},
                    "c_wits" = ${c_Wits},
                    "c_fma" = ${c_FMA},
                    "c_mma" = ${c_MMA},
                    "c_uimx" = ${c_UIMX},
                    "c_li_md" = ${c_LIMd},
                    "c_ui_li" = ${c_UI_LI},
                    "c_li_a_po" = ${c_LI_APo},
                    "c_ulip_e" = ${c_Ulip_E},
                    "c_llip_e" = ${c_Llip_E},
                    "c_naso_lip" = ${c_Naso_lip},
                    "c_tafh" = ${c_TAFH},
                    "c_uafh" = ${c_UAFH},
                    "c_lafh" = ${c_LAFH},
                    "c_percent_lafh" = ${c_PercentLAFH}
                WHERE "work_id" = ${workIdNum}
            `.execute(db);

      let successMessage: string;

      if (Number(updateResult.numAffectedRows ?? 0) > 0) {
        successMessage = 'diagnosis updated successfully';
      } else {
        // INSERT new diagnosis
        await sql`
                INSERT INTO "diagnoses" (
                    "dx_date", "work_id", "diagnosis", "treatment_plan", "chief_complain", "appliance",
                    "f_antero_posterior", "f_vertical", "f_transverse", "f_lip_competence", "f_naso_labial_angle",
                    "f_upper_incisor_show_rest", "f_upper_incisor_show_smile",
                    "i_teeth_present", "i_dental_health", "i_lower_crowding", "i_lower_incisor_inclination",
                    "i_curveof_spee", "i_upper_crowding", "i_upper_incisor_inclination",
                    "o_incisor_relation", "o_overjet", "o_overbite", "o_centerlines", "o_molar_relation",
                    "o_canine_relation", "o_functional_occlusion",
                    "c_sna", "c_snb", "c_anb", "c_sn_mx", "c_wits", "c_fma", "c_mma", "c_uimx", "c_li_md",
                    "c_ui_li", "c_li_a_po", "c_ulip_e", "c_llip_e", "c_naso_lip",
                    "c_tafh", "c_uafh", "c_lafh", "c_percent_lafh"
                )
                VALUES (
                    ${dxDate}, ${workIdNum}, ${diagnosis}, ${treatmentPlan}, ${chiefComplain}, ${appliance},
                    ${fAnteroPosterior}, ${fVertical}, ${fTransverse}, ${fLipCompetence}, ${fNasoLabialAngle},
                    ${fUpperIncisorShowRest}, ${fUpperIncisorShowSmile},
                    ${iTeethPresent}, ${iDentalHealth}, ${iLowerCrowding}, ${iLowerIncisorInclination},
                    ${iCurveofSpee}, ${iUpperCrowding}, ${iUpperIncisorInclination},
                    ${oIncisorRelation}, ${oOverjet}, ${oOverbite}, ${oCenterlines}, ${oMolarRelation},
                    ${oCanineRelation}, ${oFunctionalOcclusion},
                    ${c_SNA}, ${c_SNB}, ${c_ANB}, ${c_SNMx}, ${c_Wits}, ${c_FMA}, ${c_MMA}, ${c_UIMX}, ${c_LIMd},
                    ${c_UI_LI}, ${c_LI_APo}, ${c_Ulip_E}, ${c_Llip_E}, ${c_Naso_lip},
                    ${c_TAFH}, ${c_UAFH}, ${c_LAFH}, ${c_PercentLAFH}
                )
            `.execute(db);
        successMessage = 'diagnosis created successfully';
      }

      res.json({
        success: true,
        message: successMessage
      });
    } catch (error) {
      log.error('Error saving diagnosis:', error);
      sendError(res, 500, 'Failed to save diagnosis', error as Error);
    }
  }
);

/**
 * DELETE /api/diagnosis/:workId
 * Delete diagnosis for a specific work
 */
router.delete(
  '/diagnosis/:workId',
  async (req: Request<{ workId: string }>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;

      if (!workId) {
        log.warn('Delete diagnosis request missing workId');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      await sql`DELETE FROM "diagnoses" WHERE "work_id" = ${parseInt(workId)}`.execute(
        getKysely()
      );

      res.json({
        success: true,
        message: 'diagnosis deleted successfully'
      });
    } catch (error) {
      log.error('Error deleting diagnosis:', error);
      sendError(res, 500, 'Failed to delete diagnosis', error as Error);
    }
  }
);

// ============================================================================
// WORK TRANSFER API ENDPOINTS (Admin Only)
// ============================================================================

/**
 * Transfer work request body
 */
interface TransferWorkBody {
  targetPatientId: number;
}

/**
 * GET /api/work/:workId/transfer-preview
 * Get preview of what will be transferred (related record counts)
 * Admin only
 */
router.get(
  '/work/:workId/transfer-preview',
  authenticate,
  authorize(['admin']),
  async (req: Request<{ workId: string }>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;

      if (!workId || isNaN(parseInt(workId))) {
        log.warn('Transfer preview invalid workId', { workId });
        ErrorResponses.badRequest(res, 'workId must be a valid number');
        return;
      }

      // Get work details
      const work = await getWorkDetailsFromQueries(parseInt(workId));
      if (!work) {
        log.warn('Work not found for transfer preview', { workId });
        ErrorResponses.notFound(res, 'Work');
        return;
      }

      // Get related record counts
      const relatedCounts = await getTransferPreview(parseInt(workId));

      res.json({
        success: true,
        work: {
          workId: work.work_id,
          type: work.type_name,
          status: work.status_name,
          doctor: work.doctor_name,
          totalRequired: work.total_required,
          currency: work.currency,
          currentPatient: {
            personId: work.person_id,
            name: work.patient_name
          }
        },
        relatedRecords: relatedCounts
      });
    } catch (error) {
      if (error instanceof WorkValidationError) {
        log.warn('Transfer preview rejected by validation', {
          code: error.code
        });
        if (error.code === 'WORK_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Work');
          return;
        }
        ErrorResponses.badRequest(res, error.message, error.details);
        return;
      }

      log.error('Error getting transfer preview:', error);
      sendError(res, 500, 'Failed to get transfer preview', error as Error);
    }
  }
);

/**
 * POST /api/work/:workId/transfer
 * Transfer a work to a different patient
 * Admin only
 */
router.post(
  '/work/:workId/transfer',
  authenticate,
  authorize(['admin']),
  async (
    req: Request<{ workId: string }, unknown, TransferWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.params;
      const { targetPatientId } = req.body;

      // Validate workId
      if (!workId || isNaN(parseInt(workId))) {
        log.warn('Transfer work invalid workId', { workId });
        ErrorResponses.badRequest(res, 'workId must be a valid number');
        return;
      }

      // Validate targetPatientId
      if (!targetPatientId || isNaN(parseInt(String(targetPatientId)))) {
        log.warn('Transfer work missing targetPatientId', { workId });
        ErrorResponses.missingParameter(res, 'targetPatientId');
        return;
      }

      // Execute transfer with validation
      const result = await validateAndTransferWork(
        parseInt(workId),
        parseInt(String(targetPatientId))
      );

      log.info('Work transferred successfully', {
        workId: result.workId,
        sourcePatientId: result.sourcePatientId,
        targetPatientId: result.targetPatientId
      });

      res.json({
        ...result,
        message: 'Work transferred successfully'
      });
    } catch (error) {
      if (error instanceof WorkValidationError) {
        log.warn('Work transfer rejected by validation', {
          code: error.code,
          workId: req.params?.workId
        });
        switch (error.code) {
          case 'WORK_NOT_FOUND':
          case 'TARGET_PATIENT_NOT_FOUND':
            ErrorResponses.notFound(res, error.message);
            return;
          case 'ACTIVE_WORK_CONFLICT':
            ErrorResponses.conflict(res, error.message, error.details);
            return;
          case 'SAME_PATIENT':
            ErrorResponses.badRequest(res, error.message, error.details);
            return;
          default:
            ErrorResponses.badRequest(res, error.message, error.details);
            return;
        }
      }

      log.error('Error transferring work:', error);
      sendError(res, 500, 'Failed to transfer work', error as Error);
    }
  }
);

export default router;
