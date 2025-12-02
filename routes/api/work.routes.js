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

import express from 'express';
import * as database from '../../services/database/index.js';
import {
    getWorksByPatient,
    getWorkDetails,
    addWork,
    updateWork,
    finishWork,
    discontinueWork,
    reactivateWork,
    deleteWork,
    getActiveWork,
    getWorkById,
    validateStatusChange,
    getWorkTypes,
    getWorkKeywords,
    getWorkDetailsList,
    addWorkDetail,
    updateWorkDetail,
    deleteWorkDetail,
    addWorkWithInvoice,
    WORK_STATUS
} from '../../services/database/queries/work-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireRecordAge, getWorkCreationDate, isToday } from '../../middleware/time-based-auth.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import {
    validateAndCreateWork,
    validateAndCreateWorkWithInvoice,
    validateAndDeleteWork,
    WorkValidationError
} from '../../services/business/WorkService.js';

const router = express.Router();

// ===== WORK MANAGEMENT API ENDPOINTS =====

// Get work details (for visit page header) - First occurrence from line 791
router.get("/getworkdetails", async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return ErrorResponses.missingParameter(res, 'workId');
        }
        const work = await getWorkDetails(parseInt(workId));
        if (!work) {
            return ErrorResponses.notFound(res, 'Work');
        }
        res.json(work);
    } catch (error) {
        log.error('Error fetching work details:', error);
        return sendError(res, 500, 'Failed to fetch work details', error);
    }
});

// Get all works for a patient
router.get('/getworks', async (req, res) => {
    try {
        const { code: personId } = req.query;
        if (!personId) {
            return ErrorResponses.missingParameter(res, 'code (PersonID)');
        }

        const works = await getWorksByPatient(parseInt(personId));
        res.json(works);
    } catch (error) {
        log.error("Error fetching works:", error);
        return sendError(res, 500, 'Failed to fetch works', error);
    }
});

