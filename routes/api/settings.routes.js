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
        console.error("Error getting options:", error);
        res.status(500).json({ status: 'error', message: error.message });
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
            return res.status(404).json({
                status: 'error',
                message: 'Option not found'
            });
        }

        res.json({ status: 'success', optionName, value });
    } catch (error) {
        console.error("Error getting option:", error);
        res.status(500).json({ status: 'error', message: error.message });
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
            return res.status(400).json({
                status: 'error',
                message: 'Value is required'
            });
        }

        const updated = await updateOption(optionName, value);

        if (!updated) {
            return res.status(404).json({
                status: 'error',
                message: 'Option not found or could not be updated'
            });
        }

        res.json({ status: 'success', message: 'Option updated successfully' });
    } catch (error) {
        console.error("Error updating option:", error);
        res.status(500).json({ status: 'error', message: error.message });
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
        console.error("Error getting options by pattern:", error);
        res.status(500).json({ status: 'error', message: error.message });
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
            return res.status(400).json({
                status: 'error',
                message: 'Options array is required'
            });
        }

        const result = await bulkUpdateOptions(options);
        res.json({
            status: 'success',
            message: 'Bulk update completed',
            updated: result.updated,
            failed: result.failed
        });
    } catch (error) {
        console.error("Error bulk updating options:", error);
        res.status(500).json({ status: 'error', message: error.message });
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
            res.status(500).json({
                success: false,
                message: 'Failed to get database configuration',
                error: result.error
            });
        }
    } catch (error) {
        console.error('Error getting database configuration:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
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
            return res.status(400).json({
                success: false,
                message: 'Invalid configuration provided'
            });
        }

        console.log('Testing database connection...');
        const result = await dbConfigService.testConnection(testConfig);

        // Return appropriate status code based on test result
        const statusCode = result.success ? 200 : 400;
        res.status(statusCode).json(result);

    } catch (error) {
        console.error('Error testing database connection:', error);
        res.status(500).json({
            success: false,
            message: 'Connection test failed',
            error: error.message
        });
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
            return res.status(400).json({
                success: false,
                message: 'Invalid configuration provided'
            });
        }

        console.log('Updating database configuration...');
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
        console.error('Error updating database configuration:', error);
        res.status(500).json({
            success: false,
            message: 'Configuration update failed',
            error: error.message
        });
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
        console.error('Error getting configuration status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get configuration status',
            error: error.message
        });
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
        console.error('Error creating configuration backup:', error);
        res.status(500).json({
            success: false,
            message: 'Backup creation failed',
            error: error.message
        });
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
        console.error('Error restoring configuration from backup:', error);
        res.status(500).json({
            success: false,
            message: 'Restore failed',
            error: error.message
        });
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
        console.error('Error exporting configuration:', error);
        res.status(500).json({
            success: false,
            message: 'Export failed',
            error: error.message
        });
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
        console.error('Error getting connection presets:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get presets',
            error: error.message
        });
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

        console.log(`Application restart requested. Reason: ${reason || 'Manual restart'}`);

        // Send response before restarting
        res.json({
            success: true,
            message: 'Application restart initiated',
            timestamp: new Date().toISOString()
        });

        // Give time for response to be sent
        setTimeout(() => {
            console.log('Restarting application...');
            process.exit(0); // This will trigger the process manager to restart
        }, 1000);

    } catch (error) {
        console.error('Error initiating restart:', error);
        res.status(500).json({
            success: false,
            message: 'Restart failed',
            error: error.message
        });
    }
});

export default router;
