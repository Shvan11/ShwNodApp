/**
 * Document Template System - API Routes
 * Handles all API endpoints for template management, elements, and rendering
 */

import express from 'express';
import * as templateQueries from '../services/database/queries/template-queries.js';
import TemplateRenderer from '../services/templates/TemplateRenderer.js';
import {
    generateReceiptHTML,
    generateReceiptDataForFrontend
} from '../services/templates/receipt-service.js';

const router = express.Router();

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

/**
 * GET /api/templates/document-types
 * Get all available document types
 */
router.get('/document-types', async (req, res) => {
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
            error: error.message
        });
    }
});

/**
 * GET /api/templates/document-types/:typeId
 * Get a specific document type
 */
router.get('/document-types/:typeId', async (req, res) => {
    try {
        const { typeId } = req.params;
        const documentType = await templateQueries.getDocumentTypeById(parseInt(typeId));

        if (!documentType) {
            return res.status(404).json({
                status: 'error',
                message: 'Document type not found'
            });
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
            error: error.message
        });
    }
});

// ============================================================================
// DATA FIELDS
// ============================================================================

/**
 * GET /api/templates/data-fields/:documentTypeId
 * Get all available data fields for a document type
 */
router.get('/data-fields/:documentTypeId', async (req, res) => {
    try {
        const { documentTypeId } = req.params;
        const dataFields = await templateQueries.getDataFieldsByDocumentType(parseInt(documentTypeId));

        res.json({
            status: 'success',
            data: dataFields
        });
    } catch (error) {
        console.error('Error fetching data fields:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch data fields',
            error: error.message
        });
    }
});

/**
 * GET /api/templates/data-fields/:documentTypeId/grouped
 * Get data fields grouped by category
 */
router.get('/data-fields/:documentTypeId/grouped', async (req, res) => {
    try {
        const { documentTypeId } = req.params;
        const groupedFields = await templateQueries.getDataFieldsGrouped(parseInt(documentTypeId));

        res.json({
            status: 'success',
            data: groupedFields
        });
    } catch (error) {
        console.error('Error fetching grouped data fields:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch grouped data fields',
            error: error.message
        });
    }
});

// ============================================================================
// TEMPLATES - CRUD OPERATIONS
// ============================================================================

/**
 * GET /api/templates
 * Get all templates with optional filtering
 * Query params: documentTypeId, isActive, isDefault
 */
router.get('/', async (req, res) => {
    try {
        const filters = {};

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
            error: error.message
        });
    }
});

/**
 * GET /api/templates/:templateId
 * Get a specific template by ID (without elements)
 */
router.get('/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        const template = await templateQueries.getTemplateById(parseInt(templateId));

        if (!template) {
            return res.status(404).json({
                status: 'error',
                message: 'Template not found'
            });
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
            error: error.message
        });
    }
});

/**
 * GET /api/templates/:templateId/full
 * Get a template with all its elements
 */
router.get('/:templateId/full', async (req, res) => {
    try {
        const { templateId } = req.params;
        const template = await templateQueries.getTemplateWithElements(parseInt(templateId));

        if (!template) {
            return res.status(404).json({
                status: 'error',
                message: 'Template not found'
            });
        }

        res.json({
            status: 'success',
            data: template
        });
    } catch (error) {
        console.error('Error fetching template with elements:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch template with elements',
            error: error.message
        });
    }
});

/**
 * GET /api/templates/default/:documentTypeId
 * Get the default template for a document type
 */
router.get('/default/:documentTypeId', async (req, res) => {
    try {
        const { documentTypeId } = req.params;
        const template = await templateQueries.getDefaultTemplate(parseInt(documentTypeId));

        if (!template) {
            return res.status(404).json({
                status: 'error',
                message: 'No default template found for this document type'
            });
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
            error: error.message
        });
    }
});

/**
 * POST /api/templates
 * Create a new template
 */
router.post('/', async (req, res) => {
    try {
        const templateData = req.body;

        // Validate required fields
        if (!templateData.template_name || !templateData.document_type_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: template_name, document_type_id'
            });
        }

        // Set defaults for paper dimensions if not provided
        if (!templateData.paper_width || !templateData.paper_height) {
            const documentType = await templateQueries.getDocumentTypeById(templateData.document_type_id);
            if (documentType) {
                templateData.paper_width = templateData.paper_width || documentType.default_paper_width;
                templateData.paper_height = templateData.paper_height || documentType.default_paper_height;
            }
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
            error: error.message
        });
    }
});

/**
 * PUT /api/templates/:templateId
 * Update an existing template
 */
