/**
 * Estimated Cost Presets Database Queries
 *
 * Provides CRUD operations for managing estimated cost preset values
 * that are displayed in dropdowns for faster data entry.
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, TYPES, SqlParam } from '../index.js';

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
  const query = currency
    ? `SELECT PresetID, Amount, Currency, DisplayOrder
       FROM dbo.tblEstimatedCostPresets
       WHERE Currency = @currency
       ORDER BY DisplayOrder, Amount`
    : `SELECT PresetID, Amount, Currency, DisplayOrder
       FROM dbo.tblEstimatedCostPresets
       ORDER BY Currency, DisplayOrder, Amount`;

  const parameters: SqlParam[] = currency ? [['currency', TYPES.NVarChar, currency]] : [];

  return executeQuery<CostPreset>(query, parameters, (columns: ColumnValue[]) => ({
    PresetID: columns[0].value as number,
    Amount: columns[1].value as number,
    Currency: columns[2].value as string,
    DisplayOrder: columns[3].value as number,
  }));
}

/**
 * Create a new cost preset
 */
export async function createCostPreset(
  amount: number,
  currency: string,
  displayOrder = 0
): Promise<number> {
  const query = `
    INSERT INTO dbo.tblEstimatedCostPresets (Amount, Currency, DisplayOrder)
    OUTPUT INSERTED.PresetID
    VALUES (@amount, @currency, @displayOrder)
  `;

  const result = await executeQuery<number>(
    query,
    [
      ['amount', TYPES.Decimal, amount],
      ['currency', TYPES.NVarChar, currency],
      ['displayOrder', TYPES.Int, displayOrder],
    ],
    (columns: ColumnValue[]) => columns[0]?.value as number
  );

  if (result?.[0] === undefined) {
    throw new Error('Failed to create cost preset: no ID returned');
  }

  return result[0];
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
  const query = `
    UPDATE dbo.tblEstimatedCostPresets
    SET Amount = @amount,
        Currency = @currency,
        DisplayOrder = @displayOrder
    WHERE PresetID = @presetId
  `;

  await executeQuery(
    query,
    [
      ['presetId', TYPES.Int, presetId],
      ['amount', TYPES.Decimal, amount],
      ['currency', TYPES.NVarChar, currency],
      ['displayOrder', TYPES.Int, displayOrder],
    ],
    () => ({})
  );
}

/**
 * Delete a cost preset
 */
export async function deleteCostPreset(presetId: number): Promise<void> {
  const query = `
    DELETE FROM dbo.tblEstimatedCostPresets
    WHERE PresetID = @presetId
  `;

  await executeQuery(query, [['presetId', TYPES.Int, presetId]], () => ({}));
}

/**
 * Get distinct currencies that have presets
 */
export async function getCostPresetCurrencies(): Promise<string[]> {
  const query = `
    SELECT DISTINCT Currency
    FROM dbo.tblEstimatedCostPresets
    ORDER BY Currency
  `;

  return executeQuery<string>(query, [], (columns: ColumnValue[]) => columns[0].value as string);
}
