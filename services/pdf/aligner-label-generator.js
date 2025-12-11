/**
 * Aligner Label PDF Generator
 * Generates printable aligner labels using PDFKit
 *
 * Layout: OL291 - 3x4 grid (12 labels per US Letter sheet)
 * Label size: 2.5" x 2.5" (180pt x 180pt)
 *
 * @module AlignerLabelGenerator
 * @version 1.0.0
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from '../../utils/logger.js';

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hardcoded logo path (relative to project root)
const DEFAULT_LOGO_PATH = path.resolve(__dirname, '../../public/shawan logon.png');

// Arabic font paths
const ARABIC_FONTS = {
    cairo: path.resolve(__dirname, '../../fonts/Cairo/static/Cairo-Regular.ttf'),
    noto: path.resolve(__dirname, '../../fonts/NotoSansArabic.ttf'),
};

// =============================================================================
// CONSTANTS - OL291 Label Sheet Specifications
// =============================================================================

/** Labels per sheet */
const LABELS_PER_SHEET = 12;
const LABELS_PER_ROW = 3;
const LABELS_PER_COL = 4;

/** US Letter page dimensions in points (72 points = 1 inch) */
const PAGE = {
    WIDTH: 612,    // 8.5 inches
    HEIGHT: 792,   // 11 inches
};

/**
 * OL291 Label dimensions and positioning (in points, 72 points = 1 inch)
 *
 * Official OL291 Specs (US Letter 8.5" x 11"):
 * - Labels per sheet: 12 (3 columns x 4 rows)
 * - Label size: 2.5" x 2.5"
 * - Top margin: 0.25"
 * - Left margin: 0.375"
 * - Horizontal spacing (gap): 0.125"
 * - Vertical spacing (gap): 0.16667"
 * - Corner radius: 0.125"
 * - Horizontal pitch: 2.625" (label width + h gap)
 * - Vertical pitch: 2.66667" (label height + v gap)
 */
const LABEL = {
    WIDTH: 180,       // 2.5 inches = 180pt
    HEIGHT: 180,      // 2.5 inches = 180pt
    MARGIN_LEFT: 27,  // 0.375 inch = 27pt
    MARGIN_TOP: 18,   // 0.25 inch = 18pt
    GAP_H: 9,         // 0.125 inch = 9pt
    GAP_V: 12,        // 0.16667 inch = 12pt
    PADDING: 12,      // Internal padding within each label
    CORNER_RADIUS: 9, // 0.125 inch = 9pt
};

