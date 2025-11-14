/**
 * Media & Photo Management Routes
 *
 * Provides endpoints for managing patient photos and x-ray images through
 * the WebCeph system. Handles patient creation in WebCeph, image uploads,
 * and retrieval of WebCeph patient links and photo types.
 *
 * Note: Photo server routes are currently disabled as the photo-server.js
 * middleware file is missing. They are preserved here for future implementation.
 */

import express from 'express';
import * as database from '../../services/database/index.js';
import multer from 'multer';
import * as imaging from '../../services/imaging/index.js';
import webcephService from '../../services/webceph/webceph-service.js';

const router = express.Router();
const upload = multer();

// ==============================
// PHOTO SERVER ENDPOINTS
// ==============================
// ⚠️ DISABLED: Photo server routes - photo-server.js file is missing
// These routes were referencing middlewares/photo-server.js which doesn't exist
// TODO: Either implement photo-server.js or remove these routes entirely
/*
router.get('/photo-server/status', async (req, res) => {
    try {
        const { default: photoServer } = await import('../../middleware/photo-server.js');
        const { default: photoPathDetector } = await import('../../services/imaging/path-detector.js');

        const status = photoServer.getStatus();
        const allPaths = photoPathDetector.getAllDetectedPaths();

        res.json({
            status,
            detectedPaths: allPaths,
            isDetectionFresh: photoPathDetector.isDetectionFresh()
        });
    } catch (error) {
        console.error('Error getting photo server status:', error);
        res.status(500).json({
            error: error.message || "Failed to get photo server status"
        });
    }
});

router.post('/photo-server/re-detect', async (req, res) => {
    try {
        const { default: photoServer } = await import('../../middleware/photo-server.js');

        console.log('🔍 Manual photo path re-detection requested');
        await photoServer.initialize();

        const status = photoServer.getStatus();
        res.json({
            success: true,
            message: 'Photo paths re-detected successfully',
            status
        });
    } catch (error) {
        console.error('Error re-detecting photo paths:', error);
        res.status(500).json({
            error: error.message || "Failed to re-detect photo paths"
        });
    }
});
*/

// ==============================
// WEBCEPH API ENDPOINTS
// ==============================

/**
 * Create patient in WebCeph
 * POST /webceph/create-patient
 * Body: { personId, patientData }
 */
router.post('/webceph/create-patient', async (req, res) => {
    try {
        const { personId, patientData } = req.body;

        if (!personId) {
            return res.status(400).json({ error: 'PersonID is required' });
        }

        // Validate patient data
        const validation = webcephService.validatePatientData(patientData);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.errors.join(', ') });
        }

        // Create patient in WebCeph
        const result = await webcephService.createPatient(patientData);

        // Update local database with WebCeph information
        const updateQuery = `
            UPDATE tblPatients
            SET WebCephPatientID = @webcephPatientId,
                WebCephLink = @link,
                WebCephCreatedAt = GETDATE()
            WHERE PersonID = @personId
        `;

        await database.executeQuery(updateQuery, [
            ['webcephPatientId', database.TYPES.NVarChar, result.webcephPatientId],
            ['link', database.TYPES.NVarChar, result.link],
            ['personId', database.TYPES.Int, personId]
        ]);

        console.log(`[WebCeph] Patient created successfully for PersonID: ${personId}`);

        res.json({
            success: true,
            message: 'Patient created in WebCeph successfully',
            data: {
                webcephPatientId: result.webcephPatientId,
                link: result.link,
                linkId: result.linkId
            }
        });
    } catch (error) {
        console.error('[WebCeph] Error creating patient:', error);
        res.status(500).json({
            error: 'Failed to create patient in WebCeph',
            details: error.message
        });
    }
});

/**
 * Upload X-ray image to WebCeph
 * POST /webceph/upload-image
 * Form data: image (file), patientID, recordDate, targetClass
 */
router.post('/webceph/upload-image', upload.single('image'), async (req, res) => {
    try {
        const { patientID, recordDate, targetClass } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: 'Image file is required' });
        }

        // Step 1: Create a new record for this date (if it doesn't exist)
        let recordResult;
        try {
            recordResult = await webcephService.addNewRecord(patientID, recordDate);
            console.log(`[WebCeph] Record created or already exists`);
        } catch (error) {
            // If record already exists, that's fine, continue with upload
            if (!error.message.includes('already exist')) {
                throw error;
            }
            console.log(`[WebCeph] Using existing record for ${recordDate}`);
        }

        // Step 2: Upload the image to the record
        const uploadData = {
            patientID,
            recordHash: recordDate,
            targetClass,
            image: req.file.buffer,
            filename: req.file.originalname,
            contentType: req.file.mimetype,
            overwrite: true
        };

        // Validate upload data
        const validation = webcephService.validateUploadData(uploadData);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.errors.join(', ') });
        }

        // Upload to WebCeph
        const result = await webcephService.uploadImage(uploadData);

        console.log(`[WebCeph] Image uploaded successfully for patient: ${patientID}`);

        res.json({
            success: true,
            message: 'Image uploaded to WebCeph successfully',
            data: {
                big: result.big,
                thumbnail: result.thumbnail,
                link: result.link
            }
        });
    } catch (error) {
        console.error('[WebCeph] Error uploading image:', error);
        res.status(500).json({
            error: 'Failed to upload image to WebCeph',
            details: error.message
        });
    }
});

/**
 * Get WebCeph patient link for a patient
 * GET /webceph/patient-link/:personId
 */
router.get('/webceph/patient-link/:personId', async (req, res) => {
    try {
        const { personId } = req.params;

        if (!personId) {
            return res.status(400).json({ error: 'PersonID is required' });
        }

        const query = `
            SELECT WebCephPatientID, WebCephLink, WebCephCreatedAt
            FROM tblPatients
            WHERE PersonID = @personId
        `;

        const result = await database.executeQuery(
            query,
            [['personId', database.TYPES.Int, parseInt(personId)]],
            (columns) => ({
                webcephPatientId: columns[0].value,
                link: columns[1].value,
                createdAt: columns[2].value
            })
        );

        if (!result || result.length === 0 || !result[0].webcephPatientId) {
            return res.json({
                success: false,
                message: 'Patient not found in WebCeph',
                data: null
            });
        }

        res.json({
            success: true,
            data: result[0]
        });
    } catch (error) {
        console.error('[WebCeph] Error fetching patient link:', error);
        res.status(500).json({
            error: 'Failed to fetch WebCeph patient link',
            details: error.message
        });
    }
});

/**
 * Get available photo types
 * GET /webceph/photo-types
 */
router.get('/webceph/photo-types', async (req, res) => {
    try {
        const photoTypes = webcephService.getPhotoTypes();
        res.json({
            success: true,
            data: photoTypes
        });
    } catch (error) {
        console.error('[WebCeph] Error fetching photo types:', error);
        res.status(500).json({ error: 'Failed to fetch photo types' });
    }
});

export default router;
