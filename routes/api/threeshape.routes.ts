/**
 * 3Shape Unite Web Service actions (`/api/threeshape/*`) — mounted POST-gate, so
 * every route requires a staff session. Thin contracted handlers over the OAuth
 * client (services/threeshape/client.ts), which calls the Web Service on the
 * scanner workstation. Connect/status/disconnect live in integrations.routes.ts.
 *
 * The patient is identified to 3Shape by `IntegrationId = person_id` (the app's
 * stable key); the legacy human `patient_id` is intentionally not used.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { getPatientById } from '../../services/database/queries/patient-queries.js';
import * as threeShapeClient from '../../services/threeshape/client.js';
import { sendThreeShapeError } from '../../services/threeshape/route-helpers.js';
import * as threeshape from '../../shared/contracts/threeshape.contract.js';

const router = Router();

/** First/last name: prefer the dedicated columns, else split the display name. */
function deriveName(p: {
  first_name: string | null;
  last_name: string | null;
  patient_name: string;
}): { first: string; last: string } {
  if (p.first_name || p.last_name) {
    return { first: p.first_name ?? '', last: p.last_name ?? '' };
  }
  const parts = (p.patient_name ?? '').trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

// POST /api/threeshape/patients/:personId/initiate-workflow — push the patient and
// start a scan workflow on the scanner workstation.
router.post(
  '/threeshape/patients/:personId/initiate-workflow',
  validate({ params: threeshape.initiateWorkflow.params }),
  async (req: Request<threeshape.InitiateWorkflowParams>, res: Response): Promise<void> => {
    const personId = parseInt(req.params.personId, 10);
    try {
      const patient = await getPatientById(personId);
      if (!patient) {
        ErrorResponses.notFound(res, 'Patient');
        return;
      }
      const { first, last } = deriveName(patient);
      await threeShapeClient.initiateWorkflow({
        integrationId: String(patient.person_id),
        firstName: first,
        lastName: last,
        email: patient.email,
        phoneNumber: patient.phone,
        dateOfBirth: patient.date_of_birth,
        gender: patient.gender,
      });
      log.info('[3Shape] workflow initiated', { personId });
      sendData(res, threeshape.initiateWorkflow.response, { ok: true });
    } catch (err) {
      sendThreeShapeError(res, err, 'Failed to start the 3Shape scan');
    }
  }
);

// ── Pull: live read-through of cases + media (IntegrationId = person_id) ──

// GET /api/threeshape/patients/:personId/cases
router.get(
  '/threeshape/patients/:personId/cases',
  validate({ params: threeshape.listCases.params, query: threeshape.listCases.query }),
  async (
    req: Request<threeshape.ListCasesParams, unknown, unknown, threeshape.ListCasesQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const cases = await threeShapeClient.getCases(req.params.personId, req.query.workflowStatus);
      sendData(res, threeshape.listCases.response, { cases });
    } catch (err) {
      sendThreeShapeError(res, err, 'Failed to load 3Shape cases');
    }
  }
);

// GET /api/threeshape/patients/:personId/media
router.get(
  '/threeshape/patients/:personId/media',
  validate({ params: threeshape.listMedia.params, query: threeshape.listMedia.query }),
  async (
    req: Request<threeshape.ListMediaParams, unknown, unknown, threeshape.ListMediaQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const media = await threeShapeClient.getMedia(req.params.personId, req.query.type);
      sendData(res, threeshape.listMedia.response, { media });
    } catch (err) {
      sendThreeShapeError(res, err, 'Failed to load 3Shape media');
    }
  }
);

// ── Binary proxies — image/file bytes, served to <img>/download links (not the
// JSON funnel), so they carry no response contract. Buffered then forwarded. ──

const mediaIdParam = z.object({ mediaId: z.string().min(1) });
const caseIdParam = z.object({ caseId: z.string().min(1) });

async function forwardBinary(
  res: Response,
  upstream: Awaited<ReturnType<typeof threeShapeClient.fetchMediaDownload>>,
  download?: string
): Promise<void> {
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
  const cd = upstream.headers.get('content-disposition');
  if (cd) res.setHeader('Content-Disposition', cd);
  else if (download) res.setHeader('Content-Disposition', `attachment; filename="${download}"`);
  res.send(buf);
}

// GET /api/threeshape/media/:mediaId/download
router.get(
  '/threeshape/media/:mediaId/download',
  validate({ params: mediaIdParam }),
  async (req: Request<{ mediaId: string }>, res: Response): Promise<void> => {
    try {
      const upstream = await threeShapeClient.fetchMediaDownload(req.params.mediaId);
      await forwardBinary(res, upstream, `3shape-media-${req.params.mediaId}`);
    } catch (err) {
      sendThreeShapeError(res, err, 'Failed to download the file');
    }
  }
);

// GET /api/threeshape/media/:mediaId/thumbnail
router.get(
  '/threeshape/media/:mediaId/thumbnail',
  validate({ params: mediaIdParam }),
  async (req: Request<{ mediaId: string }>, res: Response): Promise<void> => {
    try {
      const upstream = await threeShapeClient.fetchMediaThumbnail(req.params.mediaId);
      await forwardBinary(res, upstream);
    } catch (err) {
      sendThreeShapeError(res, err, 'Failed to load the thumbnail');
    }
  }
);

// GET /api/threeshape/cases/:caseId/thumbnail
router.get(
  '/threeshape/cases/:caseId/thumbnail',
  validate({ params: caseIdParam }),
  async (req: Request<{ caseId: string }>, res: Response): Promise<void> => {
    try {
      const upstream = await threeShapeClient.fetchCaseThumbnail(req.params.caseId);
      await forwardBinary(res, upstream);
    } catch (err) {
      sendThreeShapeError(res, err, 'Failed to load the thumbnail');
    }
  }
);

export default router;
