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
import { ErrorResponses } from '../../utils/error-response.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import { log } from '../../utils/logger.js';
import * as contract from '../../shared/contracts/aligner.contract.js';
import labelGenerator from '../../services/pdf/aligner-label-generator.js';

const router = Router();

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
        arabicFont
      });

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
