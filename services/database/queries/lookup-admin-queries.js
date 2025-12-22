/**
 * Lookup Table Admin Queries
 *
 * Generic CRUD operations for lookup tables with whitelist validation.
 * Only whitelisted tables can be accessed to prevent SQL injection.
 */

import { executeQuery, TYPES } from '../index.js';

/**
 * Configuration for all allowed lookup tables.
 * This whitelist ensures only specific tables can be modified.
 */
const LOOKUP_TABLE_CONFIG = {
    tblWorkType: {
        tableName: 'tblWorkType',
        idColumn: 'ID',
        displayColumn: 'WorkType',
        displayName: 'Work Types',
        icon: 'fas fa-briefcase',
        idType: 'int',
        columns: [
            { name: 'WorkType', label: 'Work Type', type: 'varchar', maxLength: 50, required: true }
        ]
    },
    tblKeyWord: {
        tableName: 'tblKeyWord',
        idColumn: 'ID',
        displayColumn: 'KeyWord',
        displayName: 'Keywords',
        icon: 'fas fa-tag',
        idType: 'int',
        columns: [
            { name: 'KeyWord', label: 'Keyword', type: 'nvarchar', maxLength: 255, required: false }
        ]
    },
    tblDetail: {
        tableName: 'tblDetail',
        idColumn: 'ID',
        displayColumn: 'Detail',
        displayName: 'Appointment Types',
        icon: 'fas fa-calendar-check',
        idType: 'int',
        columns: [
            { name: 'Detail', label: 'Appointment Type', type: 'nvarchar', maxLength: 255, required: false }
        ]
    },
    tblPatientType: {
        tableName: 'tblPatientType',
        idColumn: 'ID',
        displayColumn: 'PatientType',
        displayName: 'Patient Types',
        icon: 'fas fa-user-tag',
        idType: 'int',
        columns: [
            { name: 'PatientType', label: 'Patient Type', type: 'varchar', maxLength: 50, required: false }
        ]
    },
    tblTagOptions: {
        tableName: 'tblTagOptions',
        idColumn: 'ID',
        displayColumn: 'Tag',
        displayName: 'Tag Options',
        icon: 'fas fa-bookmark',
        idType: 'int',
        columns: [
            { name: 'Tag', label: 'Tag', type: 'nvarchar', maxLength: 50, required: true }
        ]
    },
    tblReferrals: {
        tableName: 'tblReferrals',
        idColumn: 'ID',
        displayColumn: 'Referral',
        displayName: 'Referral Sources',
        icon: 'fas fa-handshake',
        idType: 'int',
        columns: [
            { name: 'Referral', label: 'Referral Source', type: 'nvarchar', maxLength: 255, required: false }
        ]
    },
    tblAddress: {
        tableName: 'tblAddress',
        idColumn: 'ID',
        displayColumn: 'Zone',
        displayName: 'Addresses/Zones',
        icon: 'fas fa-map-marker-alt',
        idType: 'int',
        columns: [
            { name: 'Zone', label: 'Zone/Address', type: 'nvarchar', maxLength: 255, required: false }
        ]
    },
    tblAlertTypes: {
        tableName: 'tblAlertTypes',
        idColumn: 'AlertTypeID',
        displayColumn: 'TypeName',
        displayName: 'Alert Types',
        icon: 'fas fa-exclamation-triangle',
        idType: 'int',
        columns: [
            { name: 'TypeName', label: 'Alert Type Name', type: 'nvarchar', maxLength: 100, required: true }
        ]
    },
    DocumentTypes: {
        tableName: 'DocumentTypes',
        idColumn: 'type_id',
        displayColumn: 'type_name',
        displayName: 'Document Types',
        icon: 'fas fa-file-alt',
        idType: 'int',
        columns: [
            { name: 'type_code', label: 'Code', type: 'nvarchar', maxLength: 50, required: true },
            { name: 'type_name', label: 'Name', type: 'nvarchar', maxLength: 100, required: true },
            { name: 'description', label: 'Description', type: 'nvarchar', maxLength: 500, required: false },
            { name: 'icon', label: 'Icon', type: 'nvarchar', maxLength: 50, required: false },
            { name: 'default_paper_width', label: 'Paper Width (mm)', type: 'int', required: false },
            { name: 'default_paper_height', label: 'Paper Height (mm)', type: 'int', required: false },
            { name: 'default_orientation', label: 'Orientation', type: 'nvarchar', maxLength: 20, required: false },
            { name: 'is_active', label: 'Active', type: 'bit', required: false },
            { name: 'sort_order', label: 'Sort Order', type: 'int', required: false }
        ]
    },
    tblImplantManufacturer: {
        tableName: 'tblImplantManufacturer',
        idColumn: 'ID',
        displayColumn: 'ManufacturerName',
        displayName: 'Implant Manufacturers',
        icon: 'fas fa-industry',
        idType: 'int',
        columns: [
            { name: 'ManufacturerName', label: 'Manufacturer Name', type: 'nvarchar', maxLength: 255, required: true }
        ]
    },
    tblHolidays: {
        tableName: 'tblHolidays',
        idColumn: 'ID',
        displayColumn: 'HolidayName',
        displayName: 'Holidays',
        icon: 'fas fa-calendar-times',
        idType: 'int',
        columns: [
            { name: 'Holidaydate', label: 'Date', type: 'date', required: true },
            { name: 'HolidayName', label: 'Holiday Name', type: 'nvarchar', maxLength: 100, required: true },
            { name: 'Description', label: 'Description', type: 'nvarchar', maxLength: 255, required: false }
        ]
    }
};

