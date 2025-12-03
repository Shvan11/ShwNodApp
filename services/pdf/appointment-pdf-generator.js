/**
 * Appointment PDF Generator
 * Generates PDF reports from appointment data using PDFKit
 *
 * @module AppointmentPDFGenerator
 * @version 3.0.0
 *
 * PAGINATION STRATEGY:
 * - Uses bufferPages: TRUE for clean page management
 * - Renders all content first (header, table rows with auto-pagination)
 * - Then uses switchToPage() to add footers with "Page X of Y" format
 * - Finally calls flushPages() to output the PDF
 * - Clean, maintainable, and produces perfect output
 */

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { executeStoredProcedure, TYPES } from '../database/index.js';
import { log } from '../../utils/logger.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/** PDF Document Configuration */
const PDF_CONFIG = {
    PAGE_SIZE: 'A4',
    MARGIN: 50,
    PAGE_WIDTH: 595,  // A4 width in points
    PAGE_HEIGHT: 842, // A4 height in points
    CONTENT_WIDTH: 495, // PAGE_WIDTH - (2 * MARGIN)
    FOOTER_MARGIN: 50,
    NEW_PAGE_THRESHOLD: 100, // Reserve space at bottom for footer
};

/** Typography Configuration */
const TYPOGRAPHY = {
    FONTS: {
        HEADER_SIZE: 24,
        TITLE_SIZE: 18,
        SUBTITLE_SIZE: 12,
        TABLE_HEADER_SIZE: 10,
        TABLE_ROW_SIZE: 9,
        FOOTER_SIZE: 8,
    },
    COLORS: {
        PRIMARY: '#0066cc',
        TEXT: '#000000',
        MUTED: '#666666',
        LIGHT: '#cccccc',
        ROW_ALT: '#f9f9f9',
    },
};

/** Table Configuration */
const TABLE_CONFIG = {
    ROW_HEIGHT: 25,
    HEADER_UNDERLINE_OFFSET: 15,
    HEADER_HEIGHT: 20,
    START_X: PDF_CONFIG.MARGIN,
    COLUMNS: [
        { key: 'time', label: 'Time', width: 70 },
        { key: 'patient', label: 'Patient Name', width: 160, align: 'center' },
        { key: 'phone', label: 'Phone', width: 110 },
        { key: 'type', label: 'Type', width: 90 },
        { key: 'detail', label: 'Detail', width: 65 },
    ],
};

// Calculate column X positions dynamically
const calculateColumnPositions = () => {
    const positions = {};
    let currentX = TABLE_CONFIG.START_X;

    TABLE_CONFIG.COLUMNS.forEach((col) => {
        positions[col.key] = currentX;
        currentX += col.width;
    });

    return positions;
};

const COLUMN_POSITIONS = calculateColumnPositions();

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if text contains Arabic characters
 * @param {string} text - Text to check
 * @returns {boolean} True if text contains Arabic characters
 */
const containsArabic = (text) => {
    if (!text || typeof text !== 'string') return false;
    const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
    return arabicPattern.test(text);
};

/**
 * Validate date string format
 * @param {string} dateString - Date string to validate (YYYY-MM-DD)
 * @returns {boolean} True if valid date format
 */
const isValidDate = (dateString) => {
    if (!dateString || typeof dateString !== 'string') return false;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateString)) return false;

    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
};

/**
 * Format date for display
 * @param {string} dateString - Date string (YYYY-MM-DD)
 * @returns {string} Formatted date string
 */
const formatDate = (dateString) => {
    try {
        const date = new Date(dateString);
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        return date.toLocaleDateString('en-US', options);
    } catch {
        return dateString;
    }
};

/**
 * Format time from HH:MM format to 12-hour format
 * @param {string} timeString - Time string in HH:MM format
 * @returns {string} Formatted time string (e.g., "2:30 PM")
 */
