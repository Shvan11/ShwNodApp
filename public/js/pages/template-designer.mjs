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
        <div class="receipt-container">
            <!-- Header Row -->
            <div class="header-row">
                <div class="clinic-header">
                    <div class="clinic-name">SHWAN ORTHODONTICS</div>
                    <div class="receipt-ids">Receipt #{{work.WorkID}} | Patient ID: {{patient.PersonID}}</div>
                </div>
                <div class="receipt-timestamp">
                    <div class="timestamp-label">Generated:</div>
                    <div class="timestamp-value">{{payment.PaymentDateTime|date:DD/MM/YYYY HH:mm}}</div>
                </div>
            </div>

            <!-- Two Column Main Content -->
            <div class="main-content">
                <!-- Left Column: Patient Information -->
                <div class="column-left">
                    <div class="section-header">PATIENT INFORMATION</div>
                    <div class="info-row">
                        <span class="info-label">Name:</span>
                        <span class="info-value">{{patient.PatientName}}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Phone:</span>
                        <span class="info-value">{{patient.Phone}}</span>
                    </div>

                    <!-- Next Appointment -->
                    <div class="next-appointment">
                        <div class="next-appointment-label">NEXT APPOINTMENT</div>
                        <div class="next-appointment-value">{{patient.AppDate|date:DD/MM/YYYY HH:mm|default:Not Scheduled}}</div>
                    </div>

                    <!-- Clinic Footer in Left Column -->
                    <div class="clinic-footer">
                        <div class="clinic-footer-title">Thank you for your payment!</div>
                        <div class="clinic-footer-info">Sulaymaniyah, Kurdistan - Iraq</div>
                        <div class="clinic-footer-info">Tel: +964 750 123 4567 | +964 770 987 6543</div>
                        <div class="clinic-footer-info">Keep this receipt for your records</div>
                    </div>
                </div>

                <!-- Right Column: Payment Details -->
                <div class="column-right">
                    <div class="section-header">PAYMENT DETAILS</div>
                    <table class="payment-table">
                        <tr>
                            <td class="label-col">Total Treatment Cost:</td>
                            <td class="amount-col">{{work.TotalRequired|currency}} {{work.Currency}}</td>
                        </tr>
                        <tr>
                            <td class="label-col">Previously Paid:</td>
                            <td class="amount-col">{{payment.PreviouslyPaid|currency}}</td>
                        </tr>
                        <tr class="payment-row-divider">
                            <td colspan="2"></td>
                        </tr>
                        <tr class="payment-row-highlight">
                            <td class="label-col">PAID TODAY:</td>
                            <td class="amount-col">{{payment.AmountPaidToday|currency}}</td>
                        </tr>
                        <tr class="payment-row-divider">
                            <td colspan="2"></td>
                        </tr>
                        <tr>
                            <td class="label-col">Total Paid:</td>
                            <td class="amount-col">{{payment.TotalPaid|currency}}</td>
                        </tr>
                        <tr class="payment-row-total">
                            <td class="label-col">REMAINING BALANCE:</td>
                            <td class="amount-col">{{payment.RemainingBalance|currency}}</td>
                        </tr>
                    </table>
                </div>
            </div>
        </div>
    `;
}

/**
 * Get default receipt styles (for print)
 */
function getDefaultReceiptStyles() {
    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        .receipt-container {
            width: 100%;
            max-width: 770px;
            min-height: 278px;
            background-color: #fff;
            padding: 8px;
        }

        /* Header Row */
        .header-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 6px 0;
            border-bottom: 2px solid #000;
            margin-bottom: 8px;
        }

        .clinic-header {
            flex: 1;
        }

        .clinic-name {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 3px;
        }

        .clinic-subtitle {
            font-size: 9px;
            color: #333;
        }

        .receipt-ids {
            font-size: 9px;
            color: #333;
            margin-top: 2px;
        }

        .receipt-timestamp {
            text-align: right;
            font-size: 9px;
        }

        .timestamp-label {
            font-weight: bold;
            margin-bottom: 3px;
        }

        .timestamp-value {
            color: #333;
        }

        /* Two Column Main Content */
        .main-content {
            display: flex;
            gap: 10px;
            margin-bottom: 0;
        }

        .column-left,
        .column-right {
            flex: 1;
            border: 1px solid #000;
            padding: 6px;
        }

        .section-header {
            font-size: 10px;
            font-weight: bold;
            padding: 3px 5px;
            margin-bottom: 6px;
            background-color: #000;
            color: #fff;
        }

        .info-row {
            font-size: 10px;
            margin-bottom: 4px;
            display: flex;
        }

        .info-label {
            font-weight: bold;
            min-width: 65px;
        }

        .info-value {
            flex: 1;
        }

        .next-appointment {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #000;
        }

        .next-appointment-label {
            font-size: 11px;
            font-weight: bold;
            margin-bottom: 4px;
        }

        .next-appointment-value {
            font-size: 12px;
            font-weight: bold;
        }

        .clinic-footer {
            margin-top: 8px;
            padding-top: 6px;
            border-top: 1px solid #000;
            font-size: 8px;
            text-align: center;
        }

        .clinic-footer-title {
            font-weight: bold;
            margin-bottom: 3px;
        }

        .clinic-footer-info {
            color: #333;
            margin-bottom: 1px;
        }

        /* Payment Table */
        .payment-table {
            width: 100%;
            font-size: 11px;
            border-collapse: collapse;
        }

        .payment-table td {
            padding: 4px 2px;
        }

        .payment-table .label-col {
            text-align: left;
        }

        .payment-table .amount-col {
            text-align: right;
            font-weight: bold;
        }

        .payment-row-divider {
            border-top: 1px solid #000;
        }

        .payment-row-highlight {
            background-color: #000;
            color: #fff;
        }

        .payment-row-highlight td {
            padding: 5px 3px;
            font-size: 13px;
        }

        .payment-row-total {
            border-top: 2px solid #000;
            font-size: 14px;
        }

        .payment-row-total td {
            padding: 5px 2px;
        }


        @media print {
            body {
                margin: 0;
                padding: 12px;
            }
            .gjs-dashed * {
                outline: none !important;
            }
            * {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
            }
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

        // Get current device dimensions
        const device = editor.Devices.getSelected();
        const pageWidth = device.get('width') || '794px';
        const pageHeight = device.get('height') || null;

        console.log('Saving with dimensions:', { pageWidth, pageHeight });

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
            padding: 20px;
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
