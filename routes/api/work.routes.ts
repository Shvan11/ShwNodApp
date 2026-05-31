/**
 * Work/Treatment Management API Routes
 *
 * This module handles all work (treatment) related operations including:
 * - Work CRUD operations (create, read, update, delete)
 * - Work details management (treatment details)
 * - Diagnosis and treatment planning (comprehensive orthodontic diagnosis)
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
  getWorkDetails,
  finishWork,
  discontinueWork,
  reactivateWork,
  getActiveWork,
  getWorkById,
  validateStatusChange,
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
  // Tooth number functions
  getToothNumbers,
  getWorkItemTeeth
} from '../../services/database/queries/work-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import {
  requireRecordAge,
  getWorkCreationDate,
  isToday
} from '../../middleware/time-based-auth.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import {
  validateAndCreateWork,
  validateAndCreateWorkWithInvoice,
  validateAndDeleteWork,
  validateAndTransferWork,
  getTransferPreview,
  validateDiscount,
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
  workid: number;
  PersonID: number;
  TotalRequired: number;
  Currency: string;
  Typeofwork: number;
  Notes: string | null;
  Status: number;
  DrID: number;
  DoctorName: string | null;
  TypeName: string | null;
  StatusName: string | null;
  [key: string]: string | number | null;
}

/**
 * Work data returned from getWorkById - includes Status as number for DB compatibility
 */
interface WorkData {
  workid: number;
  PersonID: number;
  TotalRequired: number | null;
  Currency: string | null;
  Typeofwork: number | null;
  Notes: string | null;
  Status: number;
  DrID: number | null;
  DoctorName: string | null;
  TypeName: string | null;
  StatusName: string | null;
}

interface AddWorkBody {
  PersonID: number;
  TotalRequired: number;
  Currency: string;
  Typeofwork: number;
  DrID: number;
  Notes?: string;
  StartDate?: string;
  KeyWordID1?: number;
  KeyWordID2?: number;
  KeywordID3?: number;
  KeywordID4?: number;
  KeywordID5?: number;
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
  PersonID?: number;
  TotalRequired?: number;
  Currency?: string;
  Typeofwork?: number;
  DrID: number;
  Notes?: string;
  Status?: WorkStatusType;
  StartDate?: string;
  DebondDate?: string;
  FPhotoDate?: string;
  IPhotoDate?: string;
  NotesDate?: string;
  KeyWordID1?: number;
  KeyWordID2?: number;
  KeywordID3?: number;
  KeywordID4?: number;
  KeywordID5?: number;
  Discount?: number | null;
  DiscountDate?: string | null;
  DiscountReason?: string | null;
}

interface WorkStatusBody {
  workId: number;
  personId?: number;
}

interface DeleteWorkBody {
  workId: number;
}

interface WorkDetailBody {
  WorkID?: number;
  detailId?: number;
  itemId?: number;
  CanalsNo?: number;
  ItemCost?: number;
  TeethIds?: number[];
  FillingType?: string;
  FillingDepth?: string;
  WorkingLength?: string;
  ImplantLength?: number;
  ImplantDiameter?: number;
  ImplantManufacturerID?: number;
  Material?: string;
  LabName?: string;
  StartDate?: Date | string;
  CompletedDate?: Date | string;
  Note?: string;
}