router.put('/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        const templateData = req.body;

        // Check if template exists
        const existingTemplate = await templateQueries.getTemplateById(parseInt(templateId));
        if (!existingTemplate) {
            return res.status(404).json({
                status: 'error',
                message: 'Template not found'
            });
        }

        // Check if it's a system template
        if (existingTemplate.is_system && templateData.is_system === false) {
            return res.status(403).json({
                status: 'error',
                message: 'Cannot modify system template flag'
            });
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
            error: error.message
        });
    }
});

/**
 * DELETE /api/templates/:templateId
 * Delete a template
 */
router.delete('/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;

        await templateQueries.deleteTemplate(parseInt(templateId));

        res.json({
            status: 'success',
            message: 'Template deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting template:', error);

        if (error.message.includes('system template')) {
            return res.status(403).json({
                status: 'error',
                message: error.message
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to delete template',
            error: error.message
        });
    }
});

/**
 * POST /api/templates/:templateId/clone
 * Clone an existing template
 */
router.post('/:templateId/clone', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { newName, createdBy } = req.body;

        const newTemplateId = await templateQueries.cloneTemplate(
            parseInt(templateId),
            newName,
            createdBy || 'system'
        );

        res.status(201).json({
            status: 'success',
            message: 'Template cloned successfully',
            data: { template_id: newTemplateId }
        });
    } catch (error) {
        console.error('Error cloning template:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to clone template',
            error: error.message
        });
    }
});

// ============================================================================
// TEMPLATE ELEMENTS - CRUD OPERATIONS
// ============================================================================

/**
 * GET /api/templates/:templateId/elements
 * Get all elements for a template
 */
router.get('/:templateId/elements', async (req, res) => {
    try {
        const { templateId } = req.params;
        const elements = await templateQueries.getTemplateElements(parseInt(templateId));

        res.json({
            status: 'success',
            data: elements
        });
    } catch (error) {
        console.error('Error fetching template elements:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch template elements',
            error: error.message
        });
    }
});

/**
 * GET /api/templates/elements/:elementId
 * Get a specific element by ID
 */
router.get('/elements/:elementId', async (req, res) => {
    try {
        const { elementId } = req.params;
        const element = await templateQueries.getTemplateElementById(parseInt(elementId));

        if (!element) {
            return res.status(404).json({
                status: 'error',
                message: 'Element not found'
            });
        }

        res.json({
            status: 'success',
            data: element
        });
    } catch (error) {
        console.error('Error fetching element:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch element',
            error: error.message
        });
    }
});

/**
 * POST /api/templates/:templateId/elements
 * Create a new element in a template
 */
router.post('/:templateId/elements', async (req, res) => {
    try {
        const { templateId } = req.params;
        const elementData = req.body;

        // Validate required fields
        if (!elementData.element_type || !elementData.element_name) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: element_type, element_name'
            });
        }

        const elementId = await templateQueries.createTemplateElement(parseInt(templateId), elementData);

        res.status(201).json({
            status: 'success',
            message: 'Element created successfully',
            data: { element_id: elementId }
        });
    } catch (error) {
        console.error('Error creating element:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create element',
            error: error.message
        });
    }
});

/**
 * PUT /api/templates/elements/:elementId
 * Update an existing element
 */
router.put('/elements/:elementId', async (req, res) => {
    try {
        const { elementId } = req.params;
        const elementData = req.body;

        // Check if element exists
        const existingElement = await templateQueries.getTemplateElementById(parseInt(elementId));
        if (!existingElement) {
            return res.status(404).json({
                status: 'error',
                message: 'Element not found'
            });
        }

        // Check if element is locked
        if (existingElement.is_locked) {
            return res.status(403).json({
                status: 'error',
                message: 'Cannot modify locked element'
            });
        }

        await templateQueries.updateTemplateElement(parseInt(elementId), elementData);

        res.json({
            status: 'success',
            message: 'Element updated successfully'
        });
    } catch (error) {
        console.error('Error updating element:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update element',
            error: error.message
        });
    }
});

/**
 * DELETE /api/templates/elements/:elementId
 * Delete an element
 */
router.delete('/elements/:elementId', async (req, res) => {
    try {
        const { elementId } = req.params;

        // Check if element exists and is not locked
        const element = await templateQueries.getTemplateElementById(parseInt(elementId));
        if (!element) {
            return res.status(404).json({
                status: 'error',
                message: 'Element not found'
            });
        }

        if (element.is_locked) {
            return res.status(403).json({
                status: 'error',
                message: 'Cannot delete locked element'
            });
        }

        await templateQueries.deleteTemplateElement(parseInt(elementId));

        res.json({
            status: 'success',
            message: 'Element deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting element:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete element',
            error: error.message
        });
    }
});

