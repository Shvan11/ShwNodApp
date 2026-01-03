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

import { Router, type Request, type Response } from 'express';
import {
  getAllOptions,
  getOption,
  updateOption,
  getOptionsByPattern,
  bulkUpdateOptions
} from '../../services/database/queries/options-queries.js';
import DatabaseConfigService from '../../services/config/DatabaseConfigService.js';
import ProtocolHandlerConfigService from '../../services/config/ProtocolHandlerConfigService.js';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface OptionNameParams {
  optionName: string;
}

interface PatternParams {
  pattern: string;
}

interface BulkUpdateBody {
  options: Array<{ name: string; value: string }>;
}

interface UpdateOptionBody {
  value: string;
}

interface DatabaseConfigBody {
  [key: string]: unknown;
}

interface ProtocolHandlerConfigBody {
  config: {
    [section: string]: {
      [key: string]: string;
    };
  };
}

interface RestartBody {
  reason?: string;
}

// ===== OPTIONS/SETTINGS ENDPOINTS =====

/**
 * Get all system options
 * GET /api/options
 */
router.get('/options', async (_req: Request, res: Response): Promise<void> => {
  try {
    const options = await getAllOptions();
    res.json({ status: 'success', options });
  } catch (error) {
    log.error('Error getting options:', error);
    ErrorResponses.internalError(
      res,
      'Failed to retrieve system options',
      error as Error
    );
  }
});

/**
 * Bulk update multiple options
 * PUT /api/options/bulk
 * NOTE: This route must come BEFORE /options/:optionName to avoid matching "bulk" as optionName
 */
router.put(
  '/options/bulk',
  async (
    req: Request<unknown, unknown, BulkUpdateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { options } = req.body;

      if (!options || !Array.isArray(options)) {
        ErrorResponses.invalidParameter(res, 'options', {
          reason: 'Options array is required'
        });
        return;
      }

      const result = await bulkUpdateOptions(options);
      res.json({
        status: 'success',
        message: 'Bulk update completed',
        updated: result.updated,
        failed: result.failed
      });
    } catch (error) {
      log.error('Error bulk updating options:', error);
      ErrorResponses.internalError(
        res,
        'Failed to bulk update options',
        error as Error
      );
    }
  }
);

/**
 * Get options matching a pattern
 * GET /api/options/pattern/:pattern
 * NOTE: This route must come BEFORE /options/:optionName to avoid matching "pattern" as optionName
 */
router.get(
  '/options/pattern/:pattern',
  async (req: Request<PatternParams>, res: Response): Promise<void> => {
    try {
      const { pattern } = req.params;
      const options = await getOptionsByPattern(pattern);
      res.json({ status: 'success', options });
    } catch (error) {
      log.error('Error getting options by pattern:', error);
      ErrorResponses.internalError(
        res,
        'Failed to retrieve options by pattern',
        error as Error
      );
    }
  }
);

/**
 * Get a specific option by name
 * GET /api/options/:optionName
 */
router.get(
  '/options/:optionName',
  async (req: Request<OptionNameParams>, res: Response): Promise<void> => {
    try {
      const { optionName } = req.params;
      const value = await getOption(optionName);

      if (value === null) {
        ErrorResponses.notFound(res, 'Option');
        return;
      }

      res.json({ status: 'success', optionName, value });
    } catch (error) {
      log.error('Error getting option:', error);
      ErrorResponses.internalError(
        res,
        'Failed to retrieve option',
        error as Error
      );
    }
  }
);

/**
 * Update a specific option
 * PUT /api/options/:optionName
 */
router.put(
  '/options/:optionName',
  async (
    req: Request<OptionNameParams, unknown, UpdateOptionBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { optionName } = req.params;
      const { value } = req.body;

      if (!value) {
        ErrorResponses.missingParameter(res, 'value');
        return;
      }

      const updated = await updateOption(optionName, value);

      if (!updated) {
        ErrorResponses.notFound(res, 'Option', {
          reason: 'Option not found or could not be updated'
        });
        return;
      }

      res.json({ status: 'success', message: 'Option updated successfully' });
    } catch (error) {
      log.error('Error updating option:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update option',
        error as Error
      );
    }
  }
);

