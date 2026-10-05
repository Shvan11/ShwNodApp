/**
 * Aligner LABEL API Routes — the printable aligner-label PDF.
 *
 * Split out of aligner.routes.ts (S2/C4), mounted at the same prefix in the order the
 * sections appeared in that file, so the route table's registration order is unchanged.
 *
 * Authorization: mounted under the global `/api` `authenticate` gate, and every
 * mutating route additionally carries an explicit `authorize()`. The gates are
 * per-route on purpose: this router is mounted at `/` inside the api router, so a
 * pathless `router.use(authorize(...))` would gate every `/api/*` request that
 * merely passes through it (the 2026-07-11 admin-403 incident — see routes/admin.ts).
 */

import { Router, type Request, type Response } from 'express';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { log } from '../../utils/logger.js';
import * as contract from '../../shared/contracts/aligner.contract.js';
import labelGenerator from '../../services/pdf/aligner-label-generator.js';
import { resolveLogoPath } from '../../services/pdf/pdf-assets.js';
import { getOption, upsertOption } from '../../services/database/queries/options-queries.js';
import { CLINIC_LOGO_OPTION, logoFilePath } from '../../services/files/clinic-branding.js';

/**
 * The logo labels carry: the clinic logo uploaded in Settings → General, or none
 * (owner decision 2026-10-04, FE-F20-3 — every install used to print this clinic's
 * bundled logo). PDFKit draws PNG and JPEG only, so a WebP logo prints no logo.
 */
async function configuredLabelLogo(): Promise<string | undefined> {
  const filename = await getOption(CLINIC_LOGO_OPTION);
  const abs = filename ? logoFilePath(filename) : '';
  return abs && /\.(png|jpe?g)$/i.test(abs) ? abs : undefined;
}

/**
 * Where the next print starts on the label sheet (1–12), written after every
 * generated PDF (FE-F20-5). A new row, not the legacy `LatestLabelPos`, whose
 * meaning (last used or next free?) nothing records.
 */
const NEXT_POSITION_OPTION = 'AlignerLabelNextPosition';
const LABELS_PER_SHEET = 12;

function parsePosition(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= LABELS_PER_SHEET ? n : 1;
}

const router = Router();

/**
 * The label dialog's starting state: the stored next sheet position and whether
 * a printable clinic logo is configured.
 */
router.get(
  '/aligner/labels/settings',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const [position, logo] = await Promise.all([
        getOption(NEXT_POSITION_OPTION),
        configuredLabelLogo(),
      ]);
      sendData(res, contract.labelSettings.response, {
        nextPosition: parsePosition(position),
        logo: !!resolveLogoPath(logo),
      });
    } catch (error) {
      log.error('Error reading label settings:', error);
      ErrorResponses.internalError(res, 'Failed to read label settings', error as Error);
    }
  }
);

// ============================================================================
// ALIGNER LABEL GENERATION
// ============================================================================

/**
 * Generate printable aligner labels PDF
 */
router.post(
  '/aligner/labels/generate',
  authorize(CLINICAL_ROLES),
  validate({ body: contract.generateLabels.body }),
  async (
    req: Request<unknown, unknown, contract.GenerateLabelsBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { labels, startingPosition, arabicFont = 'cairo' } = req.body;

      // Validate labels array
      if (!labels || !Array.isArray(labels) || labels.length === 0) {
        ErrorResponses.badRequest(
          res,
          'Labels array is required and cannot be empty'
        );
        return;
      }

      // Validate starting position
      if (
        !startingPosition ||
        !Number.isInteger(startingPosition) ||
        startingPosition < 1 ||
        startingPosition > 12
      ) {
        ErrorResponses.badRequest(
          res,
          'Starting position must be between 1 and 12'
        );
        return;
      }

      // Validate each label has required fields
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        if (!label.text) {
          ErrorResponses.badRequest(res, `labels[${i}].text is required`);
          return;
        }
        if (!label.patientName) {
          ErrorResponses.badRequest(
            res,
            `labels[${i}].patientName is required`
          );
          return;
        }
      }

      log.info('Generating aligner labels', {
        totalLabels: labels.length,
        startingPosition,
        arabicFont
      });

      // Generate PDF
      const result = await labelGenerator.generate({
        labels,
        startingPosition,
        arabicFont,
        logoPath: await configuredLabelLogo(),
      });

      // Remember where this print ended, so the next one resumes the sheet. A failed
      // write must not fail the print the user is waiting for.
      try {
        await upsertOption(NEXT_POSITION_OPTION, String(result.nextPosition));
      } catch (error) {
        log.warn('Could not store the next label position', { error: (error as Error).message });
      }

      // Send PDF response
      const firstPatient = labels[0].patientName
        .replace(/[^a-zA-Z0-9]/g, '_')
        .substring(0, 30);
      const filename = `Labels_${firstPatient}.pdf`;

      res.setHeader('Content-type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('X-Total-Labels', String(result.totalLabels));
      res.setHeader('X-Total-Pages', String(result.totalPages));
      res.setHeader('X-Next-position', String(result.nextPosition));
      res.send(result.buffer);
    } catch (error) {
      log.error('Error generating aligner labels:', error);
      // The message is a fixed string: concatenating `error.message` into it put the
      // raw PDF/font failure in the client-facing `error` field, which `sendError`
      // does NOT dev-gate (only `details` is). The error object still rides in
      // `details`, so dev keeps the full text.
      ErrorResponses.internalError(res, 'Failed to generate labels', error as Error);
    }
  }
);

export default router;
