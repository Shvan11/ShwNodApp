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
import * as database from '../../services/database/index.js';
import type { SqlParam } from '../../services/database/index.js';
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
  WorkValidationError,
  type WorkStatusType,
  type WorkErrorDetails,
  type DeleteResult
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

      const query = `
            SELECT
                w.workid,
                w.PersonID,
                w.TotalRequired,
                w.Currency,
                w.Typeofwork,
                w.Notes,
                w.Status,
                w.DrID,
                e.employeeName as DoctorName,
                wt.WorkType as TypeName,
                ws.StatusName
            FROM tblwork w
            LEFT JOIN tblEmployees e ON w.DrID = e.ID
            LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
            LEFT JOIN tblWorkStatus ws ON w.Status = ws.StatusID
            WHERE w.workid = @WorkID
        `;

      const work = await database.executeQuery<WorkResult, WorkResult | null>(
        query,
        [['WorkID', database.TYPES.Int, parseInt(workId)]],
        (columns) => ({
          workid: columns[0].value as number,
          PersonID: columns[1].value as number,
          TotalRequired: columns[2].value as number,
          Currency: columns[3].value as string,
          Typeofwork: columns[4].value as number,
          Notes: columns[5].value as string | null,
          Status: columns[6].value as number,
          DrID: columns[7].value as number,
          DoctorName: columns[8].value as string | null,
          TypeName: columns[9].value as string | null,
          StatusName: columns[10].value as string | null
        }),
        (results) => (results.length > 0 ? results[0] : null)
      );

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
      log.error('Error adding work:', error);

      // Handle validation errors from service layer
      if (error instanceof WorkValidationError) {
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
      log.error('Error adding work with invoice:', error);

      // Handle validation errors from service layer
      if (error instanceof WorkValidationError) {
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
        'NotesDate'
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
      // Handle unique constraint violation (patient already has active work)
      const err = error as Error & { number?: number };
      if (err.number === 2601 && err.message.includes('UNQ_tblWork_Active')) {
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
      log.error('Error deleting work:', error);

      // Handle validation errors from service layer
      if (error instanceof WorkValidationError) {
        ErrorResponses.conflict(res, error.message, error.details);
        return;
      }

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

      const query = `
            SELECT
                ID,
                DxDate,
                WorkID,
                Diagnosis,
                TreatmentPlan,
                ChiefComplain,
                fAnteroPosterior,
                fVertical,
                fTransverse,
                fLipCompetence,
                fNasoLabialAngle,
                fUpperIncisorShowRest,
                fUpperIncisorShowSmile,
                ITeethPresent,
                IDentalHealth,
                ILowerCrowding,
                ILowerIncisorInclination,
                ICurveofSpee,
                IUpperCrowding,
                IUpperIncisorInclination,
                OIncisorRelation,
                OOverjet,
                OOverbite,
                OCenterlines,
                OMolarRelation,
                OCanineRelation,
                OFunctionalOcclusion,
                C_SNA,
                C_SNB,
                C_ANB,
                C_SNMx,
                C_Wits,
                C_FMA,
                C_MMA,
                C_UIMX,
                C_LIMd,
                C_UI_LI,
                C_LI_APo,
                C_Ulip_E,
                C_Llip_E,
                C_Naso_lip,
                C_TAFH,
                C_UAFH,
                C_LAFH,
                C_PercentLAFH,
                Appliance
            FROM tblDiagnosis
            WHERE WorkID = @workId
        `;

      const result = await database.executeQuery(query, [
        ['workId', database.TYPES.Int, parseInt(workId)]
      ]);

      // Return null if no diagnosis found (not an error)
      if ((result as unknown[]).length === 0) {
        res.json(null);
        return;
      }

      res.json((result as unknown[])[0]);
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

      // Check if diagnosis already exists for this work
      const checkQuery = `SELECT ID FROM tblDiagnosis WHERE WorkID = @workId`;
      const existingDiagnosis = await database.executeQuery(checkQuery, [
        ['workId', database.TYPES.Int, parseInt(String(diagnosisData.WorkID))]
      ]);

      let query: string;
      let successMessage: string;

      if ((existingDiagnosis as unknown[]).length > 0) {
        // UPDATE existing diagnosis
        query = `
                UPDATE tblDiagnosis
                SET
                    DxDate = @dxDate,
                    Diagnosis = @diagnosis,
                    TreatmentPlan = @treatmentPlan,
                    ChiefComplain = @chiefComplain,
                    Appliance = @appliance,
                    fAnteroPosterior = @fAnteroPosterior,
                    fVertical = @fVertical,
                    fTransverse = @fTransverse,
                    fLipCompetence = @fLipCompetence,
                    fNasoLabialAngle = @fNasoLabialAngle,
                    fUpperIncisorShowRest = @fUpperIncisorShowRest,
                    fUpperIncisorShowSmile = @fUpperIncisorShowSmile,
                    ITeethPresent = @iTeethPresent,
                    IDentalHealth = @iDentalHealth,
                    ILowerCrowding = @iLowerCrowding,
                    ILowerIncisorInclination = @iLowerIncisorInclination,
                    ICurveofSpee = @iCurveofSpee,
                    IUpperCrowding = @iUpperCrowding,
                    IUpperIncisorInclination = @iUpperIncisorInclination,
                    OIncisorRelation = @oIncisorRelation,
                    OOverjet = @oOverjet,
                    OOverbite = @oOverbite,
                    OCenterlines = @oCenterlines,
                    OMolarRelation = @oMolarRelation,
                    OCanineRelation = @oCanineRelation,
                    OFunctionalOcclusion = @oFunctionalOcclusion,
                    C_SNA = @c_SNA,
                    C_SNB = @c_SNB,
                    C_ANB = @c_ANB,
                    C_SNMx = @c_SNMx,
                    C_Wits = @c_Wits,
                    C_FMA = @c_FMA,
                    C_MMA = @c_MMA,
                    C_UIMX = @c_UIMX,
                    C_LIMd = @c_LIMd,
                    C_UI_LI = @c_UI_LI,
                    C_LI_APo = @c_LI_APo,
                    C_Ulip_E = @c_Ulip_E,
                    C_Llip_E = @c_Llip_E,
                    C_Naso_lip = @c_Naso_lip,
                    C_TAFH = @c_TAFH,
                    C_UAFH = @c_UAFH,
                    C_LAFH = @c_LAFH,
                    C_PercentLAFH = @c_PercentLAFH
                WHERE WorkID = @workId
            `;
        successMessage = 'Diagnosis updated successfully';
      } else {
        // INSERT new diagnosis
        query = `
                INSERT INTO tblDiagnosis (
                    DxDate, WorkID, Diagnosis, TreatmentPlan, ChiefComplain, Appliance,
                    fAnteroPosterior, fVertical, fTransverse, fLipCompetence, fNasoLabialAngle,
                    fUpperIncisorShowRest, fUpperIncisorShowSmile,
                    ITeethPresent, IDentalHealth, ILowerCrowding, ILowerIncisorInclination,
                    ICurveofSpee, IUpperCrowding, IUpperIncisorInclination,
                    OIncisorRelation, OOverjet, OOverbite, OCenterlines, OMolarRelation,
                    OCanineRelation, OFunctionalOcclusion,
                    C_SNA, C_SNB, C_ANB, C_SNMx, C_Wits, C_FMA, C_MMA, C_UIMX, C_LIMd,
                    C_UI_LI, C_LI_APo, C_Ulip_E, C_Llip_E, C_Naso_lip,
                    C_TAFH, C_UAFH, C_LAFH, C_PercentLAFH
                )
                VALUES (
                    @dxDate, @workId, @diagnosis, @treatmentPlan, @chiefComplain, @appliance,
                    @fAnteroPosterior, @fVertical, @fTransverse, @fLipCompetence, @fNasoLabialAngle,
                    @fUpperIncisorShowRest, @fUpperIncisorShowSmile,
                    @iTeethPresent, @iDentalHealth, @iLowerCrowding, @iLowerIncisorInclination,
                    @iCurveofSpee, @iUpperCrowding, @iUpperIncisorInclination,
                    @oIncisorRelation, @oOverjet, @oOverbite, @oCenterlines, @oMolarRelation,
                    @oCanineRelation, @oFunctionalOcclusion,
                    @c_SNA, @c_SNB, @c_ANB, @c_SNMx, @c_Wits, @c_FMA, @c_MMA, @c_UIMX, @c_LIMd,
                    @c_UI_LI, @c_LI_APo, @c_Ulip_E, @c_Llip_E, @c_Naso_lip,
                    @c_TAFH, @c_UAFH, @c_LAFH, @c_PercentLAFH
                )
            `;
        successMessage = 'Diagnosis created successfully';
      }

      // Build parameters - handle null/empty values
      const params: SqlParam[] = [
        [
          'dxDate',
          database.TYPES.DateTime2,
          diagnosisData.DxDate ? new Date(diagnosisData.DxDate) : new Date()
        ],
        ['workId', database.TYPES.Int, parseInt(String(diagnosisData.WorkID))],
        ['diagnosis', database.TYPES.NVarChar, diagnosisData.Diagnosis],
        ['treatmentPlan', database.TYPES.NVarChar, diagnosisData.TreatmentPlan],
        [
          'chiefComplain',
          database.TYPES.NVarChar,
          diagnosisData.ChiefComplain || null
        ],
        ['appliance', database.TYPES.NVarChar, diagnosisData.Appliance || null],
        // Facial Analysis
        [
          'fAnteroPosterior',
          database.TYPES.NVarChar,
          diagnosisData.fAnteroPosterior || null
        ],
        ['fVertical', database.TYPES.NVarChar, diagnosisData.fVertical || null],
        [
          'fTransverse',
          database.TYPES.NVarChar,
          diagnosisData.fTransverse || null
        ],
        [
          'fLipCompetence',
          database.TYPES.NVarChar,
          diagnosisData.fLipCompetence || null
        ],
        [
          'fNasoLabialAngle',
          database.TYPES.NVarChar,
          diagnosisData.fNasoLabialAngle || null
        ],
        [
          'fUpperIncisorShowRest',
          database.TYPES.NVarChar,
          diagnosisData.fUpperIncisorShowRest || null
        ],
        [
          'fUpperIncisorShowSmile',
          database.TYPES.NVarChar,
          diagnosisData.fUpperIncisorShowSmile || null
        ],
        // Intraoral Analysis
        [
          'iTeethPresent',
          database.TYPES.NVarChar,
          diagnosisData.ITeethPresent || null
        ],
        [
          'iDentalHealth',
          database.TYPES.NVarChar,
          diagnosisData.IDentalHealth || null
        ],
        [
          'iLowerCrowding',
          database.TYPES.NVarChar,
          diagnosisData.ILowerCrowding || null
        ],
        [
          'iLowerIncisorInclination',
          database.TYPES.NVarChar,
          diagnosisData.ILowerIncisorInclination || null
        ],
        [
          'iCurveofSpee',
          database.TYPES.NVarChar,
          diagnosisData.ICurveofSpee || null
        ],
        [
          'iUpperCrowding',
          database.TYPES.NVarChar,
          diagnosisData.IUpperCrowding || null
        ],
        [
          'iUpperIncisorInclination',
          database.TYPES.NVarChar,
          diagnosisData.IUpperIncisorInclination || null
        ],
        // Occlusion Analysis
        [
          'oIncisorRelation',
          database.TYPES.NVarChar,
          diagnosisData.OIncisorRelation || null
        ],
        ['oOverjet', database.TYPES.NVarChar, diagnosisData.OOverjet || null],
        ['oOverbite', database.TYPES.NVarChar, diagnosisData.OOverbite || null],
        [
          'oCenterlines',
          database.TYPES.NVarChar,
          diagnosisData.OCenterlines || null
        ],
        [
          'oMolarRelation',
          database.TYPES.NVarChar,
          diagnosisData.OMolarRelation || null
        ],
        [
          'oCanineRelation',
          database.TYPES.NVarChar,
          diagnosisData.OCanineRelation || null
        ],
        [
          'oFunctionalOcclusion',
          database.TYPES.NVarChar,
          diagnosisData.OFunctionalOcclusion || null
        ],
        // Cephalometric Analysis
        ['c_SNA', database.TYPES.NVarChar, diagnosisData.C_SNA || null],
        ['c_SNB', database.TYPES.NVarChar, diagnosisData.C_SNB || null],
        ['c_ANB', database.TYPES.NVarChar, diagnosisData.C_ANB || null],
        ['c_SNMx', database.TYPES.NVarChar, diagnosisData.C_SNMx || null],
        ['c_Wits', database.TYPES.NVarChar, diagnosisData.C_Wits || null],
        ['c_FMA', database.TYPES.NVarChar, diagnosisData.C_FMA || null],
        ['c_MMA', database.TYPES.NVarChar, diagnosisData.C_MMA || null],
        ['c_UIMX', database.TYPES.NVarChar, diagnosisData.C_UIMX || null],
        ['c_LIMd', database.TYPES.NVarChar, diagnosisData.C_LIMd || null],
        ['c_UI_LI', database.TYPES.NVarChar, diagnosisData.C_UI_LI || null],
        ['c_LI_APo', database.TYPES.NVarChar, diagnosisData.C_LI_APo || null],
        ['c_Ulip_E', database.TYPES.NVarChar, diagnosisData.C_Ulip_E || null],
        ['c_Llip_E', database.TYPES.NVarChar, diagnosisData.C_Llip_E || null],
        [
          'c_Naso_lip',
          database.TYPES.NVarChar,
          diagnosisData.C_Naso_lip || null
        ],
        ['c_TAFH', database.TYPES.NVarChar, diagnosisData.C_TAFH || null],
        ['c_UAFH', database.TYPES.NVarChar, diagnosisData.C_UAFH || null],
        ['c_LAFH', database.TYPES.NVarChar, diagnosisData.C_LAFH || null],
        [
          'c_PercentLAFH',
          database.TYPES.NVarChar,
          diagnosisData.C_PercentLAFH || null
        ]
      ];

      await database.executeQuery(query, params);

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

      const query = `DELETE FROM tblDiagnosis WHERE WorkID = @workId`;

      await database.executeQuery(query, [
        ['workId', database.TYPES.Int, parseInt(workId)]
      ]);

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
      log.error('Error getting transfer preview:', error);

      if (error instanceof WorkValidationError) {
        if (error.code === 'WORK_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Work');
          return;
        }
        ErrorResponses.badRequest(res, error.message, error.details);
        return;
      }

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
      log.error('Error transferring work:', error);

      if (error instanceof WorkValidationError) {
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

      sendError(res, 500, 'Failed to transfer work', error as Error);
    }
  }
);

export default router;
