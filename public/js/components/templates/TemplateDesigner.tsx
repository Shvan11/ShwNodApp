/**
 * Template Designer Component
 * Visual template designer using GrapesJS
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Editor as GrapesJSEditorType } from 'grapesjs';

import styles from './TemplateDesigner.module.css';
import GrapesJSEditor from './GrapesJSEditor';
import DesignerToolbar from './DesignerToolbar';
import { useToast } from '../../contexts/ToastContext';

interface Template {
    template_id: number | null;
    template_name: string;
    template_file_path: string | null;
}

interface ApiResponse<T> {
    status: 'success' | 'error';
    data: T;
    message?: string;
}

function TemplateDesigner() {
    const { templateId } = useParams<{ templateId: string }>();
    const navigate = useNavigate();
    const editorRef = useRef<GrapesJSEditorType | null>(null);
    const toast = useToast();

    const [template, setTemplate] = useState<Template | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (templateId) {
            loadTemplate(templateId);
        } else {
            // No template ID means we're creating a new template
            setIsLoading(false);
            setTemplate({
                template_id: null,
                template_name: 'New Template',
                template_file_path: null
            });
        }
    }, [templateId]);

    const loadTemplate = async (id: string) => {
        try {
            setIsLoading(true);
            const response = await fetch(`/api/templates/${id}`);

            // Check if response is ok (status 200-299)
            if (!response.ok) {
                const errorText = await response.text();
                console.error('API error response:', response.status, errorText);
                throw new Error(`Failed to load template (HTTP ${response.status}): ${errorText}`);
            }

            const result: ApiResponse<Template> = await response.json();
            console.log('Template loaded:', result);

            if (result.status === 'success') {
                setTemplate(result.data);
                setError(null);
            } else {
                throw new Error(result.message || 'Failed to load template');
            }
        } catch (err) {
            console.error('Error loading template:', err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            setError('Failed to load template: ' + errorMessage);
            toast?.error('Failed to load template: ' + errorMessage);
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
            const html = editor.getHtml() || '';
            const css = editor.getCss() || '';

            // Get current device dimensions
            const device = editor.Devices.getSelected();
            const pageWidth = String(device?.get('width') || '794px');
            const pageHeight = device?.get('height') ? String(device.get('height')) : null;

            // Create complete HTML document
            const completeHtml = generateCompleteHTML(html, css, pageWidth, pageHeight);

            // Send to backend
            const response = await fetch(`/api/templates/${templateId}/save-html`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html: completeHtml })
            });

            const result: ApiResponse<unknown> = await response.json();

            if (result.status === 'success') {
                toast.success('Template saved successfully!');
            } else {
                throw new Error(result.message || 'Failed to save template');
            }
        } catch (err) {
            console.error('Error saving template:', err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            toast.error('Failed to save template: ' + errorMessage);
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
        const pageWidth = String(device?.get('width') || '794px');
        const pageHeight = device?.get('height') ? String(device.get('height')) : null;

        const html = generateCompleteHTML(
            editor.getHtml() || '',
            editor.getCss() || '',
            pageWidth,
            pageHeight
        );

        // Open preview window
        const widthPx = parseInt(String(pageWidth)) + 100;
        const heightPx = pageHeight ? parseInt(String(pageHeight)) + 100 : 800;

        const previewWindow = window.open('', '_blank', `width=${widthPx},height=${heightPx}`);
        if (previewWindow) {
            previewWindow.document.write(html);
            previewWindow.document.close();
        }
    };

    const handleBack = () => {
        if (confirm('Are you sure you want to leave? Unsaved changes will be lost.')) {
            navigate('/templates');
        }
    };

    const generateCompleteHTML = (
        bodyHtml: string,
        css: string,
        pageWidth: string = '794px',
        pageHeight: string | null = '1123px'
    ): string => {
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
            <div className={styles.designerLoading}>
                <i className="fas fa-spinner fa-spin"></i>
                <p>Loading template designer...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.designerError}>
                <i className="fas fa-exclamation-circle"></i>
                <p>{error}</p>
                <button className="btn btn-primary" onClick={handleBack}>
                    Go Back
                </button>
            </div>
        );
    }

    return (
        <div className={styles.templateDesigner}>
            <DesignerToolbar
                templateName={template?.template_name || 'New Template'}
                onBack={handleBack}
                onPreview={handlePreview}
                onSave={handleSave}
                isSaving={isSaving}
                styles={styles}
            />

            <GrapesJSEditor
                ref={editorRef}
                template={template}
                styles={styles}
            />

            {isSaving && (
                <div className={`${styles.loadingOverlay} ${styles.loadingOverlayActive}`}>
                    <div className={styles.loadingContent}>
                        <i className={`fas fa-spinner ${styles.loadingSpinner}`}></i>
                        <p className={styles.loadingMessage}>Saving template...</p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default TemplateDesigner;
