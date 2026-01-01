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
// TYPES
// =============================================================================

/**
 * Appointment data from database
 */
interface AppointmentData {
  appointmentID: number | null;
  PersonID: number | null;
  AppDetail: string;
  AppDay: string;
  PatientType: string;
  PatientName: string;
  Phone: string;
  apptime: string;
  employeeName: string;
}

/**
 * PDF generation result
 */
export interface PDFResult {
  success: boolean;
  buffer: Buffer;
  appointmentCount: number;
  date: string;
  generatedAt: string;
  fileSizeBytes: number;
}

/**
 * PDF generator options
 */
export interface PDFGeneratorOptions {
  clinicName?: string;
  reportTitle?: string;
}

/**
 * Column configuration
 */
interface ColumnConfig {
  key: string;
  label: string;
  width: number;
  align?: string;
}

/**
 * Column positions map
 */
interface ColumnPositions {
  [key: string]: number;
}

/**
 * Font paths configuration
 */
interface FontPaths {
  arabic: string;
  regular: string;
  bold: string;
}

/**
 * Date format options
 */
interface DateFormatOptions {
  weekday?: 'long' | 'short' | 'narrow';
  year?: 'numeric' | '2-digit';
  month?: 'long' | 'short' | 'narrow' | 'numeric' | '2-digit';
  day?: 'numeric' | '2-digit';
}

// =============================================================================
// CONSTANTS
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/** PDF Document Configuration */
const PDF_CONFIG = {
  PAGE_SIZE: 'A4' as const,
  MARGIN: 50,
  PAGE_WIDTH: 595, // A4 width in points
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
  ] as ColumnConfig[],
};

// Calculate column X positions dynamically
const calculateColumnPositions = (): ColumnPositions => {
  const positions: ColumnPositions = {};
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
 * @param text - Text to check
 * @returns True if text contains Arabic characters
 */
const containsArabic = (text: string | null | undefined): boolean => {
  if (!text || typeof text !== 'string') return false;
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  return arabicPattern.test(text);
};

/**
 * Validate date string format
 * @param dateString - Date string to validate (YYYY-MM-DD)
 * @returns True if valid date format
 */
const isValidDate = (dateString: string | null | undefined): boolean => {
  if (!dateString || typeof dateString !== 'string') return false;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) return false;

  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date.getTime());
};

/**
 * Format date for display
 * @param dateString - Date string (YYYY-MM-DD)
 * @returns Formatted date string
 */
const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    const options: DateFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    return date.toLocaleDateString('en-US', options);
  } catch {
    return dateString;
  }
};

/**
 * Format time from HH:MM format to 12-hour format
 * @param timeString - Time string in HH:MM format
 * @returns Formatted time string (e.g., "2:30 PM")
 */
