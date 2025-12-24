/**
 * Aligner Label PDF Generator
 * Generates printable aligner labels using PDFKit
 *
 * Layout: OL291 - 3x4 grid (12 labels per US Letter sheet)
 * Label size: 2.5" x 2.5" (180pt x 180pt)
 *
 * All labels are "rich labels" containing their own patient/doctor info.
 *
 * @module AlignerLabelGenerator
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default logo path
const DEFAULT_LOGO_PATH = path.resolve(__dirname, '../../public/shawan logon.png');

// Arabic font paths
const ARABIC_FONTS = {
    cairo: path.resolve(__dirname, '../../fonts/Cairo/static/Cairo-Regular.ttf'),
    noto: path.resolve(__dirname, '../../fonts/NotoSansArabic.ttf'),
};

// =============================================================================
// CONSTANTS - OL291 Label Sheet Specifications
// =============================================================================

const LABELS_PER_SHEET = 12;
const LABELS_PER_ROW = 3;

const LABEL = {
    WIDTH: 180,       // 2.5 inches = 180pt
    HEIGHT: 180,      // 2.5 inches = 180pt
    MARGIN_LEFT: 27,  // 0.375 inch = 27pt
    MARGIN_TOP: 18,   // 0.25 inch = 18pt
    GAP_H: 9,         // 0.125 inch = 9pt
    GAP_V: 12,        // 0.16667 inch = 12pt
    PADDING: 12,
};

const TYPOGRAPHY = {
    FONTS: {
        PATIENT_NAME: 14,
        DOCTOR_NAME: 12,
        SEQUENCE: 16,
    },
    COLORS: {
        TEXT: '#000000',
        BORDER: '#cccccc',
    },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if a logo file exists and is readable
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

/**
 * Get logo path - returns default if provided path doesn't exist
 */
function getLogoPath(requestedPath) {
    if (logoExists(requestedPath)) return requestedPath;
    if (logoExists(DEFAULT_LOGO_PATH)) return DEFAULT_LOGO_PATH;
    return null;
}

/**
 * Calculate X,Y position for a label slot (1-12)
 */
function getSlotPosition(slot) {
    const zeroIndex = slot - 1;
    const col = zeroIndex % LABELS_PER_ROW;
    const row = Math.floor(zeroIndex / LABELS_PER_ROW);

    return {
        x: LABEL.MARGIN_LEFT + col * (LABEL.WIDTH + LABEL.GAP_H),
        y: LABEL.MARGIN_TOP + row * (LABEL.HEIGHT + LABEL.GAP_V),
    };
}

/**
 * Detect if text contains Arabic/RTL characters
 */
