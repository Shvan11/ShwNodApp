/**
 * Settings & Configuration API Routes
 *
 * This module handles all settings and configuration-related endpoints including:
 * - System options management (get, update, bulk operations)
 * - Database configuration (CRUD operations, testing, backup/restore)
 * - System restart functionality
 *
 * All routes are mounted under /api prefix by the parent router.
 */

import express from 'express';
import {
    getAllOptions,
    getOption,
    updateOption,
    getOptionsByPattern,
    bulkUpdateOptions
} from '../../services/database/queries/options-queries.js';
import DatabaseConfigService from '../../services/config/DatabaseConfigService.js';
import { sendError, ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = express.Router();

// ===== OPTIONS/SETTINGS ENDPOINTS =====

/**
 * Get all system options
 * GET /api/options
 */
router.get("/options", async (req, res) => {
    try {
        const options = await getAllOptions();
        res.json({ status: 'success', options });
    } catch (error) {
        log.error("Error getting options:", error);
        return ErrorResponses.internalError(res, 'Failed to retrieve system options', error);
    }
});

/**
 * Get a specific option by name
 * GET /api/options/:optionName
 */
router.get("/options/:optionName", async (req, res) => {
    try {
        const { optionName } = req.params;
        const value = await getOption(optionName);

        if (value === null) {
            return ErrorResponses.notFound(res, 'Option');
        }

        res.json({ status: 'success', optionName, value });
    } catch (error) {
        log.error("Error getting option:", error);
        return ErrorResponses.internalError(res, 'Failed to retrieve option', error);
    }
});

/**
 * Update a specific option
 * PUT /api/options/:optionName
 */
router.put("/options/:optionName", async (req, res) => {
    try {
        const { optionName } = req.params;
        const { value } = req.body;

        if (!value) {
            return ErrorResponses.missingParameter(res, 'value');
        }

        const updated = await updateOption(optionName, value);

        if (!updated) {
            return ErrorResponses.notFound(res, 'Option', { reason: 'Option not found or could not be updated' });
        }

        res.json({ status: 'success', message: 'Option updated successfully' });
    } catch (error) {
        log.error("Error updating option:", error);
        return ErrorResponses.internalError(res, 'Failed to update option', error);
    }
});

/**
 * Get options matching a pattern
 * GET /api/options/pattern/:pattern
 */
router.get("/options/pattern/:pattern", async (req, res) => {
    try {
        const { pattern } = req.params;
        const options = await getOptionsByPattern(pattern);
        res.json({ status: 'success', options });
    } catch (error) {
        log.error("Error getting options by pattern:", error);
        return ErrorResponses.internalError(res, 'Failed to retrieve options by pattern', error);
    }
});

/**
 * Bulk update multiple options
 * PUT /api/options/bulk
 */
router.put("/options/bulk", async (req, res) => {
    try {
        const { options } = req.body;

        if (!options || !Array.isArray(options)) {
            return ErrorResponses.invalidParameter(res, 'options', { reason: 'Options array is required' });
        }

        const result = await bulkUpdateOptions(options);
        res.json({
            status: 'success',
            message: 'Bulk update completed',
            updated: result.updated,
            failed: result.failed
        });
    } catch (error) {
        log.error("Error bulk updating options:", error);
        return ErrorResponses.internalError(res, 'Failed to bulk update options', error);
    }
});

// ===== DATABASE CONFIGURATION ENDPOINTS =====

const dbConfigService = new DatabaseConfigService();

/**
 * Get current database configuration
 * GET /api/config/database
 */
router.get('/config/database', async (req, res) => {
    try {
        const result = await dbConfigService.getCurrentConfig(false); // Mask sensitive data

        if (result.success) {
            res.json({
                success: true,
                config: result.config,
                timestamp: result.timestamp
            });
        } else {
            return ErrorResponses.internalError(res, 'Failed to get database configuration', { error: result.error });
        }
    } catch (error) {
        log.error('Error getting database configuration:', error);
        return ErrorResponses.internalError(res, 'Failed to get database configuration', error);
    }
});

/**
 * Test database connection with provided configuration
 * POST /api/config/database/test
 */
router.post('/config/database/test', async (req, res) => {
    try {
        const testConfig = req.body;

        if (!testConfig || typeof testConfig !== 'object') {
            return ErrorResponses.badRequest(res, 'Invalid configuration provided');
        }

        log.info('Testing database connection...');
        const result = await dbConfigService.testConnection(testConfig);

        // Return appropriate status code based on test result
        const statusCode = result.success ? 200 : 400;
        res.status(statusCode).json(result);

    } catch (error) {
        log.error('Error testing database connection:', error);
        return ErrorResponses.internalError(res, 'Connection test failed', error);
    }
});

/**
 * Update database configuration
 * PUT /api/config/database
 */
router.put('/config/database', async (req, res) => {
    try {
        const newConfig = req.body;

        if (!newConfig || typeof newConfig !== 'object') {
            return ErrorResponses.badRequest(res, 'Invalid configuration provided');
        }

        log.info('Updating database configuration...');
        const result = await dbConfigService.updateConfiguration(newConfig);

        if (result.success) {
            // Mask password in response
            if (result.config && result.config.DB_PASSWORD) {
                result.config.DB_PASSWORD = '••••••••';
            }

            res.json(result);
        } else {
            res.status(400).json(result);
        }

    } catch (error) {
        log.error('Error updating database configuration:', error);
        return ErrorResponses.internalError(res, 'Configuration update failed', error);
    }
});

/**
 * Get database configuration status and diagnostics
 * GET /api/config/database/status
 */
router.get('/config/database/status', async (req, res) => {
    try {
        const result = await dbConfigService.getConfigurationStatus();
        res.json(result);
    } catch (error) {
        log.error('Error getting configuration status:', error);
        return ErrorResponses.internalError(res, 'Failed to get configuration status', error);
    }
});

/**
 * Create backup of current database configuration
 * POST /api/config/database/backup
 */
router.post('/config/database/backup', async (req, res) => {
    try {
        const result = await dbConfigService.createBackup();

        const statusCode = result.success ? 200 : 400;
        res.status(statusCode).json(result);

    } catch (error) {
        log.error('Error creating configuration backup:', error);
        return ErrorResponses.internalError(res, 'Backup creation failed', error);
    }
});

/**
 * Restore database configuration from backup
 * POST /api/config/database/restore
 */
router.post('/config/database/restore', async (req, res) => {
    try {
        const result = await dbConfigService.restoreFromBackup();

        const statusCode = result.success ? 200 : 400;
        res.status(statusCode).json(result);

    } catch (error) {
        log.error('Error restoring configuration from backup:', error);
        return ErrorResponses.internalError(res, 'Restore failed', error);
    }
});

/**
 * Export current database configuration (sanitized)
 * GET /api/config/database/export
 */
router.get('/config/database/export', async (req, res) => {
    try {
        const result = await dbConfigService.exportConfiguration();

        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }

    } catch (error) {
        log.error('Error exporting configuration:', error);
        return ErrorResponses.internalError(res, 'Export failed', error);
    }
});

/**
 * Get database connection presets
 * GET /api/config/database/presets
 */
router.get('/config/database/presets', (req, res) => {
    try {
        const presets = dbConfigService.getConnectionPresets();
        res.json({
            success: true,
            presets: presets
        });
    } catch (error) {
        log.error('Error getting connection presets:', error);
        return ErrorResponses.internalError(res, 'Failed to get presets', error);
    }
});

// ===== SYSTEM MANAGEMENT ENDPOINTS =====

/**
 * Application restart endpoint (for database configuration changes)
 * POST /api/system/restart
 */
router.post('/system/restart', async (req, res) => {
    try {
        const { reason } = req.body;

        log.info(`Application restart requested. Reason: ${reason || 'Manual restart'}`);

        // Send response before restarting
        res.json({
            success: true,
            message: 'Application restart initiated',
            timestamp: new Date().toISOString()
        });

        // Give time for response to be sent
        setTimeout(() => {
            log.info('Restarting application...');
            process.exit(0); // This will trigger the process manager to restart
        }, 1000);

    } catch (error) {
        log.error('Error initiating restart:', error);
        return ErrorResponses.internalError(res, 'Restart failed', error);
    }
});

export default router;
