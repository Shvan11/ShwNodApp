/**
 * Template Renderer
 * Converts document templates to HTML for printing/display
 */

/**
 * Render a template with data
 * @param {Object} template - Template object with elements
 * @param {Object} data - Data to fill into template
 * @returns {string} - Rendered HTML
 */
export function renderTemplate(template, data) {
    if (!template || !template.elements) {
        throw new Error('Invalid template: missing template or elements');
    }

    // Sort elements by order
    const sortedElements = [...template.elements].sort((a, b) => a.element_order - b.element_order);

    // Generate CSS for the template container
    const containerStyle = `
        width: ${mmToPx(template.paper_width)}px;
        min-height: ${mmToPx(template.paper_height)}px;
        background-color: ${template.background_color || '#FFFFFF'};
        position: relative;
        margin: 0 auto;
        padding: ${template.paper_margin_top}px ${template.paper_margin_right}px ${template.paper_margin_bottom}px ${template.paper_margin_left}px;
        box-sizing: border-box;
        font-family: Arial, sans-serif;
    `;

    // Render all elements
    const elementsHTML = sortedElements
        .filter(element => element.is_visible && shouldShowElement(element, data))
        .map(element => renderElement(element, data))
        .join('\\n');

    return `
        <div class="template-container" style="${containerStyle}">
            ${elementsHTML}
        </div>
    `;
}

/**
 * Render a single element
 */
function renderElement(element, data) {
    // Check conditional display
    if (!shouldShowElement(element, data)) {
        return '';
    }

    // Get element content
    let content = getElementContent(element, data);

    // Check hide_if_empty
    if (element.hide_if_empty && (!content || content.trim() === '')) {
        return '';
    }

    // Handle repeating elements (for lists)
    if (element.is_repeating && element.repeat_data_source) {
        return renderRepeatingElement(element, data);
    }

    // Generate element style
    const style = generateElementStyle(element);

    // Wrap in appropriate tag based on element type
    return `<div class="template-element" style="${style}">${content}</div>`;
}

/**
 * Get content for an element
 */
function getElementContent(element, data) {
    switch (element.element_type) {
        case 'text':
        case 'static_text':
            return element.static_content || '';

        case 'data_field':
            const value = resolveDataBinding(element.data_binding, data);
            const formattedValue = formatValue(value, element.format_pattern, element.default_value);
            // Include label/prefix if static_content is set
            const prefix = element.static_content || '';
            return prefix + formattedValue;

        case 'image':
            const imageUrl = element.image_url || resolveDataBinding(element.image_data_binding, data);
            if (imageUrl) {
                return `<img src="${imageUrl}" style="width: 100%; height: 100%; object-fit: ${element.image_fit};" alt="${element.element_name}" />`;
            }
            return '';

        case 'line':
        case 'divider':
            return renderLine(element);

        case 'signature_line':
            return renderSignatureLine(element);

        default:
            return element.static_content || '';
    }
}

/**
 * Render a line/divider
 */
function renderLine(element) {
    const isHorizontal = element.line_orientation === 'horizontal';
    const style = isHorizontal
        ? `border-top: ${element.line_thickness || 1}px ${element.line_style || 'solid'} ${element.border_color || '#000000'}; width: 100%;`
        : `border-left: ${element.line_thickness || 1}px ${element.line_style || 'solid'} ${element.border_color || '#000000'}; height: 100%;`;

    return `<div style="${style}"></div>`;
}

/**
 * Render a signature line
 */
function renderSignatureLine(element) {
    if (!element.show_signature_line) {
        return '';
    }

    const label = element.signature_label || 'Signature';
    return `
        <div style="border-top: 1px solid #000; padding-top: 5px; margin-top: 20px;">
            ${label}
        </div>
    `;
}

/**
 * Render repeating element (for lists)
 */
function renderRepeatingElement(element, data) {
    const arrayData = resolveDataBinding(element.repeat_data_source, data);

    if (!Array.isArray(arrayData) || arrayData.length === 0) {
        return '';
    }

    const direction = element.repeat_direction || 'vertical';
    const spacing = element.repeat_spacing || 0;

    const items = arrayData.map((item, index) => {
        // Create temporary element with item data
        const itemElement = { ...element, is_repeating: false };
        const itemData = { ...data, item, index };
        return renderElement(itemElement, itemData);
    });

    const containerStyle = direction === 'vertical'
        ? `display: flex; flex-direction: column; gap: ${spacing}px;`
        : `display: flex; flex-direction: row; gap: ${spacing}px; flex-wrap: wrap;`;

    return `<div style="${containerStyle}">${items.join('')}</div>`;
}