// ============================================================================
// TEMPLATE RENDERING & PREVIEW
// ============================================================================

/**
 * POST /api/templates/:templateId/render
 * Render a template with real data
 * Body: { data: { patient: {}, payment: {}, ... }, printReady: boolean }
 */
router.post('/:templateId/render', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { data, printReady } = req.body;

        if (!data) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required field: data'
            });
        }

        // Get template with elements
        const template = await templateQueries.getTemplateWithElements(parseInt(templateId));

        if (!template) {
            return res.status(404).json({
                status: 'error',
                message: 'Template not found'
            });
        }

        // Render template
        const html = printReady
            ? TemplateRenderer.renderTemplateToPrint(template, data)
            : TemplateRenderer.renderTemplate(template, data);

        // Log usage if context provided
        if (data.contextType && data.contextId) {
            await templateQueries.logTemplateUsage(
                parseInt(templateId),
                data.contextType,
                data.contextId,
                data.usedBy || 'system'
            );
        }

        res.json({
            status: 'success',
            data: {
                template_id: templateId,
                template_name: template.template_name,
                html: html
            }
        });
    } catch (error) {
        console.error('Error rendering template:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to render template',
            error: error.message
        });
    }
});

/**
 * GET /api/templates/:templateId/preview
 * Generate a preview with sample data
 */
router.get('/:templateId/preview', async (req, res) => {
    try {
        const { templateId } = req.params;

        // Get template with elements
        const template = await templateQueries.getTemplateWithElements(parseInt(templateId));

        if (!template) {
            return res.status(404).json({
                status: 'error',
                message: 'Template not found'
            });
        }

        // Generate sample data based on document type
        const sampleData = TemplateRenderer.generateSampleData(template.document_type_code);

        // Render template with sample data
        const html = TemplateRenderer.renderTemplate(template, sampleData);

        res.json({
            status: 'success',
            data: {
                template_id: templateId,
                template_name: template.template_name,
                html: html,
                sample_data: sampleData
            }
        });
    } catch (error) {
        console.error('Error generating preview:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to generate preview',
            error: error.message
        });
    }
});

// ============================================================================
// TEMPLATE USAGE LOGGING
// ============================================================================

/**
 * POST /api/templates/:templateId/log-usage
 * Log template usage
 */
router.post('/:templateId/log-usage', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { contextType, contextId, usedBy } = req.body;

        await templateQueries.logTemplateUsage(
            parseInt(templateId),
            contextType,
            contextId,
            usedBy || 'system'
        );

        res.json({
            status: 'success',
            message: 'Usage logged successfully'
        });
    } catch (error) {
        console.error('Error logging template usage:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to log template usage',
            error: error.message
        });
    }
});

// ============================================================================
// RECEIPT GENERATION (Specialized Endpoints)
// ============================================================================

/**
 * GET /api/templates/receipt/work/:workId
 * Generate receipt HTML for a work (all payments)
 */
router.get('/receipt/work/:workId', async (req, res) => {
    try {
        const { workId } = req.params;
        const html = await generateReceiptHTML(parseInt(workId));

        res.send(html);
    } catch (error) {
        console.error('Error generating receipt:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to generate receipt',
            error: error.message
        });
    }
});

/**
 * GET /api/templates/receipt/invoice/:invoiceId
 * Generate receipt HTML for a specific invoice/payment
 */
router.get('/receipt/invoice/:invoiceId', async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { workId } = req.query;

        if (!workId) {
            return res.status(400).json({
                status: 'error',
                message: 'workId query parameter is required'
            });
        }

        const html = await generateReceiptHTML(parseInt(workId), parseInt(invoiceId));

        res.send(html);
    } catch (error) {
        console.error('Error generating receipt:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to generate receipt',
            error: error.message
        });
    }
});

/**
 * GET /api/templates/receipt/data/:workId
 * Get receipt data (for frontend compatibility)
 */
router.get('/receipt/data/:workId', async (req, res) => {
    try {
        const { workId } = req.params;
        const { invoiceId } = req.query;

        const data = await generateReceiptDataForFrontend(
            parseInt(workId),
            invoiceId ? parseInt(invoiceId) : null
        );

        res.json({
            status: 'success',
            data
        });
    } catch (error) {
        console.error('Error getting receipt data:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get receipt data',
            error: error.message
        });
    }
});

export default router;
