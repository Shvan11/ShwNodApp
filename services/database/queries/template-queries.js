/**
 * Document Template System - Database Queries
 * Handles all database operations for document templates, elements, and data fields
 */

import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';

/**
 * Generic row mapper that converts columns to object
 */
function mapRowToObject(columns) {
    const row = {};
    columns.forEach(col => {
        row[col.metadata.colName] = col.value;
    });
    return row;
}

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * Get all document types
 */
export async function getDocumentTypes() {
    const query = `
        SELECT
            type_id,
            type_code,
            type_name,
            description,
            icon,
            default_paper_width,
            default_paper_height,
            default_orientation,
            is_active,
            sort_order
        FROM DocumentTypes
        WHERE is_active = 1
        ORDER BY sort_order, type_name
    `;
    return await executeQuery(query, [], mapRowToObject);
}

/**
 * Get a specific document type by ID
 */
export async function getDocumentTypeById(typeId) {
    const query = `
        SELECT
            type_id,
            type_code,
            type_name,
            description,
            icon,
            default_paper_width,
            default_paper_height,
            default_orientation,
            is_active,
            sort_order
        FROM DocumentTypes
        WHERE type_id = @typeId
    `;
    const results = await executeQuery(query, [
        ['typeId', TYPES.Int, typeId]
    ], mapRowToObject);
    return results[0] || null;
}

// ============================================================================
// DATA FIELD DEFINITIONS (DEPRECATED - file-based templates)
// ============================================================================

/**
 * Get all data fields for a specific document type (deprecated)
 */
export async function getDataFieldsByDocumentType(documentTypeId) {
    // File-based templates don't use DataFieldDefinitions
    return [];
}

/**
 * Get data fields grouped by category (deprecated)
 */
export async function getDataFieldsGrouped(documentTypeId) {
    return {};
}

// ============================================================================
// DOCUMENT TEMPLATES
// ============================================================================

/**
 * Get all templates (with optional filtering)
 */
export async function getDocumentTemplates(filters = {}) {
    let query = `
        SELECT
            t.template_id,
            t.template_name,
            t.description,
            t.document_type_id,
            dt.type_name as document_type_name,
            dt.type_code as document_type_code,
            dt.icon as document_type_icon,
            t.paper_width,
            t.paper_height,
            t.paper_orientation,
            t.paper_margin_top,
            t.paper_margin_right,
            t.paper_margin_bottom,
            t.paper_margin_left,
            t.background_color,
            t.show_grid,
            t.grid_size,
            t.is_default,
            t.is_active,
            t.is_system,
            t.template_version,
            t.parent_template_id,
            t.created_by,
            t.created_date,
            t.modified_by,
            t.modified_date,
            t.last_used_date,
            t.template_file_path
        FROM DocumentTemplates t
        INNER JOIN DocumentTypes dt ON t.document_type_id = dt.type_id
        WHERE 1=1
    `;

    const params = [];

    if (filters.documentTypeId) {
        query += ` AND t.document_type_id = @documentTypeId`;
        params.push(['documentTypeId', TYPES.Int, filters.documentTypeId]);
    }

    if (filters.isActive !== undefined) {
        query += ` AND t.is_active = @isActive`;
        params.push(['isActive', TYPES.Bit, filters.isActive ? 1 : 0]);
    }

    if (filters.isDefault !== undefined) {
        query += ` AND t.is_default = @isDefault`;
        params.push(['isDefault', TYPES.Bit, filters.isDefault ? 1 : 0]);
    }

    query += ` ORDER BY t.is_default DESC, t.template_name`;

    return await executeQuery(query, params, mapRowToObject);
}

/**
 * Get a specific template by ID (without elements)
 */
export async function getTemplateById(templateId) {
    const query = `
        SELECT
            t.template_id,
            t.template_name,
            t.description,
            t.document_type_id,
            dt.type_name as document_type_name,
            dt.type_code as document_type_code,
            t.template_file_path,
            t.paper_width,
            t.paper_height,
            t.paper_orientation,
            t.paper_margin_top,
            t.paper_margin_right,
            t.paper_margin_bottom,
            t.paper_margin_left,
            t.background_color,
            t.show_grid,
            t.grid_size,
            t.is_default,
            t.is_active,
            t.is_system,
            t.template_version,
            t.parent_template_id,
            t.created_by,
            t.created_date,
            t.modified_by,
            t.modified_date,
            t.last_used_date
        FROM DocumentTemplates t
        INNER JOIN DocumentTypes dt ON t.document_type_id = dt.type_id
        WHERE t.template_id = @templateId
    `;

    const results = await executeQuery(query, [
        ['templateId', TYPES.Int, templateId]
    ], mapRowToObject);

    return results[0] || null;
}

