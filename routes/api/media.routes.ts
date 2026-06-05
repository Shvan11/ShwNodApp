/**
 * Media & Photo Management Routes
 *
 * Provides endpoints for managing patient photos and x-ray images through
 * the WebCeph system. Handles patient creation in WebCeph, image uploads,
 * and retrieval of WebCeph patient links and photo types.
 *
 * note: Photo server routes are currently disabled as the photo-server.js
 * middleware file is missing. They are preserved here for future implementation.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { sql } from 'kysely';
import { getKysely } from '../../services/database/kysely.js';
import { log } from '../../utils/logger.js';
import multer from 'multer';
import webcephService from '../../services/webceph/webceph-service.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import * as media from '../../shared/contracts/media.contract.js';

const router = Router();

// In-memory upload with a hard size cap so an oversized/abusive body can't
// balloon RAM. X-ray/photo formats (.dcm/.pano/JPEG) sit well under 50MB;
// raise this if a legitimately larger study is ever rejected.
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

// Wrap multer so a size-limit / upload error returns a clean 400 instead of
// falling through to the generic 500 handler.
const uploadImage = (req: Request, res: Response, next: NextFunction): void => {
  upload.single('image')(req, res, (err: unknown) => {
    if (err) {
      const code = (err as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE') {
        ErrorResponses.badRequest(res, 'Image is too large. Maximum size is 50MB.');
        return;
      }
      ErrorResponses.badRequest(res, `Upload error: ${(err as Error).message}`);
      return;
    }
    next();
  });
};

/**
 * Route params for person id
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
interface FileRequest extends Omit<Request<object, object, media.UploadImageBody>, 'file'> {
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
router.post('/webceph/create-patient', validate({ body: media.createPatient.body }), async (req: Request<object, object, media.CreateWebCephPatientBody>, res: Response): Promise<void> => {
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
    const db = getKysely();
    await sql`
      UPDATE "patients"
      SET "web_ceph_patient_id" = ${result.webcephPatientId},
          "web_ceph_link" = ${result.link},
          "web_ceph_created_at" = LOCALTIMESTAMP
      WHERE "person_id" = ${personId}
    `.execute(db);

    log.info(`[WebCeph] Patient created successfully for person_id: ${personId}`);

    sendData(res, media.createPatient.response, {
      webcephPatientId: result.webcephPatientId,
      link: result.link,
      linkId: result.linkId
    }, 'Patient created in WebCeph successfully');
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
router.post('/webceph/upload-image', uploadImage, async (req: FileRequest, res: Response): Promise<void> => {
  try {
    const { patient_id, recordDate, targetClass } = req.body;

    if (!req.file) {
      ErrorResponses.missingParameter(res, 'image');
      return;
    }

    // Step 1: Create a new record for this date (if it doesn't exist)
    try {
      await webcephService.addNewRecord(patient_id, recordDate);
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
      patientID: patient_id,
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

    log.info(`[WebCeph] Image uploaded successfully for patient: ${patient_id}`);

    sendData(res, media.uploadImage.response, {
      big: result.big,
      thumbnail: result.thumbnail,
      link: result.link
    }, 'Image uploaded to WebCeph successfully');
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

    const db = getKysely();
    const { rows: result } = await sql<WebCephPatientLink>`
      SELECT "web_ceph_patient_id" AS "webcephPatientId", "web_ceph_link" AS "link", "web_ceph_created_at" AS "createdAt"
      FROM "patients"
      WHERE "person_id" = ${parseInt(personId)}
    `.execute(db);

    if (!result || result.length === 0 || !result[0].webcephPatientId) {
      // "No WebCeph link yet" is now a proper 404 (was a raw
      // `res.json({success:false,data:null})`). `sendData(…, null)` can't express
      // this — `sendSuccess` omits a null `data`, so the funnel would return the
      // whole envelope (truthy) instead of null. The consumer treats 404 as "no
      // link" without logging it as an error.
      ErrorResponses.notFound(res, 'WebCeph patient');
      return;
    }

    sendData(res, media.patientLink.response, result[0]);
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
    sendData(res, media.photoTypes.response, photoTypes);
  } catch (error) {
    log.error('[WebCeph] Error fetching photo types:', error);
    ErrorResponses.serverError(res, 'Failed to fetch photo types', error as Error);
  }
});

export default router;