interface DiagnosisData {
  WorkID: number;
  DxDate?: string;
  Diagnosis: string;
  TreatmentPlan: string;
  ChiefComplain?: string;
  Appliance?: string;
  fAnteroPosterior?: string;
  fVertical?: string;
  fTransverse?: string;
  fLipCompetence?: string;
  fNasoLabialAngle?: string;
  fUpperIncisorShowRest?: string;
  fUpperIncisorShowSmile?: string;
  ITeethPresent?: string;
  IDentalHealth?: string;
  ILowerCrowding?: string;
  ILowerIncisorInclination?: string;
  ICurveofSpee?: string;
  IUpperCrowding?: string;
  IUpperIncisorInclination?: string;
  OIncisorRelation?: string;
  OOverjet?: string;
  OOverbite?: string;
  OCenterlines?: string;
  OMolarRelation?: string;
  OCanineRelation?: string;
  OFunctionalOcclusion?: string;
  C_SNA?: string;
  C_SNB?: string;
  C_ANB?: string;
  C_SNMx?: string;
  C_Wits?: string;
  C_FMA?: string;
  C_MMA?: string;
  C_UIMX?: string;
  C_LIMd?: string;
  C_UI_LI?: string;
  C_LI_APo?: string;
  C_Ulip_E?: string;
  C_Llip_E?: string;
  C_Naso_lip?: string;
  C_TAFH?: string;
  C_UAFH?: string;
  C_LAFH?: string;
  C_PercentLAFH?: string;
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
      res.json(work);
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
        log.warn('Get works request missing PersonID parameter');
        ErrorResponses.missingParameter(res, 'code (PersonID)');
        return;
      }

      const works = await getWorksByPatient(parseInt(personId));
      res.json(works);
    } catch (error) {
      log.error('Error fetching works:', error);
      sendError(res, 500, 'Failed to fetch works', error as Error);
    }
  }
);

