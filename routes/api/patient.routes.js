/**
 * Patient Management API Routes
 *
 * This module handles all patient-related API endpoints including:
 * - Patient information retrieval
 * - Time points and imaging
 * - QR code generation
 * - Patient CRUD operations (create, read, update, delete)
 * - Patient search and phone number retrieval
 * - Patient folder settings
 * - Patient load/unload events for desktop application integration
 */

import express from 'express';
import { log } from '../../utils/logger.js';
import * as database from '../../services/database/index.js';
import { getPatientsPhones, createPatient, getPatientById, updatePatient, deletePatient, hasNextAppointment } from '../../services/database/queries/patient-queries.js';
import { getAlertsByPersonId, createAlert, setAlertStatus } from '../../services/database/queries/alert-queries.js';
import * as imaging from '../../services/imaging/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireRecordAge, getPatientCreationDate } from '../../middleware/time-based-auth.js';
import { WebSocketEvents } from '../../services/messaging/websocket-events.js';
import { getOption } from '../../services/database/queries/options-queries.js';
import { ErrorResponses } from '../../utils/error-response.js';
import * as PatientService from '../../services/business/PatientService.js';
import { PatientValidationError } from '../../services/business/PatientService.js';

const router = express.Router();

// WebSocket emitter will be injected to avoid circular imports
let wsEmitter = null;

/**
 * Set the WebSocket emitter reference
 * @param {EventEmitter} emitter - WebSocket event emitter
 */
export function setWebSocketEmitter(emitter) {
    wsEmitter = emitter;
}

// ===== PATIENT INFORMATION ROUTES =====

/**
 * Get patient information
 * GET /getinfos?code={patientId}
 */
router.get("/getinfos", async (req, res) => {
    try {
        const { code: patientId } = req.query;
        const info = await PatientService.getPatientInfo(patientId);
        res.json(info);
    } catch (error) {
        if (error instanceof PatientValidationError) {
            return res.status(400).json({
                error: error.message,
                code: error.code,
                details: error.details
            });
        }
        log.error('Error fetching patient info:', error);
        res.status(500).json({
            error: 'Failed to fetch patient information',
            message: error.message
        });
    }
});

/**
 * Get PatientsFolder setting from tbloptions
 * GET /settings/patients-folder
 */
router.get("/settings/patients-folder", async (req, res) => {
    try {
        const patientsFolder = await getOption('PatientsFolder');
        res.json({ patientsFolder: patientsFolder || '' });
    } catch (error) {
        log.error('Error fetching PatientsFolder setting:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch PatientsFolder setting', error);
    }
});

// ===== TIME POINTS AND IMAGING ROUTES =====

/**
 * Get time points for a patient
 * GET /gettimepoints?code={patientId}
 */
router.get("/gettimepoints", async (req, res) => {
    try {
        const { code: patientId } = req.query;
        const timepoints = await PatientService.getPatientTimePoints(patientId);
        res.json(timepoints);
    } catch (error) {
        if (error instanceof PatientValidationError) {
            return res.status(400).json({
                error: error.message,
                code: error.code,
                details: error.details
            });
        }
        log.error('Error fetching time points:', error);
        res.status(500).json({
            error: 'Failed to fetch time points',
            message: error.message
        });
    }
});

/**
 * Get time point images for a patient
 * GET /gettimepointimgs?code={patientId}&tp={timepoint}
 */
router.get("/gettimepointimgs", async (req, res) => {
    try {
        const { code: patientId, tp } = req.query;
        const timepointimgs = await PatientService.getPatientTimePointImages(patientId, tp);
        res.json(timepointimgs);
    } catch (error) {
        if (error instanceof PatientValidationError) {
            return res.status(400).json({
                error: error.message,
                code: error.code,
                details: error.details
            });
        }
        log.error('Error fetching time point images:', error);
        res.status(500).json({
            error: 'Failed to fetch time point images',
            message: error.message
        });
    }
});

/**
 * Generate and get QR code for a patient
 * GET /getqrcode?code={patientId}
 */