/** Typography settings */
const TYPOGRAPHY = {
    FONTS: {
        PATIENT_NAME: 14,
        DOCTOR_NAME: 12,
        SEQUENCE: 16,         // Reduced from 18 to match other text sizes
    },
    COLORS: {
        TEXT: '#000000',      // Pure black for all text
        BORDER: '#cccccc',
    },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Validate label generation parameters
 * @param {Object} params - Parameters to validate
 * @returns {{valid: boolean, error?: string}}
 */
function validateParams(params) {
    if (!params.patientName || params.patientName.trim() === '') {
        return { valid: false, error: 'Patient name is required' };
    }

    if (!params.doctorName || params.doctorName.trim() === '') {
        return { valid: false, error: 'Doctor name is required' };
    }

    const pos = params.startingPosition;
    if (!Number.isInteger(pos) || pos < 1 || pos > LABELS_PER_SHEET) {
        return { valid: false, error: `Starting position must be between 1 and ${LABELS_PER_SHEET}` };
    }

    // If custom labels array is provided, use that instead of ranges
    if (params.customLabels && Array.isArray(params.customLabels)) {
        if (params.customLabels.length === 0) {
            return { valid: false, error: 'Custom labels array cannot be empty' };
        }
        return { valid: true };
    }

    // Otherwise validate ranges
    const hasUpper = params.upperStart != null && params.upperEnd != null;
    const hasLower = params.lowerStart != null && params.lowerEnd != null;

    if (!hasUpper && !hasLower) {
        return { valid: false, error: 'At least one aligner sequence (upper or lower) is required' };
    }

    if (hasUpper && (params.upperStart < 1 || params.upperEnd < params.upperStart)) {
        return { valid: false, error: 'Invalid upper aligner range' };
    }

    if (hasLower && (params.lowerStart < 1 || params.lowerEnd < params.lowerStart)) {
        return { valid: false, error: 'Invalid lower aligner range' };
    }

    return { valid: true };
}

/**
 * Build list of labels from custom array or upper/lower ranges
 * @param {Object} params - Label parameters
 * @returns {Array<{seq: number, type: string, text: string}>}
 */
function buildLabelQueue(params) {
    // If custom labels are provided, use them directly
    if (params.customLabels && Array.isArray(params.customLabels) && params.customLabels.length > 0) {
        return params.customLabels.map((text, index) => {
            // Determine type based on text content
            let type = 'custom';
            if (text.includes('/')) {
                type = 'UL';
            } else if (text.toUpperCase().startsWith('U')) {
                type = 'U';
            } else if (text.toUpperCase().startsWith('L')) {
                type = 'L';
            }
            return { seq: index + 1, type, text };
        });
    }

    // Otherwise build from upper/lower ranges
    const labelMap = new Map();

    const hasUpper = params.upperStart != null && params.upperEnd != null;
    const hasLower = params.lowerStart != null && params.lowerEnd != null;

    // Add upper aligners
    if (hasUpper) {
        for (let i = params.upperStart; i <= params.upperEnd; i++) {
            labelMap.set(i, 'U');
        }
    }

    // Add lower aligners (may combine with upper)
    if (hasLower) {
        for (let i = params.lowerStart; i <= params.lowerEnd; i++) {
            if (labelMap.has(i)) {
                labelMap.set(i, 'UL'); // Both upper and lower
            } else {
                labelMap.set(i, 'L');
            }
        }
    }

    // Convert to sorted array
    const labels = [];
    const sortedKeys = Array.from(labelMap.keys()).sort((a, b) => a - b);

    for (const seq of sortedKeys) {
        const type = labelMap.get(seq);
        let text;

        switch (type) {
            case 'U':
                text = `U${seq}`;
                break;
            case 'L':
                text = `L${seq}`;
                break;
            case 'UL':
                text = `U${seq}/L${seq}`;
                break;
        }

        labels.push({ seq, type, text });
    }

    return labels;
}

/**
 * Calculate X,Y position for a label slot (1-12)
 * @param {number} slot - Slot number (1-12)
 * @returns {{x: number, y: number}}
 */
function getSlotPosition(slot) {
    const zeroIndex = slot - 1;
    const col = zeroIndex % LABELS_PER_ROW;
    const row = Math.floor(zeroIndex / LABELS_PER_ROW);

    const x = LABEL.MARGIN_LEFT + col * (LABEL.WIDTH + LABEL.GAP_H);
    const y = LABEL.MARGIN_TOP + row * (LABEL.HEIGHT + LABEL.GAP_V);

    return { x, y };
}

/**
 * Check if a logo file exists and is readable
 * @param {string} logoPath - Path to logo file
 * @returns {boolean}
 */
function logoExists(logoPath) {
    if (!logoPath) return false;
    try {
        fs.accessSync(logoPath, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

// =============================================================================
// LABEL GENERATOR CLASS
// =============================================================================

class AlignerLabelGenerator {
    constructor(options = {}) {
        this.showBorders = options.showBorders || false; // Debug: show label borders
    }

    /**
     * Generate label PDF
     * @param {Object} params - Label parameters
     * @param {string} params.patientName - Patient name
     * @param {string} params.doctorName - Doctor name
     * @param {number} params.startingPosition - Starting slot (1-12)
     * @param {number} [params.upperStart] - Upper aligner start sequence
     * @param {number} [params.upperEnd] - Upper aligner end sequence
     * @param {number} [params.lowerStart] - Lower aligner start sequence
     * @param {number} [params.lowerEnd] - Lower aligner end sequence
     * @param {string} [params.logoPath] - Path to doctor logo
     * @returns {Promise<{buffer: Buffer, totalLabels: number, totalPages: number, nextPosition: number}>}
     */
    async generate(params) {
        // Validate
        const validation = validateParams(params);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        // Build label queue
        const labels = buildLabelQueue(params);
        const totalLabels = labels.length;

        if (totalLabels === 0) {
            throw new Error('No labels to generate');
        }

        // Check logo - only use if explicitly provided (null means user disabled logo)
        let logoPath = params.logoPath;
        let hasLogo = false;

        if (logoPath === null || logoPath === undefined || logoPath === false) {
            // User explicitly chose no logo
            hasLogo = false;
            log.info('Logo disabled by user');
        } else if (!logoExists(logoPath)) {
            // Logo path provided but file doesn't exist - use default
            logoPath = DEFAULT_LOGO_PATH;
            hasLogo = logoExists(logoPath);
            if (hasLogo) {
                log.info('Using default logo', { logoPath });
            } else {
                log.warn('No logo file found, proceeding without logo');
            }
            params.logoPath = logoPath;
        } else {
            // Logo path provided and exists
            hasLogo = true;
        }

        log.info('Generating aligner labels', {
            patient: params.patientName,
            doctor: params.doctorName,
            totalLabels,
            startingPosition: params.startingPosition,
            hasLogo,
        });

        // Generate PDF
        const buffer = await this._generatePdf(labels, params, hasLogo);

        // Calculate next position
        const finalAbsolutePosition = params.startingPosition + totalLabels - 1;
        const nextPosition = (finalAbsolutePosition % LABELS_PER_SHEET) + 1;

        // Calculate total pages
        const availableFirstPage = LABELS_PER_SHEET - params.startingPosition + 1;
        let totalPages;
        if (totalLabels <= availableFirstPage) {
            totalPages = 1;
        } else {
            const remaining = totalLabels - availableFirstPage;
            totalPages = 1 + Math.ceil(remaining / LABELS_PER_SHEET);
        }

        log.info('Labels generated successfully', {
            patient: params.patientName,
            totalLabels,
            totalPages,
            nextPosition,
        });

        return {
            buffer,
            totalLabels,
            totalPages,
            nextPosition,
        };
    }

    /**
     * Generate the PDF document
     * @private
     */
    async _generatePdf(labels, params, hasLogo) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({
                    size: 'LETTER',
                    margin: 0,
                    info: {
                        Title: `Aligner Labels - ${params.patientName}`,
                        Author: params.doctorName,
                        Subject: 'Aligner Labels',
                        Creator: 'Aligner Label Generator v1.0',
                        CreationDate: new Date(),
                    },
                });

                // Register Arabic font based on user selection
                const selectedFontPath = ARABIC_FONTS[params.arabicFont] || ARABIC_FONTS.cairo;
                if (fs.existsSync(selectedFontPath)) {
                    doc.registerFont('ArabicFont', selectedFontPath);
                    log.info('Arabic font registered', { font: params.arabicFont, path: selectedFontPath });
                } else {
                    log.warn('Arabic font not found, falling back to Helvetica', { font: params.arabicFont, path: selectedFontPath });
                }

                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                let labelIndex = 0;
                let currentSlot = params.startingPosition;
                let isFirstPage = true;

                while (labelIndex < labels.length) {
                    if (!isFirstPage) {
                        doc.addPage();
                        currentSlot = 1;
                    }
                    isFirstPage = false;

                    // Fill labels on this page
                    while (currentSlot <= LABELS_PER_SHEET && labelIndex < labels.length) {
                        const label = labels[labelIndex];
                        const position = getSlotPosition(currentSlot);

                        this._drawLabel(doc, position, label, params, hasLogo);

                        if (this.showBorders) {
                            this._drawBorder(doc, position);
                        }

                        labelIndex++;
                        currentSlot++;
                    }
                }

                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Draw a single label
     * @private
     */
    _drawLabel(doc, position, labelData, params, hasLogo) {
        const { x, y } = position;
        const contentX = x + LABEL.PADDING;
        const contentY = y + LABEL.PADDING;
        const contentWidth = LABEL.WIDTH - (LABEL.PADDING * 2);
        const contentHeight = LABEL.HEIGHT - (LABEL.PADDING * 2);

        // Calculate vertical layout (increased spacing for Arabic text)
        const logoHeight = hasLogo ? 35 : 0;
        const logoSpacing = hasLogo ? 6 : 0;
        const patientNameHeight = TYPOGRAPHY.FONTS.PATIENT_NAME + 10;
        const doctorNameHeight = TYPOGRAPHY.FONTS.DOCTOR_NAME + 8;
        const sequenceHeight = TYPOGRAPHY.FONTS.SEQUENCE;
        const sequenceSpacing = 6;

        // Total content height
        const totalTextHeight = logoHeight + logoSpacing + patientNameHeight + doctorNameHeight + sequenceSpacing + sequenceHeight;

        // Position content higher (bias towards top, not centered)
        // Use 35% from top instead of 50% center
        const startY = contentY + (contentHeight - totalTextHeight) * 0.35;
        let currentY = startY;

        // 1. Draw logo (if available)
        if (hasLogo && params.logoPath) {
            try {
                const logoWidth = 60;
                const logoX = contentX + (contentWidth - logoWidth) / 2;
                doc.image(params.logoPath, logoX, currentY, {
                    fit: [logoWidth, logoHeight],
                    align: 'center',
                    valign: 'center',
                });
            } catch (error) {
                log.warn('Failed to draw logo', { error: error.message });
            }
            currentY += logoHeight + logoSpacing;
        }

        // Helper to detect if text contains Arabic/RTL characters
        const hasArabic = (text) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);

        // Choose font based on text content (ArabicFont is registered in _generatePdf)
        const selectedFontPath = ARABIC_FONTS[params.arabicFont] || ARABIC_FONTS.cairo;
        const arabicFont = fs.existsSync(selectedFontPath) ? 'ArabicFont' : 'Helvetica';
        const latinFont = 'Helvetica';

        // 2. Draw patient name
        const patientIsArabic = hasArabic(params.patientName);
        const patientFont = patientIsArabic ? arabicFont : latinFont;

        doc.fontSize(TYPOGRAPHY.FONTS.PATIENT_NAME)
            .fillColor(TYPOGRAPHY.COLORS.TEXT)
            .font(patientFont);

        // Get actual text height
        const patientTextHeight = doc.heightOfString(params.patientName, { width: contentWidth });

        doc.text(params.patientName, contentX, currentY, {
                width: contentWidth,
                align: 'center',
                lineBreak: false,
                features: patientIsArabic ? ['rtla'] : [],
            });
        currentY += patientTextHeight + 8;

        // 3. Draw doctor name
        const doctorIsArabic = hasArabic(params.doctorName);
        const doctorFont = doctorIsArabic ? arabicFont : 'Helvetica';

        doc.fontSize(TYPOGRAPHY.FONTS.DOCTOR_NAME)
            .fillColor(TYPOGRAPHY.COLORS.TEXT)
            .font(doctorFont);

        const doctorTextHeight = doc.heightOfString(params.doctorName, { width: contentWidth });

        doc.text(params.doctorName, contentX, currentY, {
                width: contentWidth,
                align: 'center',
                lineBreak: false,
                features: doctorIsArabic ? ['rtla'] : [],
            });
        currentY += doctorTextHeight + 10;

        // 4. Draw sequence text (largest, most prominent) - always Latin
        doc.fontSize(TYPOGRAPHY.FONTS.SEQUENCE)
            .fillColor(TYPOGRAPHY.COLORS.TEXT)
            .font('Helvetica')
            .text(labelData.text, contentX, currentY, {
                width: contentWidth,
                align: 'center',
                lineBreak: false,
            });
    }

    /**
     * Draw debug border around label
     * @private
     */
    _drawBorder(doc, position) {
        const { x, y } = position;
        doc.strokeColor(TYPOGRAPHY.COLORS.BORDER)
            .lineWidth(0.5)
            .roundedRect(x, y, LABEL.WIDTH, LABEL.HEIGHT, LABEL.CORNER_RADIUS)
            .stroke();
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    AlignerLabelGenerator,
    validateParams,
    buildLabelQueue,
    getSlotPosition,
    LABELS_PER_SHEET,
};

export default new AlignerLabelGenerator();
