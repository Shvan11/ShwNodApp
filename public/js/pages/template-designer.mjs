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
function initializeEditor(templateHtml = null) {
    console.log('Initializing GrapesJS editor...', { templateHtml: templateHtml ? 'provided' : 'null' });

    try {
        console.log('Creating GrapesJS instance...');
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
                    id: 'landscape-80x210',
                    name: 'Landscape 80×210mm',
                    width: '794px', // 210mm width (landscape)
                    height: '302px', // 80mm height
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

    console.log('GrapesJS instance created successfully');

    // Add custom receipt blocks
    console.log('Adding custom receipt blocks...');
    addReceiptBlocks();

    // Load template HTML if provided
    if (templateHtml) {
        console.log('Setting template HTML components...');
        editor.setComponents(templateHtml);
    } else {
        console.log('Setting default receipt template...');
        // Set default receipt structure
        editor.setComponents(getDefaultReceiptTemplate());
    }

    // Add custom CSS for print
    console.log('Setting default styles...');
    editor.setStyle(getDefaultReceiptStyles());

    console.log('GrapesJS editor initialized successfully!');

    // Debug: Check what GrapesJS rendered
    setTimeout(() => {
        const gjsContainer = document.getElementById('gjs');
        console.log('=== DEBUG INFO ===');
        console.log('GJS Container element:', gjsContainer);
        console.log('GJS Container children count:', gjsContainer?.children.length);
        console.log('GJS Container innerHTML length:', gjsContainer?.innerHTML.length);
        console.log('GJS Container computed height:', window.getComputedStyle(gjsContainer).height);
        console.log('GJS Container computed display:', window.getComputedStyle(gjsContainer).display);
        console.log('Editor instance:', editor);
        console.log('Editor Canvas:', editor.Canvas);
        console.log('================');
    }, 1000);

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
 * Get default receipt template structure
 */
function getDefaultReceiptTemplate() {
    return `
        <div style="max-width: 800px; margin: 0 auto; background: white; padding: 20px; font-family: Arial, sans-serif;">
            <div class="clinic-header" style="text-align: center; padding: 20px; border-bottom: 2px solid #333;">
                <h1 style="margin: 0; font-size: 24px; color: #333;">SHWAN ORTHODONTICS</h1>
                <p style="margin: 5px 0; font-size: 14px; color: #666;">Sulaymaniyah, Kurdistan - Iraq</p>
                <p style="margin: 5px 0; font-size: 14px; color: #666;">+964 750 123 4567 | +964 770 987 6543</p>
            </div>

            <h2 style="text-align: center; margin: 20px 0; color: #333;">PAYMENT RECEIPT</h2>

            <div class="patient-info" style="padding: 15px; background: #f9f9f9; margin: 10px 0;">
                <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #333;">Patient Information</h3>
                <p style="margin: 5px 0;"><strong>Name:</strong> {{patient.PatientName}}</p>
                <p style="margin: 5px 0;"><strong>Phone:</strong> {{patient.Phone}}</p>
                <p style="margin: 5px 0;"><strong>Patient ID:</strong> {{patient.PersonID}}</p>
            </div>

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

            <div class="receipt-footer" style="text-align: center; padding: 20px; border-top: 2px solid #333; margin-top: 20px;">
                <p style="margin: 5px 0; font-size: 14px; font-weight: bold;">Thank you for your payment!</p>
                <p style="margin: 5px 0; font-size: 12px; color: #666;">Keep this receipt for your records</p>
                <p style="margin: 10px 0; font-size: 11px; color: #999;">Receipt #{{work.WorkID}} | {{payment.PaymentDateTime|date:MMM DD, YYYY}}</p>
            </div>
        </div>
    `;
}

/**
 * Get default receipt styles (for print)
 */
function getDefaultReceiptStyles() {
    return `
        @media print {
            body {
                margin: 0;
                padding: 0;
            }
            .gjs-dashed * {
                outline: none !important;
            }
        }

        * {
            box-sizing: border-box;
        }
    `;
}

/**
 * Load existing template
 */
async function loadTemplate(templateId) {
    console.log('loadTemplate called with ID:', templateId);
    try {
        const response = await fetch(`/api/templates/${templateId}`);
        console.log('Template API response status:', response.status);
        const result = await response.json();
        console.log('Template API result:', result);

        if (result.status === 'success') {
            const template = result.data;
            console.log('Template loaded:', template);
            document.getElementById('templateName').textContent = template.template_name;
            currentDocumentType = template.document_type_id;

            // Load template HTML from file
            if (template.template_file_path) {
                console.log('Loading template HTML from:', template.template_file_path);
                const htmlResponse = await fetch(`/${template.template_file_path}`);
                const templateHtml = await htmlResponse.text();
                console.log('Template HTML loaded, length:', templateHtml.length);

                // Extract body content from HTML
                const parser = new DOMParser();
                const doc = parser.parseFromString(templateHtml, 'text/html');
                const bodyContent = doc.body.innerHTML;

                console.log('Calling initializeEditor with body content');
                initializeEditor(bodyContent);
            } else {
                console.log('No template file path, calling initializeEditor without content');
                initializeEditor();
            }
        } else {
            console.error('Template API returned error status:', result);
            initializeEditor();
        }
    } catch (error) {
        console.error('Error loading template:', error);
        alert('Failed to load template: ' + error.message);
        initializeEditor();
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

        // Create complete HTML document
        const completeHtml = generateCompleteHTML(html, css);

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
function generateCompleteHTML(bodyHtml, css) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Receipt</title>
    <style>
        @page {
            size: A4;
            margin: 0;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 20px;
            background: white;
            font-family: Arial, sans-serif;
        }

        ${css}

        @media print {
            body {
                margin: 0;
                padding: 20px;
            }

            * {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
            }
        }

        @media screen {
            body {
                background: #f0f0f0;
                padding: 20px;
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
    const html = generateCompleteHTML(editor.getHtml(), editor.getCss());
    const previewWindow = window.open('', '_blank', 'width=800,height=600');
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
