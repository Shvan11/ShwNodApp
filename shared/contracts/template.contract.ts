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
