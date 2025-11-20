/**
 * Cost Preset API Routes
 *
 * Handles CRUD operations for estimated cost presets
 * No authentication required - these are just preset values for data entry
 */

import express from 'express';
import { log } from '../../utils/logger.js';
import {
    getCostPresets,
    createCostPreset,
    updateCostPreset,
    deleteCostPreset,
    getCostPresetCurrencies
} from '../../services/database/queries/cost-preset-queries.js';
import { ErrorResponses } from '../../utils/error-response.js';

const router = express.Router();

/**
 * Get all cost presets or filter by currency
 * GET /api/settings/cost-presets?currency=IQD
 */
router.get('/settings/cost-presets', async (req, res) => {
    try {
        const { currency } = req.query;
        const presets = await getCostPresets(currency || null);
        res.json(presets);
    } catch (error) {
        log.error('Error fetching cost presets:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch cost presets', error);
    }
});

/**
 * Get list of currencies that have presets
 * GET /api/settings/cost-presets/currencies
 */
router.get('/settings/cost-presets/currencies', async (req, res) => {
    try {
        const currencies = await getCostPresetCurrencies();
        res.json(currencies);
    } catch (error) {
        log.error('Error fetching cost preset currencies:', error);
        return ErrorResponses.internalError(res, 'Failed to fetch currencies', error);
    }
});

/**
 * Create a new cost preset
 * POST /api/settings/cost-presets
 * Body: { amount: number, currency: string, displayOrder: number }
 */
router.post('/settings/cost-presets', async (req, res) => {
    try {
        const { amount, currency, displayOrder = 0 } = req.body;

        // Validation
        if (!amount || !currency) {
            return ErrorResponses.badRequest(res, 'Amount and currency are required');
        }

        if (isNaN(amount) || amount <= 0) {
            return ErrorResponses.badRequest(res, 'Amount must be a positive number');
        }

        const validCurrencies = ['IQD', 'USD', 'EUR'];
        if (!validCurrencies.includes(currency)) {
            return ErrorResponses.badRequest(res, `Currency must be one of: ${validCurrencies.join(', ')}`);
        }

        const presetId = await createCostPreset(amount, currency, displayOrder);

        res.json({
            success: true,
            presetId,
            message: 'Cost preset created successfully'
        });
    } catch (error) {
        log.error('Error creating cost preset:', error);
        return ErrorResponses.internalError(res, 'Failed to create cost preset', error);
    }
});

/**
 * Update an existing cost preset
 * PUT /api/settings/cost-presets/:id
 * Body: { amount: number, currency: string, displayOrder: number }
 */
router.put('/settings/cost-presets/:id', async (req, res) => {
    try {
        const presetId = parseInt(req.params.id);
        const { amount, currency, displayOrder = 0 } = req.body;

        // Validation
        if (!amount || !currency) {
            return ErrorResponses.badRequest(res, 'Amount and currency are required');
        }

        if (isNaN(amount) || amount <= 0) {
            return ErrorResponses.badRequest(res, 'Amount must be a positive number');
        }

        const validCurrencies = ['IQD', 'USD', 'EUR'];
        if (!validCurrencies.includes(currency)) {
            return ErrorResponses.badRequest(res, `Currency must be one of: ${validCurrencies.join(', ')}`);
        }

        await updateCostPreset(presetId, amount, currency, displayOrder);

        res.json({
            success: true,
            message: 'Cost preset updated successfully'
        });
    } catch (error) {
        log.error('Error updating cost preset:', error);
        return ErrorResponses.internalError(res, 'Failed to update cost preset', error);
    }
});

/**
 * Delete a cost preset
 * DELETE /api/settings/cost-presets/:id
 */
router.delete('/settings/cost-presets/:id', async (req, res) => {
    try {
        const presetId = parseInt(req.params.id);

        if (isNaN(presetId)) {
            return ErrorResponses.badRequest(res, 'Invalid preset ID');
        }

        await deleteCostPreset(presetId);

        res.json({
            success: true,
            message: 'Cost preset deleted successfully'
        });
    } catch (error) {
        log.error('Error deleting cost preset:', error);
        return ErrorResponses.internalError(res, 'Failed to delete cost preset', error);
    }
});

export default router;