// ===== DATABASE CONFIGURATION ENDPOINTS =====

const dbConfigService = new DatabaseConfigService();
const protocolConfigService = new ProtocolHandlerConfigService();

/**
 * Get current database configuration
 * GET /api/config/database
 */
router.get(
  '/config/database',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await dbConfigService.getCurrentConfig(false); // Mask sensitive data

      if (result.success) {
        res.json({
          success: true,
          config: result.config,
          timestamp: result.timestamp
        });
      } else {
        ErrorResponses.internalError(
          res,
          'Failed to get database configuration',
          { error: result.error } as unknown as Error
        );
      }
    } catch (error) {
      log.error('Error getting database configuration:', error);
      ErrorResponses.internalError(
        res,
        'Failed to get database configuration',
        error as Error
      );
    }
  }
);

/**
 * Test database connection with provided configuration
 * POST /api/config/database/test
 */
router.post(
  '/config/database/test',
  async (
    req: Request<unknown, unknown, DatabaseConfigBody>,
    res: Response
  ): Promise<void> => {
    try {
      const testConfig = req.body;

      if (!testConfig || typeof testConfig !== 'object') {
        ErrorResponses.badRequest(res, 'Invalid configuration provided');
        return;
      }

      log.info('Testing database connection...');
      const result = await dbConfigService.testConnection(testConfig);

      // Return appropriate status code based on test result
      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json(result);
    } catch (error) {
      log.error('Error testing database connection:', error);
      ErrorResponses.internalError(res, 'Connection test failed', error as Error);
    }
  }
);

/**
 * Update database configuration
 * PUT /api/config/database
 */
router.put(
  '/config/database',
  async (
    req: Request<unknown, unknown, DatabaseConfigBody>,
    res: Response
  ): Promise<void> => {
    try {
      const newConfig = req.body;

      if (!newConfig || typeof newConfig !== 'object') {
        ErrorResponses.badRequest(res, 'Invalid configuration provided');
        return;
      }

      log.info('Updating database configuration...');
      const result = await dbConfigService.updateConfiguration(newConfig);

      if (result.success) {
        // Mask password in response - create a copy to avoid mutating original
        const responseConfig = result.config
          ? { ...result.config, DB_PASSWORD: '••••••••' }
          : result.config;

        res.json({
          ...result,
          config: responseConfig
        });
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      log.error('Error updating database configuration:', error);
      ErrorResponses.internalError(
        res,
        'Configuration update failed',
        error as Error
      );
    }
  }
);

/**
 * Get database configuration status and diagnostics
 * GET /api/config/database/status
 */
router.get(
  '/config/database/status',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await dbConfigService.getConfigurationStatus();
      res.json(result);
    } catch (error) {
      log.error('Error getting configuration status:', error);
      ErrorResponses.internalError(
        res,
        'Failed to get configuration status',
        error as Error
      );
    }
  }
);

/**
 * Create backup of current database configuration
 * POST /api/config/database/backup
 */
router.post(
  '/config/database/backup',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await dbConfigService.createBackup();

      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json(result);
    } catch (error) {
      log.error('Error creating configuration backup:', error);
      ErrorResponses.internalError(res, 'Backup creation failed', error as Error);
    }
  }
);

/**
 * Restore database configuration from backup
 * POST /api/config/database/restore
 */
router.post(
  '/config/database/restore',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await dbConfigService.restoreFromBackup();

      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json(result);
    } catch (error) {
      log.error('Error restoring configuration from backup:', error);
      ErrorResponses.internalError(res, 'Restore failed', error as Error);
    }
  }
);

/**
 * Export current database configuration (sanitized)
 * GET /api/config/database/export
 */