const formatTime = (timeString) => {
    if (!timeString || typeof timeString !== 'string') return 'N/A';

    const parts = timeString.split(':');
    if (parts.length < 2) return timeString;

    const hours = parseInt(parts[0], 10);
    const minutes = parts[1].padStart(2, '0');

    if (isNaN(hours)) return timeString;

    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;

    return `${displayHours}:${minutes} ${period}`;
};

/**
 * Safely get string value with fallback
 * @param {*} value - Value to check
 * @param {string} fallback - Fallback value
 * @returns {string} String value or fallback
 */
const safeString = (value, fallback = 'N/A') => {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }
    return String(value);
};

// =============================================================================
// FONT CONFIGURATION
// =============================================================================

/**
 * Get font paths based on platform with fallback support
 * @returns {Object} Font paths object
 */
const getFontPaths = () => {
    const fontsDir = path.join(PROJECT_ROOT, 'fonts');
    const platform = process.platform;

    const fonts = {
        arabic: path.join(fontsDir, 'NotoSansArabic.ttf'),
        regular: platform === 'win32'
            ? 'C:\\Windows\\Fonts\\arial.ttf'
            : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        bold: platform === 'win32'
            ? 'C:\\Windows\\Fonts\\arialbd.ttf'
            : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    };

    return fonts;
};

/**
 * Verify font file exists
 * @param {string} fontPath - Path to font file
 * @returns {boolean} True if font exists
 */
