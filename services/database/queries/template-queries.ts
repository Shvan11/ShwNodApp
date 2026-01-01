/**
 * Document Template System - Database Queries
 * Handles all database operations for document templates, elements, and data fields
 */
import type { ColumnValue } from '../../../types/database.types.js';
import { executeQuery, TYPES, SqlParam } from '../index.js';

// Type definitions
interface DocumentType {
  type_id: number;
  type_code: string;
  type_name: string;
  description: string | null;
  icon: string | null;
  default_paper_width: number | null;
  default_paper_height: number | null;
  default_orientation: string | null;
  is_active: boolean;
  sort_order: number;
}

interface DocumentTemplate {
  template_id: number;
  template_name: string;
  description: string | null;
  document_type_id: number;
  document_type_name: string;
  document_type_code: string;
  document_type_icon?: string | null;
  paper_width: number;
  paper_height: number;
  paper_orientation: string;
  paper_margin_top: number;
  paper_margin_right: number;
  paper_margin_bottom: number;
  paper_margin_left: number;
  background_color: string;
  show_grid: boolean;
  grid_size: number;
  is_default: boolean;
  is_active: boolean;
  is_system: boolean;
  template_version?: number;
  parent_template_id?: number | null;
  created_by: string;
  created_date: Date;
  modified_by?: string | null;
  modified_date?: Date | null;
  last_used_date?: Date | null;
  template_file_path?: string | null;
}

interface TemplateFilters {
  documentTypeId?: number;
  isActive?: boolean;
  isDefault?: boolean;
}

interface TemplateData {
  template_name: string;
  description?: string | null;
  document_type_id: number;
  paper_width: number;
  paper_height: number;
  paper_orientation?: string;
  paper_margin_top?: number;
  paper_margin_right?: number;
  paper_margin_bottom?: number;
  paper_margin_left?: number;
  background_color?: string;
  show_grid?: boolean;
  grid_size?: number;
  is_default?: boolean;
  is_active?: boolean;
  is_system?: boolean;
  parent_template_id?: number;
  created_by?: string;
}

interface TemplateUpdateData {
  template_name?: string;
  description?: string | null;
  paper_width?: number;
  paper_height?: number;
  paper_orientation?: string;
  paper_margin_top?: number;
  paper_margin_right?: number;
  paper_margin_bottom?: number;
  paper_margin_left?: number;
  background_color?: string;
  show_grid?: boolean;
  grid_size?: number;
  is_default?: boolean;
  is_active?: boolean;
  template_file_path?: string | null;
  modified_by?: string;
}

/**
 * Generic row mapper that converts columns to object
 */
function mapRowToObject<T>(columns: ColumnValue[]): T {
  const row: Record<string, unknown> = {};
  columns.forEach((col) => {
    row[col.metadata.colName] = col.value;
  });
  return row as T;
}

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * Get all document types
 */
export async function getDocumentTypes(): Promise<DocumentType[]> {
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
  return executeQuery<DocumentType>(query, [], mapRowToObject);
}

/**
 * Get a specific document type by ID
 */
export async function getDocumentTypeById(typeId: number): Promise<DocumentType | null> {
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
  const results = await executeQuery<DocumentType>(
    query,
    [['typeId', TYPES.Int, typeId]],
    mapRowToObject
  );
  return results[0] || null;
}

// ============================================================================
// DATA FIELD DEFINITIONS (DEPRECATED - file-based templates)
// ============================================================================

/**
 * Get all data fields for a specific document type (deprecated)
 */
export async function getDataFieldsByDocumentType(_documentTypeId: number): Promise<never[]> {
  // File-based templates don't use DataFieldDefinitions
  return [];
}

/**
 * Get data fields grouped by category (deprecated)
 */
export async function getDataFieldsGrouped(
  _documentTypeId: number
): Promise<Record<string, never>> {
  return {};
}

// ============================================================================
// DOCUMENT TEMPLATES
// ============================================================================

/**
 * Get all templates (with optional filtering)
 */
export async function getDocumentTemplates(
  filters: TemplateFilters = {}
): Promise<DocumentTemplate[]> {
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

  const params: SqlParam[] = [];

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

  return executeQuery<DocumentTemplate>(query, params, mapRowToObject);
}

