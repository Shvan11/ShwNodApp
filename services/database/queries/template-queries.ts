/**
 * Document Template System - Database Queries
 * Handles all database operations for document templates, elements, and data fields
 *
 * Migration Phase 4: translated to typed Kysely (PostgreSQL). The positional
 * `ColumnValue` mappers are gone — selects return plain objects. `is_active`/
 * `is_default`/`is_system`/`show_grid` are PG `boolean` columns now, so filters/
 * inserts use JS booleans (was mssql bit 1/0). `created_date`/`updated_at` are PG
 * `timestamp`, parsed to local-wall-clock `Date` by the centralized kysely.ts parser.
 * `updateTemplate`'s dynamic partial SET clause is built with `eb`/`set()` from the
 * provided fields; `updated_at` is maintained by the trg_set_updated_at DB trigger.
 */
import type { UpdateObject } from 'kysely';
import { getKysely, type Database } from '../kysely.js';

// type definitions
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
  updated_at?: Date | null;
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

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * Get all document types
 */
export async function getDocumentTypes(): Promise<DocumentType[]> {
  const db = getKysely();
  return db
    .selectFrom('document_types')
    .select([
      'type_id',
      'type_code',
      'type_name',
      'description',
      'icon',
      'default_paper_width',
      'default_paper_height',
      'default_orientation',
      'is_active',
      'sort_order',
    ])
    .where('is_active', '=', true)
    .orderBy('sort_order')
    .orderBy('type_name')
    .execute() as Promise<DocumentType[]>;
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
  const db = getKysely();
  let q = db
    .selectFrom('document_templates as t')
    .innerJoin('document_types as dt', 't.document_type_id', 'dt.type_id')
    .select([
      't.template_id',
      't.template_name',
      't.description',
      't.document_type_id',
      'dt.type_name as document_type_name',
      'dt.type_code as document_type_code',
      'dt.icon as document_type_icon',
      't.paper_width',
      't.paper_height',
      't.paper_orientation',
      't.paper_margin_top',
      't.paper_margin_right',
      't.paper_margin_bottom',
      't.paper_margin_left',
      't.background_color',
      't.show_grid',
      't.grid_size',
      't.is_default',
      't.is_active',
      't.is_system',
      't.template_version',
      't.parent_template_id',
      't.created_by',
      't.created_date',
      't.modified_by',
      't.updated_at',
      't.last_used_date',
      't.template_file_path',
    ]);

  if (filters.documentTypeId) {
    q = q.where('t.document_type_id', '=', filters.documentTypeId);
  }
  if (filters.isActive !== undefined) {
    q = q.where('t.is_active', '=', filters.isActive);
  }
  if (filters.isDefault !== undefined) {
    q = q.where('t.is_default', '=', filters.isDefault);
  }

  q = q.orderBy('t.is_default', 'desc').orderBy('t.template_name');

  return q.execute() as Promise<DocumentTemplate[]>;
}

/**
 * Get a specific template by id (without elements)
 */
export async function getTemplateById(templateId: number): Promise<DocumentTemplate | null> {
  const db = getKysely();
  const row = await db
    .selectFrom('document_templates as t')
    .innerJoin('document_types as dt', 't.document_type_id', 'dt.type_id')
    .select([
      't.template_id',
      't.template_name',
      't.description',
      't.document_type_id',
      'dt.type_name as document_type_name',
      'dt.type_code as document_type_code',
      't.template_file_path',
      't.paper_width',
      't.paper_height',
      't.paper_orientation',
      't.paper_margin_top',
      't.paper_margin_right',
      't.paper_margin_bottom',
      't.paper_margin_left',
      't.background_color',
      't.show_grid',
      't.grid_size',
      't.is_default',
      't.is_active',
      't.is_system',
      't.template_version',
      't.parent_template_id',
      't.created_by',
      't.created_date',
      't.modified_by',
      't.updated_at',
      't.last_used_date',
    ])
    .where('t.template_id', '=', templateId)
    .executeTakeFirst();

  return (row as DocumentTemplate | undefined) ?? null;
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
 * Create a new template
 */
export async function createTemplate(templateData: TemplateData): Promise<number> {
  const db = getKysely();
  const row = await db
    .insertInto('document_templates')
    .values({
      template_name: templateData.template_name,
      description: templateData.description ?? null,
      document_type_id: templateData.document_type_id,
      paper_width: templateData.paper_width,
      paper_height: templateData.paper_height,
      paper_orientation: templateData.paper_orientation || 'portrait',
      paper_margin_top: templateData.paper_margin_top ?? 10,
      paper_margin_right: templateData.paper_margin_right ?? 10,
      paper_margin_bottom: templateData.paper_margin_bottom ?? 10,
      paper_margin_left: templateData.paper_margin_left ?? 10,
      background_color: templateData.background_color || '#FFFFFF',
      show_grid: templateData.show_grid ?? false,
      grid_size: templateData.grid_size ?? 10,
      is_default: templateData.is_default ?? false,
      is_active: templateData.is_active !== false,
      is_system: templateData.is_system ?? false,
      created_by: templateData.created_by || 'system',
    })
    .returning('template_id')
    .executeTakeFirst();

  if (!row?.template_id) {
    throw new Error('Failed to create template: no id returned');
  }

  return row.template_id;
}

/**
 * Update an existing template (supports partial updates)
 */
export async function updateTemplate(
  templateId: number,
  templateData: TemplateUpdateData
): Promise<boolean> {
  // Build the partial SET object from only the provided fields. The whitelist of
  // updatable columns matches the old fieldTypeMap; booleans pass through as JS
  // booleans (PG boolean columns). updated_at is maintained by the trg_set_updated_at trigger.
  const updatableFields: (keyof TemplateUpdateData)[] = [
    'template_name',
    'description',
    'paper_width',
    'paper_height',
    'paper_orientation',
    'paper_margin_top',
    'paper_margin_right',
    'paper_margin_bottom',
    'paper_margin_left',
    'background_color',
    'show_grid',
    'grid_size',
    'is_default',
    'is_active',
    'template_file_path',
    'modified_by',
  ];

  const updateSet: UpdateObject<Database, 'document_templates'> = {};
  let hasFields = false;

  for (const field of updatableFields) {
    if (Object.prototype.hasOwnProperty.call(templateData, field)) {
      const value = templateData[field];
      (updateSet as Record<string, unknown>)[field] = value ?? null;
      hasFields = true;
    }
  }

  // If no fields to update, return early — the trg_set_updated_at trigger now owns
  // updated_at, and an empty SET would be a no-op bump (matches the old skip behavior).
  if (!hasFields) {
    return true;
  }

  const db = getKysely();
  await db
    .updateTable('document_templates')
    .set(updateSet)
    .where('template_id', '=', templateId)
    .execute();

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

  const db = getKysely();
  await db
    .deleteFrom('document_templates')
    .where('template_id', '=', templateId)
    .where('is_system', '=', false)
    .execute();

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
 * Get a single element by id (deprecated - file-based templates)
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
