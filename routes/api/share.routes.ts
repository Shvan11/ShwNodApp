/**
 * Share staging route (`/api/share/*`).
 *
 * Bridges browser-generated images (e.g. the Compare montage) into the existing
 * share targets. The transports (LocalSend / Telegram) resolve files by an
 * on-disk path, so the client uploads the canvas bytes here; we stage them and
 * return a token the client re-sends as a `{ source: 'staged' }` SendFileRef.
 * Auth-gated (mounted on the post-auth aggregator); follows the shared-contract
 * pattern: `validate(...)` against the contract, then `sendData(...)`.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { createUpload, uploadErrorMessage } from '../../middleware/upload.js';
import { timeouts } from '../../middleware/timeout.js';
import { z } from 'zod';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { stage } from '../../shared/contracts/share.contract.js';
import { stageShareImage } from '../../services/files/share-stage.js';

const router = Router();

// Memory storage — the buffer is written to the staging dir by the service. 60MB
// covers a full-resolution two-image montage; multipart sidesteps the 10MB JSON cap.
const upload = createUpload({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
});

// Run multer, but turn its errors (oversized file, etc.) into clean 400s instead
// of bubbling to the generic 500 handler.
function uploadImage(req: Request, res: Response, next: NextFunction): void {
  upload.single('image')(req, res, (err: unknown) => {
    if (err) {
      ErrorResponses.badRequest(res, uploadErrorMessage(err, 'The image is too large to share (60 MB max).') ?? 'Upload failed');
      return;
    }
    next();
  });
}

// POST /api/share/stage — persist an uploaded image and return its staged ref.
router.post(
  '/stage',
  authorize(CLINICAL_ROLES),
  // An image upload: off the LAN it outlasts the global 30 s request timeout (the
  // client grants it 120 s too — FE-F13-6).
  timeouts.long,
  uploadImage,
  validate({ body: stage.body }),
  async (req: Request<object, object, z.infer<typeof stage.body>>, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      ErrorResponses.badRequest(res, 'No image uploaded');
      return;
    }
    const ext =
      file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/jpeg' ? 'jpg' : null;
    if (!ext) {
      ErrorResponses.badRequest(res, 'Only PNG or JPEG images can be shared');
      return;
    }
    try {
      const { personId, displayName } = req.body;
      const ref = await stageShareImage(file.buffer, ext);
      log.info('[Share] staged image for sharing', { personId, ref, bytes: file.size });
      sendData(res, stage.response, { ref, displayName: displayName || ref });
    } catch (err) {
      log.error('[Share] failed to stage image', { error: (err as Error).message });
      ErrorResponses.badRequest(res, 'Could not stage the image for sharing');
    }
  },
);

export default router;