/**
 * Get a specific template by ID (without elements)
 */
export async function getTemplateById(templateId: number): Promise<DocumentTemplate | null> {
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

  const results = await executeQuery<DocumentTemplate>(
    query,
    [['templateId', TYPES.Int, templateId]],
    mapRowToObject
  );

  return results[0] || null;
}

/**
 * Get template with all elements (deprecated - now file-based)
 */
export async function getTemplateWithElements(
  templateId: number
): Promise<DocumentTemplate | null> {
  // File-based templates don't have elements in database
  return getTemplateById(templateId);
}

/**
 * Get default template for a document type
 */
export async function getDefaultTemplate(
  documentTypeId: number
): Promise<DocumentTemplate | null> {
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

  const results = await executeQuery<DocumentTemplate>(
    query,
    [['documentTypeId', TYPES.Int, documentTypeId]],
    mapRowToObject
  );

  return results[0] || null;
}

/**
 * Create a new template
 */
export async function createTemplate(templateData: TemplateData): Promise<number> {
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

  const params: SqlParam[] = [
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
    ['created_by', TYPES.NVarChar, templateData.created_by || 'system'],
  ];

  const result = await executeQuery<{ template_id: number }>(
    query,
    params,
    mapRowToObject
  );

  if (!result?.[0]?.template_id) {
    throw new Error('Failed to create template: no ID returned');
  }

  return result[0].template_id;
}

/**
 * Update an existing template (supports partial updates)
 */
export async function updateTemplate(
  templateId: number,
  templateData: TemplateUpdateData
): Promise<boolean> {
  // Build dynamic SET clause based on provided fields
  const setFields: string[] = [];
  const params: SqlParam[] = [['template_id', TYPES.Int, templateId]];

  // Map of field names to their SQL types
  const fieldTypeMap: Record<
    keyof TemplateUpdateData,
    typeof TYPES.NVarChar | typeof TYPES.Int | typeof TYPES.Bit
  > = {
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
    modified_by: TYPES.NVarChar,
  };

  // Add each provided field to the update
  for (const [fieldName, sqlType] of Object.entries(fieldTypeMap)) {
    if (Object.prototype.hasOwnProperty.call(templateData, fieldName)) {
      setFields.push(`${fieldName} = @${fieldName}`);

      let value = templateData[fieldName as keyof TemplateUpdateData];

      // Handle boolean fields for SQL Server bit type
      if (sqlType === TYPES.Bit && typeof value === 'boolean') {
        value = value ? 1 : 0;
      }

      // Handle null values
      if (value === null || value === undefined) {
        value = null;
      }

      params.push([fieldName, sqlType, value as unknown]);
    }
  }

  // Always update modified_date
  setFields.push('modified_date = GETDATE()');

  // If no fields to update, return early
  if (setFields.length === 1) {
    // Only modified_date
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
export async function deleteTemplate(templateId: number): Promise<boolean> {
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
export async function cloneTemplate(
  templateId: number,
  newName: string,
  createdBy: string
): Promise<number> {
  // Get original template with elements
  const originalTemplate = await getTemplateWithElements(templateId);

  if (!originalTemplate) {
    throw new Error('Template not found');
  }

  // Create new template
  const newTemplateData: TemplateData = {
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
    created_by: createdBy || 'system',
  };

  const newTemplateId = await createTemplate(newTemplateData);

  return newTemplateId;
}

// ============================================================================
// TEMPLATE ELEMENTS
// ============================================================================

/**
 * Get all elements for a template (deprecated - file-based templates)
 */
export async function getTemplateElements(_templateId: number): Promise<never[]> {
  // File-based templates don't store elements in database
  return [];
}

/**
 * Get a single element by ID (deprecated - file-based templates)
 */
export async function getTemplateElementById(_elementId: number): Promise<null> {
  return null;
}

// Element functions deprecated - use GrapesJS file-based templates
export async function createTemplateElement(): Promise<never> {
  throw new Error('Deprecated');
}
export async function updateTemplateElement(): Promise<never> {
  throw new Error('Deprecated');
}
export async function deleteTemplateElement(): Promise<never> {
  throw new Error('Deprecated');
}
export async function logTemplateUsage(): Promise<void> {
  /* No-op */
}