/**
 * Get template with all elements (deprecated - now file-based)
 */
export async function getTemplateWithElements(templateId) {
    // File-based templates don't have elements in database
    return await getTemplateById(templateId);
}

/**
 * Get default template for a document type
 */
export async function getDefaultTemplate(documentTypeId) {
    const query = `
        SELECT TOP 1
            t.template_id,
            t.template_name,
            t.description,
            t.document_type_id,
            dt.type_name as document_type_name,
            dt.type_code as document_type_code,
            t.template_file_path,
            t.paper_width,
            t.paper_height,
            t.paper_orientation,
            t.paper_margin_top,
            t.paper_margin_right,
            t.paper_margin_bottom,
            t.paper_margin_left,
            t.background_color,
            t.is_default,
            t.is_active,
            t.is_system
        FROM DocumentTemplates t
        INNER JOIN DocumentTypes dt ON t.document_type_id = dt.type_id
        WHERE t.document_type_id = @documentTypeId
            AND t.is_active = 1
            AND t.is_default = 1
        ORDER BY t.template_id
    `;

    const results = await executeQuery(query, [
        ['documentTypeId', TYPES.Int, documentTypeId]
    ], mapRowToObject);

    return results[0] || null;
}

/**
 * Create a new template
 */
export async function createTemplate(templateData) {
    const query = `
        INSERT INTO DocumentTemplates (
            template_name,
            description,
            document_type_id,
            paper_width,
            paper_height,
            paper_orientation,
            paper_margin_top,
            paper_margin_right,
            paper_margin_bottom,
            paper_margin_left,
            background_color,
            show_grid,
            grid_size,
            is_default,
            is_active,
            is_system,
            created_by
        ) VALUES (
            @template_name,
            @description,
            @document_type_id,
            @paper_width,
            @paper_height,
            @paper_orientation,
            @paper_margin_top,
            @paper_margin_right,
            @paper_margin_bottom,
            @paper_margin_left,
            @background_color,
            @show_grid,
            @grid_size,
            @is_default,
            @is_active,
            @is_system,
            @created_by
        );
        SELECT SCOPE_IDENTITY() as template_id;
    `;

    const params = [
        ['template_name', TYPES.NVarChar, templateData.template_name],
        ['description', TYPES.NVarChar, templateData.description || null],
        ['document_type_id', TYPES.Int, templateData.document_type_id],
        ['paper_width', TYPES.Int, templateData.paper_width],
        ['paper_height', TYPES.Int, templateData.paper_height],
        ['paper_orientation', TYPES.NVarChar, templateData.paper_orientation || 'portrait'],
        ['paper_margin_top', TYPES.Int, templateData.paper_margin_top || 10],
        ['paper_margin_right', TYPES.Int, templateData.paper_margin_right || 10],
        ['paper_margin_bottom', TYPES.Int, templateData.paper_margin_bottom || 10],
        ['paper_margin_left', TYPES.Int, templateData.paper_margin_left || 10],
        ['background_color', TYPES.NVarChar, templateData.background_color || '#FFFFFF'],
        ['show_grid', TYPES.Bit, templateData.show_grid ? 1 : 0],
        ['grid_size', TYPES.Int, templateData.grid_size || 10],
        ['is_default', TYPES.Bit, templateData.is_default ? 1 : 0],
        ['is_active', TYPES.Bit, templateData.is_active !== false ? 1 : 0],
        ['is_system', TYPES.Bit, templateData.is_system ? 1 : 0],
        ['created_by', TYPES.NVarChar, templateData.created_by || 'system']
    ];

    const result = await executeQuery(query, params, mapRowToObject);
    return result[0].template_id;
}

/**
 * Update an existing template (supports partial updates)
 */
