/**
 * Database queries for the `options` table — system settings and preferences.
 *
 * The bulk-update path runs on a Kysely transaction via `withPgTransaction` so a
 * failed row rolls the whole batch back. `option_name` is `citext`, so the LIKE
 * pattern match is case-insensitive.
 */
import { getKysely, withPgTransaction } from '../kysely.js';
import { log } from '../../../utils/logger.js';

// type definitions
// `type` (not `interface`) so Option[] is assignable to the settings contract's
// `z.array(z.looseObject({ option_name }))` sendData arg (the looseObject index-signature rule).
type Option = {
  option_name: string;
  option_value: string | null;
};

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
      .selectFrom('options')
      .select(['option_name', 'option_value'])
      .orderBy('option_name')
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
      .selectFrom('options')
      .select('option_value')
      .where('option_name', '=', optionName)
      .executeTakeFirst();

    return row ? row.option_value : null;
  } catch (error) {
    log.error('Error fetching option', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Read several options in ONE round trip, as a name → value map. Names the
 * caller asked for that have no row are simply absent from the map (the caller
 * owns the fallback). Added for the calendar range view, which needs four
 * settings before it can decide which slot rows to render.
 */
export async function getOptions(optionNames: string[]): Promise<Map<string, string | null>> {
  if (optionNames.length === 0) return new Map();
  const rows = await getKysely()
    .selectFrom('options')
    .select(['option_name', 'option_value'])
    .where('option_name', 'in', optionNames)
    .execute();
  return new Map(rows.map((r) => [r.option_name, r.option_value]));
}

/**
 * Update an existing option value (only updates existing options)
 */
export async function updateOption(optionName: string, optionValue: string): Promise<boolean> {
  try {
    const result = await getKysely()
      .updateTable('options')
      .set({ option_value: optionValue })
      .where('option_name', '=', optionName)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  } catch (error) {
    log.error('Error updating option', { error: (error as Error).message });
    throw error;
  }
}

/**
 * Insert or update an option (upsert). Unlike `updateOption`, this creates the
 * row when it doesn't exist yet — needed for runtime-managed keys (e.g. the
 * Telegram session) that aren't seeded by a migration.
 */
export async function upsertOption(optionName: string, optionValue: string): Promise<void> {
  try {
    await getKysely()
      .insertInto('options')
      .values({ option_name: optionName, option_value: optionValue })
      .onConflict((oc) => oc.column('option_name').doUpdateSet({ option_value: optionValue }))
      .execute();
  } catch (error) {
    log.error('Error upserting option', { error: (error as Error).message });
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
          .updateTable('options')
          .set({ option_value: option.value })
          .where('option_name', '=', option.name)
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