const fontExists = (fontPath) => {
    try {
        fs.accessSync(fontPath, fs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
};

// =============================================================================
// PDF GENERATOR CLASS
// =============================================================================

/**
 * Generates PDF reports for appointment data
 */
class AppointmentPDFGenerator {
    /**
     * Create a new AppointmentPDFGenerator instance
     * @param {Object} options - Configuration options
     * @param {string} options.clinicName - Name of the clinic
     * @param {string} options.reportTitle - Title for the report
     */
    constructor(options = {}) {
        this.clinicName = options.clinicName || 'Shwan Orthodontics';
        this.reportTitle = options.reportTitle || 'Daily Appointments Report';
        this.fonts = getFontPaths();
        this.fontRegistered = false;

        this._validateFonts();
    }

    /**
     * Validate that required fonts exist
     * @private
     */
    _validateFonts() {
        if (!fontExists(this.fonts.arabic)) {
            log.warn('Arabic font not found, falling back to system font', {
                expected: this.fonts.arabic,
            });
            // Fallback to regular font if Arabic font is missing
            this.fonts.arabic = this.fonts.regular;
        }

        log.info('PDF Generator initialized', {
            fonts: this.fonts,
            arabicFontAvailable: fontExists(this.fonts.arabic),
        });
    }

    /**
     * Register fonts with the PDF document
     * @private
     * @param {PDFDocument} doc - PDFKit document instance
     */
    _registerFonts(doc) {
        try {
            if (fontExists(this.fonts.arabic)) {
                doc.registerFont('NotoArabic', this.fonts.arabic);
                this.fontRegistered = true;
            } else {
                // Use Helvetica as ultimate fallback (built into PDFKit)
                doc.registerFont('NotoArabic', 'Helvetica');
                log.warn('Using Helvetica as font fallback');
            }
        } catch (error) {
            log.error('Failed to register fonts', { error: error.message });
            // Fallback to built-in font
            doc.registerFont('NotoArabic', 'Helvetica');
        }
    }

    /**
     * Fetch appointment data from ProAppsPhones stored procedure
     * @param {string} date - Appointment date (YYYY-MM-DD)
     * @returns {Promise<Array>} Array of appointment objects
     * @throws {Error} If date is invalid or database query fails
     */
    async fetchAppointments(date) {
        if (!isValidDate(date)) {
            throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD`);
        }

        try {
            const results = await executeStoredProcedure(
                'ProAppsPhones',
                [['AppsDate', TYPES.Date, date]],
                null,
                (columns) => ({
                    appointmentID: columns[0]?.value ?? null,
                    PersonID: columns[1]?.value ?? null,
                    AppDetail: columns[2]?.value ?? '',
                    AppDay: columns[3]?.value ?? '',
                    PatientType: columns[4]?.value ?? '',
                    PatientName: columns[5]?.value ?? '',
                    Phone: columns[6]?.value ?? '',
                    apptime: columns[7]?.value ?? '',
                    employeeName: columns[8]?.value ?? '',
                })
            );

            return results || [];
        } catch (error) {
            log.error('Failed to fetch appointments', {
                date,
                error: error.message,
                stack: error.stack,
            });
            throw new Error(`Failed to fetch appointments for ${date}: ${error.message}`);
        }
    }

    /**
     * Generate PDF buffer from appointment data
     * @param {Array} appointments - Array of appointment objects
     * @param {string} date - Appointment date for title
     * @returns {Promise<Buffer>} PDF buffer
     */
    async generatePDF(appointments, date) {
        return new Promise((resolve, reject) => {
            try {
                // Create document with page buffering enabled
                // This allows us to add footers after all content is rendered
                const doc = new PDFDocument({
                    size: PDF_CONFIG.PAGE_SIZE,
                    margin: PDF_CONFIG.MARGIN,
                    bufferPages: true, // Enable page buffering for switchToPage()
                    autoFirstPage: false,
                    info: {
                        Title: `Appointments - ${date}`,
                        Author: this.clinicName,
                        Subject: this.reportTitle,
                        Creator: 'AppointmentPDFGenerator v3.0',
                        CreationDate: new Date(),
                    },
                });

                // Register fonts
                this._registerFonts(doc);

                const chunks = [];

                doc.on('data', (chunk) => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', (error) => {
                    log.error('PDF generation error', { error: error.message });
                    reject(error);
                });

                // Add first page
                doc.addPage();

                // Add header
                this._addHeader(doc, date, appointments.length);

                // Add appointments table (content only, no footers yet)
                this._addAppointmentsTable(doc, appointments);

                // Now add footers to all pages using switchToPage()
                this._addFootersToAllPages(doc);

                // Finalize PDF - flushPages() is called automatically by end()
                doc.end();

            } catch (error) {
                log.error('PDF generation failed', { error: error.message });
                reject(error);
            }
        });
    }

    /**
     * Add PDF header section
     * @private
     * @param {PDFDocument} doc - PDFKit document instance
     * @param {string} date - Appointment date
     * @param {number} count - Total appointment count
     */
    _addHeader(doc, date, count) {
        // Reset color state
        doc.fillColor(TYPOGRAPHY.COLORS.TEXT);

        // Clinic Name
        doc.fontSize(TYPOGRAPHY.FONTS.HEADER_SIZE)
            .font('NotoArabic')
            .text(this.clinicName, { align: 'center' });

        doc.moveDown(0.5);

        // Report Title
        doc.fontSize(TYPOGRAPHY.FONTS.TITLE_SIZE)
            .text(this.reportTitle, { align: 'center' });

        doc.moveDown(0.5);

        // Date and count
        doc.fontSize(TYPOGRAPHY.FONTS.SUBTITLE_SIZE)
            .text(`Date: ${formatDate(date)}`, { align: 'center' })
            .text(`Total Appointments: ${count}`, { align: 'center' });

        doc.moveDown(1);

        // Separator line
        const lineY = doc.y;
        doc.strokeColor(TYPOGRAPHY.COLORS.PRIMARY)
            .lineWidth(2)
            .moveTo(PDF_CONFIG.MARGIN, lineY)
            .lineTo(PDF_CONFIG.PAGE_WIDTH - PDF_CONFIG.MARGIN, lineY)
            .stroke();

        doc.moveDown(1);
    }

    /**
     * Add footers to all buffered pages using switchToPage()
     * This is called after all content is rendered, so we know the total page count
     * @private
     * @param {PDFDocument} doc - PDFKit document instance
     */
    _addFootersToAllPages(doc) {
        const generatedTime = new Date().toLocaleString();

        // Get the range of buffered pages
        const range = doc.bufferedPageRange();
        const totalPages = range.count;

        log.debug('Adding footers to pages', {
            start: range.start,
            count: range.count,
        });

        // Iterate through all pages and add footer
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(i);
            this._addFooter(doc, i + 1, totalPages, generatedTime);
        }
    }

    /**
     * Add footer to the current page
     * @private
     * @param {PDFDocument} doc - PDFKit document instance
     * @param {number} pageNumber - Current page number (1-indexed)
     * @param {number} totalPages - Total number of pages
     * @param {string} generatedTime - Generation timestamp
     */
    _addFooter(doc, pageNumber, totalPages, generatedTime) {
        const footerY = doc.page.height - PDF_CONFIG.FOOTER_MARGIN;
        const footerText = `Generated on ${generatedTime}  •  Page ${pageNumber} of ${totalPages}`;

        // WORKAROUND: PDFKit auto-paginates when text is drawn near page bottom,
        // even with lineBreak: false. The 'height' option clips text and prevents
        // this behavior. This is the officially recommended workaround per
        // PDFKit Issue #198 (confirmed by Devon Govett, PDFKit creator).
        // See: https://github.com/foliojs/pdfkit/issues/198
        doc.fontSize(TYPOGRAPHY.FONTS.FOOTER_SIZE)
            .font('NotoArabic')
            .fillColor(TYPOGRAPHY.COLORS.MUTED)
            .text(footerText, PDF_CONFIG.MARGIN, footerY, {
                width: PDF_CONFIG.CONTENT_WIDTH,
                height: 20,
                align: 'center',
                lineBreak: false,
            });
    }

    /**
     * Add table header row
     * @private
     * @param {PDFDocument} doc - PDFKit document instance
     * @param {number} startY - Starting Y position
     * @returns {number} Y position after header
     */
    _addTableHeader(doc, startY) {
        doc.fontSize(TYPOGRAPHY.FONTS.TABLE_HEADER_SIZE)
            .font('NotoArabic')
            .fillColor(TYPOGRAPHY.COLORS.TEXT);

        let x = TABLE_CONFIG.START_X;

        TABLE_CONFIG.COLUMNS.forEach((column) => {
            doc.text(column.label, x, startY, {
                width: column.width,
                align: 'left',
                lineBreak: false,
            });
            x += column.width;
        });

        // Header underline
        const underlineY = startY + TABLE_CONFIG.HEADER_UNDERLINE_OFFSET;
        doc.strokeColor(TYPOGRAPHY.COLORS.LIGHT)
            .lineWidth(1)
            .moveTo(TABLE_CONFIG.START_X, underlineY)
            .lineTo(PDF_CONFIG.PAGE_WIDTH - PDF_CONFIG.MARGIN, underlineY)
            .stroke();

        return startY + TABLE_CONFIG.HEADER_HEIGHT;
    }

    /**
     * Add appointments table with automatic pagination
     * Renders content only - footers are added separately via switchToPage()
     * @private
     * @param {PDFDocument} doc - PDFKit document instance
     * @param {Array} appointments - Array of appointment objects
     */
    _addAppointmentsTable(doc, appointments) {
        // Handle empty appointments
        if (!appointments || appointments.length === 0) {
            doc.fontSize(TYPOGRAPHY.FONTS.SUBTITLE_SIZE)
                .font('NotoArabic')
                .fillColor(TYPOGRAPHY.COLORS.MUTED)
                .text('No appointments scheduled for this date.', { align: 'center' });
            return;
        }

        // Add initial table header
        let currentY = this._addTableHeader(doc, doc.y);

        // Set font for table rows
        doc.font('NotoArabic').fontSize(TYPOGRAPHY.FONTS.TABLE_ROW_SIZE);

        // Iterate through appointments
        appointments.forEach((apt, index) => {
            const nextY = currentY + TABLE_CONFIG.ROW_HEIGHT;
            const pageBottom = doc.page.height - PDF_CONFIG.NEW_PAGE_THRESHOLD;

            // Check if we need a new page
            if (nextY > pageBottom) {
                doc.addPage();

                // Add header on new page
                currentY = this._addTableHeader(doc, PDF_CONFIG.MARGIN);

                // Reset font for rows
                doc.font('NotoArabic').fontSize(TYPOGRAPHY.FONTS.TABLE_ROW_SIZE);
            }

            // Add alternating row background
            if (index % 2 === 0) {
                doc.save()
                    .fillColor(TYPOGRAPHY.COLORS.ROW_ALT)
                    .rect(
                        TABLE_CONFIG.START_X,
                        currentY - 5,
                        PDF_CONFIG.CONTENT_WIDTH,
                        TABLE_CONFIG.ROW_HEIGHT
                    )
                    .fill()
                    .restore();
            }

            // Reset text color after background
            doc.fillColor(TYPOGRAPHY.COLORS.TEXT);

            // Render row cells
            this._renderTableRow(doc, apt, currentY);

            // Move to next row
            currentY += TABLE_CONFIG.ROW_HEIGHT;
        });
    }

    /**
     * Render a single table row
     * @private
     * @param {PDFDocument} doc - PDFKit document instance
     * @param {Object} appointment - Appointment data object
     * @param {number} y - Y position for the row
     */
    _renderTableRow(doc, appointment, y) {
        const textOptions = { ellipsis: true, lineBreak: false };

        // Time column
        const time = formatTime(appointment.apptime);
        doc.text(time, COLUMN_POSITIONS.time, y, {
            width: TABLE_CONFIG.COLUMNS[0].width,
            align: 'left',
            ...textOptions,
        });

        // Patient Name column (with RTL support for Arabic)
        const patientName = safeString(appointment.PatientName);
        const isArabicName = containsArabic(patientName);

        doc.text(patientName, COLUMN_POSITIONS.patient, y, {
            width: TABLE_CONFIG.COLUMNS[1].width,
            align: 'center',
            features: isArabicName ? ['rtla'] : [],
            ...textOptions,
        });

        // Phone column
        doc.text(safeString(appointment.Phone), COLUMN_POSITIONS.phone, y, {
            width: TABLE_CONFIG.COLUMNS[2].width,
            align: 'left',
            ...textOptions,
        });

        // Patient Type column
        doc.text(safeString(appointment.PatientType), COLUMN_POSITIONS.type, y, {
            width: TABLE_CONFIG.COLUMNS[3].width,
            align: 'left',
            ...textOptions,
        });

        // Detail column
        doc.text(safeString(appointment.AppDetail), COLUMN_POSITIONS.detail, y, {
            width: TABLE_CONFIG.COLUMNS[4].width,
            align: 'left',
            ...textOptions,
        });
    }

    /**
     * Main method: Fetch appointments and generate PDF
     * @param {string} date - Appointment date (YYYY-MM-DD)
     * @returns {Promise<Object>} Result object with buffer and metadata
     * @throws {Error} If date is invalid or generation fails
     */
    async generateAppointmentPDF(date) {
        if (!isValidDate(date)) {
            throw new Error(`Invalid date format: "${date}". Expected format: YYYY-MM-DD`);
        }

        try {
            log.info('Generating appointment PDF', { date });

            // Fetch appointments
            const appointments = await this.fetchAppointments(date);
            log.info('Appointments fetched', { count: appointments.length, date });

            // Generate PDF
            const pdfBuffer = await this.generatePDF(appointments, date);

            const result = {
                success: true,
                buffer: pdfBuffer,
                appointmentCount: appointments.length,
                date,
                generatedAt: new Date().toISOString(),
                fileSizeBytes: pdfBuffer.length,
            };

            log.info('PDF generated successfully', {
                size: pdfBuffer.length,
                appointmentCount: appointments.length,
                date,
            });

            return result;
        } catch (error) {
            log.error('Failed to generate appointment PDF', {
                date,
                error: error.message,
                stack: error.stack,
            });
            throw error;
        }
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

// Export class for custom instantiation
export { AppointmentPDFGenerator };

// Export default singleton for convenience
const defaultGenerator = new AppointmentPDFGenerator();
export default defaultGenerator;

// Export utility functions for testing
export { formatDate, formatTime, containsArabic, isValidDate, safeString };