router.get(
  '/config/database/export',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await dbConfigService.exportConfiguration();

      if (result.success) {
        res.json(result);
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      log.error('Error exporting configuration:', error);
      ErrorResponses.internalError(res, 'Export failed', error as Error);
    }
  }
);

/**
 * Get database connection presets
 * GET /api/config/database/presets
 */
router.get('/config/database/presets', (_req: Request, res: Response): void => {
  try {
    const presets = dbConfigService.getConnectionPresets();
    res.json({
      success: true,
      presets: presets
    });
  } catch (error) {
    log.error('Error getting connection presets:', error);
    ErrorResponses.internalError(res, 'Failed to get presets', error as Error);
  }
});

// ===== PROTOCOL HANDLER CONFIGURATION ENDPOINTS =====

/**
 * Get current protocol handler configuration
 * GET /api/config/protocol-handlers
 */
router.get(
  '/config/protocol-handlers',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await protocolConfigService.readConfig();

      if (result.success) {
        res.json({
          success: true,
          config: result.config,
          timestamp: result.timestamp
        });
      } else {
        res.status(404).json({
          success: false,
          error: result.error,
          message: result.message
        });
      }
    } catch (error) {
      log.error('Error getting protocol handler configuration:', error);
      ErrorResponses.internalError(
        res,
        'Failed to get protocol handler configuration',
        error as Error
      );
    }
  }
);

/**
 * Update protocol handler configuration
 * PUT /api/config/protocol-handlers
 */
router.put(
  '/config/protocol-handlers',
  async (
    req: Request<unknown, unknown, ProtocolHandlerConfigBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { config } = req.body;

      if (!config || typeof config !== 'object') {
        ErrorResponses.badRequest(res, 'Invalid configuration provided');
        return;
      }

      log.info('Updating protocol handler configuration...');
      const result = await protocolConfigService.updateConfig(config);

      if (result.success) {
        res.json({
          success: true,
          config: result.config,
          message: result.message,
          timestamp: result.timestamp
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
          message: result.message
        });
      }
    } catch (error) {
      log.error('Error updating protocol handler configuration:', error);
      ErrorResponses.internalError(
        res,
        'Failed to update protocol handler configuration',
        error as Error
      );
    }
  }
);

/**
 * Get protocol handler configuration file status
 * GET /api/config/protocol-handlers/status
 */
router.get(
  '/config/protocol-handlers/status',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const status = await protocolConfigService.getFileStatus();
      const paths = protocolConfigService.getPaths();

      res.json({
        success: true,
        status,
        paths,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      log.error('Error getting protocol handler status:', error);
      ErrorResponses.internalError(
        res,
        'Failed to get configuration status',
        error as Error
      );
    }
  }
);

/**
 * Create backup of protocol handler configuration
 * POST /api/config/protocol-handlers/backup
 */
router.post(
  '/config/protocol-handlers/backup',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await protocolConfigService.createBackup();
      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json(result);
    } catch (error) {
      log.error('Error creating protocol handler backup:', error);
      ErrorResponses.internalError(res, 'Backup creation failed', error as Error);
    }
  }
);

/**
 * Restore protocol handler configuration from backup
 * POST /api/config/protocol-handlers/restore
 */
router.post(
  '/config/protocol-handlers/restore',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await protocolConfigService.restoreFromBackup();
      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json(result);
    } catch (error) {
      log.error('Error restoring protocol handler configuration:', error);
      ErrorResponses.internalError(res, 'Restore failed', error as Error);
    }
  }
);

// ===== SYSTEM MANAGEMENT ENDPOINTS =====

/**
 * Application restart endpoint (for database configuration changes)
 * POST /api/system/restart
 */
router.post(
  '/system/restart',
  async (
    req: Request<unknown, unknown, RestartBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { reason } = req.body;

      log.info(
        `Application restart requested. Reason: ${reason || 'Manual restart'}`
      );

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
      ErrorResponses.internalError(res, 'Restart failed', error as Error);
    }
  }
);

export default router;
