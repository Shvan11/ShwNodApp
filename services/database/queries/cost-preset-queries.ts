/**
 * Estimated Cost Presets Database Queries
 *
 * Provides CRUD operations for managing estimated cost preset values
 * that are displayed in dropdowns for faster data entry.
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). `Amount` is a PG
 * `numeric`; the centralized pg parser (kysely.ts) returns it as a JS number, so
 * `$castTo<number>()` aligns the static type (kysely-codegen types numeric as string)
 * with the runtime value without emitting a SQL cast.
 */
import { getKysely } from '../kysely.js';

// Type definitions
interface CostPreset {
  PresetID: number;
  Amount: number;
  Currency: string;
  DisplayOrder: number;
}

/**
 * Get all cost presets, optionally filtered by currency
 */
export async function getCostPresets(currency: string | null = null): Promise<CostPreset[]> {
  const db = getKysely();
  let q = db
    .selectFrom('tblEstimatedCostPresets')
    .select((eb) => ['PresetID', eb.ref('Amount').$castTo<number>().as('Amount'), 'Currency', 'DisplayOrder']);

  q = currency
    ? q.where('Currency', '=', currency).orderBy('DisplayOrder').orderBy('Amount')
    : q.orderBy('Currency').orderBy('DisplayOrder').orderBy('Amount');

  return q.execute() as Promise<CostPreset[]>;
}

/**
 * Create a new cost preset
 */
export async function createCostPreset(
  amount: number,
  currency: string,
  displayOrder = 0
): Promise<number> {
  const db = getKysely();
  const row = await db
    .insertInto('tblEstimatedCostPresets')
    .values({ Amount: amount, Currency: currency, DisplayOrder: displayOrder })
    .returning('PresetID')
    .executeTakeFirstOrThrow();

  return row.PresetID;
}

/**
 * Update an existing cost preset
 */
export async function updateCostPreset(
  presetId: number,
  amount: number,
  currency: string,
  displayOrder: number
): Promise<void> {
  const db = getKysely();
  await db
    .updateTable('tblEstimatedCostPresets')
    .set({ Amount: amount, Currency: currency, DisplayOrder: displayOrder })
    .where('PresetID', '=', presetId)
    .execute();
}

/**
 * Delete a cost preset
 */
export async function deleteCostPreset(presetId: number): Promise<void> {
  const db = getKysely();
  await db.deleteFrom('tblEstimatedCostPresets').where('PresetID', '=', presetId).execute();
}

/**
 * Get distinct currencies that have presets
 */
export async function getCostPresetCurrencies(): Promise<string[]> {
  const db = getKysely();
  const rows = await db
    .selectFrom('tblEstimatedCostPresets')
    .select('Currency')
    .distinct()
    .orderBy('Currency')
    .execute();

  return rows.map((r) => r.Currency);
}