const formatTime = (timeString: string | null | undefined): string => {
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
 * @param value - Value to check
 * @param fallback - Fallback value
 * @returns String value or fallback
 */
const safeString = (value: unknown, fallback: string = 'N/A'): string => {
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
 * @returns Font paths object
 */
const getFontPaths = (): FontPaths => {
  const fontsDir = path.join(PROJECT_ROOT, 'fonts');
  const platform = process.platform;

  const fonts: FontPaths = {
    arabic: path.join(fontsDir, 'NotoSansArabic.ttf'),
    regular:
      platform === 'win32'
        ? 'C:\\Windows\\Fonts\\arial.ttf'
        : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    bold:
      platform === 'win32'
        ? 'C:\\Windows\\Fonts\\arialbd.ttf'
        : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  };

  return fonts;
};

/**
 * Verify font file exists
 * @param fontPath - Path to font file
 * @returns True if font exists
 */
const fontExists = (fontPath: string): boolean => {
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
  private clinicName: string;
  private reportTitle: string;
  private fonts: FontPaths;
  private fontRegistered: boolean;

  /**
   * Create a new AppointmentPDFGenerator instance
   * @param options - Configuration options
   */
  constructor(options: PDFGeneratorOptions = {}) {
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
  private _validateFonts(): void {
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
   * @param doc - PDFKit document instance
   */
  private _registerFonts(doc: PDFKit.PDFDocument): void {
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
      log.error('Failed to register fonts', { error: (error as Error).message });
      // Fallback to built-in font
      doc.registerFont('NotoArabic', 'Helvetica');
    }
  }

  /**
   * Fetch appointment data from ProAppsPhones stored procedure
   * @param date - Appointment date (YYYY-MM-DD)
   * @returns Array of appointment objects
   * @throws Error If date is invalid or database query fails
   */
  async fetchAppointments(date: string): Promise<AppointmentData[]> {
    if (!isValidDate(date)) {
      throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD`);
    }

    try {
      const results = await executeStoredProcedure<AppointmentData>(
        'ProAppsPhones',
        [['AppsDate', TYPES.Date, date]],
        undefined,
        (columns) => ({
          appointmentID: (columns[0]?.value as number) ?? null,
          PersonID: (columns[1]?.value as number) ?? null,
          AppDetail: (columns[2]?.value as string) ?? '',
          AppDay: (columns[3]?.value as string) ?? '',
          PatientType: (columns[4]?.value as string) ?? '',
          PatientName: (columns[5]?.value as string) ?? '',
          Phone: (columns[6]?.value as string) ?? '',
          apptime: (columns[7]?.value as string) ?? '',
          employeeName: (columns[8]?.value as string) ?? '',
        })
      );

      return (results || []) as AppointmentData[];
    } catch (error) {
      log.error('Failed to fetch appointments', {
        date,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw new Error(`Failed to fetch appointments for ${date}: ${(error as Error).message}`);
    }
  }

  /**
   * Generate PDF buffer from appointment data
   * @param appointments - Array of appointment objects
   * @param date - Appointment date for title
   * @returns PDF buffer
   */
  async generatePDF(appointments: AppointmentData[], date: string): Promise<Buffer> {
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

        const chunks: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', (error: Error) => {
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
        log.error('PDF generation failed', { error: (error as Error).message });
        reject(error);
      }
    });
  }

  /**
   * Add PDF header section
   * @private
   * @param doc - PDFKit document instance
   * @param date - Appointment date
   * @param count - Total appointment count
   */
  private _addHeader(doc: PDFKit.PDFDocument, date: string, count: number): void {
    // Reset color state
    doc.fillColor(TYPOGRAPHY.COLORS.TEXT);

    // Clinic Name
    doc.fontSize(TYPOGRAPHY.FONTS.HEADER_SIZE).font('NotoArabic').text(this.clinicName, {
      align: 'center',
    });

    doc.moveDown(0.5);

    // Report Title
    doc.fontSize(TYPOGRAPHY.FONTS.TITLE_SIZE).text(this.reportTitle, { align: 'center' });

    doc.moveDown(0.5);

    // Date and count
    doc
      .fontSize(TYPOGRAPHY.FONTS.SUBTITLE_SIZE)
      .text(`Date: ${formatDate(date)}`, { align: 'center' })
      .text(`Total Appointments: ${count}`, { align: 'center' });

    doc.moveDown(1);

    // Separator line
    const lineY = doc.y;
    doc
      .strokeColor(TYPOGRAPHY.COLORS.PRIMARY)
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
   * @param doc - PDFKit document instance
   */
  private _addFootersToAllPages(doc: PDFKit.PDFDocument): void {
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
   * @param doc - PDFKit document instance
   * @param pageNumber - Current page number (1-indexed)
   * @param totalPages - Total number of pages
   * @param generatedTime - Generation timestamp
   */
  private _addFooter(
    doc: PDFKit.PDFDocument,
    pageNumber: number,
    totalPages: number,
    generatedTime: string
  ): void {
    const footerY = doc.page.height - PDF_CONFIG.FOOTER_MARGIN;
    const footerText = `Generated on ${generatedTime}  •  Page ${pageNumber} of ${totalPages}`;

    // WORKAROUND: PDFKit auto-paginates when text is drawn near page bottom,
    // even with lineBreak: false. The 'height' option clips text and prevents
    // this behavior. This is the officially recommended workaround per
    // PDFKit Issue #198 (confirmed by Devon Govett, PDFKit creator).
    // See: https://github.com/foliojs/pdfkit/issues/198
    doc
      .fontSize(TYPOGRAPHY.FONTS.FOOTER_SIZE)
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
   * @param doc - PDFKit document instance
   * @param startY - Starting Y position
   * @returns Y position after header
   */
  private _addTableHeader(doc: PDFKit.PDFDocument, startY: number): number {
    doc
      .fontSize(TYPOGRAPHY.FONTS.TABLE_HEADER_SIZE)
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
    doc
      .strokeColor(TYPOGRAPHY.COLORS.LIGHT)
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
   * @param doc - PDFKit document instance
   * @param appointments - Array of appointment objects
   */
  private _addAppointmentsTable(doc: PDFKit.PDFDocument, appointments: AppointmentData[]): void {
    // Handle empty appointments
    if (!appointments || appointments.length === 0) {
      doc
        .fontSize(TYPOGRAPHY.FONTS.SUBTITLE_SIZE)
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
        doc
          .save()
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
   * @param doc - PDFKit document instance
   * @param appointment - Appointment data object
   * @param y - Y position for the row
   */
  private _renderTableRow(doc: PDFKit.PDFDocument, appointment: AppointmentData, y: number): void {
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
   * @param date - Appointment date (YYYY-MM-DD)
   * @returns Result object with buffer and metadata
   * @throws Error If date is invalid or generation fails
   */
  async generateAppointmentPDF(date: string): Promise<PDFResult> {
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

      const result: PDFResult = {
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
        error: (error as Error).message,
        stack: (error as Error).stack,
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
