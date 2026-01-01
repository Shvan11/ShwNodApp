/**
 * Cost Preset API Routes
 *
 * Handles CRUD operations for estimated cost presets
 * No authentication required - these are just preset values for data entry
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import {
  getCostPresets,
  createCostPreset,
  updateCostPreset,
  deleteCostPreset,
  getCostPresetCurrencies
} from '../../services/database/queries/cost-preset-queries.js';
import { ErrorResponses } from '../../utils/error-response.js';

const router = Router();

/**
 * Valid currency types
 */
type Currency = 'IQD' | 'USD' | 'EUR';

/**
 * Query params for filtering cost presets
 */
interface CostPresetQuery {
  currency?: string;
}

/**
 * Request body for creating/updating cost preset
 */
interface CostPresetBody {
  amount: number;
  currency: Currency;
  displayOrder?: number;
}

/**
 * Route params for cost preset by ID
 */
interface CostPresetParams {
  id: string;
}

const VALID_CURRENCIES: Currency[] = ['IQD', 'USD', 'EUR'];

/**
 * GET /settings/cost-presets
 * Get all cost presets or filter by currency
 */
router.get('/settings/cost-presets', async (req: Request<object, object, object, CostPresetQuery>, res: Response): Promise<void> => {
  try {
    const { currency } = req.query;
    const presets = await getCostPresets(currency || null);
    res.json(presets);
  } catch (error) {
    log.error('Error fetching cost presets:', error);
    ErrorResponses.internalError(res, 'Failed to fetch cost presets', error as Error);
  }
});

/**
 * GET /settings/cost-presets/currencies
 * Get list of currencies that have presets
 */
router.get('/settings/cost-presets/currencies', async (_req: Request, res: Response): Promise<void> => {
  try {
    const currencies = await getCostPresetCurrencies();
    res.json(currencies);
  } catch (error) {
    log.error('Error fetching cost preset currencies:', error);
    ErrorResponses.internalError(res, 'Failed to fetch currencies', error as Error);
  }
});

/**
 * POST /settings/cost-presets
 * Create a new cost preset
 * Body: { amount: number, currency: string, displayOrder: number }
 */
router.post('/settings/cost-presets', async (req: Request<object, object, CostPresetBody>, res: Response): Promise<void> => {
  try {
    const { amount, currency, displayOrder = 0 } = req.body;

    // Validation
    if (!amount || !currency) {
      ErrorResponses.badRequest(res, 'Amount and currency are required');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      ErrorResponses.badRequest(res, 'Amount must be a positive number');
      return;
    }

    if (!VALID_CURRENCIES.includes(currency)) {
      ErrorResponses.badRequest(res, `Currency must be one of: ${VALID_CURRENCIES.join(', ')}`);
      return;
    }

    const presetId = await createCostPreset(amount, currency, displayOrder);

    res.json({
      success: true,
      presetId,
      message: 'Cost preset created successfully'
    });
  } catch (error) {
    log.error('Error creating cost preset:', error);
    ErrorResponses.internalError(res, 'Failed to create cost preset', error as Error);
  }
});

/**
 * PUT /settings/cost-presets/:id
 * Update an existing cost preset
 * Body: { amount: number, currency: string, displayOrder: number }
 */
router.put('/settings/cost-presets/:id', async (req: Request<CostPresetParams, object, CostPresetBody>, res: Response): Promise<void> => {
  try {
    const presetId = parseInt(req.params.id);
    const { amount, currency, displayOrder = 0 } = req.body;

    // Validation
    if (!amount || !currency) {
      ErrorResponses.badRequest(res, 'Amount and currency are required');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      ErrorResponses.badRequest(res, 'Amount must be a positive number');
      return;
    }

    if (!VALID_CURRENCIES.includes(currency)) {
      ErrorResponses.badRequest(res, `Currency must be one of: ${VALID_CURRENCIES.join(', ')}`);
      return;
    }

    await updateCostPreset(presetId, amount, currency, displayOrder);

    res.json({
      success: true,
      message: 'Cost preset updated successfully'
    });
  } catch (error) {
    log.error('Error updating cost preset:', error);
    ErrorResponses.internalError(res, 'Failed to update cost preset', error as Error);
  }
});

/**
 * DELETE /settings/cost-presets/:id
 * Delete a cost preset
 */
router.delete('/settings/cost-presets/:id', async (req: Request<CostPresetParams>, res: Response): Promise<void> => {
  try {
    const presetId = parseInt(req.params.id);

    if (isNaN(presetId)) {
      ErrorResponses.badRequest(res, 'Invalid preset ID');
      return;
    }

    await deleteCostPreset(presetId);

    res.json({
      success: true,
      message: 'Cost preset deleted successfully'
    });
  } catch (error) {
    log.error('Error deleting cost preset:', error);
    ErrorResponses.internalError(res, 'Failed to delete cost preset', error as Error);
  }
});

export default router;
