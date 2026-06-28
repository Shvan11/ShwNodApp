/**
 * Saved slideshow configurations — CRUD for the Patient Presentation Slideshow.
 *
 * Per-patient saved sequences (`person_id` set) + clinic-wide generic templates
 * (`person_id` NULL). Reads + writes ride the global `/api` `authenticate` gate
 * (index.ts); mutations are CSRF-checked by the staff funnel. Backed by the
 * LOCAL-ONLY `slideshow_configs` table.
 */
import { Router, type Request, type Response } from 'express';
import { validate } from '../../middleware/validate.js';
import { sendData, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import * as slideshowContract from '../../shared/contracts/slideshow.contract.js';
import {
  listConfigs,
  createConfig,
  updateConfig,
  deleteConfig,
} from '../../services/database/queries/slideshow-config-queries.js';

const router = Router();

// GET /api/slideshow-configs?personId= — that patient's configs + generic templates.
router.get(
  '/slideshow-configs',
  validate({ query: slideshowContract.listConfigs.query }),
  async (
    req: Request<unknown, unknown, unknown, slideshowContract.ListConfigsQuery>,
    res: Response
  ): Promise<void> => {
    try {
      const rows = await listConfigs(req.query.personId);
      sendData(res, slideshowContract.listConfigs.response, rows);
    } catch (error) {
      log.error('Error listing slideshow configs:', error);
      ErrorResponses.internalError(res, 'Failed to list slideshow configurations', error as Error);
    }
  }
);

// POST /api/slideshow-configs — create a config.
router.post(
  '/slideshow-configs',
  validate({ body: slideshowContract.createConfig.body }),
  async (
    req: Request<unknown, unknown, slideshowContract.CreateConfigBody>,
    res: Response
  ): Promise<void> => {
    try {
      const row = await createConfig(req.body);
      sendData(res, slideshowContract.createConfig.response, row, 'Configuration saved');
    } catch (error) {
      log.error('Error creating slideshow config:', error);
      ErrorResponses.internalError(res, 'Failed to save configuration', error as Error);
    }
  }
);

// PUT /api/slideshow-configs/:id — rename and/or overwrite the saved sequence.
router.put(
  '/slideshow-configs/:id',
  validate({
    params: slideshowContract.updateConfig.params,
    body: slideshowContract.updateConfig.body,
  }),
  async (
    req: Request<{ id: string }, unknown, slideshowContract.UpdateConfigBody>,
    res: Response
  ): Promise<void> => {
    try {
      const row = await updateConfig(parseInt(req.params.id, 10), req.body);
      if (!row) {
        ErrorResponses.notFound(res, 'Slideshow configuration');
        return;
      }
      sendData(res, slideshowContract.updateConfig.response, row, 'Configuration updated');
    } catch (error) {
      log.error('Error updating slideshow config:', error);
      ErrorResponses.internalError(res, 'Failed to update configuration', error as Error);
    }
  }
);

// DELETE /api/slideshow-configs/:id
router.delete(
  '/slideshow-configs/:id',
  validate({ params: slideshowContract.deleteConfig.params }),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const row = await deleteConfig(parseInt(req.params.id, 10));
      if (!row) {
        ErrorResponses.notFound(res, 'Slideshow configuration');
        return;
      }
      sendData(res, slideshowContract.deleteConfig.response, row, 'Configuration deleted');
    } catch (error) {
      log.error('Error deleting slideshow config:', error);
      ErrorResponses.internalError(res, 'Failed to delete configuration', error as Error);
    }
  }
);

export default router;