/**
 * Map SQL type string to Tedious TYPES
 * @param {string} typeStr - Type string from config
 * @returns {object} Tedious type
 */
function mapSqlType(typeStr) {
    const typeMap = {
        'int': TYPES.Int,
        'varchar': TYPES.VarChar,
        'nvarchar': TYPES.NVarChar,
        'bit': TYPES.Bit,
        'uniqueidentifier': TYPES.UniqueIdentifier,
        'date': TYPES.Date
    };
    return typeMap[typeStr] || TYPES.NVarChar;
}

/**
 * Get configuration for a specific table
 * @param {string} tableKey - The table key
 * @returns {object|null} Table configuration or null if not found
 */
export function getTableConfig(tableKey) {
    return LOOKUP_TABLE_CONFIG[tableKey] || null;
}

/**
 * Get all available lookup table configurations
 * @returns {Array} Array of table configurations for frontend
 */
export function getLookupTableConfigs() {
    return Object.entries(LOOKUP_TABLE_CONFIG).map(([key, config]) => ({
        key,
        displayName: config.displayName,
        icon: config.icon,
        idColumn: config.idColumn,
        columns: config.columns
    }));
}

/**
 * Get all items from a lookup table
 * @param {string} tableKey - The table key from LOOKUP_TABLE_CONFIG
 * @returns {Promise<Array>} Array of items
 */
export async function getLookupItems(tableKey) {
    const config = LOOKUP_TABLE_CONFIG[tableKey];
    if (!config) {
        throw new Error(`Invalid lookup table: ${tableKey}`);
    }

    const columnNames = [config.idColumn, ...config.columns.map(c => c.name)];
    const query = `
        SELECT ${columnNames.join(', ')}
        FROM dbo.${config.tableName}
        ORDER BY ${config.displayColumn}
    `;

    return executeQuery(
        query,
        [],
        (columns) => {
            const item = {};
            columns.forEach((col) => {
                item[col.metadata.colName] = col.value;
            });
            return item;
        }
    );
}

/**
 * Create a new lookup item
 * @param {string} tableKey - The table key
 * @param {object} data - The data to insert
 * @returns {Promise<any>} The new item ID
 */
export async function createLookupItem(tableKey, data) {
    const config = LOOKUP_TABLE_CONFIG[tableKey];
    if (!config) {
        throw new Error(`Invalid lookup table: ${tableKey}`);
    }

    const columnNames = config.columns.map(c => c.name);
    const paramNames = config.columns.map((_, i) => `@p${i}`);

    let query;
    if (config.idType === 'uniqueidentifier') {
        query = `
            INSERT INTO dbo.${config.tableName} (${config.idColumn}, ${columnNames.join(', ')})
            OUTPUT INSERTED.${config.idColumn}
            VALUES (NEWID(), ${paramNames.join(', ')})
        `;
    } else {
        query = `
            INSERT INTO dbo.${config.tableName} (${columnNames.join(', ')})
            OUTPUT INSERTED.${config.idColumn}
            VALUES (${paramNames.join(', ')})
        `;
    }

    const params = config.columns.map((col, idx) => {
        const type = mapSqlType(col.type);
        let value = data[col.name];

        // Handle type conversions
        if (col.type === 'bit') {
            value = value === true || value === 'true' || value === 1 ? 1 : 0;
        } else if (col.type === 'int' && value !== null && value !== undefined && value !== '') {
            value = parseInt(value, 10);
            if (isNaN(value)) value = null;
        }

        return [`p${idx}`, type, value ?? null];
    });

    const result = await executeQuery(
        query,
        params,
        (columns) => columns[0].value
    );

    return result[0];
}

/**
 * Update an existing lookup item
 * @param {string} tableKey - The table key
 * @param {string|number} id - The item ID
 * @param {object} data - The new data
 * @returns {Promise<void>}
 */
export async function updateLookupItem(tableKey, id, data) {
    const config = LOOKUP_TABLE_CONFIG[tableKey];
    if (!config) {
        throw new Error(`Invalid lookup table: ${tableKey}`);
    }

    const setClauses = config.columns.map((c, i) => `${c.name} = @p${i}`).join(', ');
    const query = `
        UPDATE dbo.${config.tableName}
        SET ${setClauses}
        WHERE ${config.idColumn} = @id
    `;

    const params = config.columns.map((col, idx) => {
        const type = mapSqlType(col.type);
        let value = data[col.name];

        // Handle type conversions
        if (col.type === 'bit') {
            value = value === true || value === 'true' || value === 1 ? 1 : 0;
        } else if (col.type === 'int' && value !== null && value !== undefined && value !== '') {
            value = parseInt(value, 10);
            if (isNaN(value)) value = null;
        }

        return [`p${idx}`, type, value ?? null];
    });

    const idType = mapSqlType(config.idType);
    params.push(['id', idType, id]);

    await executeQuery(query, params);
}

/**
 * Delete a lookup item
 * @param {string} tableKey - The table key
 * @param {string|number} id - The item ID
 * @returns {Promise<void>}
 */
export async function deleteLookupItem(tableKey, id) {
    const config = LOOKUP_TABLE_CONFIG[tableKey];
    if (!config) {
        throw new Error(`Invalid lookup table: ${tableKey}`);
    }

    const query = `
        DELETE FROM dbo.${config.tableName}
        WHERE ${config.idColumn} = @id
    `;

    const idType = mapSqlType(config.idType);
    await executeQuery(query, [['id', idType, id]]);
}

/**
 * Check if a table key is valid
 * @param {string} tableKey - The table key to validate
 * @returns {boolean} True if valid
 */
export function isValidTableKey(tableKey) {
    return tableKey in LOOKUP_TABLE_CONFIG;
}
