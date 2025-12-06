/**
 * Lookup Table Admin API Routes
 *
 * Handles CRUD operations for lookup tables through a generic interface.
 * Only whitelisted tables can be accessed for security.
 */

import express from 'express';
import { log } from '../../utils/logger.js';
import {
    getLookupTableConfigs,
    getLookupItems,
    createLookupItem,
    updateLookupItem,
    deleteLookupItem,
    isValidTableKey,
    getTableConfig
} from '../../services/database/queries/lookup-admin-queries.js';
import { ErrorResponses } from '../../utils/error-response.js';

const router = express.Router();

/**
 * Get all available lookup table configurations
 * GET /api/admin/lookups/tables
 */
router.get('/lookups/tables', async (req, res) => {
    try {
        const tables = getLookupTableConfigs();
        res.json(tables);
    } catch (error) {
        log.error('Error fetching lookup table configs:', { error: error.message });
        return ErrorResponses.internalError(res, 'Failed to fetch lookup table configurations', error);
    }
});

/**
 * Get all items from a specific lookup table
 * GET /api/admin/lookups/:tableName
 */
router.get('/lookups/:tableName', async (req, res) => {
    try {
        const { tableName } = req.params;

        if (!isValidTableKey(tableName)) {
            return ErrorResponses.badRequest(res, `Invalid table name: ${tableName}`);
        }

        const items = await getLookupItems(tableName);
        res.json(items);
    } catch (error) {
        log.error('Error fetching lookup items:', {
            table: req.params.tableName,
            error: error.message
        });
        return ErrorResponses.internalError(res, 'Failed to fetch lookup items', error);
    }
});

/**
 * Create a new item in a lookup table
 * POST /api/admin/lookups/:tableName
 * Body: { [columnName]: value, ... }
 */
router.post('/lookups/:tableName', async (req, res) => {
    try {
        const { tableName } = req.params;

        if (!isValidTableKey(tableName)) {
            return ErrorResponses.badRequest(res, `Invalid table name: ${tableName}`);
        }

        const config = getTableConfig(tableName);

        // Validate required fields
        for (const col of config.columns) {
            if (col.required && !req.body[col.name]) {
                return ErrorResponses.badRequest(res, `${col.label} is required`);
            }
        }

        const newId = await createLookupItem(tableName, req.body);

        log.info('Created lookup item', {
            table: tableName,
            id: newId
        });

        res.json({
            success: true,
            id: newId,
            message: 'Item created successfully'
        });
    } catch (error) {
        log.error('Error creating lookup item:', {
            table: req.params.tableName,
            error: error.message
        });
        return ErrorResponses.internalError(res, 'Failed to create item', error);
    }
});

/**
 * Update an existing item in a lookup table
 * PUT /api/admin/lookups/:tableName/:id
 * Body: { [columnName]: value, ... }
 */
router.put('/lookups/:tableName/:id', async (req, res) => {
    try {
        const { tableName, id } = req.params;

        if (!isValidTableKey(tableName)) {
            return ErrorResponses.badRequest(res, `Invalid table name: ${tableName}`);
        }

        if (!id) {
            return ErrorResponses.badRequest(res, 'Item ID is required');
        }

        const config = getTableConfig(tableName);

        // Validate required fields
        for (const col of config.columns) {
            if (col.required && !req.body[col.name]) {
                return ErrorResponses.badRequest(res, `${col.label} is required`);
            }
        }

        await updateLookupItem(tableName, id, req.body);

        log.info('Updated lookup item', {
            table: tableName,
            id
        });

        res.json({
            success: true,
            message: 'Item updated successfully'
        });
    } catch (error) {
        log.error('Error updating lookup item:', {
            table: req.params.tableName,
            id: req.params.id,
            error: error.message
        });
        return ErrorResponses.internalError(res, 'Failed to update item', error);
    }
});

/**
 * Delete an item from a lookup table
 * DELETE /api/admin/lookups/:tableName/:id
 */
router.delete('/lookups/:tableName/:id', async (req, res) => {
    try {
        const { tableName, id } = req.params;

        if (!isValidTableKey(tableName)) {
            return ErrorResponses.badRequest(res, `Invalid table name: ${tableName}`);
        }

        if (!id) {
            return ErrorResponses.badRequest(res, 'Item ID is required');
        }

        await deleteLookupItem(tableName, id);

        log.info('Deleted lookup item', {
            table: tableName,
            id
        });

        res.json({
            success: true,
            message: 'Item deleted successfully'
        });
    } catch (error) {
        log.error('Error deleting lookup item:', {
            table: req.params.tableName,
            id: req.params.id,
            error: error.message
        });
        return ErrorResponses.internalError(res, 'Failed to delete item', error);
    }
});

export default router;
