/**
 * Document Template System - API Routes
 * Handles API endpoints for file-based template management and receipt generation
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../utils/logger.js';
import * as templateQueries from '../services/database/queries/template-queries.js';
import {
  generateReceiptHTML,
  generateNoWorkReceiptHTML
} from '../services/templates/receipt-service.js';
import { promises as fs } from 'fs';
import path from 'path';

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

interface TypeIdParams {
  typeId: string;
}

interface TemplateIdParams {
  templateId: string;
}

interface DocumentTypeIdParams {
  documentTypeId: string;
}

interface WorkIdParams {
  workId: string;
}

interface TemplateQueryParams {
  documentTypeId?: string;
  isActive?: string;
  isDefault?: string;
}

interface CreateTemplateBody {
  template_name: string;
  document_type_id: number;
  description?: string | null;
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

interface UpdateTemplateBody {
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
  is_system?: boolean;
  template_file_path?: string | null;
  modified_by?: string;
}

interface SaveHtmlBody {
  html: string;
}

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
      res.json({
        success: true,
        data: documentTypes
      });
    } catch (error) {
      log.error('Error fetching document types', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        message: 'Failed to fetch document types',
        error: (error as Error).message
      });
    }
  }
);

/**
 * GET /api/templates/document-types/:typeId
 * Get a specific document type
 */
router.get(
  '/document-types/:typeId',
  async (req: Request<TypeIdParams>, res: Response): Promise<void> => {
    try {
      const { typeId } = req.params;
      const documentType = await templateQueries.getDocumentTypeById(
        parseInt(typeId)
      );

      if (!documentType) {
        res.status(404).json({
          success: false,
          message: 'Document type not found'
        });
        return;
      }

      res.json({
        success: true,
        data: documentType
      });
    } catch (error) {
      log.error('Error fetching document type', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        message: 'Failed to fetch document type',
        error: (error as Error).message
      });
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
  async (
    req: Request<unknown, unknown, unknown, TemplateQueryParams>,
    res: Response
  ): Promise<void> => {
    try {
      const filters: {
        documentTypeId?: number;
        isActive?: boolean;
        isDefault?: boolean;
      } = {};

      if (req.query.documentTypeId) {
        filters.documentTypeId = parseInt(req.query.documentTypeId);
      }
      if (req.query.isActive !== undefined) {
        filters.isActive = req.query.isActive === 'true';
      }
      if (req.query.isDefault !== undefined) {
        filters.isDefault = req.query.isDefault === 'true';
      }

      const templates = await templateQueries.getDocumentTemplates(filters);

      res.json({
        success: true,
        data: templates
      });
    } catch (error) {
      log.error('Error fetching templates', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        message: 'Failed to fetch templates',
        error: (error as Error).message
      });
    }
  }
);

/**
 * GET /api/templates/:templateId
 * Get a specific template by ID
 */
router.get(
  '/:templateId',
  async (req: Request<TemplateIdParams>, res: Response): Promise<void> => {
    try {
      const { templateId } = req.params;
      const template = await templateQueries.getTemplateById(
        parseInt(templateId)
      );

      if (!template) {
        res.status(404).json({
          success: false,
          message: 'Template not found'
        });
        return;
      }

      res.json({
        success: true,
        data: template
      });
    } catch (error) {
      log.error('Error fetching template', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        message: 'Failed to fetch template',
        error: (error as Error).message
      });
    }
  }
);

/**
 * GET /api/templates/default/:documentTypeId
 * Get the default template for a document type
 */
router.get(
  '/default/:documentTypeId',
  async (
    req: Request<DocumentTypeIdParams>,
    res: Response
  ): Promise<void> => {
    try {
      const { documentTypeId } = req.params;
      const template = await templateQueries.getDefaultTemplate(
        parseInt(documentTypeId)
      );

      if (!template) {
        res.status(404).json({
          success: false,
          message: 'No default template found for this document type'
        });
        return;
      }

      res.json({
        success: true,
        data: template
      });
    } catch (error) {
      log.error('Error fetching default template', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        message: 'Failed to fetch default template',
        error: (error as Error).message
      });
    }
  }
);

/**
 * POST /api/templates
 * Create a new template
 */
router.post(
  '/',
  async (
    req: Request<unknown, unknown, CreateTemplateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const templateData = req.body;

      // Validate required fields
      if (!templateData.template_name || !templateData.document_type_id) {
        res.status(400).json({
          success: false,
          message: 'Missing required fields: template_name, document_type_id'
        });
        return;
      }

      const templateId = await templateQueries.createTemplate(templateData);

      res.status(201).json({
        success: true,
        message: 'Template created successfully',
        data: { template_id: templateId }
      });
    } catch (error) {
      log.error('Error creating template', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        message: 'Failed to create template',
        error: (error as Error).message
      });
    }
  }
);

/**
 * PUT /api/templates/:templateId
 * Update an existing template
 */
