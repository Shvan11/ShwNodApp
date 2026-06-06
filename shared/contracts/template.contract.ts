/**
 * API contract — document-template endpoints (`/api/templates/*`).
 *
 * SSoT for the create/update/save-html request bodies (mirroring the template-queries
 * `TemplateData`/`TemplateUpdateData` service inputs) AND the responses. The routes
 * are wired to `validate({ body/params/query })` against these schemas and return via
 * `sendData` (data) / `sendSuccess(res, null, …)` (message-only acks) — drift is a
 * server compile error + a client fail-loud guard. The list / get-one / document-types
 * read rows are modeled from the generated DB types (types/db.d.ts) — DB-accurate
 * nullability so the client fail-loud guard accepts every real row.
 * See docs/shared-contract-progress.md.
 */
import { z } from 'zod';
import { timestampString } from '../validation.js';

// POST /api/templates — create a template. Mirrors TemplateData.
export const createTemplate = {
  body: z.object({
    template_name: z.string(),
    document_type_id: z.number(),
    description: z.string().nullable().optional(),
    paper_width: z.number(),
    paper_height: z.number(),
    paper_orientation: z.string().optional(),
    paper_margin_top: z.number().optional(),
    paper_margin_right: z.number().optional(),
    paper_margin_bottom: z.number().optional(),
    paper_margin_left: z.number().optional(),
    background_color: z.string().optional(),
    show_grid: z.boolean().optional(),
    grid_size: z.number().optional(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    is_system: z.boolean().optional(),
    parent_template_id: z.number().optional(),
    created_by: z.string().optional(),
  }),
  // POST /api/templates → 201 { success, message, data: { template_id } } (funnel
  // unwraps `data`). The consumer reads the new id.
  response: z.object({ template_id: z.number() }),
} as const;
export type CreateTemplateBody = z.infer<typeof createTemplate.body>;

// PUT /api/templates/:templateId — update a template. Mirrors TemplateUpdateData.
export const updateTemplate = {
  body: z.object({
    template_name: z.string().optional(),
    description: z.string().nullable().optional(),
    paper_width: z.number().optional(),
    paper_height: z.number().optional(),
    paper_orientation: z.string().optional(),
    paper_margin_top: z.number().optional(),
    paper_margin_right: z.number().optional(),
    paper_margin_bottom: z.number().optional(),
    paper_margin_left: z.number().optional(),
    background_color: z.string().optional(),
    show_grid: z.boolean().optional(),
    grid_size: z.number().optional(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    is_system: z.boolean().optional(),
    template_file_path: z.string().nullable().optional(),
    modified_by: z.string().optional(),
  }),
} as const;
export type UpdateTemplateBody = z.infer<typeof updateTemplate.body>;

// POST /api/templates/:templateId/save-html — write the rendered HTML to disk.
export const saveHtml = {
  body: z.object({ html: z.string().min(1) }),
  // → { file_path } (funnel unwraps `data`). The designer ignores the payload, but
  // the route returns the resolved path; modeled so the handler is compile-checked.
  response: z.object({ file_path: z.string() }),
} as const;
export type SaveHtmlBody = z.infer<typeof saveHtml.body>;

// ── Read responses (envelope `{ success, data }`; the funnel returns the unwrapped
// `data`). The handlers return these via `sendData`, so each row schema is BOTH the
// server-side compile/dev-parse check AND the client fail-loud guard. Shapes +
// nullability are modeled from the generated DB types (types/db.d.ts), NOT the
// hand-written template-queries interfaces — those under-declared nullability (e.g.
// is_active / created_date / background_color / paper_orientation are all `| null` in
// PG), which would make the client guard reject real rows. Closed `z.object`: the
// SELECTs list a fixed column set, so there is no long-tail field to preserve.

// One `document_types` row (GET /api/templates/document-types).
const documentTypeRow = z.object({
  type_id: z.number(),
  type_code: z.string(),
  type_name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  default_paper_width: z.number().nullable(),
  default_paper_height: z.number().nullable(),
  default_orientation: z.string().nullable(),
  is_active: z.boolean().nullable(),
  sort_order: z.number().nullable(),
});
export type DocumentTypeRow = z.infer<typeof documentTypeRow>;

// One template row: `document_templates` INNER JOIN `document_types`, so the joined
// document_type_name/_code are non-null; document_type_icon is dt.icon (nullable). The
// `*_date` columns are PG `timestamp` → Date server-side / ISO string client-side.
const documentTemplateRow = z.object({
  template_id: z.number(),
  template_name: z.string(),
  description: z.string().nullable(),
  document_type_id: z.number(),
  document_type_name: z.string(),
  document_type_code: z.string(),
  document_type_icon: z.string().nullable().optional(),
  paper_width: z.number(),
  paper_height: z.number(),
  paper_orientation: z.string().nullable(),
  paper_margin_top: z.number().nullable(),
  paper_margin_right: z.number().nullable(),
  paper_margin_bottom: z.number().nullable(),
  paper_margin_left: z.number().nullable(),
  background_color: z.string().nullable(),
  show_grid: z.boolean().nullable(),
  grid_size: z.number().nullable(),
  is_default: z.boolean().nullable(),
  is_active: z.boolean().nullable(),
  is_system: z.boolean().nullable(),
  template_version: z.number().nullable().optional(),
  parent_template_id: z.number().nullable().optional(),
  created_by: z.string().nullable(),
  created_date: timestampString.nullable(),
  modified_by: z.string().nullable().optional(),
  modified_date: timestampString.nullable().optional(),
  last_used_date: timestampString.nullable().optional(),
  template_file_path: z.string().nullable().optional(),
});
export type DocumentTemplateRow = z.infer<typeof documentTemplateRow>;

// GET /api/templates → DocumentTemplate[] (the unwrapped `data`).
export const getTemplates = { response: z.array(documentTemplateRow) } as const;

// GET /api/templates/document-types → DocumentType[].
export const documentTypes = { response: z.array(documentTypeRow) } as const;

// GET /api/templates/:templateId → a single template row (handler 404s on null).
export const getTemplate = { response: documentTemplateRow } as const;

// Path params + list query (type-only; handlers parse the query strings manually).
export const templateIdParams = z.object({ templateId: z.string() });
export type TemplateIdParams = z.infer<typeof templateIdParams>;
export const workIdParams = z.object({ workId: z.string() });
export type WorkIdParams = z.infer<typeof workIdParams>;
export const templateQuery = z.object({
  documentTypeId: z.string().optional(),
  isActive: z.string().optional(),
  isDefault: z.string().optional(),
});
export type TemplateQueryParams = z.infer<typeof templateQuery>;
