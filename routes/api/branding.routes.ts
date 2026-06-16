/**
 * Clinic branding route (`/api/branding*`).
 *
 * Serves + manages the per-deployment header logo and clinic display name.
 * Both persist as `options` rows (`CLINIC_LOGO` filename, `CLINIC_NAME`); the
 * logo bytes live on the clinic volume (services/files/clinic-branding.ts) and
 * stream from `GET /api/branding/logo`. Auth-gated (mounted on the post-auth
 * aggregator); follows the shared-contract pattern: validate(...) then
 * sendData(...). The image stream is a deliberately-raw (un-enveloped) response.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { readFile } from 'fs/promises';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { getOption, upsertOption } from '../../services/database/queries/options-queries.js';
import {
  saveLogo,
  pruneLogosExcept,
  logoFilePath,
  LOGO_MIME_EXT,
  LOGO_EXT_MIME,
  type LogoExt,
} from '../../services/files/clinic-branding.js';
import * as branding from '../../shared/contracts/branding.contract.js';

const router = Router();

const LOGO_OPTION = 'CLINIC_LOGO';
const NAME_OPTION = 'CLINIC_NAME';

// Logos are small; 2 MB is generous. Memory storage → the service writes to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

// Run multer, turning its errors (oversized file, etc.) into clean 400s.
function uploadLogoFile(req: Request, res: Response, next: NextFunction): void {
  upload.single('logo')(req, res, (err: unknown) => {
    if (err) {
      ErrorResponses.badRequest(res, err instanceof Error ? err.message : 'Upload failed');
      return;
    }
    next();
  });
}

/** Build the contract response from the current option rows. */
async function readBranding(): Promise<branding.Branding> {
  const [logoFile, clinicName] = await Promise.all([
    getOption(LOGO_OPTION),
    getOption(NAME_OPTION),
  ]);
  return {
    clinicName: clinicName && clinicName.length > 0 ? clinicName : null,
    // The `?v=` token (the immutable filename) busts the browser cache when the
    // logo changes; the stream route ignores the query string itself.
    logo:
      logoFile && logoFile.length > 0
        ? `/api/branding/logo?v=${encodeURIComponent(logoFile)}`
        : null,
  };
}

// GET /api/branding — current logo URL + clinic name.
router.get('/branding', async (_req: Request, res: Response): Promise<void> => {
  try {
    sendData(res, branding.getBranding.response, await readBranding());
  } catch (error) {
    log.error('Error reading branding', { error: (error as Error).message });
    ErrorResponses.internalError(res, 'Failed to read branding', error as Error);
  }
});

// GET /api/branding/logo — stream the current logo image (raw, un-enveloped).
router.get('/branding/logo', async (_req: Request, res: Response): Promise<void> => {
  try {
    const filename = await getOption(LOGO_OPTION);
    const abs = filename ? logoFilePath(filename) : '';
    if (!abs) {
      ErrorResponses.notFound(res, 'Logo');
      return;
    }
    const buf = await readFile(abs).catch(() => null);
    if (!buf) {
      ErrorResponses.notFound(res, 'Logo');
      return;
    }
    const ext = filename!.split('.').pop() as LogoExt;
    res.setHeader('Content-Type', LOGO_EXT_MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buf);
  } catch (error) {
    log.error('Error streaming logo', { error: (error as Error).message });
    ErrorResponses.internalError(res, 'Failed to read logo', error as Error);
  }
});

// PUT /api/branding — set the clinic display name ('' clears it).
router.put(
  '/branding',
  validate({ body: branding.updateBranding.body }),
  async (
    req: Request<unknown, unknown, branding.UpdateBrandingBody>,
    res: Response,
  ): Promise<void> => {
    try {
      await upsertOption(NAME_OPTION, req.body.clinicName);
      sendData(res, branding.updateBranding.response, await readBranding());
    } catch (error) {
      log.error('Error updating clinic name', { error: (error as Error).message });
      ErrorResponses.internalError(res, 'Failed to update branding', error as Error);
    }
  },
);

// POST /api/branding/logo — upload / replace the logo image.
router.post(
  '/branding/logo',
  uploadLogoFile,
  async (req: Request, res: Response): Promise<void> => {
    const file = req.file;
    if (!file) {
      ErrorResponses.badRequest(res, 'No image uploaded');
      return;
    }
    const ext = LOGO_MIME_EXT[file.mimetype as keyof typeof LOGO_MIME_EXT];
    if (!ext) {
      ErrorResponses.badRequest(res, 'Logo must be a PNG, JPEG, or WebP image');
      return;
    }
    try {
      const filename = await saveLogo(file.buffer, ext);
      await upsertOption(LOGO_OPTION, filename);
      await pruneLogosExcept(filename); // drop the superseded file(s)
      log.info('[Branding] logo updated', { filename, bytes: file.size });
      sendData(res, branding.uploadLogo.response, await readBranding());
    } catch (error) {
      log.error('Error saving logo', { error: (error as Error).message });
      ErrorResponses.badRequest(res, 'Could not save the uploaded logo');
    }
  },
);

// DELETE /api/branding/logo — remove the custom logo (revert to name/default).
router.delete('/branding/logo', async (_req: Request, res: Response): Promise<void> => {
  try {
    await upsertOption(LOGO_OPTION, '');
    await pruneLogosExcept(null);
    sendData(res, branding.deleteLogo.response, await readBranding());
  } catch (error) {
    log.error('Error removing logo', { error: (error as Error).message });
    ErrorResponses.internalError(res, 'Failed to remove logo', error as Error);
  }
});

export default router;