router.put(
  '/:templateId',
  async (
    req: Request<TemplateIdParams, unknown, UpdateTemplateBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { templateId } = req.params;
      const templateData = req.body;

      // Check if template exists
      const existingTemplate = await templateQueries.getTemplateById(
        parseInt(templateId)
      );
      if (!existingTemplate) {
        res.status(404).json({
          success: false,
          message: 'Template not found'
        });
        return;
      }

      // Check if it's a system template
      if (existingTemplate.is_system && templateData.is_system === false) {
        res.status(403).json({
          success: false,
          message: 'Cannot modify system template flag'
        });
        return;
      }

      await templateQueries.updateTemplate(parseInt(templateId), templateData);

      res.json({
        success: true,
        message: 'Template updated successfully'
      });
    } catch (error) {
      log.error('Error updating template', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        message: 'Failed to update template',
        error: (error as Error).message
      });
    }
  }
);

/**
 * DELETE /api/templates/:templateId
 * Delete a template
 */
router.delete(
  '/:templateId',
  async (req: Request<TemplateIdParams>, res: Response): Promise<void> => {
    try {
      const { templateId } = req.params;

      await templateQueries.deleteTemplate(parseInt(templateId));

      res.json({
        success: true,
        message: 'Template deleted successfully'
      });
    } catch (error) {
      log.error('Error deleting template', { error: (error as Error).message });

      if ((error as Error).message.includes('system template')) {
        res.status(403).json({
          success: false,
          message: (error as Error).message
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to delete template',
        error: (error as Error).message
      });
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
  async (
    req: Request<TemplateIdParams, unknown, SaveHtmlBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { templateId } = req.params;
      const { html } = req.body;

      if (!html) {
        res.status(400).json({
          success: false,
          message: 'Missing HTML content'
        });
        return;
      }

      // Get template metadata
      const template = await templateQueries.getTemplateById(
        parseInt(templateId)
      );
      if (!template) {
        res.status(404).json({
          success: false,
          message: 'Template not found'
        });
        return;
      }

      // Generate file path if not exists
      let filePath = template.template_file_path;
      if (!filePath) {
        // Create filename from template name
        const fileName = template.template_name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        filePath = `data/templates/${fileName}.html`;

        // Update database with file path
        await templateQueries.updateTemplate(parseInt(templateId), {
          template_file_path: filePath,
          modified_by: 'designer'
        });
      }

      // Save HTML to file
      const fullPath = path.join(process.cwd(), filePath);
      await fs.writeFile(fullPath, html, 'utf-8');

      res.json({
        success: true,
        message: 'Template saved successfully',
        data: { file_path: filePath }
      });
    } catch (error) {
      log.error('Error saving template HTML', { error: (error as Error).message });
      res.status(500).json({
        success: false,
        message: 'Failed to save template',
        error: (error as Error).message
      });
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
 * path the receipt service uses) and hand back the HTML.
 */
router.get(
  '/:templateId/html',
  async (req: Request<TemplateIdParams>, res: Response): Promise<void> => {
    try {
      const { templateId } = req.params;

      const template = await templateQueries.getTemplateById(
        parseInt(templateId)
      );
      if (!template) {
        res.status(404).json({ success: false, message: 'Template not found' });
        return;
      }
      if (!template.template_file_path) {
        res.status(404).json({
          success: false,
          message: 'Template has no saved HTML yet'
        });
        return;
      }

      const fullPath = path.join(process.cwd(), template.template_file_path);
      const html = await fs.readFile(fullPath, 'utf-8');

      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(html);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        res.status(404).json({
          success: false,
          message: 'Template file not found on disk'
        });
        return;
      }
      log.error('Error reading template HTML', { error: err.message });
      res.status(500).json({
        success: false,
        message: 'Failed to read template',
        error: err.message
      });
    }
  }
);

// ============================================================================
// RECEIPT GENERATION
// ============================================================================

/**
 * GET /api/templates/receipt/work/:workId
 * Generate receipt HTML for a work using file-based template
 */
router.get(
  '/receipt/work/:workId',
  async (req: Request<WorkIdParams>, res: Response): Promise<void> => {
    try {
      const { workId } = req.params;
      const rendered = await generateReceiptHTML(parseInt(workId));
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
      res.status(500).json({
        success: false,
        message: 'Failed to generate receipt',
        error: (error as Error).message
      });
    }
  }
);

/**
 * GET /api/templates/receipt/no-work/:personId
 * Generate appointment confirmation receipt for patients with no works
 */
router.get(
  '/receipt/no-work/:personId',
  async (req: Request<{ personId: string }>, res: Response): Promise<void> => {
    try {
      const { personId } = req.params;
      log.info(`Generating no-work receipt for patient ${personId}`);

      const rendered = await generateNoWorkReceiptHTML(parseInt(personId));
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
      const statusCode = (error as Error).message.includes('not found')
        ? 404
        : (error as Error).message.includes('no scheduled appointment')
          ? 400
          : 500;

      res.status(statusCode).json({
        success: false,
        message: 'Failed to generate appointment receipt',
        error: (error as Error).message
      });
    }
  }
);

export default router;