function hasArabic(text) {
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

/**
 * Determine label type from text
 */
function getLabelType(text) {
    if (text.includes('/')) return 'UL';
    if (text.toUpperCase().startsWith('U')) return 'U';
    if (text.toUpperCase().startsWith('L')) return 'L';
    return 'custom';
}

// =============================================================================
// LABEL GENERATOR CLASS
// =============================================================================

class AlignerLabelGenerator {
    constructor(options = {}) {
        this.showBorders = options.showBorders || false;
    }

    /**
     * Generate label PDF from rich label objects
     *
     * @param {Object} params
     * @param {Array<Object>} params.labels - Array of rich label objects
     * @param {string} params.labels[].text - Label text (e.g., "U1/L1")
     * @param {string} params.labels[].patientName - Patient name for this label
     * @param {string} params.labels[].doctorName - Doctor name for this label
     * @param {boolean} params.labels[].includeLogo - Whether to show logo on this label
     * @param {number} params.startingPosition - Starting slot (1-12)
     * @param {string} [params.arabicFont='cairo'] - Arabic font choice
     * @param {string} [params.logoPath] - Path to logo file
     * @returns {Promise<{buffer: Buffer, totalLabels: number, totalPages: number, nextPosition: number}>}
     */
    async generate(params) {
        const { labels, startingPosition, arabicFont = 'cairo', logoPath } = params;

        // Validate
        if (!labels || !Array.isArray(labels) || labels.length === 0) {
            throw new Error('Labels array is required and cannot be empty');
        }

        if (!Number.isInteger(startingPosition) || startingPosition < 1 || startingPosition > LABELS_PER_SHEET) {
            throw new Error(`Starting position must be between 1 and ${LABELS_PER_SHEET}`);
        }

        // Validate each label has required fields
        for (let i = 0; i < labels.length; i++) {
            const label = labels[i];
            if (!label.text) {
                throw new Error(`Label at index ${i} is missing required 'text' field`);
            }
            if (!label.patientName) {
                throw new Error(`Label at index ${i} is missing required 'patientName' field`);
            }
        }

        const totalLabels = labels.length;
        const resolvedLogoPath = getLogoPath(logoPath);

        log.info('Generating aligner labels', {
            totalLabels,
            startingPosition,
            hasLogo: !!resolvedLogoPath,
        });

        // Generate PDF
        const buffer = await this._generatePdf(labels, {
            startingPosition,
            arabicFont,
            logoPath: resolvedLogoPath,
        });

        // Calculate stats
        const finalAbsolutePosition = startingPosition + totalLabels - 1;
        const nextPosition = (finalAbsolutePosition % LABELS_PER_SHEET) + 1;
        const availableFirstPage = LABELS_PER_SHEET - startingPosition + 1;
        const totalPages = totalLabels <= availableFirstPage
            ? 1
            : 1 + Math.ceil((totalLabels - availableFirstPage) / LABELS_PER_SHEET);

        log.info('Labels generated successfully', { totalLabels, totalPages, nextPosition });

        return { buffer, totalLabels, totalPages, nextPosition };
    }

    /**
     * Generate the PDF document
     * @private
     */
    async _generatePdf(labels, config) {
        return new Promise((resolve, reject) => {
            try {
                // Get first label info for PDF metadata
                const firstLabel = labels[0];

                const doc = new PDFDocument({
                    size: 'LETTER',
                    margin: 0,
                    info: {
                        Title: `Aligner Labels - ${firstLabel.patientName}`,
                        Subject: 'Aligner Labels',
                        Creator: 'Aligner Label Generator',
                        CreationDate: new Date(),
                    },
                });

                // Register Arabic font
                const fontPath = ARABIC_FONTS[config.arabicFont] || ARABIC_FONTS.cairo;
                if (fs.existsSync(fontPath)) {
                    doc.registerFont('ArabicFont', fontPath);
                }

                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                let labelIndex = 0;
                let currentSlot = config.startingPosition;
                let isFirstPage = true;

                while (labelIndex < labels.length) {
                    if (!isFirstPage) {
                        doc.addPage();
                        currentSlot = 1;
                    }
                    isFirstPage = false;

                    while (currentSlot <= LABELS_PER_SHEET && labelIndex < labels.length) {
                        const label = labels[labelIndex];
                        const position = getSlotPosition(currentSlot);

                        this._drawLabel(doc, position, label, config);

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
    _drawLabel(doc, position, label, config) {
        const { x, y } = position;
        const contentX = x + LABEL.PADDING;
        const contentY = y + LABEL.PADDING;
        const contentWidth = LABEL.WIDTH - (LABEL.PADDING * 2);
        const contentHeight = LABEL.HEIGHT - (LABEL.PADDING * 2);

        // Extract label data
        const { text, patientName, doctorName = '', includeLogo = false } = label;
        const showLogo = includeLogo && config.logoPath;

        // Calculate layout
        const logoHeight = showLogo ? 35 : 0;
        const logoSpacing = showLogo ? 6 : 0;
        const totalTextHeight = logoHeight + logoSpacing +
            TYPOGRAPHY.FONTS.PATIENT_NAME + 10 +
            TYPOGRAPHY.FONTS.DOCTOR_NAME + 8 +
            6 + TYPOGRAPHY.FONTS.SEQUENCE;

        const startY = contentY + (contentHeight - totalTextHeight) * 0.35;
        let currentY = startY;

        // 1. Draw logo
        if (showLogo) {
            try {
                const logoWidth = 60;
                const logoX = contentX + (contentWidth - logoWidth) / 2;
                doc.image(config.logoPath, logoX, currentY, {
                    fit: [logoWidth, logoHeight],
                    align: 'center',
                    valign: 'center',
                });
            } catch (error) {
                log.warn('Failed to draw logo', { error: error.message });
            }
            currentY += logoHeight + logoSpacing;
        }

        // Font selection
        const fontPath = ARABIC_FONTS[config.arabicFont] || ARABIC_FONTS.cairo;
        const arabicFont = fs.existsSync(fontPath) ? 'ArabicFont' : 'Helvetica';

        // 2. Draw patient name
        const patientIsArabic = hasArabic(patientName);
        doc.fontSize(TYPOGRAPHY.FONTS.PATIENT_NAME)
            .fillColor(TYPOGRAPHY.COLORS.TEXT)
            .font(patientIsArabic ? arabicFont : 'Helvetica');

        const patientTextHeight = doc.heightOfString(patientName, { width: contentWidth });
        doc.text(patientName, contentX, currentY, {
            width: contentWidth,
            align: 'center',
            lineBreak: false,
            features: patientIsArabic ? ['rtla'] : [],
        });
        currentY += patientTextHeight + 8;

        // 3. Draw doctor name
        if (doctorName) {
            const doctorIsArabic = hasArabic(doctorName);
            doc.fontSize(TYPOGRAPHY.FONTS.DOCTOR_NAME)
                .fillColor(TYPOGRAPHY.COLORS.TEXT)
                .font(doctorIsArabic ? arabicFont : 'Helvetica');

            const doctorTextHeight = doc.heightOfString(doctorName, { width: contentWidth });
            doc.text(doctorName, contentX, currentY, {
                width: contentWidth,
                align: 'center',
                lineBreak: false,
                features: doctorIsArabic ? ['rtla'] : [],
            });
            currentY += doctorTextHeight + 10;
        } else {
            currentY += 10;
        }

        // 4. Draw sequence text
        doc.fontSize(TYPOGRAPHY.FONTS.SEQUENCE)
            .fillColor(TYPOGRAPHY.COLORS.TEXT)
            .font('Helvetica')
            .text(text, contentX, currentY, {
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
            .roundedRect(x, y, LABEL.WIDTH, LABEL.HEIGHT, 9)
            .stroke();
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { AlignerLabelGenerator, getSlotPosition, getLabelType, LABELS_PER_SHEET };
export default new AlignerLabelGenerator();