// Get single work by ID
router.get('/getwork/:workId', async (req, res) => {
    try {
        const { workId } = req.params;
        if (!workId) {
            return ErrorResponses.missingParameter(res, 'workId');
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

        const work = await database.executeQuery(
            query,
            [['WorkID', database.TYPES.Int, parseInt(workId)]],
            (columns) => ({
                workid: columns[0].value,
                PersonID: columns[1].value,
                TotalRequired: columns[2].value,
                Currency: columns[3].value,
                Typeofwork: columns[4].value,
                Notes: columns[5].value,
                Status: columns[6].value,
                DrID: columns[7].value,
                DoctorName: columns[8].value,
                TypeName: columns[9].value,
                StatusName: columns[10].value
            }),
            (results) => results.length > 0 ? results[0] : null
        );

        if (!work) {
            return ErrorResponses.notFound(res, 'Work');
        }

        res.json({ success: true, work });
    } catch (error) {
        log.error("Error fetching work:", error);
        return sendError(res, 500, 'Failed to fetch work', error);
    }
});

// Add new work
router.post('/addwork', async (req, res) => {
    try {
        // Delegate to service layer for validation and creation
        const result = await validateAndCreateWork(req.body);

        res.json({
            success: true,
            workId: result.workid,
            message: "Work added successfully"
        });
    } catch (error) {
        log.error("Error adding work:", error);

        // Handle validation errors from service layer
        if (error instanceof WorkValidationError) {
            if (error.code === 'DUPLICATE_ACTIVE_WORK') {
                return ErrorResponses.conflict(res, 'Patient already has an active work', error.details);
            }
            return ErrorResponses.badRequest(res, error.message, { code: error.code, ...error.details });
        }

        return sendError(res, 500, 'Failed to add work', error);
    }
});

// Add work with invoice (finished work with full payment)
router.post('/addWorkWithInvoice', async (req, res) => {
    try {
        // Delegate to service layer for validation and creation
        const result = await validateAndCreateWorkWithInvoice(req.body);

        res.json({
            success: true,
            workId: result.workId,
            invoiceId: result.invoiceId,
            message: "Work and invoice created successfully"
        });

    } catch (error) {
        log.error("Error adding work with invoice:", error);

        // Handle validation errors from service layer
        if (error instanceof WorkValidationError) {
            if (error.code === 'DUPLICATE_ACTIVE_WORK') {
                return ErrorResponses.conflict(res, 'Patient already has an active work', error.details);
            }
            return ErrorResponses.badRequest(res, error.message, { code: error.code, ...error.details });
        }

        return sendError(res, 500, 'Failed to add work with invoice', error);
    }
});

// Update existing work - Protected: Secretary cannot edit money fields for old works
router.put('/updatework',
    authenticate,
    authorize(['admin', 'secretary']),
    async (req, res) => {
        try {
            const { workId, ...workData } = req.body;

        if (!workId) {
            return ErrorResponses.missingParameter(res, 'workId');
        }

        // Validate DrID is provided
        if (!workData.DrID) {
            return ErrorResponses.badRequest(res, 'DrID is required');
        }

        // Validate data types
        if (isNaN(parseInt(workId)) || isNaN(parseInt(workData.DrID))) {
            return ErrorResponses.badRequest(res, 'workId and DrID must be valid numbers');
        }

        // Convert date strings to proper Date objects if provided
        ['StartDate', 'DebondDate', 'FPhotoDate', 'IPhotoDate', 'NotesDate'].forEach(field => {
            if (workData[field] && typeof workData[field] === 'string') {
                const date = new Date(workData[field]);
                if (isNaN(date.getTime())) {
                    return ErrorResponses.invalidParameter(res, field, 'Invalid date format');
                }
                workData[field] = date;
            }
        });

        // Fetch current work once if needed for validation
        const needsCurrentWork = workData.Status !== undefined ||
            (req.session?.userRole !== 'admin' && ['TotalRequired', 'Currency'].some(field => workData.hasOwnProperty(field)));

        let currentWork = null;
        if (needsCurrentWork) {
            currentWork = await getWorkById(parseInt(workId));
            if (!currentWork) {
                return ErrorResponses.notFound(res, 'Work not found');
            }
        }

        // ===== STATUS CHANGE VALIDATION =====
        if (workData.Status !== undefined && currentWork) {
            if (currentWork.Status !== workData.Status) {
                const validation = await validateStatusChange(
                    parseInt(workId),
                    workData.Status,
                    workData.PersonID || currentWork.PersonID
                );

                if (!validation.valid) {
                    return res.status(409).json({
                        error: 'Status Change Conflict',
                        message: validation.error,
                        existingWork: validation.existingWork
                    });
                }
            }
        }
        // ===== END STATUS VALIDATION =====

        // ===== FINANCIAL FIELDS PERMISSION CHECK =====
        const financialFields = ['TotalRequired', 'Currency'];
        let isChangingFinancialFields = false;

        if (req.session?.userRole !== 'admin' && currentWork && financialFields.some(field => workData.hasOwnProperty(field))) {
            isChangingFinancialFields = financialFields.some(field => {
                if (!workData.hasOwnProperty(field)) return false;

                const newValue = workData[field];
                const currentValue = currentWork[field];

                // Compare numeric and string fields appropriately
                if (field === 'TotalRequired') {
                    return Number(newValue) !== Number(currentValue);
                }
                return String(newValue) !== String(currentValue);
            });
        }

        if (isChangingFinancialFields) {
            const workCreationDate = await getWorkCreationDate(req);
            if (!isToday(workCreationDate)) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'Cannot edit financial fields (Total Required, Currency) for work not created today. Contact admin.',
                    restrictedFields: financialFields
                });
            }
        }
        // ===== END FINANCIAL FIELDS PERMISSION CHECK =====

        const result = await updateWork(parseInt(workId), workData);
        res.json({
            success: true,
            message: "Work updated successfully",
            rowsAffected: result.rowCount
        });
        } catch (error) {
            log.error("Error updating work:", error);
            return sendError(res, 500, 'Failed to update work', error);
        }
    }
);