/**
 * Generate CSS style string for an element
 */
function generateElementStyle(element) {
    const styles = [];

    // Position
    if (element.position_type === 'absolute') {
        styles.push(`position: absolute`);
        styles.push(`left: ${element.pos_x}px`);
        styles.push(`top: ${element.pos_y}px`);
    }

    // Size
    if (element.width) styles.push(`width: ${element.width}px`);
    if (element.height) styles.push(`height: ${element.height}px`);

    // Typography
    if (element.font_family) styles.push(`font-family: ${element.font_family}`);
    if (element.font_size) styles.push(`font-size: ${element.font_size}px`);
    if (element.font_weight) styles.push(`font-weight: ${element.font_weight}`);
    if (element.font_style) styles.push(`font-style: ${element.font_style}`);
    if (element.text_align) styles.push(`text-align: ${element.text_align}`);
    if (element.text_decoration) styles.push(`text-decoration: ${element.text_decoration}`);
    if (element.text_transform) styles.push(`text-transform: ${element.text_transform}`);
    if (element.text_color) styles.push(`color: ${element.text_color}`);
    if (element.line_height) styles.push(`line-height: ${element.line_height}`);
    if (element.letter_spacing) styles.push(`letter-spacing: ${element.letter_spacing}px`);
    if (element.word_spacing) styles.push(`word-spacing: ${element.word_spacing}px`);
    if (element.white_space) styles.push(`white-space: ${element.white_space}`);

    // Background
    if (element.background_color && element.background_color !== 'transparent') {
        styles.push(`background-color: ${element.background_color}`);
    }

    // Margins
    if (element.margin_top) styles.push(`margin-top: ${element.margin_top}px`);
    if (element.margin_right) styles.push(`margin-right: ${element.margin_right}px`);
    if (element.margin_bottom) styles.push(`margin-bottom: ${element.margin_bottom}px`);
    if (element.margin_left) styles.push(`margin-left: ${element.margin_left}px`);

    // Padding
    if (element.padding_top) styles.push(`padding-top: ${element.padding_top}px`);
    if (element.padding_right) styles.push(`padding-right: ${element.padding_right}px`);
    if (element.padding_bottom) styles.push(`padding-bottom: ${element.padding_bottom}px`);
    if (element.padding_left) styles.push(`padding-left: ${element.padding_left}px`);

    // Border
    if (element.border_style && element.border_style !== 'none') {
        const borderWidth = element.border_width || 1;
        styles.push(`border: ${borderWidth}px ${element.border_style} ${element.border_color || '#000000'}`);
    }
    if (element.border_radius) {
        styles.push(`border-radius: ${element.border_radius}px`);
    }

    // Display
    if (element.display_type) {
        styles.push(`display: ${element.display_type}`);
    }

    return styles.join('; ');
}

/**
 * Resolve data binding path
 * @param {string} path - Dot-notation path (e.g., 'patient.PatientName')
 * @param {Object} data - Data object
 * @returns {any} - Resolved value
 */
function resolveDataBinding(path, data) {
    if (!path || !data) {
        return null;
    }

    const keys = path.split('.');
    let value = data;

    for (const key of keys) {
        if (value === null || value === undefined) {
            return null;
        }
        value = value[key];
    }

    return value;
}

/**
 * Format a value based on format pattern
 */
function formatValue(value, formatPattern, defaultValue) {
    // If value is null/undefined, return default
    if (value === null || value === undefined || value === '') {
        return defaultValue || '';
    }

    if (!formatPattern) {
        return String(value);
    }

    // Currency formatting
    if (formatPattern === 'currency' || formatPattern.startsWith('currency')) {
        const num = parseFloat(value);
        if (isNaN(num)) return defaultValue || '0';
        return Math.round(num).toLocaleString('en-US');
    }

    // Date formatting
    if (formatPattern.startsWith('date:')) {
        const format = formatPattern.substring(5); // Remove 'date:' prefix
        return formatDate(value, format);
    }

    // Number formatting
    if (formatPattern.startsWith('number:')) {
        const num = parseFloat(value);
        if (isNaN(num)) return defaultValue || '0';
        return num.toLocaleString('en-US');
    }

    return String(value);
}

/**
 * Format date based on pattern
 */
