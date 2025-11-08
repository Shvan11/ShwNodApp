/**
 * GrapesJS Template Designer
 * Visual designer for receipt/invoice/prescription templates
 */

import grapesjs from 'grapesjs';
// CSS loaded via <link> tag in HTML instead of import for better Vite compatibility

let editor;
let currentTemplateId = null;
let currentDocumentType = null;

// Make functions globally available for onclick handlers
window.goBack = goBack;
window.previewTemplate = previewTemplate;
window.saveTemplate = saveTemplate;

// Initialize designer on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded - Initializing template designer');

    try {
        // Get template ID from URL
        const urlParams = new URLSearchParams(window.location.search);
        currentTemplateId = urlParams.get('templateId');

        console.log('Template ID from URL:', currentTemplateId);

        if (currentTemplateId) {
            loadTemplate(currentTemplateId);
        } else {
            initializeEditor();
        }
    } catch (error) {
        console.error('Error during initialization:', error);
        alert('Error initializing designer: ' + error.message);
    }
});

/**
 * Initialize GrapesJS editor
 */
function initializeEditor(templateHtml = null, templateCss = null) {
    try {
        editor = grapesjs.init({
            container: '#gjs',
            height: 'calc(100vh - 71px)', // Match CSS height calculation
            width: 'auto',
            storageManager: false, // Disable local storage - we save to files

            // Removed gjs-preset-newsletter due to ESM import issues
            // plugins: [gjsNewsletter],

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
                    width: '718px', // 190mm width - optimal for single-page thermal printing
                    height: '283px', // 75mm height - optimal for single-page thermal printing
                },
                {
                    id: 'a4',
                    name: 'A4 Portrait (210×297mm)',
                    width: '794px', // 210mm width
                    height: '1123px', // 297mm height
                },
                {
                    id: 'a4-landscape',
                    name: 'A4 Landscape (297×210mm)',
                    width: '1123px', // 297mm width
                    height: '794px', // 210mm height
                },
                {
                    id: 'letter',
                    name: 'Letter (8.5×11")',
                    width: '816px', // 8.5 inches width
                    height: '1056px', // 11 inches height
                },
                {
                    id: 'receipt-80mm',
                    name: 'Receipt 80mm (Portrait)',
                    width: '302px', // 80mm width
                },
                {
                    id: 'receipt-58mm',
                    name: 'Receipt 58mm (Portrait)',
                    width: '219px', // 58mm width
                }
            ]
        }
    });

    // Add custom receipt blocks
    addReceiptBlocks();

    // Load template HTML if provided
    if (templateHtml) {
        editor.setComponents(templateHtml);
    } else {
        console.warn('No template HTML provided - cannot initialize editor');
        alert('Error: Template file not found. Please ensure the template has a valid file path.');
        return;
    }

    // Load CSS from file
    if (templateCss) {
        editor.setStyle(templateCss);
    } else {
        console.warn('No template CSS provided - using minimal styles');
        editor.setStyle('');
    }


    } catch (error) {
        console.error('Error initializing GrapesJS editor:', error);
        alert('Failed to initialize template designer: ' + error.message);
    }
}

/**
 * Add custom receipt-specific blocks
 */
function addReceiptBlocks() {
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
}

/**
 * Load existing template
 */
async function loadTemplate(templateId) {
    try {
        const response = await fetch(`/api/templates/${templateId}`);
        const result = await response.json();

        if (result.status === 'success') {
            const template = result.data;
            document.getElementById('templateName').textContent = template.template_name;
            currentDocumentType = template.document_type_id;

            // Load template HTML from file
            if (template.template_file_path) {
                // Add cache-busting query parameter to ensure fresh load
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

                initializeEditor(bodyContent, extractedCss);
            } else {
                console.error('Template has no file path');
                alert('Error: Template file not found. Please contact support.');
            }
        } else {
            console.error('Failed to load template:', result.message);
            alert('Failed to load template: ' + result.message);
        }
    } catch (error) {
        console.error('Error loading template:', error);
        alert('Failed to load template: ' + error.message);
    }
}

/**
 * Save template to file
 */
async function saveTemplate() {
    if (!currentTemplateId) {
        alert('No template ID found. Please create a template first.');
        return;
    }

    const loadingOverlay = document.getElementById('loadingOverlay');
    loadingOverlay.classList.add('active');

    try {
        // Get HTML and CSS from editor
        const html = editor.getHtml();
        const css = editor.getCss();

        // Get current device dimensions
        const device = editor.Devices.getSelected();
        const pageWidth = device.get('width') || '794px';
        const pageHeight = device.get('height') || null;

        // Create complete HTML document with page size
        const completeHtml = generateCompleteHTML(html, css, pageWidth, pageHeight);

        // Send to backend to save as file
        const response = await fetch(`/api/templates/${currentTemplateId}/save-html`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: completeHtml })
        });

        const result = await response.json();

        if (result.status === 'success') {
            alert('Template saved successfully!');
        } else {
            throw new Error(result.message || 'Failed to save template');
        }
    } catch (error) {
        console.error('Error saving template:', error);
        alert('Failed to save template: ' + error.message);
    } finally {
        loadingOverlay.classList.remove('active');
    }
}

/**
 * Generate complete HTML document
 */
function generateCompleteHTML(bodyHtml, css, pageWidth = '794px', pageHeight = '1123px') {
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
}

/**
 * Preview template
 */
function previewTemplate() {
    // Get current device dimensions
    const device = editor.Devices.getSelected();
    const pageWidth = device.get('width') || '794px';
    const pageHeight = device.get('height') || null;

    console.log('Preview with dimensions:', { pageWidth, pageHeight });

    const html = generateCompleteHTML(editor.getHtml(), editor.getCss(), pageWidth, pageHeight);

    // Open preview window with dimensions matching the page size
    const widthPx = parseInt(pageWidth) + 100; // Add padding for window chrome
    const heightPx = pageHeight ? parseInt(pageHeight) + 100 : 800;

    const previewWindow = window.open('', '_blank', `width=${widthPx},height=${heightPx}`);
    previewWindow.document.write(html);
    previewWindow.document.close();
}

/**
 * Go back to template management
 */
function goBack() {
    if (confirm('Are you sure you want to leave? Unsaved changes will be lost.')) {
        window.location.href = '/views/template-management.html';
    }
}
