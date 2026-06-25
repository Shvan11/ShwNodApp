/**
 * Cost Preset API Routes
 *
 * Mounted BEFORE the global auth gate (`index.ts`: `app.use('/api', costPresetRoutes)`
 * precedes `app.use('/api', authenticate)`), so the module is responsible for its
 * OWN per-route protection:
 *   - @public    GET  /settings/cost-presets        — read-only, populates dropdowns.
 *   - @protected POST/PUT/DELETE /settings/cost-presets[/:id] — self-guarded with
 *               inline `authenticate, authorize(ADMIN_ROLES)`; they change clinic-wide
 *               billing presets and were previously reachable without a session.
 *
 * Because the gate is bypassed for this mount, any NEW route added here MUST carry
 * its own `authenticate`/`authorize` if it is meant to be protected — there is no
 * outer gate to fall back on.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import {
  getCostPresets,
  createCostPreset,
  updateCostPreset,
  deleteCostPreset
} from '../../services/database/queries/cost-preset-queries.js';
import { ErrorResponses, sendSuccess, sendData } from '../../utils/error-response.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { ADMIN_ROLES } from '../../shared/auth/roles.js';
import { validate } from '../../middleware/validate.js';
import * as costPreset from '../../shared/contracts/cost-preset.contract.js';

const router = Router();

/**
 * Valid currency types
 */
type currency = 'IQD' | 'USD' | 'EUR';

/**
 * Query params for filtering cost presets
 */
type CostPresetQuery = costPreset.CostPresetQuery;

/**
 * Route params for cost preset by id.
 * Declared as a `type` (not `interface`) so it carries an implicit index
 * signature and stays assignable to Express's ParamsDictionary on the
 * multi-handler (authenticate + authorize) overload used below.
 */
type CostPresetParams = {
  id: string;
};

const VALID_CURRENCIES: currency[] = ['IQD', 'USD', 'EUR'];

/**
 * GET /settings/cost-presets
 * Get all cost presets or filter by currency
 * @public — no auth (pre-gate mount); read-only reference data.
 */
router.get('/settings/cost-presets', async (req: Request<object, object, object, CostPresetQuery>, res: Response): Promise<void> => {
  try {
    const { currency } = req.query;
    const presets = await getCostPresets(currency || null);
    sendData(res, costPreset.getPresets.response, presets);
  } catch (error) {
    log.error('Error fetching cost presets:', error);
    ErrorResponses.internalError(res, 'Failed to fetch cost presets', error as Error);
  }
});

/**
 * POST /settings/cost-presets
 * Create a new cost preset
 * Body: { amount: number, currency: string, displayOrder: number }
 * @protected admin — self-guarded (pre-gate mount): authenticate + authorize(ADMIN_ROLES).
 */
router.post('/settings/cost-presets', authenticate, authorize(ADMIN_ROLES), validate({ body: costPreset.createPreset.body }), async (req: Request<object, object, costPreset.CostPresetBody>, res: Response): Promise<void> => {
  try {
    const { amount, currency, displayOrder = 0 } = req.body;

    // Validation
    if (!amount || !currency) {
      ErrorResponses.badRequest(res, 'amount and currency are required');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      ErrorResponses.badRequest(res, 'amount must be a positive number');
      return;
    }

    if (!VALID_CURRENCIES.includes(currency)) {
      ErrorResponses.badRequest(res, `currency must be one of: ${VALID_CURRENCIES.join(', ')}`);
      return;
    }

    const presetId = await createCostPreset(amount, currency, displayOrder);

    sendData(res, costPreset.createPreset.response, { presetId }, 'Cost preset created successfully');
  } catch (error) {
    log.error('Error creating cost preset:', error);
    ErrorResponses.internalError(res, 'Failed to create cost preset', error as Error);
  }
});

/**
 * PUT /settings/cost-presets/:id
 * Update an existing cost preset
 * Body: { amount: number, currency: string, displayOrder: number }
 * @protected admin — self-guarded (pre-gate mount): authenticate + authorize(ADMIN_ROLES).
 */
router.put('/settings/cost-presets/:id', authenticate, authorize(ADMIN_ROLES), validate({ body: costPreset.updatePreset.body }), async (req: Request<CostPresetParams, object, costPreset.CostPresetBody>, res: Response): Promise<void> => {
  try {
    const presetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(presetId) || presetId <= 0) {
      ErrorResponses.badRequest(res, 'Invalid cost preset ID');
      return;
    }
    const { amount, currency, displayOrder = 0 } = req.body;

    // Validation
    if (!amount || !currency) {
      ErrorResponses.badRequest(res, 'amount and currency are required');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      ErrorResponses.badRequest(res, 'amount must be a positive number');
      return;
    }

    if (!VALID_CURRENCIES.includes(currency)) {
      ErrorResponses.badRequest(res, `currency must be one of: ${VALID_CURRENCIES.join(', ')}`);
      return;
    }

    await updateCostPreset(presetId, amount, currency, displayOrder);

    sendSuccess(res, null, 'Cost preset updated successfully');
  } catch (error) {
    log.error('Error updating cost preset:', error);
    ErrorResponses.internalError(res, 'Failed to update cost preset', error as Error);
  }
});

/**
 * DELETE /settings/cost-presets/:id
 * Delete a cost preset
 * @protected admin — self-guarded (pre-gate mount): authenticate + authorize(ADMIN_ROLES).
 */
router.delete('/settings/cost-presets/:id', authenticate, authorize(ADMIN_ROLES), async (req: Request<CostPresetParams>, res: Response): Promise<void> => {
  try {
    const presetId = parseInt(req.params.id);

    if (isNaN(presetId)) {
      ErrorResponses.badRequest(res, 'Invalid preset id');
      return;
    }

    await deleteCostPreset(presetId);

    sendSuccess(res, null, 'Cost preset deleted successfully');
  } catch (error) {
    log.error('Error deleting cost preset:', error);
    ErrorResponses.internalError(res, 'Failed to delete cost preset', error as Error);
  }
});

export default router;
