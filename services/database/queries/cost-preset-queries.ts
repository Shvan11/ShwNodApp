/**
 * Estimated Cost Presets Database Queries
 *
 * Provides CRUD operations for managing estimated cost preset values
 * that are displayed in dropdowns for faster data entry.
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). `amount` is a PG
 * `numeric`; the centralized pg parser (kysely.ts) returns it as a JS number, so
 * `$castTo<number>()` aligns the static type (kysely-codegen types numeric as string)
 * with the runtime value without emitting a SQL cast.
 */
import { getKysely } from '../kysely.js';

// type definitions
interface CostPreset {
  preset_id: number;
  amount: number;
  currency: string;
  display_order: number;
}

/**
 * Get all cost presets, optionally filtered by currency
 */
export async function getCostPresets(currency: string | null = null): Promise<CostPreset[]> {
  const db = getKysely();
  let q = db
    .selectFrom('estimated_cost_presets')
    .select((eb) => ['preset_id', eb.ref('amount').$castTo<number>().as('amount'), 'currency', 'display_order']);

  q = currency
    ? q.where('currency', '=', currency).orderBy('display_order').orderBy('amount')
    : q.orderBy('currency').orderBy('display_order').orderBy('amount');

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
    .insertInto('estimated_cost_presets')
    .values({ amount: amount, currency: currency, display_order: displayOrder })
    .returning('preset_id')
    .executeTakeFirstOrThrow();

  return row.preset_id;
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
    .updateTable('estimated_cost_presets')
    .set({ amount: amount, currency: currency, display_order: displayOrder })
    .where('preset_id', '=', presetId)
    .execute();
}

/**
 * Delete a cost preset
 */
export async function deleteCostPreset(presetId: number): Promise<void> {
  const db = getKysely();
  await db.deleteFrom('estimated_cost_presets').where('preset_id', '=', presetId).execute();
}