router.get("/getqrcode", async (req, res) => {
    const { code: pid } = req.query;
    await imaging.generateQRCode(pid);
    res.json({ OK: "OK" });
});

/**
 * Get gallery images for a patient
 * GET /getgal?code={patientId}&tp={timepoint}
 */
router.get("/getgal", async (req, res) => {
    try {
        const { code: pid, tp } = req.query;
        const images = await imaging.getImageSizes(pid, tp);
        res.json(images);
    } catch (error) {
        log.error('Error getting gallery images:', error);
        return ErrorResponses.internalError(res, 'Failed to load gallery images', {
            message: error.message
        });
    }
});

/**
 * Get and process X-ray image
 * GET /getxray?code={patientId}&file={filename}&detailsDir={directory}
 */
router.get("/getxray", async (req, res) => {
    try {
        const { code: pid, file, detailsDir } = req.query;

        if (!pid || !file) {
            return ErrorResponses.badRequest(res, 'Missing required parameters: code and file');
        }

        const imagePath = await imaging.processXrayImage(pid, file, detailsDir);
        res.sendFile(imagePath);
    } catch (error) {
        log.error('Error processing X-ray:', error);
        return ErrorResponses.internalError(res, 'X-ray processing failed', {
            message: error.message,
            note: 'X-ray processing tool may not be available in this environment'
        });
    }
});

// ===== PATIENT LOAD/UNLOAD EVENTS =====

/**
 * Handle patient loaded event from desktop application
 * GET /patientloaded?pid={patientId}&screenid={screenId}
 */
router.get("/patientloaded", (req, res) => {
    res.sendStatus(200);
    const { pid, screenid: screenID } = req.query;
    log.info(`PatientLoaded called with pid: ${pid}, screenID: ${screenID}`);

    // Emit universal event only
    if (wsEmitter) {
        wsEmitter.emit(WebSocketEvents.PATIENT_LOADED, pid, screenID);
    }
});

/**
 * Handle patient unloaded event from desktop application
 * GET /patientunloaded?screenid={screenId}
 */
router.get("/patientunloaded", (req, res) => {
    res.sendStatus(200);
    const { screenid: screenID } = req.query;
    log.info(`PatientUnloaded called with screenID: ${screenID}`);

    // Emit universal event only
    if (wsEmitter) {
        wsEmitter.emit(WebSocketEvents.PATIENT_UNLOADED, screenID);
    }
});

// ===== PATIENT PHONE NUMBERS =====

/**
 * Get all patient phone numbers
 * GET /patientsPhones
 */
router.get("/patientsPhones", async (req, res) => {
    try {
        const phonesList = await getPatientsPhones();
        res.json(phonesList);
    } catch (error) {
        log.error("Error fetching patients phones:", error);
        return ErrorResponses.internalError(res, 'Failed to fetch patients phones', error);
    }
});

// ===== PATIENT SEARCH =====

/**
 * Search patients by name, phone, ID, work type, keywords, and tags
 * GET /patients/search?q={query}&patientName={name}&firstName={first}&lastName={last}&workTypes={ids}&keywords={ids}&tags={ids}
 */
