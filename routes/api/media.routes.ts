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

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import * as database from '../../services/database/index.js';
import multer from 'multer';
import webcephService from '../../services/webceph/webceph-service.js';
import { ErrorResponses } from '../../utils/error-response.js';

const router = Router();
const upload = multer();

/**
 * Patient data for WebCeph creation
 */
interface WebCephPatientData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Request body for creating WebCeph patient
 */
interface CreateWebCephPatientBody {
  personId: number;
  patientData: WebCephPatientData;
}

/**
 * Request body for uploading image
 */
interface UploadImageBody {
  patientID: string;
  recordDate: string;
  targetClass: string;
}

/**
 * Route params for person ID
 */
interface PersonIdParams {
  personId: string;
}

/**
 * WebCeph patient link result
 */
interface WebCephPatientLink {
  webcephPatientId: string | null;
  link: string | null;
  createdAt: Date | null;
}

/**
 * Multer file interface
 */
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  stream?: NodeJS.ReadableStream;
}

/**
 * Request with file upload
 */
interface FileRequest extends Omit<Request<object, object, UploadImageBody>, 'file'> {
  file?: MulterFile;
}

// ==============================
// WEBCEPH API ENDPOINTS
// ==============================

/**
 * Create patient in WebCeph
 * POST /webceph/create-patient
 * Body: { personId, patientData }
 */
router.post('/webceph/create-patient', async (req: Request<object, object, CreateWebCephPatientBody>, res: Response): Promise<void> => {
  try {
    const { personId, patientData } = req.body;

    if (!personId) {
      ErrorResponses.missingParameter(res, 'personId');
      return;
    }

    // Validate patient data
    const validation = webcephService.validatePatientData(patientData);
    if (!validation.valid) {
      ErrorResponses.invalidParameter(res, 'patientData', { errors: validation.errors });
      return;
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

    log.info(`[WebCeph] Patient created successfully for PersonID: ${personId}`);

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
    log.error('[WebCeph] Error creating patient:', error);
    ErrorResponses.serverError(res, 'Failed to create patient in WebCeph', error as Error);
  }
});

/**
 * Upload X-ray image to WebCeph
 * POST /webceph/upload-image
 * Form data: image (file), patientID, recordDate, targetClass
 */
router.post('/webceph/upload-image', upload.single('image'), async (req: FileRequest, res: Response): Promise<void> => {
  try {
    const { patientID, recordDate, targetClass } = req.body;

    if (!req.file) {
      ErrorResponses.missingParameter(res, 'image');
      return;
    }

    // Step 1: Create a new record for this date (if it doesn't exist)
    try {
      await webcephService.addNewRecord(patientID, recordDate);
      log.info(`[WebCeph] Record created or already exists`);
    } catch (error) {
      const err = error as Error;
      // If record already exists, that's fine, continue with upload
      if (!err.message.includes('already exist')) {
        throw error;
      }
      log.info(`[WebCeph] Using existing record for ${recordDate}`);
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
    const uploadValidation = webcephService.validateUploadData(uploadData);
    if (!uploadValidation.valid) {
      ErrorResponses.invalidParameter(res, 'uploadData', { errors: uploadValidation.errors });
      return;
    }

    // Upload to WebCeph
    const result = await webcephService.uploadImage(uploadData);

    log.info(`[WebCeph] Image uploaded successfully for patient: ${patientID}`);

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
    log.error('[WebCeph] Error uploading image:', error);
    ErrorResponses.serverError(res, 'Failed to upload image to WebCeph', error as Error);
  }
});

/**
 * Get WebCeph patient link for a patient
 * GET /webceph/patient-link/:personId
 */
router.get('/webceph/patient-link/:personId', async (req: Request<PersonIdParams>, res: Response): Promise<void> => {
  try {
    const { personId } = req.params;

    if (!personId) {
      ErrorResponses.missingParameter(res, 'personId');
      return;
    }

    const query = `
      SELECT WebCephPatientID, WebCephLink, WebCephCreatedAt
      FROM tblPatients
      WHERE PersonID = @personId
    `;

    const result = await database.executeQuery<WebCephPatientLink>(
      query,
      [['personId', database.TYPES.Int, parseInt(personId)]],
      (columns) => ({
        webcephPatientId: columns[0].value as string | null,
        link: columns[1].value as string | null,
        createdAt: columns[2].value as Date | null
      })
    );

    if (!result || result.length === 0 || !result[0].webcephPatientId) {
      res.json({
        success: false,
        message: 'Patient not found in WebCeph',
        data: null
      });
      return;
    }

    res.json({
      success: true,
      data: result[0]
    });
  } catch (error) {
    log.error('[WebCeph] Error fetching patient link:', error);
    ErrorResponses.serverError(res, 'Failed to fetch WebCeph patient link', error as Error);
  }
});

/**
 * Get available photo types
 * GET /webceph/photo-types
 */
router.get('/webceph/photo-types', async (_req: Request, res: Response): Promise<void> => {
  try {
    const photoTypes = webcephService.getPhotoTypes();
    res.json({
      success: true,
      data: photoTypes
    });
  } catch (error) {
    log.error('[WebCeph] Error fetching photo types:', error);
    ErrorResponses.serverError(res, 'Failed to fetch photo types', error as Error);
  }
});

export default router;
