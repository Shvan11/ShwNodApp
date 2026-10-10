/**
 * Aligner FILE API Routes — the two kinds of file attached to an aligner set: the
 * treatment-plan PDF (uploaded by staff, stored on Google Drive) and the photos the
 * doctor uploaded through the portal.
 *
 * Split out of aligner.routes.ts (S2/C4) — the PDF and PHOTOS sections, kept together
 * because both are set attachments. Mounted at the same prefix in the order the
 * sections appeared in that file, so the route table's registration order is unchanged.
 *
 * Authorization: mounted under the global `/api` `authenticate` gate, and every
 * mutating route additionally carries an explicit `authorize()`. The gates are
 * per-route on purpose: this router is mounted at `/` inside the api router, so a
 * pathless `router.use(authorize(...))` would gate every `/api/*` request that
 * merely passes through it (the 2026-07-11 admin-403 incident — see routes/admin.ts).
 */

import { Router, type Request, type Response } from 'express';
import { sendSuccess, sendData, ErrorResponses } from '../../utils/error-response.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { log } from '../../utils/logger.js';
import * as contract from '../../shared/contracts/aligner.contract.js';
import {
  uploadSinglePdf,
  handleUploadError
} from '../../middleware/upload.js';
import driveUploadService from '../../services/google-drive/drive-upload.js';
import {
  listPhotosForSet,
  readPhotoForSet,
  deletePhotoForSet,
  isR2Configured,
  PhotoOwnershipError,
  PhotoNotFoundError,
} from '../../services/imaging/aligner-photo.service.js';
import { timeouts } from '../../middleware/timeout.js';
import {
  uploadPdfForSet,
  deletePdfFromSet,
  AlignerPdfError
} from '../../services/business/AlignerPdfService.js';

const router = Router();

// ============================================================================
// ALIGNER PDF UPLOAD/DELETE
// ============================================================================

/**
 * Upload PDF for an aligner set (staff page)
 */
router.post(
  '/aligner/sets/:setId/upload-pdf',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.setIdParams }),
  timeouts.long,
  uploadSinglePdf,
  handleUploadError,
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const setId = parseInt(req.params.setId, 10);
      if (!Number.isInteger(setId) || setId <= 0) {
        ErrorResponses.badRequest(res, 'Invalid aligner set ID');
        return;
      }
      const uploaderEmail = req.session?.username || 'unknown';

      // Validate file exists
      if (!req.file) {
        ErrorResponses.badRequest(
          res,
          'No file uploaded. Please select a PDF file.'
        );
        return;
      }

      // Validate PDF
      const validation = driveUploadService.validatePdfFile(
        req.file.buffer,
        req.file.mimetype
      );
      if (!validation.valid) {
        ErrorResponses.badRequest(res, validation.error || 'Invalid PDF file');
        return;
      }

      const result = await uploadPdfForSet(setId, req.file, uploaderEmail);

      sendData(res, contract.uploadPdf.response, result, 'PDF uploaded successfully');
    } catch (error) {
      if (error instanceof AlignerPdfError) {
        if (error.code === 'SET_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Aligner set');
          return;
        }
        ErrorResponses.internalError(res, error.message, error.details as Error);
        return;
      }
      log.error('Error uploading PDF:', error);
      ErrorResponses.internalError(res, 'Failed to upload PDF', error as Error);
    }
  }
);

/**
 * Delete PDF from an aligner set (staff page)
 */
router.delete(
  '/aligner/sets/:setId/pdf',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.setIdParams }),
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const setId = parseInt(req.params.setId, 10);
      if (!Number.isInteger(setId) || setId <= 0) {
        ErrorResponses.badRequest(res, 'Invalid aligner set ID');
        return;
      }

      await deletePdfFromSet(setId);

      sendSuccess(res, null, 'PDF deleted successfully');
    } catch (error) {
      if (error instanceof AlignerPdfError) {
        if (error.code === 'SET_NOT_FOUND') {
          ErrorResponses.notFound(res, 'Aligner set');
          return;
        }
        ErrorResponses.internalError(res, error.message, error.details as Error);
        return;
      }
      log.error('Error deleting PDF:', error);
      ErrorResponses.internalError(res, 'Failed to delete PDF', error as Error);
    }
  }
);

