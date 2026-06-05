/**
 * API contract — document-template endpoints (`/api/templates/*`).
 *
 * REQUEST-TYPE source for the create/update/save-html bodies (mirroring the
 * template-queries `TemplateData`/`TemplateUpdateData` service inputs). These
 * handlers keep their own required-field checks and raw response envelopes, so the
 * schemas here are the `z.infer` SSoT for the handler generics but are NOT wired to
 * `validate()` (no boundary behaviour change). The route's hand-written
 * `CreateTemplateBody`/`UpdateTemplateBody`/`SaveHtmlBody` interfaces are dropped
 * for these exports. See docs/shared-contract-progress.md.
 */
import { z } from 'zod';

// Loose array guard — asserts the array-vs-object class, preserves rows (tighten in
// Phase 3). Matches the per-contract convention (e.g. patient/video/reports).
const anyArray = z.array(z.unknown());

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

// PUT /api/templates/:templateId/html — save the rendered HTML.
export const saveHtml = {
  body: z.object({ html: z.string() }),
} as const;
export type SaveHtmlBody = z.infer<typeof saveHtml.body>;

// ── Read responses (envelope `{ success, data }`; the funnel returns the unwrapped
// `data`). Response-only — the handlers keep their raw `res.json`; these are the
// client-side fail-loud guards. Rich rows preserved loosely (tighten in Phase 3).

// GET /api/templates → DocumentTemplate[] (the unwrapped `data`).
export const getTemplates = { response: anyArray } as const;

// GET /api/templates/document-types → DocumentType[].
export const documentTypes = { response: anyArray } as const;

// GET /api/templates/:templateId → a single template row.
export const getTemplate = { response: z.unknown() } as const;

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