function formatDate(dateValue, pattern) {
    if (!dateValue) return '';

    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return String(dateValue);

    // Simple date formatting (can be extended)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthsFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const replacements = {
        'YYYY': date.getFullYear(),
        'YY': String(date.getFullYear()).slice(-2),
        'MMMM': monthsFull[date.getMonth()],
        'MMM': months[date.getMonth()],
        'MM': String(date.getMonth() + 1).padStart(2, '0'),
        'DD': String(date.getDate()).padStart(2, '0'),
        'HH': String(date.getHours()).padStart(2, '0'),
        'mm': String(date.getMinutes()).padStart(2, '0'),
        'ss': String(date.getSeconds()).padStart(2, '0')
    };

    let formatted = pattern;
    for (const [key, value] of Object.entries(replacements)) {
        formatted = formatted.replace(new RegExp(key, 'g'), value);
    }

    return formatted;
}

/**
 * Check if element should be shown based on condition
 */
function shouldShowElement(element, data) {
    if (!element.show_condition) {
        return true;
    }

    try {
        // Simple condition evaluation
        // For now, just check basic comparisons
        // In production, you might want a more robust expression evaluator
        const condition = element.show_condition.trim();

        // Example: "payment.newBalance > 0"
        // Parse and evaluate the condition
        // This is a simplified version - consider using a library for complex expressions

        return true; // TODO: Implement proper condition evaluation
    } catch (error) {
        console.error('Error evaluating show_condition:', error);
        return true; // Show by default if condition fails
    }
}

/**
 * Convert millimeters to pixels (assuming 96 DPI)
 */
function mmToPx(mm) {
    return Math.round((mm * 96) / 25.4);
}

/**
 * Convert pixels to millimeters
 */
function pxToMm(px) {
    return (px * 25.4) / 96;
}

/**
 * Generate print-ready HTML with CSS
 */
export function renderTemplateToPrint(template, data) {
    const html = renderTemplate(template, data);

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${template.template_name} - Print</title>
            <style>
                @page {
                    size: ${template.paper_width}mm ${template.paper_height}mm;
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
                }

                .template-container {
                    page-break-after: always;
                }

                @media print {
                    body {
                        margin: 0;
                        padding: 0;
                    }

                    .template-container {
                        page-break-after: always;
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
            ${html}
        </body>
        </html>
    `;
}

/**
 * Generate sample data for preview
 */
export function generateSampleData(documentTypeCode) {
    const sampleData = {
        receipt: {
            patient: {
                PatientName: 'John Doe',
                Phone: '+1 (555) 123-4567',
                PersonID: 'P12345'
            },
            payment: {
                TotalRequired: 5000,
                TotalPaid: 3000,
                amountPaidToday: 1000,
                newBalance: 1000,
                Currency: 'USD',
                paymentDate: new Date().toISOString(),
                usdReceived: 1000,
                iqdReceived: 0,
                change: 0
            },
            work: {
                TypeName: 'Orthodontic Treatment',
                workid: 101,
                AppDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            },
            clinic: {
                clinicName: 'SHWAN ORTHODONTICS',
                address: 'Sulaymaniyah, Kurdistan - Iraq',
                phone1: '+964 750 123 4567',
                phone2: '+964 770 987 6543'
            },
            system: {
                receiptNumber: 'RCP-' + Date.now(),
                currentDateTime: new Date().toISOString()
            }
        },
        prescription: {
            patient: {
                PatientName: 'Jane Smith',
                Age: 28,
                PersonID: 'P54321',
                Phone: '+1 (555) 987-6543'
            },
            prescription: {
                medications: [
                    { name: 'Amoxicillin', dosage: '500mg', frequency: '3 times daily', duration: '7 days' },
                    { name: 'Ibuprofen', dosage: '400mg', frequency: 'As needed for pain', duration: '5 days' }
                ],
                diagnosis: 'Dental infection',
                instructions: 'Take with food. Complete full course of antibiotics.',
                prescriptionDate: new Date().toISOString()
            },
            doctor: {
                doctorName: 'Dr. Shwan Ahmed',
                licenseNumber: 'MD12345',
                signature: '[Signature]'
            }
        },
        referral: {
            patient: {
                PatientName: 'Bob Johnson',
                DOB: '1990-05-15',
                PersonID: 'P99999'
            },
            referral: {
                referringTo: 'Dr. Sarah Wilson - Oral Surgeon',
                referralReason: 'Impacted wisdom tooth extraction',
                clinicalFindings: 'Patient presents with partially erupted lower right wisdom tooth causing pericoronitis',
                referralDate: new Date().toISOString()
            },
            doctor: {
                doctorName: 'Dr. Shwan Ahmed',
                clinicName: 'SHWAN ORTHODONTICS'
            }
        }
    };

    return sampleData[documentTypeCode] || sampleData.receipt;
}

export default {
    renderTemplate,
    renderTemplateToPrint,
    generateSampleData,
    mmToPx,
    pxToMm
};
