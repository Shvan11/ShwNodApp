/**
 * Database queries for tbloptions table operations
 * Manages system settings and preferences
 */
import type { ColumnValue } from '../../../types/database.types.js';
import sql from 'mssql';
import { executeQuery, withTransaction, TYPES } from '../index.js';
import { log } from '../../../utils/logger.js';

// Type definitions
interface Option {
  OptionName: string;
  OptionValue: string | null;
}

interface BulkUpdateOption {
  name: string;
  value: string;
}

interface BulkUpdateResult {
  success: boolean;
  updated: number;
  failed: string[];
}

/**
 * Get all options from the database
 */
export async function getAllOptions(): Promise<Option[]> {
  try {
    const result = await executeQuery<Option>(
      'SELECT OptionName, OptionValue FROM tbloptions ORDER BY OptionName',
      [],
      (columns: ColumnValue[]) => ({
        OptionName: columns[0].value as string,
        OptionValue: columns[1].value as string | null,
      })
    );
    return result;
  } catch (error) {
    log.error('Error fetching all options', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Get a specific option value by name
 */
export async function getOption(optionName: string): Promise<string | null> {
  try {
    const result = await executeQuery<{ OptionValue: string | null }>(
      'SELECT OptionValue FROM tbloptions WHERE OptionName = @optionName',
      [['optionName', TYPES.NVarChar, optionName]],
      (columns: ColumnValue[]) => ({
        OptionValue: columns[0].value as string | null,
      })
    );

    return result.length > 0 ? result[0].OptionValue : null;
  } catch (error) {
    log.error('Error fetching option', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Update an existing option value (only updates existing options)
 */
export async function updateOption(optionName: string, optionValue: string): Promise<boolean> {
  try {
    const result = await executeQuery(
      'UPDATE tbloptions SET OptionValue = @optionValue WHERE OptionName = @optionName',
      [
        ['optionName', TYPES.NVarChar, optionName],
        ['optionValue', TYPES.NVarChar, optionValue],
      ],
      () => ({})
    );

    return (result.rowsAffected ?? 0) > 0;
  } catch (error) {
    log.error('Error updating option', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Get options by name pattern (for grouped settings)
 */
export async function getOptionsByPattern(pattern: string): Promise<Option[]> {
  try {
    const result = await executeQuery<Option>(
      'SELECT OptionName, OptionValue FROM tbloptions WHERE OptionName LIKE @pattern ORDER BY OptionName',
      [['pattern', TYPES.NVarChar, pattern]],
      (columns: ColumnValue[]) => ({
        OptionName: columns[0].value as string,
        OptionValue: columns[1].value as string | null,
      })
    );

    return result;
  } catch (error) {
    log.error('Error fetching options by pattern', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Bulk update multiple existing options. All updates run inside a single
 * transaction, so a SQL error on any row rolls back the whole batch (atomic) —
 * matching this function's contract. Names that match no existing row are not
 * errors; they're collected in `failed` without aborting the batch.
 */
export async function bulkUpdateOptions(options: BulkUpdateOption[]): Promise<BulkUpdateResult> {
  try {
    let updatedCount = 0;
    const failed: string[] = [];

    await withTransaction(async (tx) => {
      for (const option of options) {
        const result = await new sql.Request(tx)
          .input('optionName', TYPES.NVarChar, option.name)
          .input('optionValue', TYPES.NVarChar, option.value)
          .query(
            'UPDATE tbloptions SET OptionValue = @optionValue WHERE OptionName = @optionName'
          );

        const affected = Array.isArray(result.rowsAffected)
          ? result.rowsAffected.reduce((sum, n) => sum + n, 0)
          : (result.rowsAffected ?? 0);

        if (affected > 0) {
          updatedCount++;
        } else {
          failed.push(option.name);
        }
      }
    });

    return {
      success: true,
      updated: updatedCount,
      failed: failed,
    };
  } catch (error) {
    log.error('Error bulk updating options', { error: (error as Error).message });
    throw error;
  }
}