router.get('/patients/search', async (req, res) => {
    try {
        const searchQuery = req.query.q || '';
        const patientName = req.query.patientName || '';
        const firstName = req.query.firstName || '';
        const lastName = req.query.lastName || '';
        const workTypesParam = req.query.workTypes || '';
        const keywordsParam = req.query.keywords || '';
        const tagsParam = req.query.tags || '';

        const sortBy = req.query.sortBy || 'name'; // 'name' or 'date'
        const order = req.query.order || 'asc'; // 'asc' or 'desc'

        // Parse comma-separated IDs into arrays
        const workTypeIds = workTypesParam ? workTypesParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : [];
        const keywordIds = keywordsParam ? keywordsParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : [];
        const tagIds = tagsParam ? tagsParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : [];

        // Build WHERE clause for search
        let whereConditions = [];
        const parameters = [];

        // Search by individual name fields
        if (patientName.trim()) {
            whereConditions.push('p.PatientName LIKE @patientName');
            parameters.push(['patientName', database.TYPES.NVarChar, `%${patientName.trim()}%`]);
        }

        if (firstName.trim()) {
            whereConditions.push('p.FirstName LIKE @firstName');
            parameters.push(['firstName', database.TYPES.NVarChar, `%${firstName.trim()}%`]);
        }

        if (lastName.trim()) {
            whereConditions.push('p.LastName LIKE @lastName');
            parameters.push(['lastName', database.TYPES.NVarChar, `%${lastName.trim()}%`]);
        }

        // General search (phone or ID)
        if (searchQuery.trim()) {
            whereConditions.push('(p.Phone LIKE @search OR p.Phone2 LIKE @search OR p.patientID LIKE @search)');
            parameters.push(['search', database.TYPES.NVarChar, `%${searchQuery.trim()}%`]);
        }

        // Filter by work types (ANY work, past or current)
        if (workTypeIds.length > 0) {
            const workTypePlaceholders = workTypeIds.map((_, idx) => `@workType${idx}`).join(',');
            whereConditions.push(`EXISTS (
                SELECT 1 FROM dbo.tblwork w
                WHERE w.PersonID = p.PersonID
                AND w.Typeofwork IN (${workTypePlaceholders})
            )`);
            workTypeIds.forEach((id, idx) => {
                parameters.push([`workType${idx}`, database.TYPES.Int, id]);
            });
        }

        // Filter by keywords (check all 5 keyword columns)
        if (keywordIds.length > 0) {
            const keywordPlaceholders = keywordIds.map((_, idx) => `@keyword${idx}`).join(',');
            whereConditions.push(`EXISTS (
                SELECT 1 FROM dbo.tblwork w
                WHERE w.PersonID = p.PersonID
                AND (
                    w.KeyWordID1 IN (${keywordPlaceholders})
                    OR w.KeyWordID2 IN (${keywordPlaceholders})
                    OR w.KeywordID3 IN (${keywordPlaceholders})
                    OR w.KeywordID4 IN (${keywordPlaceholders})
                    OR w.KeywordID5 IN (${keywordPlaceholders})
                )
            )`);
            keywordIds.forEach((id, idx) => {
                parameters.push([`keyword${idx}`, database.TYPES.Int, id]);
            });
        }

        // Filter by patient tags
        if (tagIds.length > 0) {
            const tagPlaceholders = tagIds.map((_, idx) => `@tag${idx}`).join(',');
            whereConditions.push(`p.TagID IN (${tagPlaceholders})`);
            tagIds.forEach((id, idx) => {
                parameters.push([`tag${idx}`, database.TYPES.Int, id]);
            });
        }

        const whereClause = whereConditions.length > 0
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';

        // Determine ORDER BY clause
        let orderByClause = 'ORDER BY p.PatientName ASC';
        if (sortBy === 'date') {
            orderByClause = order === 'desc' ? 'ORDER BY p.DateAdded DESC' : 'ORDER BY p.DateAdded ASC';
        } else {
            orderByClause = order === 'desc' ? 'ORDER BY p.PatientName DESC' : 'ORDER BY p.PatientName ASC';
        }

        const query = `
            SELECT DISTINCT TOP 100
                    p.PersonID, p.patientID, p.PatientName, p.FirstName, p.LastName,
                    p.Phone, p.Phone2, p.Email, p.DateofBirth, p.Gender,
                    p.AddressID, p.ReferralSourceID, p.PatientTypeID, p.TagID,
                    p.Notes, p.Language, p.CountryCode,
                    p.EstimatedCost, p.Currency, p.DateAdded,
                    g.Gender as GenderName, a.Zone as AddressName,
                    r.Referral as ReferralSource, pt.PatientType as PatientTypeName,
                    tag.Tag as TagName,
                    (
                        SELECT STRING_AGG(wt.WorkType, ', ')
                        FROM (
                            SELECT DISTINCT wt2.WorkType
                            FROM dbo.tblwork w2
                            INNER JOIN dbo.tblWorkType wt2 ON w2.Typeofwork = wt2.ID
                            WHERE w2.PersonID = p.PersonID AND w2.Finished = 0
                        ) wt
                    ) as ActiveWorkTypes
            FROM dbo.tblpatients p
            LEFT JOIN dbo.tblGender g ON p.Gender = g.Gender_ID
            LEFT JOIN dbo.tblAddress a ON p.AddressID = a.ID
            LEFT JOIN dbo.tblReferrals r ON p.ReferralSourceID = r.ID
            LEFT JOIN dbo.tblPatientType pt ON p.PatientTypeID = pt.ID
            LEFT JOIN dbo.tblTagOptions tag ON p.TagID = tag.ID
            ${whereClause}
            ${orderByClause}
        `;

        const patients = await database.executeQuery(
            query,
            parameters,
            (columns) => ({
                PersonID: columns[0].value,
                patientID: columns[1].value,
                PatientName: columns[2].value,
                FirstName: columns[3].value,
                LastName: columns[4].value,
                Phone: columns[5].value,
                Phone2: columns[6].value,
                Email: columns[7].value,
                DateofBirth: columns[8].value,
                Gender: columns[9].value,
                AddressID: columns[10].value,
                ReferralSourceID: columns[11].value,
                PatientTypeID: columns[12].value,
                TagID: columns[13].value,
                Notes: columns[14].value,
                Language: columns[15].value,
                CountryCode: columns[16].value,
                EstimatedCost: columns[17].value,
                Currency: columns[18].value,
                DateAdded: columns[19].value,
                GenderName: columns[20].value,
                AddressName: columns[21].value,
                ReferralSource: columns[22].value,
                PatientTypeName: columns[23].value,
                TagName: columns[24].value,
                ActiveWorkTypes: columns[25].value
            })
        );

        res.json(patients);
    } catch (error) {
        log.error('Error searching patients:', error);
        return ErrorResponses.internalError(res, 'Failed to search patients', error);
    }
});

