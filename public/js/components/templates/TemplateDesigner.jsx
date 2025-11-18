/**
 * Template Designer Component
 * Visual template designer using GrapesJS
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import GrapesJSEditor from './GrapesJSEditor.jsx';
import DesignerToolbar from './DesignerToolbar.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';

const TemplateDesigner = () => {
    const { templateId } = useParams();
    const navigate = useNavigate();
    const editorRef = useRef(null);
    const toast = useToast();

    const [template, setTemplate] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (templateId) {
            loadTemplate(templateId);
        } else {
            setIsLoading(false);
            setError('No template ID provided');
        }
    }, [templateId]);

    const loadTemplate = async (id) => {
        try {
            setIsLoading(true);
            const response = await fetch(`/api/templates/${id}`);
            const result = await response.json();

            if (result.status === 'success') {
                setTemplate(result.data);
                setError(null);
            } else {
                throw new Error(result.message || 'Failed to load template');
            }
        } catch (err) {
            console.error('Error loading template:', err);
            setError('Failed to load template: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        if (!editorRef.current || !templateId) {
            toast.error('Editor not ready or no template ID');
            return;
        }

        setIsSaving(true);

        try {
            const editor = editorRef.current;
            const html = editor.getHtml();
            const css = editor.getCss();

            // Get current device dimensions
            const device = editor.Devices.getSelected();
            const pageWidth = device.get('width') || '794px';
            const pageHeight = device.get('height') || null;

            // Create complete HTML document
            const completeHtml = generateCompleteHTML(html, css, pageWidth, pageHeight);

            // Send to backend
            const response = await fetch(`/api/templates/${templateId}/save-html`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html: completeHtml })
            });

            const result = await response.json();

            if (result.status === 'success') {
                toast.success('Template saved successfully!');
            } else {
                throw new Error(result.message || 'Failed to save template');
            }
        } catch (err) {
            console.error('Error saving template:', err);
            toast.error('Failed to save template: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handlePreview = () => {
        if (!editorRef.current) {
            toast.error('Editor not ready');
            return;
        }

        const editor = editorRef.current;
        const device = editor.Devices.getSelected();
        const pageWidth = device.get('width') || '794px';
        const pageHeight = device.get('height') || null;

        const html = generateCompleteHTML(
            editor.getHtml(),
            editor.getCss(),
            pageWidth,
            pageHeight
        );

        // Open preview window
        const widthPx = parseInt(pageWidth) + 100;
        const heightPx = pageHeight ? parseInt(pageHeight) + 100 : 800;

        const previewWindow = window.open('', '_blank', `width=${widthPx},height=${heightPx}`);
        previewWindow.document.write(html);
        previewWindow.document.close();
    };

    const handleBack = () => {
        if (confirm('Are you sure you want to leave? Unsaved changes will be lost.')) {
            navigate('/templates');
        }
    };

    const generateCompleteHTML = (bodyHtml, css, pageWidth = '794px', pageHeight = '1123px') => {
        // Convert px to mm for @page size (96dpi: 1px = 0.2646mm)
        const widthMm = Math.round(parseInt(pageWidth) * 0.2646);
        const heightMm = pageHeight ? Math.round(parseInt(pageHeight) * 0.2646) : 'auto';
        const pageSize = pageHeight ? `${widthMm}mm ${heightMm}mm` : `${widthMm}mm auto`;

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Receipt Preview</title>
    <style>
        @page {
            size: ${pageSize};
            margin: 0;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 0;
            background: white;
            font-family: Arial, sans-serif;
            width: ${pageWidth};
            ${pageHeight ? `min-height: ${pageHeight};` : ''}
            max-width: ${pageWidth};
            margin: 0 auto;
        }

        ${css}

        @media print {
            body {
                margin: 0;
                padding: 0;
            }

            * {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
            }
        }

        @media screen {
            body {
                background: #f0f0f0;
                padding: 0;
            }
        }
    </style>
</head>
<body>
    ${bodyHtml}
</body>
</html>`;
    };

    if (isLoading) {
        return (
            <div className="designer-loading">
                <i className="fas fa-spinner fa-spin"></i>
                <p>Loading template designer...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="designer-error">
                <i className="fas fa-exclamation-circle"></i>
                <p>{error}</p>
                <button className="btn btn-primary" onClick={handleBack}>
                    Go Back
                </button>
            </div>
        );
    }

    return (
        <div className="template-designer">
            <DesignerToolbar
                templateName={template?.template_name || 'New Template'}
                onBack={handleBack}
                onPreview={handlePreview}
                onSave={handleSave}
                isSaving={isSaving}
            />

            <GrapesJSEditor
                ref={editorRef}
                template={template}
            />

            {isSaving && (
                <div className="loading-overlay active">
                    <div className="loading-content">
                        <i className="fas fa-spinner loading-spinner"></i>
                        <p style={{ marginTop: '15px', fontSize: '16px' }}>Saving template...</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TemplateDesigner;
