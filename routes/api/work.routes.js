/**
 * Work/Treatment Management API Routes
 *
 * This module handles all work (treatment) related operations including:
 * - Work CRUD operations (create, read, update, delete)
 * - Work details management (treatment details)
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
    deleteWork,
    getActiveWork,
    getWorkTypes,
    getWorkKeywords,
    getWorkDetailsList,
    addWorkDetail,
    updateWorkDetail,
    deleteWorkDetail,
    addWorkWithInvoice
} from '../../services/database/queries/work-queries.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireRecordAge, getWorkCreationDate } from '../../middleware/time-based-auth.js';
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
                w.Finished,
                w.DrID,
                e.employeeName as DoctorName,
                wt.WorkType as TypeName
            FROM tblwork w
            LEFT JOIN tblEmployees e ON w.DrID = e.ID
            LEFT JOIN tblWorkType wt ON w.Typeofwork = wt.ID
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
                Finished: columns[6].value,
                DrID: columns[7].value,
                DoctorName: columns[8].value,
                TypeName: columns[9].value
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
    requireRecordAge({
        resourceType: 'work',
        operation: 'update',
        getRecordDate: getWorkCreationDate,
        restrictedFields: ['TotalRequired', 'Paid', 'Discount'] // Money-related fields
    }),
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

export default router;