// ===== PATIENT CRUD OPERATIONS =====

/**
 * Get single patient by ID
 * GET /getpatient/:personId
 */
router.get('/getpatient/:personId', async (req, res) => {
    try {
        const { personId } = req.params;
        if (!personId) {
            return ErrorResponses.missingParameter(res, 'personId');
        }

        const patient = await getPatientById(parseInt(personId));

        if (!patient) {
            return ErrorResponses.notFound(res, 'Patient');
        }

        // Fetch and attach alerts
        const alerts = await getAlertsByPersonId(patient.PersonID);
        patient.alerts = alerts;

        res.json(patient);
    } catch (error) {
        log.error("Error fetching patient:", error);
        return ErrorResponses.internalError(res, 'Failed to fetch patient', error);
    }
});

/**
 * Create new patient
 * POST /patients
 */
router.post('/patients', async (req, res) => {
    const patientData = req.body;

    try {
        // Basic validation
        if (!patientData.patientName || !patientData.patientName.trim()) {
            return ErrorResponses.badRequest(res, 'Patient name is required');
        }

        // Trim string values
        Object.keys(patientData).forEach(key => {
            if (typeof patientData[key] === 'string') {
                patientData[key] = patientData[key].trim();
                // Convert empty strings to null for optional fields
                if (patientData[key] === '' && key !== 'patientName') {
                    patientData[key] = null;
                }
            }
        });

        // Create the patient
        const result = await createPatient(patientData);

        res.json({
            success: true,
            personId: result.personId,
            message: "Patient created successfully"
        });

    } catch (error) {
        // Handle duplicate patient name error
        if (error.code === 'DUPLICATE_PATIENT_NAME') {
            log.warn(`Duplicate patient name attempted: ${patientData.patientName}`);
            return res.status(409).json({
                success: false,
                error: error.message,
                code: 'DUPLICATE_PATIENT_NAME',
                existingPatientId: error.existingPatientId
            });
        }

        log.error('Error creating patient', { error });
        return ErrorResponses.internalError(res, 'Failed to create patient', error);
    }
});

/**
 * Update patient
 * PUT /patients/:personId
 */
