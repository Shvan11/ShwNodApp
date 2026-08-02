/**
 * Estimated Cost Presets Database Queries
 *
 * Provides CRUD operations for managing estimated cost preset values
 * that are displayed in dropdowns for faster data entry.
 *
 * `amount` is a PG `numeric`; the centralized pg parser (kysely.ts) returns it as a JS
 * number, so `$castTo<number>()` aligns the static type (kysely-codegen types numeric
 * as string) with the runtime value without emitting a SQL cast.
 */
import { sql } from 'kysely';
import { getKysely } from '../kysely.js';

// type definitions
// `type` (not `interface`) so a CostPreset[] feeds the contract's
// `z.looseObject({ preset_id })` sendData arg — the index-signature rule
// (docs/shared-contract-progress.md).
type CostPreset = {
  preset_id: number;
  amount: number;
  currency: 'IQD' | 'USD' | 'EUR';
  display_order: number;
};

/**
 * Get all cost presets, optionally filtered by currency
 */
export async function getCostPresets(currency: string | null = null): Promise<CostPreset[]> {
  const db = getKysely();
  let q = db
    .selectFrom('estimated_cost_presets')
    // `currency` is free-text citext in the DB but a closed 3-value vocabulary in the
    // app (the write path validates `z.enum(['IQD','USD','EUR'])`, and the read contract
    // declares the same enum). Restricting the SELECT to those three makes the narrowed
    // static type a GUARANTEE rather than an assertion, and keeps a stray legacy row
    // from fail-loud-ing the client's contract parse.
    .where('currency', 'in', ['IQD', 'USD', 'EUR'])
    .select((eb) => [
      'preset_id',
      eb.ref('amount').$castTo<number>().as('amount'),
      eb.ref('currency').$castTo<'IQD' | 'USD' | 'EUR'>().as('currency'),
      // display_order is nullable in the schema; the contract and the consumer's sort
      // both require a number, so default it in SQL (matches the handler's 0 default).
      eb.fn.coalesce('display_order', sql<number>`0`).as('display_order'),
    ]);

  q = currency
    ? q.where('currency', '=', currency).orderBy('display_order').orderBy('amount')
    : q.orderBy('currency').orderBy('display_order').orderBy('amount');

  return q.execute();
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