// Finish/Complete work
router.post('/finishwork', async (req, res) => {
    try {
        const { workId } = req.body;

        if (!workId) {
            return ErrorResponses.missingParameter(res, 'workId');
        }

        if (isNaN(parseInt(workId))) {
            return ErrorResponses.invalidParameter(res, 'workId', 'Must be a valid number');
        }

        const result = await finishWork(parseInt(workId));
        res.json({
            success: true,
            message: "Work completed successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        log.error("Error finishing work:", error);
        return sendError(res, 500, 'Failed to finish work', error);
    }
});

// Discontinue work (patient abandoned treatment)
router.post('/discontinuework', async (req, res) => {
    try {
        const { workId } = req.body;

        if (!workId) {
            return ErrorResponses.missingParameter(res, 'workId');
        }

        if (isNaN(parseInt(workId))) {
            return ErrorResponses.invalidParameter(res, 'workId', 'Must be a valid number');
        }

        const result = await discontinueWork(parseInt(workId));
        res.json({
            success: true,
            message: "Work discontinued successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        log.error("Error discontinuing work:", error);
        return sendError(res, 500, 'Failed to discontinue work', error);
    }
});

// Reactivate work (change from discontinued/finished back to active)
router.post('/reactivatework', async (req, res) => {
    try {
        const { workId, personId } = req.body;

        if (!workId) {
            return ErrorResponses.missingParameter(res, 'workId');
        }

        if (isNaN(parseInt(workId))) {
            return ErrorResponses.invalidParameter(res, 'workId', 'Must be a valid number');
        }

        // Check if patient already has an active work
        if (personId) {
            const activeWork = await getActiveWork(parseInt(personId));
            if (activeWork && activeWork.workid !== parseInt(workId)) {
                return ErrorResponses.conflict(res, 'Patient already has an active work. Please finish or discontinue it first.', {
                    existingWorkId: activeWork.workid,
                    existingWorkType: activeWork.TypeName
                });
            }
        }

        const result = await reactivateWork(parseInt(workId));
        res.json({
            success: true,
            message: "Work reactivated successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        // Handle unique constraint violation (patient already has active work)
        if (error.number === 2601 && error.message.includes('UNQ_tblWork_Active')) {
            return ErrorResponses.conflict(res, 'Cannot reactivate: Patient already has an active work');
        }
        log.error("Error reactivating work:", error);
        return sendError(res, 500, 'Failed to reactivate work', error);
    }
});

// Get work status constants (for frontend reference)
router.get('/workstatuses', (req, res) => {
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

// Delete work - Protected: Secretary can only delete works created today
router.delete('/deletework',
    authenticate,
    authorize(['admin', 'secretary']),
    requireRecordAge({
        resourceType: 'work',
        operation: 'delete',
        getRecordDate: getWorkCreationDate
    }),
    async (req, res) => {
        try {
            const { workId } = req.body;

            if (!workId) {
                return ErrorResponses.missingParameter(res, 'workId');
            }

            if (isNaN(parseInt(workId))) {
                return ErrorResponses.invalidParameter(res, 'workId', 'Must be a valid number');
            }

            // Delegate to service layer for validation and deletion
            const result = await validateAndDeleteWork(parseInt(workId));

            res.json({
                success: true,
                message: "Work deleted successfully",
                rowsAffected: result.rowCount
            });
        } catch (error) {
            log.error("Error deleting work:", error);

            // Handle validation errors from service layer
            if (error instanceof WorkValidationError) {
                return ErrorResponses.conflict(res, error.message, error.details);
            }

            return sendError(res, 500, 'Failed to delete work', error);
        }
    }
);

// Get active work for a patient
router.get('/getactivework', async (req, res) => {
    try {
        const { code: personId } = req.query;
        if (!personId) {
            return ErrorResponses.missingParameter(res, 'code (PersonID)');
        }

        const activeWork = await getActiveWork(parseInt(personId));
        res.json(activeWork);
    } catch (error) {
        log.error("Error fetching active work:", error);
        return sendError(res, 500, 'Failed to fetch active work', error);
    }
});

// Get work types for dropdown
router.get('/getworktypes', async (req, res) => {
    try {
        const workTypes = await getWorkTypes();
        res.json(workTypes);
    } catch (error) {
        log.error("Error fetching work types:", error);
        return sendError(res, 500, 'Failed to fetch work types', error);
    }
});

// Get work keywords for dropdown
router.get('/getworkkeywords', async (req, res) => {
    try {
        const keywords = await getWorkKeywords();
        res.json(keywords);
    } catch (error) {
        log.error("Error fetching work keywords:", error);
        return sendError(res, 500, 'Failed to fetch work keywords', error);
    }
});

// ===== WORK DETAILS API ENDPOINTS =====

// Get work details list for a specific work
router.get('/getworkdetailslist', async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return ErrorResponses.missingParameter(res, 'workId');
        }

        const workDetailsList = await getWorkDetailsList(parseInt(workId));
        res.json(workDetailsList);
    } catch (error) {
        log.error("Error fetching work details list:", error);
        return sendError(res, 500, 'Failed to fetch work details list', error);
    }
});

// Add new work detail
router.post('/addworkdetail', async (req, res) => {
    try {
        const workDetailData = req.body;

        // Validate required fields
        if (!workDetailData.WorkID) {
            return ErrorResponses.missingParameter(res, 'WorkID');
        }

        // Validate data types
        if (isNaN(parseInt(workDetailData.WorkID))) {
            return ErrorResponses.invalidParameter(res, 'WorkID', 'Must be a valid number');
        }

        // Validate CanalsNo if provided
        if (workDetailData.CanalsNo && isNaN(parseInt(workDetailData.CanalsNo))) {
            return ErrorResponses.invalidParameter(res, 'CanalsNo', 'Must be a valid number');
        }

        const result = await addWorkDetail(workDetailData);
        res.json({
            success: true,
            detailId: result.ID,
            message: "Work detail added successfully"
        });
    } catch (error) {
        log.error("Error adding work detail:", error);
        return sendError(res, 500, 'Failed to add work detail', error);
    }
});

// Update existing work detail
router.put('/updateworkdetail', async (req, res) => {
    try {
        const { detailId, ...workDetailData } = req.body;

        if (!detailId) {
            return ErrorResponses.missingParameter(res, 'detailId');
        }

        // Validate data types
        if (isNaN(parseInt(detailId))) {
            return ErrorResponses.invalidParameter(res, 'detailId', 'Must be a valid number');
        }

        // Validate CanalsNo if provided
        if (workDetailData.CanalsNo && isNaN(parseInt(workDetailData.CanalsNo))) {
            return ErrorResponses.invalidParameter(res, 'CanalsNo', 'Must be a valid number');
        }

        const result = await updateWorkDetail(parseInt(detailId), workDetailData);
        res.json({
            success: true,
            message: "Work detail updated successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        log.error("Error updating work detail:", error);
        return sendError(res, 500, 'Failed to update work detail', error);
    }
});

// Delete work detail
router.delete('/deleteworkdetail', async (req, res) => {
    try {
        const { detailId } = req.body;

        if (!detailId) {
            return ErrorResponses.missingParameter(res, 'detailId');
        }

        if (isNaN(parseInt(detailId))) {
            return ErrorResponses.invalidParameter(res, 'detailId', 'Must be a valid number');
        }

        const result = await deleteWorkDetail(parseInt(detailId));
        res.json({
            success: true,
            message: "Work detail deleted successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        log.error("Error deleting work detail:", error);
        return sendError(res, 500, 'Failed to delete work detail', error);
    }
});

// ===== DIAGNOSIS & TREATMENT PLANNING API ENDPOINTS =====

/**
 * GET /api/diagnosis/:workId
 * Get comprehensive diagnosis data for a specific work
 */
router.get('/diagnosis/:workId', async (req, res) => {
    try {
        const { workId } = req.params;

        if (!workId) {
            return ErrorResponses.missingParameter(res, 'workId');
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
        if (result.length === 0) {
            return res.json(null);
        }

        res.json(result[0]);
    } catch (error) {
        log.error('Error fetching diagnosis:', error);
        return sendError(res, 500, 'Failed to fetch diagnosis', error);
    }
});

/**
 * POST /api/diagnosis
 * Create or update diagnosis (upsert operation)
 */
router.post('/diagnosis', async (req, res) => {
    try {
        const diagnosisData = req.body;

        // Validate required fields
        if (!diagnosisData.WorkID) {
            return ErrorResponses.missingParameter(res, 'WorkID');
        }
        if (!diagnosisData.Diagnosis || !diagnosisData.Diagnosis.trim()) {
            return ErrorResponses.missingParameter(res, 'Diagnosis');
        }
        if (!diagnosisData.TreatmentPlan || !diagnosisData.TreatmentPlan.trim()) {
            return ErrorResponses.missingParameter(res, 'TreatmentPlan');
        }

        // Check if diagnosis already exists for this work
        const checkQuery = `SELECT ID FROM tblDiagnosis WHERE WorkID = @workId`;
        const existingDiagnosis = await database.executeQuery(checkQuery, [
            ['workId', database.TYPES.Int, parseInt(diagnosisData.WorkID)]
        ]);

        let query;
        let successMessage;

        if (existingDiagnosis.length > 0) {
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
        const params = [
            ['dxDate', database.TYPES.DateTime2, diagnosisData.DxDate ? new Date(diagnosisData.DxDate) : new Date()],
            ['workId', database.TYPES.Int, parseInt(diagnosisData.WorkID)],
            ['diagnosis', database.TYPES.NVarChar, diagnosisData.Diagnosis],
            ['treatmentPlan', database.TYPES.NVarChar, diagnosisData.TreatmentPlan],
            ['chiefComplain', database.TYPES.NVarChar, diagnosisData.ChiefComplain || null],
            ['appliance', database.TYPES.NVarChar, diagnosisData.Appliance || null],
            // Facial Analysis
            ['fAnteroPosterior', database.TYPES.NVarChar, diagnosisData.fAnteroPosterior || null],
            ['fVertical', database.TYPES.NVarChar, diagnosisData.fVertical || null],
            ['fTransverse', database.TYPES.NVarChar, diagnosisData.fTransverse || null],
            ['fLipCompetence', database.TYPES.NVarChar, diagnosisData.fLipCompetence || null],
            ['fNasoLabialAngle', database.TYPES.NVarChar, diagnosisData.fNasoLabialAngle || null],
            ['fUpperIncisorShowRest', database.TYPES.NVarChar, diagnosisData.fUpperIncisorShowRest || null],
            ['fUpperIncisorShowSmile', database.TYPES.NVarChar, diagnosisData.fUpperIncisorShowSmile || null],
            // Intraoral Analysis
            ['iTeethPresent', database.TYPES.NVarChar, diagnosisData.ITeethPresent || null],
            ['iDentalHealth', database.TYPES.NVarChar, diagnosisData.IDentalHealth || null],
            ['iLowerCrowding', database.TYPES.NVarChar, diagnosisData.ILowerCrowding || null],
            ['iLowerIncisorInclination', database.TYPES.NVarChar, diagnosisData.ILowerIncisorInclination || null],
            ['iCurveofSpee', database.TYPES.NVarChar, diagnosisData.ICurveofSpee || null],
            ['iUpperCrowding', database.TYPES.NVarChar, diagnosisData.IUpperCrowding || null],
            ['iUpperIncisorInclination', database.TYPES.NVarChar, diagnosisData.IUpperIncisorInclination || null],
            // Occlusion Analysis
            ['oIncisorRelation', database.TYPES.NVarChar, diagnosisData.OIncisorRelation || null],
            ['oOverjet', database.TYPES.NVarChar, diagnosisData.OOverjet || null],
            ['oOverbite', database.TYPES.NVarChar, diagnosisData.OOverbite || null],
            ['oCenterlines', database.TYPES.NVarChar, diagnosisData.OCenterlines || null],
            ['oMolarRelation', database.TYPES.NVarChar, diagnosisData.OMolarRelation || null],
            ['oCanineRelation', database.TYPES.NVarChar, diagnosisData.OCanineRelation || null],
            ['oFunctionalOcclusion', database.TYPES.NVarChar, diagnosisData.OFunctionalOcclusion || null],
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
            ['c_Naso_lip', database.TYPES.NVarChar, diagnosisData.C_Naso_lip || null],
            ['c_TAFH', database.TYPES.NVarChar, diagnosisData.C_TAFH || null],
            ['c_UAFH', database.TYPES.NVarChar, diagnosisData.C_UAFH || null],
            ['c_LAFH', database.TYPES.NVarChar, diagnosisData.C_LAFH || null],
            ['c_PercentLAFH', database.TYPES.NVarChar, diagnosisData.C_PercentLAFH || null]
        ];

        await database.executeQuery(query, params);

        res.json({
            success: true,
            message: successMessage
        });
    } catch (error) {
        log.error('Error saving diagnosis:', error);
        return sendError(res, 500, 'Failed to save diagnosis', error);
    }
});

/**
 * DELETE /api/diagnosis/:workId
 * Delete diagnosis for a specific work
 */
router.delete('/diagnosis/:workId', async (req, res) => {
    try {
        const { workId } = req.params;

        if (!workId) {
            return ErrorResponses.missingParameter(res, 'workId');
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
        return sendError(res, 500, 'Failed to delete diagnosis', error);
    }
});

export default router;