router.put('/patients/:personId', async (req, res) => {
    try {
        const personId = parseInt(req.params.personId);
        const patientData = req.body;

        // Basic validation
        if (!patientData.PatientName || !patientData.PatientName.trim()) {
            return ErrorResponses.badRequest(res, 'Patient name is required');
        }

        const result = await updatePatient(personId, patientData);
        res.json({ success: true, message: 'Patient updated successfully' });
    } catch (error) {
        log.error('Error updating patient:', error);
        return ErrorResponses.internalError(res, 'Failed to update patient', error);
    }
});

/**
 * Delete patient
 * DELETE /patients/:personId
 * Protected: Secretary can only delete patients created today
 */
router.delete('/patients/:personId',
    authenticate,
    authorize(['admin', 'secretary']),
    requireRecordAge({
        resourceType: 'patient',
        operation: 'delete',
        getRecordDate: getPatientCreationDate
    }),
    async (req, res) => {
        try {
            const personId = parseInt(req.params.personId);
            const result = await deletePatient(personId);
            res.json({ success: true, message: 'Patient deleted successfully' });
        } catch (error) {
            log.error('Error deleting patient:', error);
            return ErrorResponses.internalError(res, 'Failed to delete patient', error);
        }
    }
);

// ===== ALERT MANAGEMENT =====

/**
 * Create a new alert for a patient
 * POST /patients/:personId/alerts
 */
router.post('/patients/:personId/alerts', authenticate, authorize(['admin', 'secretary', 'doctor']), async (req, res) => {
    try {
        const personId = parseInt(req.params.personId, 10);
        const {
            alertTypeId,
            alertSeverity,
            alertDetails
        } = req.body;

        if (!alertTypeId || !alertSeverity || !alertDetails) {
            return ErrorResponses.badRequest(res, 'Missing required fields: alertTypeId, alertSeverity, alertDetails');
        }

        await createAlert({
            PersonID: personId,
            AlertTypeID: parseInt(alertTypeId, 10),
            AlertSeverity: parseInt(alertSeverity, 10),
            AlertDetails: alertDetails
        });

        res.status(201).json({ success: true, message: 'Alert created successfully' });
    } catch (error) {
        log.error('Error creating alert:', error);
        return ErrorResponses.internalError(res, 'Failed to create alert', error);
    }
});

/**
 * Activate or deactivate an alert
 * PUT /alerts/:alertId/status
 */
router.put('/alerts/:alertId/status', authenticate, authorize(['admin', 'secretary', 'doctor']), async (req, res) => {
    try {
        const alertId = parseInt(req.params.alertId, 10);
        const { isActive } = req.body;

        if (typeof isActive !== 'boolean') {
            return ErrorResponses.badRequest(res, 'isActive must be a boolean value');
        }

        await setAlertStatus(alertId, isActive);

        res.json({ success: true, message: `Alert status updated to ${isActive}` });
    } catch (error) {
        log.error('Error updating alert status:', error);
        return ErrorResponses.internalError(res, 'Failed to update alert status', error);
    }
});

// ===== APPOINTMENT CHECK ROUTE =====

/**
 * Check if patient has a future appointment
 * GET /patients/:patientId/has-appointment
 */
router.get('/patients/:patientId/has-appointment', async (req, res) => {
    try {
        const patientId = parseInt(req.params.patientId, 10);

        if (isNaN(patientId)) {
            return ErrorResponses.badRequest(res, 'Invalid patient ID');
        }

        const hasAppointment = await hasNextAppointment(patientId);

        res.json({
            success: true,
            hasAppointment
        });
    } catch (error) {
        log.error(`Error checking appointment for patient ${req.params.patientId}:`, error);
        return ErrorResponses.internalError(res, 'Failed to check appointment status', error);
    }
});

// ===== TAG OPTIONS =====

/**
 * Get all tag options
 * GET /tag-options
 */
router.get('/tag-options', async (req, res) => {
    try {
        const tags = await database.executeQuery(
            'SELECT ID, Tag FROM dbo.tblTagOptions ORDER BY Tag',
            [],
            (columns) => ({
                ID: columns[0].value,
                Tag: columns[1].value
            })
        );
        res.json(tags);
    } catch (error) {
        log.error('Error fetching tag options:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch tag options', error);
    }
});

export default router;
