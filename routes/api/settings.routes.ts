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
  bulkUpdateOptions
} from '../../services/database/queries/options-queries.js';
import DatabaseConfigService from '../../services/config/DatabaseConfigService.js';
import { sendSuccess, sendData, ErrorResponses } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { log } from '../../utils/logger.js';
import * as settings from '../../shared/contracts/settings.contract.js';

const router = Router();

// Boundary schemas + bodies live in the shared contract
// (`shared/contracts/settings.contract.ts`). The DB-config bodies stay DYNAMIC
// (`{[key]:unknown}` maps validated field-by-field by DatabaseConfigService);
// the bulk/update bodies keep their local interfaces (the service wants a string
// `value`, so the looser contract schema isn't the SSoT there).

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface OptionNameParams {
  optionName: string;
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

type RestartBody = settings.RestartBody;

// ===== OPTIONS/SETTINGS ENDPOINTS =====

/**
 * Get all system options
 * GET /api/options
 */
router.get('/options', async (_req: Request, res: Response): Promise<void> => {
  try {
    const options = await getAllOptions();
    sendData(res, settings.getOptions.response, { options });
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
  validate({ body: settings.bulkOptions.body }),
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
      sendData(
        res,
        settings.bulkOptions.response,
        { updated: result.updated, failed: result.failed },
        'Bulk update completed'
      );
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

      sendData(res, settings.getOptionByName.response, { optionName, value });
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
  validate({ params: settings.updateOption.params, body: settings.updateOption.body }),
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

      sendSuccess(res, null, 'Option updated successfully');
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
        sendData(res, settings.getDatabaseConfig.response, { config: result.config });
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
  validate({ body: settings.testDatabaseConnection.body }),
  async (
    req: Request<unknown, unknown, DatabaseConfigBody>,
    res: Response
  ): Promise<void> => {
    try {
      const testConfig = req.body;

      // body asserted to be a JSON object by the contract schema above.
      log.info('Testing database connection...');
      const result = await dbConfigService.testConnection(testConfig);

      // The test always *runs* successfully (HTTP 200); whether the DB was
      // reachable rides `connectionOk` in the envelope data. (Was a 200/400
      // split — re-modelled honestly per audit H4/N16, like photo `/prepare`.)
      sendData(res, settings.testDatabaseConnection.response, {
        connectionOk: result.success,
        message: result.message,
        details: result.details
      });
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
  validate({ body: settings.updateDatabaseConfig.body }),
  async (
    req: Request<unknown, unknown, DatabaseConfigBody>,
    res: Response
  ): Promise<void> => {
    try {
      const newConfig = req.body;

      // body asserted to be a JSON object by the contract schema above.
      log.info('Updating database configuration...');
      const result = await dbConfigService.updateConfiguration(newConfig);

      if (result.success) {
        // Mask password in response - create a copy to avoid mutating original
        const responseConfig = result.config
          ? { ...result.config, PG_PASSWORD: '••••••••' }
          : result.config;

        sendData(res, settings.updateDatabaseConfig.response, {
          config: responseConfig,
          requiresRestart: result.requiresRestart,
          message: result.message
        });
      } else {
        ErrorResponses.badRequest(
          res,
          result.message || 'Failed to update configuration',
          result.errors ? { errors: result.errors } : null
        );
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
 * Export current database configuration (sanitized)
 * GET /api/config/database/export
 */
router.get(
  '/config/database/export',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await dbConfigService.exportConfiguration();

      if (result.success) {
        sendData(res, settings.exportDatabaseConfig.response, { config: result.config });
      } else {
        ErrorResponses.internalError(
          res,
          result.message || 'Failed to export configuration'
        );
      }
    } catch (error) {
      log.error('Error exporting configuration:', error);
      ErrorResponses.internalError(res, 'Export failed', error as Error);
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
  validate({ body: settings.restart.body }),
  async (
    req: Request<unknown, unknown, RestartBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { reason } = req.body;

      log.info(
        `Application restart requested. reason: ${reason || 'Manual restart'}`
      );

      // Send response before restarting (then process.exit in the setTimeout
      // below — the envelope is flushed first; behavior preserved).
      sendData(res, settings.restart.response, { message: 'Application restart initiated' });

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
