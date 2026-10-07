/**
 * Document Template System - API Routes
 * Handles API endpoints for file-based template management and receipt generation
 *
 * Authorization: mounted at `/api/templates` behind the global `authenticate`
 * gate. The four writes carry an explicit `authorize(CLINICAL_ROLES)` — every
 * staff role may edit a document template, as before, but the decision is now
 * written down instead of being the absence of a line. The reads (list/get/
 * render/receipt) stay open; the receipt renderers are deliberately un-enveloped
 * HTML.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import * as templateQueries from '../../services/database/queries/template-queries.js';
import { SystemTemplateError } from '../../services/database/queries/template-queries.js';
import * as templateContract from '../../shared/contracts/template.contract.js';
import { sendData, sendSuccess, sendError, ErrorResponses } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { authorize } from '../../middleware/auth.js';
import { CLINICAL_ROLES } from '../../shared/auth/roles.js';
import {
  generateReceiptHTML,
  generateNoWorkReceiptHTML
} from '../../services/templates/receipt-service.js';
import {
  removeTemplateFile,
  resolveTemplateFile,
  templateFilePathFor,
  templatesDir,
  TemplatePathError,
} from '../../services/templates/template-files.js';
import { promises as fs } from 'fs';

/** The signed-in user's name for the template audit columns. */
const sessionUser = (req: Request): string => req.session?.username ?? 'unknown';

const router = Router();

/**
 * Inject an auto-print + auto-close script into a rendered receipt document.
 *
 * The print trigger lives here (added as the HTML leaves the server), NOT in the
 * template file — the GrapesJS designer rebuilds the whole <head> on every save
 * via generateCompleteHTML() and never preserves a <script>, so any script stored
 * in the template is wiped on the next edit. Injecting at render time makes
 * auto-print immune to template edits. Gated by ?autoprint=1 so callers that
 * print the document themselves (e.g. PaymentModal) don't get a double dialog.
 */
function withAutoPrint(html: string): string {
  const script =
    '<script>window.onload=function(){window.print();' +
    'window.onafterprint=function(){window.close();};};</script>';
  return html.includes('</body>')
    ? html.replace('</body>', `${script}</body>`)
    : html + script;
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// All request shapes (bodies, params, query) and the JSON responses are authored
// in shared/contracts/template.contract.ts and referenced via `templateContract.*`:
// the routes `validate()` against the contract schemas and return through
// `sendData` / `sendSuccess`. Receipt + raw-HTML endpoints stay raw on success
// (res.send) but use the standard error envelope (ErrorResponses / sendError).

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * GET /api/templates/document-types
 * Get all available document types
 */
router.get(
  '/document-types',
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const documentTypes = await templateQueries.getDocumentTypes();
      sendData(res, templateContract.documentTypes.response, documentTypes);
    } catch (error) {
      log.error('Error fetching document types', { error: (error as Error).message });
      ErrorResponses.serverError(res, 'Failed to fetch document types', error as Error);
    }
  }
);

// ============================================================================
// TEMPLATES - CRUD OPERATIONS
// ============================================================================

/**
 * GET /api/templates
 * Get all templates with optional filtering
 * Query params: documentTypeId, isActive, isDefault
 */
router.get(
  '/',
  validate({ query: templateContract.templateQuery }),
  async (
    req: Request<unknown, unknown, unknown, templateContract.TemplateQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const filters: {
        documentTypeId?: number;
        isActive?: boolean;
        isDefault?: boolean;
      } = {};

      if (req.query.documentTypeId) {
        filters.documentTypeId = parseInt(req.query.documentTypeId, 10);
      }
      if (req.query.isActive !== undefined) {
        filters.isActive = req.query.isActive === 'true';
      }
      if (req.query.isDefault !== undefined) {
        filters.isDefault = req.query.isDefault === 'true';
      }

      const templates = await templateQueries.getDocumentTemplates(filters);

      sendData(res, templateContract.getTemplates.response, templates);
    } catch (error) {
      log.error('Error fetching templates', { error: (error as Error).message });
      ErrorResponses.serverError(res, 'Failed to fetch templates', error as Error);
    }
  }
);

/**
 * GET /api/templates/:templateId
 * Get a specific template by ID
 */
router.get(
  '/:templateId',
  validate({ params: templateContract.templateIdParams }),
  async (req: Request<templateContract.TemplateIdParams>, res: Response): Promise<void> => {
    try {
      const { templateId } = req.params;
      const template = await templateQueries.getTemplateById(
        parseInt(templateId, 10)
      );

      if (!template) {
        ErrorResponses.notFound(res, 'Template');
        return;
      }

      sendData(res, templateContract.getTemplate.response, template);
    } catch (error) {
      log.error('Error fetching template', { error: (error as Error).message });
      ErrorResponses.serverError(res, 'Failed to fetch template', error as Error);
    }
  }
);

