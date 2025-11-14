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

const router = express.Router();

// ===== WORK MANAGEMENT API ENDPOINTS =====

// Get work details (for visit page header) - First occurrence from line 791
router.get("/getworkdetails", async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }
        const work = await getWorkDetails(parseInt(workId));
        if (!work) {
            return res.status(404).json({ error: "Work not found" });
        }
        res.json(work);
    } catch (error) {
        console.error('Error fetching work details:', error);
        res.status(500).json({ error: 'Failed to fetch work details' });
    }
});

// Get all works for a patient
router.get('/getworks', async (req, res) => {
    try {
        const { code: personId } = req.query;
        if (!personId) {
            return res.status(400).json({ error: "Missing required parameter: code (PersonID)" });
        }

        const works = await getWorksByPatient(parseInt(personId));
        res.json(works);
    } catch (error) {
        console.error("Error fetching works:", error);
        res.status(500).json({ error: "Failed to fetch works" });
    }
});

// Get single work by ID
router.get('/getwork/:workId', async (req, res) => {
    try {
        const { workId } = req.params;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
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
            return res.status(404).json({ success: false, error: "Work not found" });
        }

        res.json({ success: true, work });
    } catch (error) {
        console.error("Error fetching work:", error);
        res.status(500).json({ success: false, error: "Failed to fetch work" });
    }
});

// Add new work
router.post('/addwork', async (req, res) => {
    const workData = req.body;  // Moved outside try block so it's accessible in catch
    try {

        // Validate required fields
        if (!workData.PersonID || !workData.DrID) {
            return res.status(400).json({
                error: "Missing required fields: PersonID and DrID are required"
            });
        }

        // Default TotalRequired to 0 if empty or not provided
        if (workData.TotalRequired === '' || workData.TotalRequired === null || workData.TotalRequired === undefined) {
            workData.TotalRequired = 0;
        }

        // Validate Typeofwork is required
        if (!workData.Typeofwork) {
            return res.status(400).json({
                error: "Typeofwork is required"
            });
        }

        // Validate data types
        if (isNaN(parseInt(workData.PersonID)) || isNaN(parseInt(workData.DrID))) {
            return res.status(400).json({
                error: "PersonID and DrID must be valid numbers"
            });
        }

        // Convert date strings to proper Date objects if provided
        ['StartDate', 'DebondDate', 'FPhotoDate', 'IPhotoDate', 'NotesDate'].forEach(field => {
            if (workData[field] && typeof workData[field] === 'string') {
                const date = new Date(workData[field]);
                if (isNaN(date.getTime())) {
                    return res.status(400).json({
                        error: `Invalid date format for ${field}`
                    });
                }
                workData[field] = date;
            }
        });

        const result = await addWork(workData);
        res.json({
            success: true,
            workId: result.workid,
            message: "Work added successfully"
        });
    } catch (error) {
        console.error("Error adding work:", error);

        // Handle duplicate active work constraint violation
        if (error.number === 2601 && error.message.includes('UNQ_tblWork_Active')) {
            try {
                // Fetch the existing active work details to show to the user
                const existingWork = await getActiveWork(workData.PersonID);
                return res.status(409).json({
                    error: "Patient already has an active work",
                    details: "This patient already has an active (unfinished) work record. You can finish the existing work and add the new one.",
                    code: "DUPLICATE_ACTIVE_WORK",
                    existingWork: existingWork ? {
                        workId: existingWork.workid,
                        typeOfWork: existingWork.Typeofwork,
                        typeName: existingWork.TypeName,
                        doctor: existingWork.DoctorName,
                        additionDate: existingWork.AdditionDate,
                        totalRequired: existingWork.TotalRequired,
                        currency: existingWork.Currency
                    } : null
                });
            } catch (fetchError) {
                // If we can't fetch the existing work, return basic error
                return res.status(409).json({
                    error: "Patient already has an active work",
                    details: "This patient already has an active (unfinished) work record. Please complete or finish the existing work before adding a new one.",
                    code: "DUPLICATE_ACTIVE_WORK"
                });
            }
        }

        res.status(500).json({ error: "Failed to add work", details: error.message });
    }
});