/**
 * Get single work by ID
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
                w."workid",
                w."PersonID",
                w."TotalRequired",
                w."Currency",
                w."Typeofwork",
                w."Notes",
                w."Status",
                w."DrID",
                e."employeeName" as "DoctorName",
                wt."WorkType" as "TypeName",
                ws."StatusName"
            FROM "tblwork" w
            LEFT JOIN "tblEmployees" e ON w."DrID" = e."ID"
            LEFT JOIN "tblWorkType" wt ON w."Typeofwork" = wt."ID"
            LEFT JOIN "tblWorkStatus" ws ON w."Status" = ws."StatusID"
            WHERE w."workid" = ${parseInt(workId)}
        `.execute(getKysely());

      const work = rows.length > 0 ? rows[0] : null;

      if (!work) {
        log.warn('Work not found by ID', { workId });
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
        workId: result.workid,
        message: 'Work added successfully'
      });
    } catch (error) {
      // Handle validation errors from service layer (expected business-rule
      // rejections — log at warn, not error, and without a stack trace).
      if (error instanceof WorkValidationError) {
        log.warn('Work creation rejected by validation', {
          code: error.code,
          personId: req.body?.PersonID
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
          personId: req.body?.PersonID
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
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { workId, ...workData } = req.body as UpdateWorkBody;

      if (!workId) {
        log.warn('Update work request missing workId');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      // Validate DrID is provided
      if (!workData.DrID) {
        log.warn('Update work request missing DrID', { workId });
        ErrorResponses.badRequest(res, 'DrID is required');
        return;
      }

      // Validate data types
      if (isNaN(parseInt(String(workId))) || isNaN(parseInt(String(workData.DrID)))) {
        log.warn('Update work invalid parameters', { workId, DrID: workData.DrID });
        ErrorResponses.badRequest(res, 'workId and DrID must be valid numbers');
        return;
      }

      // Convert date strings to proper Date objects if provided
      const dateFields = [
        'StartDate',
        'DebondDate',
        'FPhotoDate',
        'IPhotoDate',
        'NotesDate',
        'DiscountDate'
      ];
      for (const field of dateFields) {
        const value = (workData as Record<string, unknown>)[field];
        if (value && typeof value === 'string') {
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            log.warn('Update work invalid date format', { workId, field, value });
            ErrorResponses.badRequest(res, `Invalid date format for ${field}`);
            return;
          }
          (workData as Record<string, unknown>)[field] = date;
        }
      }

      // Fetch current work once if needed for validation
      const needsCurrentWork =
        workData.Status !== undefined ||
        (req.session?.userRole !== 'admin' &&
          ['TotalRequired', 'Currency'].some((field) =>
            Object.prototype.hasOwnProperty.call(workData, field)
          ));

      let currentWork: WorkData | null = null;
      if (needsCurrentWork) {
        const fetchedWork = await getWorkById(parseInt(String(workId)));
        if (!fetchedWork) {
          log.warn('Work not found for update', { workId });
          ErrorResponses.notFound(res, 'Work not found');
          return;
        }
        currentWork = fetchedWork as WorkData;
      }

      // ===== STATUS CHANGE VALIDATION =====
      if (workData.Status !== undefined && currentWork) {
        if (currentWork.Status !== workData.Status) {
          const validation = await validateStatusChange(
            parseInt(String(workId)),
            workData.Status,
            (workData.PersonID || currentWork.PersonID) as number
          );

          if (!validation.valid) {
            res.status(409).json({
              error: 'Status Change Conflict',
              message: validation.error,
              existingWork: validation.existingWork
            });
            return;
          }
        }
      }
      // ===== END STATUS VALIDATION =====

      // ===== FINANCIAL FIELDS PERMISSION CHECK =====
      const financialFields = ['TotalRequired', 'Currency'];
      let isChangingFinancialFields = false;

      if (
        req.session?.userRole !== 'admin' &&
        currentWork &&
        financialFields.some((field) =>
          Object.prototype.hasOwnProperty.call(workData, field)
        )
      ) {
        // Check if TotalRequired is changing
        const totalRequiredChanged = workData.TotalRequired !== undefined &&
          Number(workData.TotalRequired) !== Number(currentWork.TotalRequired);

        // Check if Currency is changing
        const currencyChanged = workData.Currency !== undefined &&
          String(workData.Currency) !== String(currentWork.Currency);

        isChangingFinancialFields = totalRequiredChanged || currencyChanged;
      }

      if (isChangingFinancialFields) {
        const workCreationDate = await getWorkCreationDate(req);
        if (!isToday(workCreationDate)) {
          res.status(403).json({
            error: 'Forbidden',
            message:
              'Cannot edit financial fields (Total Required, Currency) for work not created today. Contact admin.',
            restrictedFields: financialFields
          });
          return;
        }
      }
      // ===== END FINANCIAL FIELDS PERMISSION CHECK =====

      // ===== TOTAL-REQUIRED vs PAID GUARD (was DB CHECK CK_MoreThanTotalW) =====
      // A work's TotalRequired must never drop below what's already been paid, or the
      // work becomes overpaid. PostgreSQL can't host the old function-based CHECK, so
      // enforce it here. (NULL/absent TotalRequired = no change / no limit → skip.)
      if (
        Object.prototype.hasOwnProperty.call(workData, 'TotalRequired') &&
        workData.TotalRequired !== null &&
        workData.TotalRequired !== undefined
      ) {
        const newTotal = Number(workData.TotalRequired);
        const workForTotal = await getWorkDetailsFromQueries(
          parseInt(String(workId))
        );
        const alreadyPaid = Number(
          (workForTotal as { TotalPaid?: number } | null)?.TotalPaid ?? 0
        );
        if (Number.isFinite(newTotal) && newTotal < alreadyPaid) {
          res.status(400).json({
            error: 'Invalid total',
            code: 'TOTAL_BELOW_PAID',
            message: `Total required (${newTotal}) cannot be less than the amount already paid (${alreadyPaid}).`
          });
          return;
        }
      }

      // ===== DISCOUNT FIELDS PERMISSION + VALIDATION =====
      // Discount and DiscountDate are admin-only (financial concession).
      // DiscountReason is editable by any authenticated user.
      const discountAdminFields = ['Discount', 'DiscountDate'] as const;
      const hasDiscountFieldInPayload = discountAdminFields.some((field) =>
        Object.prototype.hasOwnProperty.call(workData, field)
      );

      if (hasDiscountFieldInPayload) {
        // Fetch work with TotalPaid (needed for DISCOUNT_EXCEEDS_REMAINING check)
        const workWithPaid = await getWorkDetailsFromQueries(parseInt(String(workId)));
        if (!workWithPaid) {
          ErrorResponses.notFound(res, 'Work not found');
          return;
        }

        const discountChanged = workData.Discount !== undefined &&
          Number(workData.Discount ?? 0) !== Number(workWithPaid.Discount ?? 0);
        const discountDateChanged = workData.DiscountDate !== undefined &&
          String(workData.DiscountDate ?? '') !== String(workWithPaid.DiscountDate ?? '');

        if ((discountChanged || discountDateChanged) && req.session?.userRole !== 'admin') {
          res.status(403).json({
            error: 'Forbidden',
            message: 'Only admin can add or edit discount.',
            restrictedFields: [...discountAdminFields]
          });
          return;
        }

        if (discountChanged) {
          try {
            validateDiscount(
              workData.Discount ?? null,
              workWithPaid.TotalRequired,
              (workWithPaid as { TotalPaid?: number }).TotalPaid ?? 0
            );
          } catch (err) {
            if (err instanceof WorkValidationError) {
              res.status(400).json({
                error: 'Invalid discount',
                code: err.code,
                message: err.message,
                details: err.details
              });
              return;
            }
            throw err;
          }
        }
      }
      // ===== END DISCOUNT FIELDS =====

      const { updateWork } = await import(
        '../../services/database/queries/work-queries.js'
      );
      const result = await updateWork(parseInt(String(workId)), workData);
      res.json({
        success: true,
        message: 'Work updated successfully',
        rowsAffected: result.rowCount
      });
    } catch (error) {
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
  async (
    req: Request<unknown, unknown, WorkStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.body;

      if (!workId) {
        log.warn('Finish work request missing workId');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      if (isNaN(parseInt(String(workId)))) {
        log.warn('Finish work invalid workId', { workId });
        ErrorResponses.badRequest(res, 'workId must be a valid number');
        return;
      }

      const result = await finishWork(parseInt(String(workId)));
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
  async (
    req: Request<unknown, unknown, WorkStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId } = req.body;

      if (!workId) {
        log.warn('Discontinue work request missing workId');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      if (isNaN(parseInt(String(workId)))) {
        log.warn('Discontinue work invalid workId', { workId });
        ErrorResponses.badRequest(res, 'workId must be a valid number');
        return;
      }

      const result = await discontinueWork(parseInt(String(workId)));
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
  async (
    req: Request<unknown, unknown, WorkStatusBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { workId, personId } = req.body;

      if (!workId) {
        log.warn('Reactivate work request missing workId');
        ErrorResponses.missingParameter(res, 'workId');
        return;
      }

      if (isNaN(parseInt(String(workId)))) {
        log.warn('Reactivate work invalid workId', { workId });
        ErrorResponses.badRequest(res, 'workId must be a valid number');
        return;
      }

      // Check if patient already has an active work
      if (personId) {
        const activeWork = await getActiveWork(parseInt(String(personId)));
        if (activeWork && activeWork.workid !== parseInt(String(workId))) {
          ErrorResponses.conflict(
            res,
            'Patient already has an active work. Please finish or discontinue it first.',
            {
              existingWorkId: activeWork.workid,
              existingWorkType: activeWork.TypeName
            }
          );
          return;
        }
      }

      const result = await reactivateWork(parseInt(String(workId)));
      res.json({
        success: true,
        message: 'Work reactivated successfully',
        rowsAffected: result.rowCount
      });
    } catch (error) {
      // Reactivating sets Status=1, which can collide with the patient's existing
      // active work (partial unique index UNQ_tblWork_Active → pg SQLSTATE 23505).
      if (isUniqueViolation(error, 'UNQ_tblWork_Active')) {
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
        log.warn('Get active work request missing PersonID');
        ErrorResponses.missingParameter(res, 'code (PersonID)');
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
      if (!workDetailData.WorkID) {
        log.warn('Add work detail missing WorkID');
        ErrorResponses.missingParameter(res, 'WorkID');
        return;
      }

      // Validate data types
      if (isNaN(parseInt(String(workDetailData.WorkID)))) {
        log.warn('Add work detail invalid WorkID', { WorkID: workDetailData.WorkID });
        ErrorResponses.badRequest(res, 'WorkID must be a valid number');
        return;
      }

      // Validate CanalsNo if provided
      if (
        workDetailData.CanalsNo &&
        isNaN(parseInt(String(workDetailData.CanalsNo)))
      ) {
        log.warn('Add work detail invalid CanalsNo', { CanalsNo: workDetailData.CanalsNo });
        ErrorResponses.badRequest(res, 'CanalsNo must be a valid number');
        return;
      }

      // Validate ItemCost if provided
      if (
        workDetailData.ItemCost &&
        isNaN(parseInt(String(workDetailData.ItemCost)))
      ) {
        log.warn('Add work detail invalid ItemCost', { ItemCost: workDetailData.ItemCost });
        ErrorResponses.badRequest(res, 'ItemCost must be a valid number');
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

      // Create item data with required WorkID
      const itemData = {
        WorkID: workDetailData.WorkID,
        ...workDetailData
      };

      const result = await addWorkDetail(itemData);
      res.json({
        success: true,
        detailId: result?.ID,
        itemId: result?.ID, // Alias for new naming
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

      // Validate CanalsNo if provided
      if (
        workDetailData.CanalsNo &&
        isNaN(parseInt(String(workDetailData.CanalsNo)))
      ) {
        log.warn('Update work detail invalid CanalsNo', { id, CanalsNo: workDetailData.CanalsNo });
        ErrorResponses.badRequest(res, 'CanalsNo must be a valid number');
        return;
      }

      // Validate ItemCost if provided
      if (
        workDetailData.ItemCost &&
        isNaN(parseInt(String(workDetailData.ItemCost)))
      ) {
        log.warn('Update work detail invalid ItemCost', { id, ItemCost: workDetailData.ItemCost });
        ErrorResponses.badRequest(res, 'ItemCost must be a valid number');
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

      // Create item data with required WorkID from URL
      const workItemData = {
        ...itemData,
        WorkID: parseInt(workId)
      };

      const result = await addWorkItem(workItemData);
      res.json({
        success: true,
        itemId: result?.ID,
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
                "ID",
                "DxDate",
                "WorkID",
                "Diagnosis",
                "TreatmentPlan",
                "ChiefComplain",
                "fAnteroPosterior",
                "fVertical",
                "fTransverse",
                "fLipCompetence",
                "fNasoLabialAngle",
                "fUpperIncisorShowRest",
                "fUpperIncisorShowSmile",
                "ITeethPresent",
                "IDentalHealth",
                "ILowerCrowding",
                "ILowerIncisorInclination",
                "ICurveofSpee",
                "IUpperCrowding",
                "IUpperIncisorInclination",
                "OIncisorRelation",
                "OOverjet",
                "OOverbite",
                "OCenterlines",
                "OMolarRelation",
                "OCanineRelation",
                "OFunctionalOcclusion",
                "C_SNA",
                "C_SNB",
                "C_ANB",
                "C_SNMx",
                "C_Wits",
                "C_FMA",
                "C_MMA",
                "C_UIMX",
                "C_LIMd",
                "C_UI_LI",
                "C_LI_APo",
                "C_Ulip_E",
                "C_Llip_E",
                "C_Naso_lip",
                "C_TAFH",
                "C_UAFH",
                "C_LAFH",
                "C_PercentLAFH",
                "Appliance"
            FROM "tblDiagnosis"
            WHERE "WorkID" = ${parseInt(workId)}
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
      if (!diagnosisData.WorkID) {
        log.warn('Save diagnosis missing WorkID');
        ErrorResponses.missingParameter(res, 'WorkID');
        return;
      }
      if (!diagnosisData.Diagnosis || !diagnosisData.Diagnosis.trim()) {
        log.warn('Save diagnosis missing Diagnosis', { WorkID: diagnosisData.WorkID });
        ErrorResponses.missingParameter(res, 'Diagnosis');
        return;
      }
      if (!diagnosisData.TreatmentPlan || !diagnosisData.TreatmentPlan.trim()) {
        log.warn('Save diagnosis missing TreatmentPlan', { WorkID: diagnosisData.WorkID });
        ErrorResponses.missingParameter(res, 'TreatmentPlan');
        return;
      }

      const db = getKysely();
      const workIdNum = parseInt(String(diagnosisData.WorkID));

      // Normalized column values (null for empty strings — preserves original semantics).
      const dxDate = diagnosisData.DxDate
        ? new Date(diagnosisData.DxDate)
        : new Date();
      const diagnosis = diagnosisData.Diagnosis;
      const treatmentPlan = diagnosisData.TreatmentPlan;
      const chiefComplain = diagnosisData.ChiefComplain || null;
      const appliance = diagnosisData.Appliance || null;
      // Facial Analysis
      const fAnteroPosterior = diagnosisData.fAnteroPosterior || null;
      const fVertical = diagnosisData.fVertical || null;
      const fTransverse = diagnosisData.fTransverse || null;
      const fLipCompetence = diagnosisData.fLipCompetence || null;
      const fNasoLabialAngle = diagnosisData.fNasoLabialAngle || null;
      const fUpperIncisorShowRest = diagnosisData.fUpperIncisorShowRest || null;
      const fUpperIncisorShowSmile = diagnosisData.fUpperIncisorShowSmile || null;
      // Intraoral Analysis
      const iTeethPresent = diagnosisData.ITeethPresent || null;
      const iDentalHealth = diagnosisData.IDentalHealth || null;
      const iLowerCrowding = diagnosisData.ILowerCrowding || null;
      const iLowerIncisorInclination = diagnosisData.ILowerIncisorInclination || null;
      const iCurveofSpee = diagnosisData.ICurveofSpee || null;
      const iUpperCrowding = diagnosisData.IUpperCrowding || null;
      const iUpperIncisorInclination = diagnosisData.IUpperIncisorInclination || null;
      // Occlusion Analysis
      const oIncisorRelation = diagnosisData.OIncisorRelation || null;
      const oOverjet = diagnosisData.OOverjet || null;
      const oOverbite = diagnosisData.OOverbite || null;
      const oCenterlines = diagnosisData.OCenterlines || null;
      const oMolarRelation = diagnosisData.OMolarRelation || null;
      const oCanineRelation = diagnosisData.OCanineRelation || null;
      const oFunctionalOcclusion = diagnosisData.OFunctionalOcclusion || null;
      // Cephalometric Analysis
      const c_SNA = diagnosisData.C_SNA || null;
      const c_SNB = diagnosisData.C_SNB || null;
      const c_ANB = diagnosisData.C_ANB || null;
      const c_SNMx = diagnosisData.C_SNMx || null;
      const c_Wits = diagnosisData.C_Wits || null;
      const c_FMA = diagnosisData.C_FMA || null;
      const c_MMA = diagnosisData.C_MMA || null;
      const c_UIMX = diagnosisData.C_UIMX || null;
      const c_LIMd = diagnosisData.C_LIMd || null;
      const c_UI_LI = diagnosisData.C_UI_LI || null;
      const c_LI_APo = diagnosisData.C_LI_APo || null;
      const c_Ulip_E = diagnosisData.C_Ulip_E || null;
      const c_Llip_E = diagnosisData.C_Llip_E || null;
      const c_Naso_lip = diagnosisData.C_Naso_lip || null;
      const c_TAFH = diagnosisData.C_TAFH || null;
      const c_UAFH = diagnosisData.C_UAFH || null;
      const c_LAFH = diagnosisData.C_LAFH || null;
      const c_PercentLAFH = diagnosisData.C_PercentLAFH || null;

      // Upsert: try UPDATE first; INSERT only if no existing row was updated.
      // (The original IF-EXISTS check at L1460 collapses into the rowCount test.)
      const updateResult = await sql`
                UPDATE "tblDiagnosis"
                SET
                    "DxDate" = ${dxDate},
                    "Diagnosis" = ${diagnosis},
                    "TreatmentPlan" = ${treatmentPlan},
                    "ChiefComplain" = ${chiefComplain},
                    "Appliance" = ${appliance},
                    "fAnteroPosterior" = ${fAnteroPosterior},
                    "fVertical" = ${fVertical},
                    "fTransverse" = ${fTransverse},
                    "fLipCompetence" = ${fLipCompetence},
                    "fNasoLabialAngle" = ${fNasoLabialAngle},
                    "fUpperIncisorShowRest" = ${fUpperIncisorShowRest},
                    "fUpperIncisorShowSmile" = ${fUpperIncisorShowSmile},
                    "ITeethPresent" = ${iTeethPresent},
                    "IDentalHealth" = ${iDentalHealth},
                    "ILowerCrowding" = ${iLowerCrowding},
                    "ILowerIncisorInclination" = ${iLowerIncisorInclination},
                    "ICurveofSpee" = ${iCurveofSpee},
                    "IUpperCrowding" = ${iUpperCrowding},
                    "IUpperIncisorInclination" = ${iUpperIncisorInclination},
                    "OIncisorRelation" = ${oIncisorRelation},
                    "OOverjet" = ${oOverjet},
                    "OOverbite" = ${oOverbite},
                    "OCenterlines" = ${oCenterlines},
                    "OMolarRelation" = ${oMolarRelation},
                    "OCanineRelation" = ${oCanineRelation},
                    "OFunctionalOcclusion" = ${oFunctionalOcclusion},
                    "C_SNA" = ${c_SNA},
                    "C_SNB" = ${c_SNB},
                    "C_ANB" = ${c_ANB},
                    "C_SNMx" = ${c_SNMx},
                    "C_Wits" = ${c_Wits},
                    "C_FMA" = ${c_FMA},
                    "C_MMA" = ${c_MMA},
                    "C_UIMX" = ${c_UIMX},
                    "C_LIMd" = ${c_LIMd},
                    "C_UI_LI" = ${c_UI_LI},
                    "C_LI_APo" = ${c_LI_APo},
                    "C_Ulip_E" = ${c_Ulip_E},
                    "C_Llip_E" = ${c_Llip_E},
                    "C_Naso_lip" = ${c_Naso_lip},
                    "C_TAFH" = ${c_TAFH},
                    "C_UAFH" = ${c_UAFH},
                    "C_LAFH" = ${c_LAFH},
                    "C_PercentLAFH" = ${c_PercentLAFH}
                WHERE "WorkID" = ${workIdNum}
            `.execute(db);

      let successMessage: string;

      if (Number(updateResult.numAffectedRows ?? 0) > 0) {
        successMessage = 'Diagnosis updated successfully';
      } else {
        // INSERT new diagnosis
        await sql`
                INSERT INTO "tblDiagnosis" (
                    "DxDate", "WorkID", "Diagnosis", "TreatmentPlan", "ChiefComplain", "Appliance",
                    "fAnteroPosterior", "fVertical", "fTransverse", "fLipCompetence", "fNasoLabialAngle",
                    "fUpperIncisorShowRest", "fUpperIncisorShowSmile",
                    "ITeethPresent", "IDentalHealth", "ILowerCrowding", "ILowerIncisorInclination",
                    "ICurveofSpee", "IUpperCrowding", "IUpperIncisorInclination",
                    "OIncisorRelation", "OOverjet", "OOverbite", "OCenterlines", "OMolarRelation",
                    "OCanineRelation", "OFunctionalOcclusion",
                    "C_SNA", "C_SNB", "C_ANB", "C_SNMx", "C_Wits", "C_FMA", "C_MMA", "C_UIMX", "C_LIMd",
                    "C_UI_LI", "C_LI_APo", "C_Ulip_E", "C_Llip_E", "C_Naso_lip",
                    "C_TAFH", "C_UAFH", "C_LAFH", "C_PercentLAFH"
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
        successMessage = 'Diagnosis created successfully';
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

      await sql`DELETE FROM "tblDiagnosis" WHERE "WorkID" = ${parseInt(workId)}`.execute(
        getKysely()
      );

      res.json({
        success: true,
        message: 'Diagnosis deleted successfully'
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
          workId: work.workid,
          type: work.TypeName,
          status: work.StatusName,
          doctor: work.DoctorName,
          totalRequired: work.TotalRequired,
          currency: work.Currency,
          currentPatient: {
            personId: work.PersonID,
            name: work.PatientName
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
