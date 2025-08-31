/**
 * Database queries for tbloptions table operations
 * Manages system settings and preferences
 */

import { executeQuery, TYPES } from '../index.js';

/**
 * Get all options from the database
 * @returns {Promise<Array>} Array of option objects
 */
export const getAllOptions = async () => {
    try {
        const result = await executeQuery(
            'SELECT OptionName, OptionValue FROM tbloptions ORDER BY OptionName',
            [],
            (columns) => ({
                OptionName: columns[0].value,
                OptionValue: columns[1].value
            })
        );
        return result;
    } catch (error) {
        console.error('Error fetching all options:', error);
        throw error;
    }
};

/**
 * Get a specific option value by name
 * @param {string} optionName - The name of the option to retrieve
 * @returns {Promise<string|null>} The option value or null if not found
 */
export const getOption = async (optionName) => {
    try {
        const result = await executeQuery(
            'SELECT OptionValue FROM tbloptions WHERE OptionName = @optionName',
            [['optionName', TYPES.NVarChar, optionName]],
            (columns) => ({
                OptionValue: columns[0].value
            })
        );
        
        return result.length > 0 ? result[0].OptionValue : null;
    } catch (error) {
        console.error('Error fetching option:', error);
        throw error;
    }
};

/**
 * Update an existing option value (only updates existing options)
 * @param {string} optionName - The name of the option
 * @param {string} optionValue - The value to set
 * @returns {Promise<boolean>} True if successful, false if option doesn't exist
 */
export const updateOption = async (optionName, optionValue) => {
    try {
        const result = await executeQuery(
            'UPDATE tbloptions SET OptionValue = @optionValue WHERE OptionName = @optionName',
            [
                ['optionName', TYPES.NVarChar, optionName],
                ['optionValue', TYPES.NVarChar, optionValue]
            ]
        );
        
        return result.rowsAffected > 0;
    } catch (error) {
        console.error('Error updating option:', error);
        throw error;
    }
};


/**
 * Get options by name pattern (for grouped settings)
 * @param {string} pattern - SQL LIKE pattern to match option names
 * @returns {Promise<Array>} Array of matching option objects
 */
export const getOptionsByPattern = async (pattern) => {
    try {
        const result = await executeQuery(
            'SELECT OptionName, OptionValue FROM tbloptions WHERE OptionName LIKE @pattern ORDER BY OptionName',
            [['pattern', TYPES.NVarChar, pattern]],
            (columns) => ({
                OptionName: columns[0].value,
                OptionValue: columns[1].value
            })
        );
        
        return result;
    } catch (error) {
        console.error('Error fetching options by pattern:', error);
        throw error;
    }
};

/**
 * Bulk update multiple existing options in a single transaction
 * @param {Array<{name: string, value: string}>} options - Array of option objects
 * @returns {Promise<{success: boolean, updated: number, failed: Array}>} Update results
 */
export const bulkUpdateOptions = async (options) => {
    try {
        let updatedCount = 0;
        const failed = [];
        
        for (const option of options) {
            try {
                const result = await executeQuery(
                    'UPDATE tbloptions SET OptionValue = @optionValue WHERE OptionName = @optionName',
                    [
                        ['optionName', TYPES.NVarChar, option.name],
                        ['optionValue', TYPES.NVarChar, option.value]
                    ]
                );
                
                if (result.rowsAffected > 0) {
                    updatedCount++;
                } else {
                    failed.push(option.name);
                }
            } catch (error) {
                console.error(`Error updating option ${option.name}:`, error);
                failed.push(option.name);
            }
        }
        
        return {
            success: true,
            updated: updatedCount,
            failed: failed
        };
    } catch (error) {
        console.error('Error bulk updating options:', error);
        throw error;
    }
};