// Add work with invoice (finished work with full payment)
router.post('/addWorkWithInvoice', async (req, res) => {
    const workData = req.body;
    try {
        // Validate required fields
        if (!workData.PersonID || !workData.DrID) {
            return res.status(400).json({
                error: "Missing required fields: PersonID and DrID are required"
            });
        }

        // Validate createAsFinished flag
        if (!workData.createAsFinished) {
            return res.status(400).json({
                error: "createAsFinished flag must be true for this endpoint"
            });
        }

        // Validate TotalRequired
        if (!workData.TotalRequired || parseFloat(workData.TotalRequired) <= 0) {
            return res.status(400).json({
                error: "TotalRequired must be greater than 0 for finished work with invoice"
            });
        }

        // Validate Currency
        if (!workData.Currency) {
            return res.status(400).json({
                error: "Currency is required for finished work with invoice"
            });
        }

        // Validate Typeofwork
        if (!workData.Typeofwork) {
            return res.status(400).json({
                error: "Typeofwork is required"
            });
        }

        // Validate data types
        if (isNaN(parseInt(workData.PersonID)) || isNaN(parseInt(workData.DrID))) {
            return res.status(400).json({
                error: "PersonID and DrID must be valid numbers"
            });
        }

        // Convert date strings to proper Date objects if provided
        ['StartDate', 'DebondDate', 'FPhotoDate', 'IPhotoDate', 'NotesDate'].forEach(field => {
            if (workData[field] && typeof workData[field] === 'string') {
                const date = new Date(workData[field]);
                if (isNaN(date.getTime())) {
                    return res.status(400).json({
                        error: `Invalid date format for ${field}`
                    });
                }
                workData[field] = date;
            }
        });

        // Call service layer function to handle business logic
        const result = await addWorkWithInvoice(workData);

        res.json({
            success: true,
            workId: result.workId,
            invoiceId: result.invoiceId,
            message: "Work and invoice created successfully"
        });

    } catch (error) {
        console.error("Error adding work with invoice:", error);

        // Handle duplicate active work constraint violation
        if (error.number === 2601 && error.message.includes('UNQ_tblWork_Active')) {
            try {
                const existingWork = await getActiveWork(workData.PersonID);
                return res.status(409).json({
                    error: "Patient already has an active work",
                    details: "This patient already has an active (unfinished) work record. You can finish the existing work and add the new one.",
                    code: "DUPLICATE_ACTIVE_WORK",
                    existingWork: existingWork ? {
                        workId: existingWork.workid,
                        typeOfWork: existingWork.Typeofwork,
                        typeName: existingWork.TypeName,
                        doctor: existingWork.DoctorName,
                        additionDate: existingWork.AdditionDate,
                        totalRequired: existingWork.TotalRequired,
                        currency: existingWork.Currency
                    } : null
                });
            } catch (fetchError) {
                return res.status(409).json({
                    error: "Patient already has an active work",
                    details: "This patient already has an active (unfinished) work record. Please complete or finish the existing work before adding a new one.",
                    code: "DUPLICATE_ACTIVE_WORK"
                });
            }
        }

        res.status(500).json({
            error: "Failed to add work with invoice",
            details: error.message
        });
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
            return res.status(400).json({ error: "Missing required field: workId" });
        }

        // Validate DrID is provided
        if (!workData.DrID) {
            return res.status(400).json({ error: "DrID is required" });
        }

        // Validate data types
        if (isNaN(parseInt(workId)) || isNaN(parseInt(workData.DrID))) {
            return res.status(400).json({
                error: "workId and DrID must be valid numbers"
            });
        }

        // Convert date strings to proper Date objects if provided
        ['StartDate', 'DebondDate', 'FPhotoDate', 'IPhotoDate', 'NotesDate'].forEach(field => {
            if (workData[field] && typeof workData[field] === 'string') {
                const date = new Date(workData[field]);
                if (isNaN(date.getTime())) {
                    return res.status(400).json({
                        error: `Invalid date format for ${field}`
                    });
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
            console.error("Error updating work:", error);
            res.status(500).json({ error: "Failed to update work", details: error.message });
        }
    }
);

// Finish/Complete work
router.post('/finishwork', async (req, res) => {
    try {
        const { workId } = req.body;

        if (!workId) {
            return res.status(400).json({ error: "Missing required field: workId" });
        }

        if (isNaN(parseInt(workId))) {
            return res.status(400).json({ error: "workId must be a valid number" });
        }

        const result = await finishWork(parseInt(workId));
        res.json({
            success: true,
            message: "Work completed successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        console.error("Error finishing work:", error);
        res.status(500).json({ error: "Failed to finish work", details: error.message });
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
            return res.status(400).json({ error: "Missing required field: workId" });
        }

        if (isNaN(parseInt(workId))) {
            return res.status(400).json({ error: "workId must be a valid number" });
        }

        const result = await deleteWork(parseInt(workId));

        // Check if work has dependencies that prevent deletion
        if (!result.canDelete) {
            const deps = result.dependencies;
            const dependencyMessages = [];

            if (deps.InvoiceCount > 0) dependencyMessages.push(`${deps.InvoiceCount} payment(s)`);
            if (deps.VisitCount > 0) dependencyMessages.push(`${deps.VisitCount} visit(s)`);
            if (deps.DetailCount > 0) dependencyMessages.push(`${deps.DetailCount} detail(s)`);
            if (deps.DiagnosisCount > 0) dependencyMessages.push(`${deps.DiagnosisCount} diagnosis(es)`);
            if (deps.ImplantCount > 0) dependencyMessages.push(`${deps.ImplantCount} implant(s)`);
            if (deps.ScrewCount > 0) dependencyMessages.push(`${deps.ScrewCount} screw(s)`);

            return res.status(409).json({
                success: false,
                error: "Cannot delete work with existing records",
                message: `This work has ${dependencyMessages.join(', ')} that must be deleted first.`,
                dependencies: deps
            });
        }

        res.json({
            success: true,
            message: "Work deleted successfully",
            rowsAffected: result.rowCount
        });
        } catch (error) {
            console.error("Error deleting work:", error);
            res.status(500).json({ error: "Failed to delete work", details: error.message });
        }
    }
);

// Get active work for a patient
router.get('/getactivework', async (req, res) => {
    try {
        const { code: personId } = req.query;
        if (!personId) {
            return res.status(400).json({ error: "Missing required parameter: code (PersonID)" });
        }

        const activeWork = await getActiveWork(parseInt(personId));
        res.json(activeWork);
    } catch (error) {
        console.error("Error fetching active work:", error);
        res.status(500).json({ error: "Failed to fetch active work" });
    }
});

// Get work types for dropdown
router.get('/getworktypes', async (req, res) => {
    try {
        const workTypes = await getWorkTypes();
        res.json(workTypes);
    } catch (error) {
        console.error("Error fetching work types:", error);
        res.status(500).json({ error: "Failed to fetch work types" });
    }
});

// Get work keywords for dropdown
router.get('/getworkkeywords', async (req, res) => {
    try {
        const keywords = await getWorkKeywords();
        res.json(keywords);
    } catch (error) {
        console.error("Error fetching work keywords:", error);
        res.status(500).json({ error: "Failed to fetch work keywords" });
    }
});

// ===== WORK DETAILS API ENDPOINTS =====

// Get work details list for a specific work
router.get('/getworkdetailslist', async (req, res) => {
    try {
        const { workId } = req.query;
        if (!workId) {
            return res.status(400).json({ error: "Missing required parameter: workId" });
        }

        const workDetailsList = await getWorkDetailsList(parseInt(workId));
        res.json(workDetailsList);
    } catch (error) {
        console.error("Error fetching work details list:", error);
        res.status(500).json({ error: "Failed to fetch work details list" });
    }
});

// Add new work detail
router.post('/addworkdetail', async (req, res) => {
    try {
        const workDetailData = req.body;

        // Validate required fields
        if (!workDetailData.WorkID) {
            return res.status(400).json({
                error: "Missing required field: WorkID"
            });
        }

        // Validate data types
        if (isNaN(parseInt(workDetailData.WorkID))) {
            return res.status(400).json({
                error: "WorkID must be a valid number"
            });
        }

        // Validate CanalsNo if provided
        if (workDetailData.CanalsNo && isNaN(parseInt(workDetailData.CanalsNo))) {
            return res.status(400).json({
                error: "CanalsNo must be a valid number"
            });
        }

        const result = await addWorkDetail(workDetailData);
        res.json({
            success: true,
            detailId: result.ID,
            message: "Work detail added successfully"
        });
    } catch (error) {
        console.error("Error adding work detail:", error);
        res.status(500).json({ error: "Failed to add work detail", details: error.message });
    }
});

// Update existing work detail
router.put('/updateworkdetail', async (req, res) => {
    try {
        const { detailId, ...workDetailData } = req.body;

        if (!detailId) {
            return res.status(400).json({ error: "Missing required field: detailId" });
        }

        // Validate data types
        if (isNaN(parseInt(detailId))) {
            return res.status(400).json({
                error: "detailId must be a valid number"
            });
        }

        // Validate CanalsNo if provided
        if (workDetailData.CanalsNo && isNaN(parseInt(workDetailData.CanalsNo))) {
            return res.status(400).json({
                error: "CanalsNo must be a valid number"
            });
        }

        const result = await updateWorkDetail(parseInt(detailId), workDetailData);
        res.json({
            success: true,
            message: "Work detail updated successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        console.error("Error updating work detail:", error);
        res.status(500).json({ error: "Failed to update work detail", details: error.message });
    }
});

// Delete work detail
router.delete('/deleteworkdetail', async (req, res) => {
    try {
        const { detailId } = req.body;

        if (!detailId) {
            return res.status(400).json({ error: "Missing required field: detailId" });
        }

        if (isNaN(parseInt(detailId))) {
            return res.status(400).json({ error: "detailId must be a valid number" });
        }

        const result = await deleteWorkDetail(parseInt(detailId));
        res.json({
            success: true,
            message: "Work detail deleted successfully",
            rowsAffected: result.rowCount
        });
    } catch (error) {
        console.error("Error deleting work detail:", error);
        res.status(500).json({ error: "Failed to delete work detail", details: error.message });
    }
});

export default router;
