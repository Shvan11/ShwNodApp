/**
 * Lookup Table Admin API Routes
 *
 * Handles CRUD operations for lookup tables through a generic interface.
 * Only whitelisted tables can be accessed for security.
 */

import { Router, type Request, type Response } from 'express';
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

const router = Router();

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TableNameParams {
  tableName: string;
}

interface TableNameIdParams {
  tableName: string;
  id: string;
}

interface LookupItemBody {
  [key: string]: unknown;
}

/**
 * Get all available lookup table configurations
 * GET /api/admin/lookups/tables
 */
router.get(
  '/lookups/tables',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const tables = getLookupTableConfigs();
      res.json(tables);
    } catch (error) {
      log.error('Error fetching lookup table configs:', {
        error: (error as Error).message
      });
      ErrorResponses.internalError(
        res,
        'Failed to fetch lookup table configurations',
        error as Error
      );
    }
  }
);

/**
 * Get all items from a specific lookup table
 * GET /api/admin/lookups/:tableName
 */
router.get(
  '/lookups/:tableName',
  async (req: Request<TableNameParams>, res: Response): Promise<void> => {
    try {
      const { tableName } = req.params;

      if (!isValidTableKey(tableName)) {
        ErrorResponses.badRequest(res, `Invalid table name: ${tableName}`);
        return;
      }

      const items = await getLookupItems(tableName);
      res.json(items);
    } catch (error) {
      log.error('Error fetching lookup items:', {
        table: req.params.tableName,
        error: (error as Error).message
      });
      ErrorResponses.internalError(
        res,
        'Failed to fetch lookup items',
        error as Error
      );
    }
  }
);

/**
 * Create a new item in a lookup table
 * POST /api/admin/lookups/:tableName
 * Body: { [columnName]: value, ... }
 */
router.post(
  '/lookups/:tableName',
  async (
    req: Request<TableNameParams, unknown, LookupItemBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { tableName } = req.params;

      if (!isValidTableKey(tableName)) {
        ErrorResponses.badRequest(res, `Invalid table name: ${tableName}`);
        return;
      }

      const config = getTableConfig(tableName);
      if (!config) {
        ErrorResponses.badRequest(res, `Configuration not found for table: ${tableName}`);
        return;
      }

      // Validate required fields
      for (const col of config.columns) {
        if (col.required && !req.body[col.name]) {
          ErrorResponses.badRequest(res, `${col.label} is required`);
          return;
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
        error: (error as Error).message
      });
      ErrorResponses.internalError(res, 'Failed to create item', error as Error);
    }
  }
);

/**
 * Update an existing item in a lookup table
 * PUT /api/admin/lookups/:tableName/:id
 * Body: { [columnName]: value, ... }
 */
router.put(
  '/lookups/:tableName/:id',
  async (
    req: Request<TableNameIdParams, unknown, LookupItemBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { tableName, id } = req.params;

      if (!isValidTableKey(tableName)) {
        ErrorResponses.badRequest(res, `Invalid table name: ${tableName}`);
        return;
      }

      if (!id) {
        ErrorResponses.badRequest(res, 'Item ID is required');
        return;
      }

      const config = getTableConfig(tableName);
      if (!config) {
        ErrorResponses.badRequest(res, `Configuration not found for table: ${tableName}`);
        return;
      }

      // Validate required fields
      for (const col of config.columns) {
        if (col.required && !req.body[col.name]) {
          ErrorResponses.badRequest(res, `${col.label} is required`);
          return;
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
        error: (error as Error).message
      });
      ErrorResponses.internalError(res, 'Failed to update item', error as Error);
    }
  }
);

/**
 * Delete an item from a lookup table
 * DELETE /api/admin/lookups/:tableName/:id
 */
router.delete(
  '/lookups/:tableName/:id',
  async (req: Request<TableNameIdParams>, res: Response): Promise<void> => {
    try {
      const { tableName, id } = req.params;

      if (!isValidTableKey(tableName)) {
        ErrorResponses.badRequest(res, `Invalid table name: ${tableName}`);
        return;
      }

      if (!id) {
        ErrorResponses.badRequest(res, 'Item ID is required');
        return;
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
        error: (error as Error).message
      });
      ErrorResponses.internalError(res, 'Failed to delete item', error as Error);
    }
  }
);

export default router;
