/**
 * Estimated Cost Presets Database Queries
 *
 * Provides CRUD operations for managing estimated cost preset values
 * that are displayed in dropdowns for faster data entry.
 */

import { executeQuery, TYPES } from '../index.js';

/**
 * Get all cost presets, optionally filtered by currency
 * @param {string} currency - Optional currency filter (IQD, USD, EUR)
 * @returns {Promise<Array>} Array of cost presets
 */
export async function getCostPresets(currency = null) {
    const query = currency
        ? `SELECT PresetID, Amount, Currency, DisplayOrder
           FROM dbo.tblEstimatedCostPresets
           WHERE Currency = @currency
           ORDER BY DisplayOrder, Amount`
        : `SELECT PresetID, Amount, Currency, DisplayOrder
           FROM dbo.tblEstimatedCostPresets
           ORDER BY Currency, DisplayOrder, Amount`;

    const parameters = currency ? [['currency', TYPES.NVarChar, currency]] : [];

    return executeQuery(
        query,
        parameters,
        (columns) => ({
            PresetID: columns[0].value,
            Amount: columns[1].value,
            Currency: columns[2].value,
            DisplayOrder: columns[3].value
        })
    );
}

/**
 * Create a new cost preset
 * @param {number} amount - The preset amount
 * @param {string} currency - Currency code (IQD, USD, EUR)
 * @param {number} displayOrder - Display order for sorting
 * @returns {Promise<number>} The new PresetID
 */
export async function createCostPreset(amount, currency, displayOrder = 0) {
    const query = `
        INSERT INTO dbo.tblEstimatedCostPresets (Amount, Currency, DisplayOrder)
        OUTPUT INSERTED.PresetID
        VALUES (@amount, @currency, @displayOrder)
    `;

    const result = await executeQuery(
        query,
        [
            ['amount', TYPES.Decimal, amount],
            ['currency', TYPES.NVarChar, currency],
            ['displayOrder', TYPES.Int, displayOrder]
        ],
        (columns) => columns[0].value
    );

    return result[0];
}

/**
 * Update an existing cost preset
 * @param {number} presetId - The preset ID to update
 * @param {number} amount - The new amount
 * @param {string} currency - The new currency
 * @param {number} displayOrder - The new display order
 * @returns {Promise<void>}
 */
export async function updateCostPreset(presetId, amount, currency, displayOrder) {
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
            ['displayOrder', TYPES.Int, displayOrder]
        ]
    );
}

/**
 * Delete a cost preset
 * @param {number} presetId - The preset ID to delete
 * @returns {Promise<void>}
 */
export async function deleteCostPreset(presetId) {
    const query = `
        DELETE FROM dbo.tblEstimatedCostPresets
        WHERE PresetID = @presetId
    `;

    await executeQuery(
        query,
        [['presetId', TYPES.Int, presetId]]
    );
}

/**
 * Get distinct currencies that have presets
 * @returns {Promise<Array<string>>} Array of currency codes
 */
export async function getCostPresetCurrencies() {
    const query = `
        SELECT DISTINCT Currency
        FROM dbo.tblEstimatedCostPresets
        ORDER BY Currency
    `;

    return executeQuery(
        query,
        [],
        (columns) => columns[0].value
    );
}
