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
  // tooth number functions
  getToothNumbers
} from '../../services/database/queries/work-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  requireRecordAge,
  getWorkCreationDate
} from '../../middleware/time-based-auth.js';
import { sendSuccess, sendData, sendError, ErrorResponses } from '../../utils/error-response.js';
import * as workContract from '../../shared/contracts/work.contract.js';
import { log } from '../../utils/logger.js';
import {
  validateAndCreateWork,
  validateAndCreateWorkWithInvoice,
  validateAndDeleteWork,
  validateAndTransferWork,
  getTransferPreview,
  validateAndUpdateWork,
  WorkUpdateError,
  WorkValidationError
} from '../../services/business/WorkService.js';
import { getWorkDetails as getWorkDetailsFromQueries } from '../../services/database/queries/work-queries.js';

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

      const works = await getWorksByPatient(parseInt(personId));
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
  validate({ body: workContract.addWork.body }),
  async (
    req: Request<unknown, unknown, workContract.AddWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      // Delegate to service layer for validation and creation
      const result = await validateAndCreateWork(req.body);

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
  authorize(['admin', 'secretary']),
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

      sendData(res, workContract.updateWork.response, { rowsAffected: result.rowsAffected }, 'Work updated successfully');
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
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'work',
    operation: 'delete',
    getRecordDate: getWorkCreationDate
  }),
  validate({ body: workContract.deleteWork.body }),
  async (
    req: Request<unknown, unknown, DeleteWorkBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.body;

      // workId validated + coerced to a positive int by workContract.deleteWork.body.
      const result = await validateAndDeleteWork(parseInt(String(workId)));

      // DeleteResult.rowsAffected is optional; on the success path it's the deleted
      // row count — coerce a (type-only) undefined to 0 to satisfy the strict contract.
      sendData(res, workContract.deleteWork.response, { rowsAffected: result.rowsAffected ?? 0 }, 'Work deleted successfully');
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

      // Create item data with required work_id (validated + coerced by the schema above).
      const itemData = {
        ...workDetailData,
        work_id: parseInt(String(workDetailData.work_id))
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
  validate({ body: workContract.updateWorkDetail.body }),
  async (
    req: Request<unknown, unknown, workContract.UpdateWorkDetailBody>,
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
  validate({ body: workContract.deleteWorkDetail.body }),
  async (
    req: Request<unknown, unknown, workContract.WorkDetailIdBody>,
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
      sendData(res, workContract.deleteWorkDetail.response, { rowsAffected: result.rowCount }, 'Work item deleted successfully');
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

      // Stays raw (not sendSuccess): the "no diagnosis yet / new diagnosis"
      // state is signalled by a literal 200 `null`, which Diagnosis.tsx detects
      // via `if (diagnosis)`. sendSuccess(res, null) would omit `data` and the
      // FE would receive `{success,timestamp}` (truthy) instead of null, breaking
      // that signal. See audit H4/N18/N22.
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
  validate({ body: workContract.diagnosis.body }),
  async (
    req: Request<unknown, unknown, workContract.DiagnosisBody>,
    res: Response
  ): Promise<void> => {
    try {
      const diagnosisData = req.body;

      // work_id / diagnosis / treatment_plan validated by workContract.diagnosis.body
      // (work_id a positive int; both text fields trimmed + non-empty).

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

      sendSuccess(res, null, successMessage);
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

      sendSuccess(res, null, 'diagnosis deleted successfully');
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

      sendData(res, workContract.transferPreview.response, {
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
  validate({ body: workContract.transfer.body }),
  async (
    req: Request<{ workId: string }, unknown, workContract.TransferBody>,
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

      sendData(res, workContract.transfer.response, result, 'Work transferred successfully');
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