export async function updateTemplate(templateId, templateData) {
    // Build dynamic SET clause based on provided fields
    const setFields = [];
    const params = [['template_id', TYPES.Int, templateId]];

    // Map of field names to their SQL types
    const fieldTypeMap = {
        template_name: TYPES.NVarChar,
        description: TYPES.NVarChar,
        paper_width: TYPES.Int,
        paper_height: TYPES.Int,
        paper_orientation: TYPES.NVarChar,
        paper_margin_top: TYPES.Int,
        paper_margin_right: TYPES.Int,
        paper_margin_bottom: TYPES.Int,
        paper_margin_left: TYPES.Int,
        background_color: TYPES.NVarChar,
        show_grid: TYPES.Bit,
        grid_size: TYPES.Int,
        is_default: TYPES.Bit,
        is_active: TYPES.Bit,
        template_file_path: TYPES.NVarChar,
        modified_by: TYPES.NVarChar
    };

    // Add each provided field to the update
    for (const [fieldName, sqlType] of Object.entries(fieldTypeMap)) {
        if (templateData.hasOwnProperty(fieldName)) {
            setFields.push(`${fieldName} = @${fieldName}`);

            let value = templateData[fieldName];

            // Handle boolean fields for SQL Server bit type
            if (sqlType === TYPES.Bit && typeof value === 'boolean') {
                value = value ? 1 : 0;
            }

            // Handle null values
            if (value === null || value === undefined) {
                value = null;
            }

            params.push([fieldName, sqlType, value]);
        }
    }

    // Always update modified_date
    setFields.push('modified_date = GETDATE()');

    // If no fields to update, return early
    if (setFields.length === 1) { // Only modified_date
        return true;
    }

    const query = `
        UPDATE DocumentTemplates
        SET ${setFields.join(',\n            ')}
        WHERE template_id = @template_id
    `;

    await executeQuery(query, params, mapRowToObject);
    return true;
}

/**
 * Delete a template
 */
export async function deleteTemplate(templateId) {
    // Check if it's a system template
    const template = await getTemplateById(templateId);
    if (template && template.is_system) {
        throw new Error('Cannot delete system templates');
    }

    const query = `DELETE FROM DocumentTemplates WHERE template_id = @template_id AND is_system = 0`;
    await executeQuery(query, [['template_id', TYPES.Int, templateId]], mapRowToObject);
    return true;
}

/**
 * Clone a template
 */
export async function cloneTemplate(templateId, newName, createdBy) {
    // Get original template with elements
    const originalTemplate = await getTemplateWithElements(templateId);

    if (!originalTemplate) {
        throw new Error('Template not found');
    }

    // Create new template
    const newTemplateData = {
        template_name: newName || `${originalTemplate.template_name} (Copy)`,
        description: originalTemplate.description,
        document_type_id: originalTemplate.document_type_id,
        paper_width: originalTemplate.paper_width,
        paper_height: originalTemplate.paper_height,
        paper_orientation: originalTemplate.paper_orientation,
        paper_margin_top: originalTemplate.paper_margin_top,
        paper_margin_right: originalTemplate.paper_margin_right,
        paper_margin_bottom: originalTemplate.paper_margin_bottom,
        paper_margin_left: originalTemplate.paper_margin_left,
        background_color: originalTemplate.background_color,
        show_grid: originalTemplate.show_grid,
        grid_size: originalTemplate.grid_size,
        is_default: false, // Never default
        is_active: true,
        is_system: false, // Never system
        parent_template_id: templateId,
        created_by: createdBy || 'system'
    };

    const newTemplateId = await createTemplate(newTemplateData);

    // Clone all elements
    for (const element of originalTemplate.elements) {
        const elementData = { ...element };
        delete elementData.element_id; // Remove ID so new one is generated
        await createTemplateElement(newTemplateId, elementData);
    }

    return newTemplateId;
}

// ============================================================================
// TEMPLATE ELEMENTS
// ============================================================================

/**
 * Get all elements for a template (deprecated - file-based templates)
 */
export async function getTemplateElements(templateId) {
    // File-based templates don't store elements in database
    return [];
}

/**
 * Get a single element by ID (deprecated - file-based templates)
 */
export async function getTemplateElementById(elementId) {
    return null;
}

// Element functions deprecated - use GrapesJS file-based templates
export async function createTemplateElement() { throw new Error('Deprecated'); }
export async function updateTemplateElement() { throw new Error('Deprecated'); }
export async function deleteTemplateElement() { throw new Error('Deprecated'); }
export async function logTemplateUsage() { /* No-op */ }
