/**
 * Document Template System - API Routes
 * Handles API endpoints for file-based template management and receipt generation
 */

import { Router, type Request, type Response } from 'express';
import * as templateQueries from '../services/database/queries/template-queries.js';
import {
  generateReceiptHTML,
  generateNoWorkReceiptHTML
} from '../services/templates/receipt-service.js';
import { promises as fs } from 'fs';
import path from 'path';

const router = Router();

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

interface PatientIdParams {
  patientId: string;
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
        status: 'success',
        data: documentTypes
      });
    } catch (error) {
      console.error('Error fetching document types:', error);
      res.status(500).json({
        status: 'error',
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
          status: 'error',
          message: 'Document type not found'
        });
        return;
      }

      res.json({
        status: 'success',
        data: documentType
      });
    } catch (error) {
      console.error('Error fetching document type:', error);
      res.status(500).json({
        status: 'error',
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
        status: 'success',
        data: templates
      });
    } catch (error) {
      console.error('Error fetching templates:', error);
      res.status(500).json({
        status: 'error',
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
          status: 'error',
          message: 'Template not found'
        });
        return;
      }

      res.json({
        status: 'success',
        data: template
      });
    } catch (error) {
      console.error('Error fetching template:', error);
      res.status(500).json({
        status: 'error',
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
          status: 'error',
          message: 'No default template found for this document type'
        });
        return;
      }

      res.json({
        status: 'success',
        data: template
      });
    } catch (error) {
      console.error('Error fetching default template:', error);
      res.status(500).json({
        status: 'error',
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
          status: 'error',
          message: 'Missing required fields: template_name, document_type_id'
        });
        return;
      }

      const templateId = await templateQueries.createTemplate(templateData);

      res.status(201).json({
        status: 'success',
        message: 'Template created successfully',
        data: { template_id: templateId }
      });
    } catch (error) {
      console.error('Error creating template:', error);
      res.status(500).json({
        status: 'error',
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
          status: 'error',
          message: 'Template not found'
        });
        return;
      }

      // Check if it's a system template
      if (existingTemplate.is_system && templateData.is_system === false) {
        res.status(403).json({
          status: 'error',
          message: 'Cannot modify system template flag'
        });
        return;
      }

      await templateQueries.updateTemplate(parseInt(templateId), templateData);

      res.json({
        status: 'success',
        message: 'Template updated successfully'
      });
    } catch (error) {
      console.error('Error updating template:', error);
      res.status(500).json({
        status: 'error',
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
        status: 'success',
        message: 'Template deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting template:', error);

      if ((error as Error).message.includes('system template')) {
        res.status(403).json({
          status: 'error',
          message: (error as Error).message
        });
        return;
      }

      res.status(500).json({
        status: 'error',
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
          status: 'error',
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
          status: 'error',
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
        status: 'success',
        message: 'Template saved successfully',
        data: { file_path: filePath }
      });
    } catch (error) {
      console.error('Error saving template HTML:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to save template',
        error: (error as Error).message
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
      const html = await generateReceiptHTML(parseInt(workId));

      // Prevent caching
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private'
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.send(html);
    } catch (error) {
      console.error('Error generating receipt:', error);
      res.status(500).json({
        status: 'error',
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
      console.log(
        `[TEMPLATE-API] Generating no-work receipt for patient ${personId}`
      );

      const html = await generateNoWorkReceiptHTML(parseInt(personId));

      // Prevent caching
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, private'
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      console.log(`[TEMPLATE-API] No-work receipt generated successfully`);
      res.send(html);
    } catch (error) {
      console.error('[TEMPLATE-API] Error generating no-work receipt:', error);

      // Determine appropriate status code based on error message
      const statusCode = (error as Error).message.includes('not found')
        ? 404
        : (error as Error).message.includes('no scheduled appointment')
          ? 400
          : 500;

      res.status(statusCode).json({
        status: 'error',
        message: 'Failed to generate appointment receipt',
        error: (error as Error).message
      });
    }
  }
);

export default router;