/**
 * POST /api/templates
 * Create a new template
 */
router.post(
  '/',
  authorize(CLINICAL_ROLES),
  validate({ body: templateContract.createTemplate.body }),
  async (
    req: Request<unknown, unknown, templateContract.CreateTemplateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const templateId = await templateQueries.createTemplate({ ...req.body, created_by: sessionUser(req as Request) });

      sendData(
        res,
        templateContract.createTemplate.response,
        { template_id: templateId },
        'Template created successfully',
        201
      );
    } catch (error) {
      log.error('Error creating template', { error: (error as Error).message });
      ErrorResponses.serverError(res, 'Failed to create template', error as Error);
    }
  }
);

/**
 * PUT /api/templates/:templateId
 * Update an existing template
 */
router.put(
  '/:templateId',
  authorize(CLINICAL_ROLES),
  validate({
    params: templateContract.templateIdParams,
    body: templateContract.updateTemplate.body,
  }),
  async (
    req: Request<templateContract.TemplateIdParams, unknown, templateContract.UpdateTemplateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { templateId } = req.params;
      const templateData = req.body;

      // Check if template exists
      const existingTemplate = await templateQueries.getTemplateById(
        parseInt(templateId, 10)
      );
      if (!existingTemplate) {
        ErrorResponses.notFound(res, 'Template');
        return;
      }

      // Check if it's a system template
      if (existingTemplate.is_system && templateData.is_system === false) {
        ErrorResponses.forbidden(res, 'Cannot modify system template flag');
        return;
      }

      await templateQueries.updateTemplate(parseInt(templateId, 10), {
        ...templateData,
        modified_by: sessionUser(req as Request),
      });

      sendSuccess(res, null, 'Template updated successfully');
    } catch (error) {
      log.error('Error updating template', { error: (error as Error).message });
      ErrorResponses.serverError(res, 'Failed to update template', error as Error);
    }
  }
);

/**
 * DELETE /api/templates/:templateId
 * Delete a template
 */
router.delete(
  '/:templateId',
  authorize(CLINICAL_ROLES),
  validate({ params: templateContract.templateIdParams }),
  async (req: Request<templateContract.TemplateIdParams>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.templateId, 10);

      // The row first, then its design file. A file that cannot be removed is
      // logged, not an error: the template is gone either way.
      const orphanedFile = await templateQueries.deleteTemplate(id);
      if (orphanedFile) {
        await removeTemplateFile(id, orphanedFile).catch((fileErr: Error) => {
          log.warn('Deleted template, but its file could not be removed', {
            templateId: id,
            file: orphanedFile,
            error: fileErr.message,
          });
        });
      }

      sendSuccess(res, null, 'Template deleted successfully');
    } catch (error) {
      log.error('Error deleting template', { error: (error as Error).message });

      if (error instanceof SystemTemplateError) {
        ErrorResponses.forbidden(res, error.message);
        return;
      }

      ErrorResponses.serverError(res, 'Failed to delete template', error as Error);
    }
  }
);

// ============================================================================
// TEMPLATE DESIGNER - SAVE HTML TO FILE
// ============================================================================

/**
 * POST /api/templates/:templateId/save-html
 * Save template HTML to file system
 */
