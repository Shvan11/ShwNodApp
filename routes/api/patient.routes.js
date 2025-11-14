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
import { getTimePoints, getTimePointImgs } from '../../services/database/queries/timepoint-queries.js';
import { getPatientsPhones, getInfos, createPatient, getPatientById, updatePatient, deletePatient } from '../../services/database/queries/patient-queries.js';
import * as imaging from '../../services/imaging/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { requireRecordAge, getPatientCreationDate } from '../../middleware/time-based-auth.js';
import { WebSocketEvents } from '../../services/messaging/websocket-events.js';
import { getOption } from '../../services/database/queries/options-queries.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';

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
    const { code: pid } = req.query;
    const infos = await getInfos(pid);
    res.json(infos);
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
    const { code: pid } = req.query;
    const timepoints = await getTimePoints(pid);
    res.json(timepoints);
});

/**
 * Get time point images for a patient
 * GET /gettimepointimgs?code={patientId}&tp={timepoint}
 */
router.get("/gettimepointimgs", async (req, res) => {
    const { code: pid, tp } = req.query;
    const timepointimgs = await getTimePointImgs(pid, tp);
    res.json(timepointimgs);
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
router.get("/getgal", (req, res) => {
    const { code: pid, tp } = req.query;
    const images = imaging.getImageSizes(pid, tp);
    res.json(images);
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
 * Search patients by name, phone, or ID
 * GET /patients/search?q={query}&patientName={name}&firstName={first}&lastName={last}
 */
router.get('/patients/search', async (req, res) => {
    try {
        const searchQuery = req.query.q || '';
        const patientName = req.query.patientName || '';
        const firstName = req.query.firstName || '';
        const lastName = req.query.lastName || '';

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

        const whereClause = whereConditions.length > 0
            ? 'WHERE ' + whereConditions.join(' AND ')
            : '';

        const query = `
            SELECT TOP 100 p.PersonID, p.patientID, p.PatientName, p.FirstName, p.LastName,
                    p.Phone, p.Phone2, p.Email, p.DateofBirth, p.Gender,
                    p.AddressID, p.ReferralSourceID, p.PatientTypeID,
                    p.Notes, p.Alerts, p.Language, p.CountryCode,
                    g.Gender as GenderName, a.Zone as AddressName,
                    r.Referral as ReferralSource, pt.PatientType as PatientTypeName
            FROM dbo.tblpatients p
            LEFT JOIN dbo.tblGender g ON p.Gender = g.Gender_ID
            LEFT JOIN dbo.tblAddress a ON p.AddressID = a.ID
            LEFT JOIN dbo.tblReferrals r ON p.ReferralSourceID = r.ID
            LEFT JOIN dbo.tblPatientType pt ON p.PatientTypeID = pt.ID
            ${whereClause}
            ORDER BY p.PatientName
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
                Notes: columns[13].value,
                Alerts: columns[14].value,
                Language: columns[15].value,
                CountryCode: columns[16].value,
                GenderName: columns[17].value,
                AddressName: columns[18].value,
                ReferralSource: columns[19].value,
                PatientTypeName: columns[20].value
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
    try {
        const patientData = req.body;

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
        log.error('Error creating patient:', error);
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

export default router;