// ============================================================================
// ALIGNER PHOTOS UPLOADED VIA PORTAL
// ============================================================================

/**
 * List photos for an aligner set (staff page)
 */
router.get(
  '/aligner/sets/:setId/photos',
  validate({ params: contract.setIdParams }),
  async (req: Request<{ setId: string }>, res: Response): Promise<void> => {
    try {
      const setId = parseInt(req.params.setId, 10);
      if (!Number.isInteger(setId) || setId <= 0) {
        ErrorResponses.badRequest(res, 'Invalid aligner set ID');
        return;
      }

      const photos = await listPhotosForSet(setId);
      sendData(res, contract.getSetPhotos.response, { photos });
    } catch (error) {
      log.error('Error listing R2 photos:', error);
      ErrorResponses.internalError(res, 'Failed to retrieve set photos', error as Error);
    }
  }
);

/**
 * One attachment's bytes, same-origin (the 3D scan viewer). The browser can't read
 * the presigned R2 URL itself: the bucket's CORS admits only the doctor portal.
 * Same gate as the list — whoever can list a set's files can already download them.
 */
router.get(
  '/aligner/sets/:setId/photos/content',
  validate({ params: contract.photoContent.params, query: contract.photoContent.query }),
  async (
    req: Request<{ setId: string }, unknown, unknown, contract.PhotoContentQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const setId = parseInt(req.params.setId, 10);
      if (!Number.isInteger(setId) || setId <= 0) {
        ErrorResponses.badRequest(res, 'Invalid aligner set ID');
        return;
      }
      if (!isR2Configured()) {
        ErrorResponses.notFound(res, 'Portal file');
        return;
      }

      const { bytes, fileName } = await readPhotoForSet(setId, req.query.path);
      log.info('[Aligner] portal file read', { userId: req.session?.userId, setId, path: req.query.path });

      // `attachment` keeps a doctor-uploaded file from ever rendering inline on this
      // origin; the octet-stream type is set after it (attachment() types by extension).
      res.attachment(fileName);
      res.type('application/octet-stream');
      // Private (PHI), and safe to keep a day: portal keys are write-once — the name
      // carries the upload's millisecond timestamp, so new bytes mean a new key.
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(bytes);
    } catch (error) {
      if (error instanceof PhotoOwnershipError) {
        ErrorResponses.forbidden(res, error.message);
        return;
      }
      if (error instanceof PhotoNotFoundError) {
        ErrorResponses.notFound(res, 'Portal file');
        return;
      }
      log.error('Error reading R2 photo:', error);
      ErrorResponses.internalError(res, 'Failed to read the file', error as Error);
    }
  }
);

/**
 * Delete a photo from an aligner set (staff page)
 */
router.delete(
  '/aligner/sets/:setId/photos',
  authorize(CLINICAL_ROLES),
  validate({ params: contract.setIdParams, query: contract.deletePhotoQuery }),
  async (
    req: Request<{ setId: string }, unknown, unknown, contract.DeletePhotoQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const setId = parseInt(req.params.setId, 10);
      if (!Number.isInteger(setId) || setId <= 0) {
        ErrorResponses.badRequest(res, 'Invalid aligner set ID');
        return;
      }

      // Presence + string-ness of `path` are the contract's now.
      await deletePhotoForSet(setId, req.query.path);
      sendSuccess(res, null, 'Photo deleted successfully');
    } catch (error) {
      // A key outside `sets/<id>/` is a refusal, not a server fault.
      if (error instanceof PhotoOwnershipError) {
        ErrorResponses.forbidden(res, error.message);
        return;
      }
      log.error('Error deleting R2 photo:', error);
      ErrorResponses.internalError(res, 'Failed to delete photo', error as Error);
    }
  }
);

export default router;
