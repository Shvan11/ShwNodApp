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
import { z } from 'zod';
import {
  getAllOptions,
  getOption,
  updateOption,
  bulkUpdateOptions
} from '../../services/database/queries/options-queries.js';
import DatabaseConfigService from '../../services/config/DatabaseConfigService.js';
import { sendSuccess, ErrorResponses } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { log } from '../../utils/logger.js';

const router = Router();

// Boundary schemas. The option `value` is a scalar (string/number/boolean) the
// options table stores as text; each bulk element is loose-validated for a string
// `name` (value passes through). The `/config/database` + `/config/database/test`
// bodies are intentionally DYNAMIC (`{[key]:unknown}` db-config maps) and stay
// validated by DatabaseConfigService — not statically schemable here (cf. lookup-admin).
const optionScalar = z.union([z.string(), z.number(), z.boolean()]);
const bulkOptionsBodySchema = z.object({ options: z.array(z.looseObject({ name: z.string() })) });
const optionNameParams = z.object({ optionName: z.string().min(1) });
const updateOptionBodySchema = z.object({ value: optionScalar });
const restartBodySchema = z.object({ reason: z.string().optional() });
// DB-config bodies are free-form key/value maps (validated field-by-field by
// dbConfigService); the boundary guard just asserts a JSON object. Loose so no
// config key is stripped before reaching the service.
const dbConfigBodySchema = z.looseObject({});

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
    sendSuccess(res, { options });
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
  validate({ body: bulkOptionsBodySchema }),
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
      sendSuccess(
        res,
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

      sendSuccess(res, { optionName, value });
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
  validate({ params: optionNameParams, body: updateOptionBodySchema }),
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
        sendSuccess(res, { config: result.config });
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
  validate({ body: dbConfigBodySchema }),
  async (
    req: Request<unknown, unknown, DatabaseConfigBody>,
    res: Response
  ): Promise<void> => {
    try {
      const testConfig = req.body;

      // body asserted to be a JSON object by dbConfigBodySchema above.
      log.info('Testing database connection...');
      const result = await dbConfigService.testConnection(testConfig);

      // The test always *runs* successfully (HTTP 200); whether the DB was
      // reachable rides `connectionOk` in the envelope data. (Was a 200/400
      // split — re-modelled honestly per audit H4/N16, like photo `/prepare`.)
      sendSuccess(res, {
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
  validate({ body: dbConfigBodySchema }),
  async (
    req: Request<unknown, unknown, DatabaseConfigBody>,
    res: Response
  ): Promise<void> => {
    try {
      const newConfig = req.body;

      // body asserted to be a JSON object by dbConfigBodySchema above.
      log.info('Updating database configuration...');
      const result = await dbConfigService.updateConfiguration(newConfig);

      if (result.success) {
        // Mask password in response - create a copy to avoid mutating original
        const responseConfig = result.config
          ? { ...result.config, PG_PASSWORD: '••••••••' }
          : result.config;

        sendSuccess(res, {
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
        sendSuccess(res, { config: result.config });
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
  validate({ body: restartBodySchema }),
  async (
    req: Request<unknown, unknown, RestartBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { reason } = req.body;

      log.info(
        `Application restart requested. reason: ${reason || 'Manual restart'}`
      );

      // Send response before restarting
      sendSuccess(res, { message: 'Application restart initiated' });

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
