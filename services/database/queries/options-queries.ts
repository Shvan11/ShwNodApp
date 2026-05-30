/**
 * Database queries for tbloptions table operations
 * Manages system settings and preferences
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). This was a facade
 * bypasser (`withTransaction` + `new sql.Request(tx)`); the bulk path now runs on a
 * Kysely transaction via `withPgTransaction`. `OptionName` is `citext`, so the LIKE
 * pattern match stays case-insensitive (matches the old Arabic_CI_AS column).
 */
import { getKysely, withPgTransaction } from '../kysely.js';
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
    return await getKysely()
      .selectFrom('tbloptions')
      .select(['OptionName', 'OptionValue'])
      .orderBy('OptionName')
      .execute();
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
    const row = await getKysely()
      .selectFrom('tbloptions')
      .select('OptionValue')
      .where('OptionName', '=', optionName)
      .executeTakeFirst();

    return row ? row.OptionValue : null;
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
    const result = await getKysely()
      .updateTable('tbloptions')
      .set({ OptionValue: optionValue })
      .where('OptionName', '=', optionName)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
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
    return await getKysely()
      .selectFrom('tbloptions')
      .select(['OptionName', 'OptionValue'])
      .where('OptionName', 'like', pattern)
      .orderBy('OptionName')
      .execute();
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

    await withPgTransaction(async (trx) => {
      for (const option of options) {
        const result = await trx
          .updateTable('tbloptions')
          .set({ OptionValue: option.value })
          .where('OptionName', '=', option.name)
          .executeTakeFirst();

        if (Number(result.numUpdatedRows) > 0) {
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