router.post(
  '/:templateId/save-html',
  authorize(CLINICAL_ROLES),
  validate({
    params: templateContract.templateIdParams,
    body: templateContract.saveHtml.body,
  }),
  async (
    req: Request<templateContract.TemplateIdParams, unknown, templateContract.SaveHtmlBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { templateId } = req.params;
      const { html } = req.body;

      // Get template metadata
      const template = await templateQueries.getTemplateById(
        parseInt(templateId, 10)
      );
      if (!template) {
        ErrorResponses.notFound(res, 'Template');
        return;
      }

      // The file is the server's to choose (FE-F20-1). A template keeps its own file;
      // one with none yet, one whose stored path escapes data/templates, or one that
      // SHARES its file with another template (the old name-only naming made that
      // happen — FE-F20-2) gets a fresh `<slug>-<id>.html`.
      const id = parseInt(templateId, 10);
      const stored = template.template_file_path;
      let filePath = '';
      let fullPath: string | null = null;
      if (stored && !(await templateQueries.isTemplateFileShared(stored, id))) {
        try {
          fullPath = resolveTemplateFile(stored);
          filePath = stored;
        } catch (e) {
          if (!(e instanceof TemplatePathError)) throw e;
          log.warn('Template had a path outside data/templates — reassigned', { templateId: id, stored });
        }
      }
      if (!fullPath) {
        filePath = templateFilePathFor(id, template.template_name);
        fullPath = resolveTemplateFile(filePath);
        await templateQueries.updateTemplate(id, { template_file_path: filePath, modified_by: sessionUser(req as Request) });
      }

      // Same-directory temp file + rename, so a reader never sees a half-written template.
      await fs.mkdir(templatesDir(), { recursive: true });
      const tmp = `${fullPath}.tmp-${process.pid}-${Date.now()}`;
      await fs.writeFile(tmp, html, 'utf-8');
      await fs.rename(tmp, fullPath);

      sendData(
        res,
        templateContract.saveHtml.response,
        { file_path: filePath },
        'Template saved successfully'
      );
    } catch (error) {
      log.error('Error saving template HTML', { error: (error as Error).message });
      ErrorResponses.serverError(res, 'Failed to save template', error as Error);
    }
  }
);

/**
 * GET /api/templates/:templateId/html
 * Return the raw template HTML for the visual designer to load.
 *
 * The template files live under ./data, which is intentionally NOT served as
 * static (see index.ts — that dir holds runtime state). So the designer can't
 * fetch the file directly; we read it server-side via fs.readFile (same trusted
 * path the receipt service uses) and hand back the HTML. Success is raw HTML
 * (res.type('html').send) — a deliberately-raw response; only errors are enveloped.
 */
router.get(
  '/:templateId/html',
  validate({ params: templateContract.templateIdParams }),
  async (req: Request<templateContract.TemplateIdParams>, res: Response): Promise<void> => {
    try {
      const { templateId } = req.params;

      const template = await templateQueries.getTemplateById(
        parseInt(templateId, 10)
      );
      if (!template) {
        ErrorResponses.notFound(res, 'Template');
        return;
      }
      if (!template.template_file_path) {
        sendError(res, 404, 'Template has no saved HTML yet');
        return;
      }

      let fullPath: string;
      try {
        fullPath = resolveTemplateFile(template.template_file_path);
      } catch (e) {
        if (!(e instanceof TemplatePathError)) throw e;
        sendError(res, 404, 'Template file not found');
        return;
      }
      const html = await fs.readFile(fullPath, 'utf-8');

      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(html);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        sendError(res, 404, 'Template file not found on disk');
        return;
      }
      log.error('Error reading template HTML', { error: err.message });
      ErrorResponses.serverError(res, 'Failed to read template', err);
    }
  }
);

// ============================================================================
// RECEIPT GENERATION
// ============================================================================

/**
 * GET /api/templates/receipt/work/:workId
 * Generate receipt HTML for a work using file-based template.
 * Raw HTML on success (printed in the browser); only errors are enveloped.
 */
router.get(
  '/receipt/work/:workId',
  validate({ params: templateContract.workIdParams }),
  async (req: Request<templateContract.WorkIdParams>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;
      const rendered = await generateReceiptHTML(parseInt(workId, 10));
      const html = req.query.autoprint === '1' ? withAutoPrint(rendered) : rendered;

      // Prevent caching
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private'
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.send(html);
    } catch (error) {
      log.error('Error generating receipt', { error: (error as Error).message });
      ErrorResponses.serverError(res, 'Failed to generate receipt', error as Error);
    }
  }
);

/**
 * GET /api/templates/receipt/no-work/:personId
 * Generate appointment confirmation receipt for patients with no works.
 * Raw HTML on success; only errors are enveloped.
 */
router.get(
  '/receipt/no-work/:personId',
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      log.info(`Generating no-work receipt for patient ${personId}`);

      const rendered = await generateNoWorkReceiptHTML(parseInt(personId, 10));
      const html = req.query.autoprint === '1' ? withAutoPrint(rendered) : rendered;

      // Prevent caching
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private'
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      log.info('No-work receipt generated successfully');
      res.send(html);
    } catch (error) {
      log.error('Error generating no-work receipt', { error: (error as Error).message });

      // Determine appropriate status code based on error message
      const message = (error as Error).message;
      const statusCode = message.includes('not found')
        ? 404
        : message.includes('no scheduled appointment')
          ? 400
          : 500;

      sendError(res, statusCode, 'Failed to generate appointment receipt', error as Error);
    }
  }
);

export default router;
