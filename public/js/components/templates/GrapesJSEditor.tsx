/**
 * GrapesJS Editor Component
 * React wrapper for GrapesJS visual editor
 * Uses dynamic import() to load GrapesJS only when needed
 */

import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import type { Editor as GrapesJSEditorType, BlockManagerConfig } from 'grapesjs';

interface Template {
    template_id: number | null;
    template_name: string;
    template_file_path: string | null;
}

interface EditorStyles {
    readonly [key: string]: string;
}

interface GrapesJSEditorProps {
    template: Template | null;
    styles: EditorStyles;
}

const GrapesJSEditor = forwardRef<GrapesJSEditorType | null, GrapesJSEditorProps>(({ template, styles }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<GrapesJSEditorType | null>(null);
    const isInitializingRef = useRef(false); // Prevent double initialization in StrictMode
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const toast = useToast();

    useImperativeHandle(ref, () => editorRef.current!);

    // Initialize GrapesJS after container is rendered
    useEffect(() => {
        // Wait for container to be rendered (it's rendered when isLoading becomes false)
        if (!containerRef.current) {
            console.log('GrapesJSEditor: Waiting for container to render...');
            return;
        }

        if (editorRef.current) {
            console.log('GrapesJSEditor: Editor already initialized');
            return;
        }

        if (isInitializingRef.current) {
            console.log('GrapesJSEditor: Already initializing, skipping...');
            return;
        }

        console.log('GrapesJSEditor: Container is ready, starting to load GrapesJS...', containerRef.current);
        isInitializingRef.current = true;

        // Dynamically import GrapesJS only when component mounts
        loadGrapesJS();

        // Cleanup on unmount
        return () => {
            if (editorRef.current) {
                console.log('GrapesJSEditor: Destroying editor');
                try {
                    editorRef.current.destroy();
                } catch (err) {
                    console.warn('GrapesJSEditor: Error destroying editor:', err);
                }
                editorRef.current = null;
            }
            isInitializingRef.current = false;
        };
    }, [isLoading]); // Run when isLoading changes (becomes false and container renders)

    const loadGrapesJS = async () => {
        try {
            console.log('GrapesJSEditor: Loading GrapesJS module...');
            setIsLoading(true);

            // Dynamic import - GrapesJS is only loaded when this component mounts
            // CSS is loaded globally in index.html
            const grapesJSModule = await import('grapesjs');

            console.log('GrapesJSEditor: GrapesJS module loaded successfully', grapesJSModule);
            const grapesjs = grapesJSModule.default;

            if (!grapesjs) {
                throw new Error('GrapesJS module loaded but default export is undefined');
            }

            console.log('GrapesJSEditor: Initializing editor...');
            setIsLoading(false);
            initializeEditor(grapesjs);
        } catch (error) {
            console.error('Failed to load GrapesJS:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error loading GrapesJS';
            setLoadError(errorMessage);
            setIsLoading(false);
            toast?.error('Failed to load template designer: ' + errorMessage);
        }
    };

    useEffect(() => {
        if (editorRef.current && template) {
            loadTemplateContent();
        }
    }, [template]);

    const initializeEditor = (grapesjs: typeof import('grapesjs').default) => {
        try {
            console.log('GrapesJSEditor: Initializing GrapesJS with container:', containerRef.current);

            if (!containerRef.current) {
                throw new Error('Container element is not available');
            }

            // Clear any existing content in the container to avoid React/GrapesJS conflicts
            containerRef.current.innerHTML = '';

            const editor = grapesjs.init({
                container: containerRef.current,
                height: 'calc(100vh - 71px)',
                width: 'auto',
                storageManager: false,

                canvas: {
                    styles: [
                        'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
                    ]
                },

                deviceManager: {
                    devices: [
                        {
                            id: 'landscape-80x200',
                            name: 'Thermal 75×190mm',
                            width: '718px',
                            height: '283px',
                        },
                        {
                            id: 'a4',
                            name: 'A4 Portrait (210×297mm)',
                            width: '794px',
                            height: '1123px',
                        },
                        {
                            id: 'a4-landscape',
                            name: 'A4 Landscape (297×210mm)',
                            width: '1123px',
                            height: '794px',
                        },
                        {
                            id: 'letter',
                            name: 'Letter (8.5×11")',
                            width: '816px',
                            height: '1056px',
                        },
                        {
                            id: 'receipt-80mm',
                            name: 'Receipt 80mm (Portrait)',
                            width: '302px',
                        },
                        {
                            id: 'receipt-58mm',
                            name: 'Receipt 58mm (Portrait)',
                            width: '219px',
                        }
                    ]
                }
            });

            console.log('GrapesJSEditor: Editor initialized successfully', editor);

            // Add custom receipt blocks
            addReceiptBlocks(editor);

            editorRef.current = editor;
            console.log('GrapesJSEditor: Editor reference stored, ready to use');

            // Load template if available
            if (template) {
                console.log('GrapesJSEditor: Template available, loading content...');
                loadTemplateContent();
            } else {
                console.log('GrapesJSEditor: No template to load, editor ready for new content');
            }
        } catch (error) {
            console.error('Error initializing GrapesJS editor:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to initialize editor';
            setLoadError(errorMessage);
            toast?.error('Failed to initialize template designer: ' + errorMessage);
        }
    };

    const loadTemplateContent = async () => {
        if (!editorRef.current || !template?.template_file_path) return;

        try {
            // Add cache-busting query parameter
            const cacheBuster = `?t=${Date.now()}`;
            const htmlResponse = await fetch(`/${template.template_file_path}${cacheBuster}`);
            const templateHtml = await htmlResponse.text();

            // Extract body content and CSS from HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(templateHtml, 'text/html');
            const bodyContent = doc.body.innerHTML;

            // Extract CSS from style tags
            const styleElements = doc.querySelectorAll('style');
            let extractedCss = '';
            styleElements.forEach(style => {
                extractedCss += style.textContent + '\n';
            });

            // Load into editor
            editorRef.current.setComponents(bodyContent);
            editorRef.current.setStyle(extractedCss);
        } catch (error) {
            console.error('Error loading template content:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            toast.error('Failed to load template content: ' + errorMessage);
        }
    };

    const addReceiptBlocks = (editor: GrapesJSEditorType) => {
        const blockManager = editor.BlockManager;

        // Clinic Header Block
        blockManager.add('clinic-header', {
            label: 'Clinic Header',
            category: 'Receipt Elements',
            content: `
                <div class="clinic-header" style="text-align: center; padding: 20px; border-bottom: 2px solid #333;">
                    <h1 style="margin: 0; font-size: 24px; color: #333;">{{clinic.Name}}</h1>
                    <p style="margin: 5px 0; font-size: 14px; color: #666;">{{clinic.Location}}</p>
                    <p style="margin: 5px 0; font-size: 14px; color: #666;">{{clinic.Phone1}} | {{clinic.Phone2}}</p>
                </div>
            `,
            attributes: { class: 'fa fa-building' }
        });

        // Patient Info Block
        blockManager.add('patient-info', {
            label: 'Patient Info',
            category: 'Receipt Elements',
            content: `
                <div class="patient-info" style="padding: 15px; background: #f9f9f9; margin: 10px 0;">
                    <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #333;">Patient Information</h3>
                    <p style="margin: 5px 0;"><strong>Name:</strong> {{patient.PatientName}}</p>
                    <p style="margin: 5px 0;"><strong>Phone:</strong> {{patient.Phone}}</p>
                    <p style="margin: 5px 0;"><strong>Patient ID:</strong> {{patient.PersonID}}</p>
                </div>
            `,
            attributes: { class: 'fa fa-user' }
        });

        // Payment Details Block
        blockManager.add('payment-details', {
            label: 'Payment Details',
            category: 'Receipt Elements',
            content: `
                <div class="payment-details" style="padding: 15px;">
                    <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #333;">Payment Details</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;">Total Treatment Cost:</td>
                            <td style="padding: 8px; text-align: right;"><strong>{{work.TotalRequired|currency}} {{work.Currency}}</strong></td>
                        </tr>
                        <tr style="border-bottom: 1px solid #ddd;">
                            <td style="padding: 8px;">Previously Paid:</td>
                            <td style="padding: 8px; text-align: right;">{{payment.PreviouslyPaid|currency}} {{payment.Currency}}</td>
                        </tr>
                        <tr style="border-bottom: 2px solid #333; background: #f0f0f0;">
                            <td style="padding: 8px;"><strong>Paid Today:</strong></td>
                            <td style="padding: 8px; text-align: right;"><strong>{{payment.AmountPaidToday|currency}} {{payment.Currency}}</strong></td>
                        </tr>
                        <tr style="font-size: 18px;">
                            <td style="padding: 12px 8px;"><strong>Total Paid:</strong></td>
                            <td style="padding: 12px 8px; text-align: right;"><strong>{{payment.TotalPaid|currency}} {{payment.Currency}}</strong></td>
                        </tr>
                        <tr style="font-size: 18px; color: #d32f2f;">
                            <td style="padding: 8px;"><strong>Remaining Balance:</strong></td>
                            <td style="padding: 8px; text-align: right;"><strong>{{payment.RemainingBalance|currency}} {{payment.Currency}}</strong></td>
                        </tr>
                    </table>
                </div>
            `,
            attributes: { class: 'fa fa-money-bill' }
        });

        // Receipt Footer Block
        blockManager.add('receipt-footer', {
            label: 'Receipt Footer',
            category: 'Receipt Elements',
            content: `
                <div class="receipt-footer" style="text-align: center; padding: 20px; border-top: 2px solid #333; margin-top: 20px;">
                    <p style="margin: 5px 0; font-size: 14px; font-weight: bold;">Thank you for your payment!</p>
                    <p style="margin: 5px 0; font-size: 12px; color: #666;">Keep this receipt for your records</p>
                    <p style="margin: 10px 0; font-size: 11px; color: #999;">Receipt #{{work.WorkID}} | {{payment.PaymentDateTime|date:MMM DD, YYYY}}</p>
                </div>
            `,
            attributes: { class: 'fa fa-receipt' }
        });

        // Placeholder Block
        blockManager.add('placeholder', {
            label: 'Data Placeholder',
            category: 'Receipt Elements',
            content: '<span style="background: #fffacd; padding: 2px 5px; border: 1px dashed #ffa500;">{{field.name}}</span>',
            attributes: { class: 'fa fa-code' }
        });

        // Divider Block
        blockManager.add('divider-line', {
            label: 'Divider Line',
            category: 'Receipt Elements',
            content: '<hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">',
            attributes: { class: 'fa fa-minus' }
        });
    };

    if (loadError) {
        return (
            <div style={{ padding: '40px', textAlign: 'center' }}>
                <h2 style={{ color: 'var(--error-color)' }}>Failed to Load Editor</h2>
                <p>{loadError}</p>
            </div>
        );
    }

    // Render container div - GrapesJS will take full control of it
    // We don't render children here to avoid React/GrapesJS DOM conflicts
    return (
        <>
            {isLoading && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '40px',
                    zIndex: 9999,
                    background: 'white',
                    borderRadius: '8px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                    <div className={styles.loadingSpinner}></div>
                    <p>Loading template designer...</p>
                </div>
            )}
            <div ref={containerRef} id="gjs" className={styles.editorContainer} />
        </>
    );
});

GrapesJSEditor.displayName = 'GrapesJSEditor';

export default GrapesJSEditor;
export type { Template as GrapesJSTemplate, GrapesJSEditorProps };
