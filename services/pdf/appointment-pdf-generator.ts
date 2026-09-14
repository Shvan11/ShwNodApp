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
import { getAppointmentsWithPhones } from '../database/queries/appointment-queries.js';
import { log } from '../../utils/logger.js';
import { formatDatePattern, formatTime12 } from '../../utils/date.js';
import { hasArabic, isReadableFile, resolveArabicFontPath } from './pdf-assets.js';
import type { PdfArabicFont } from '../../shared/pdf-fonts.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Appointment data from database
 */
interface AppointmentData {
  appointment_id: number | null;
  person_id: number | null;
  app_detail: string;
  app_day: string;
  patient_type: string;
  patient_name: string;
  phone: string;
  apptime: string;
  employee_name: string;
  checked_in: boolean;
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
  /** Registry id of the embeddable Arabic face (shared/pdf-fonts.ts). */
  arabicFont?: PdfArabicFont;
}

/**
 * Column configuration
 */
interface ColumnConfig {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  /** Cell text for a row. Declared with the column so the two can't drift. */
  value: (appointment: AppointmentData) => string;
}

/**
 * Column positions map
 */
interface ColumnPositions {
  [key: string]: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

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

/** PDFKit alias every draw call selects; bound to the Arabic TTF, else Helvetica. */
const DOC_FONT = 'DocFont';

/** Table Configuration */
const TABLE_CONFIG = {
  ROW_HEIGHT: 25,
  HEADER_UNDERLINE_OFFSET: 15,
  HEADER_HEIGHT: 20,
  START_X: PDF_CONFIG.MARGIN,
  // Widths sum to PDF_CONFIG.CONTENT_WIDTH (495) — asserted below.
  COLUMNS: [
    { key: 'time', label: 'Time', width: 62, align: 'left',
      value: (a) => formatTime12(a.apptime, true) ?? 'N/A' },
    { key: 'patient', label: 'Patient Name', width: 150, align: 'center',
      value: (a) => safeString(a.patient_name) },
    { key: 'phone', label: 'Phone', width: 100, align: 'left',
      value: (a) => safeString(a.phone) },
    { key: 'type', label: 'Type', width: 85, align: 'left',
      value: (a) => safeString(a.patient_type) },
    { key: 'detail', label: 'Detail', width: 58, align: 'left',
      value: (a) => safeString(a.app_detail) },
    // Arrivals are marked, never filtered out — see getAppointmentsWithPhones.
    { key: 'status', label: 'Status', width: 40, align: 'left',
      value: (a) => (a.checked_in ? 'In' : '') },
  ] as ColumnConfig[],
};

// Fail loudly at import if a column edit pushes the table past the printable width
// instead of silently clipping the last column on every generated report.
const TOTAL_COLUMN_WIDTH = TABLE_CONFIG.COLUMNS.reduce((sum, c) => sum + c.width, 0);
if (TOTAL_COLUMN_WIDTH > PDF_CONFIG.CONTENT_WIDTH) {
  throw new Error(
    `Appointment PDF columns total ${TOTAL_COLUMN_WIDTH}pt, exceeding the ${PDF_CONFIG.CONTENT_WIDTH}pt content width`
  );
}

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
//
// The embeddable Arabic face comes from the shared registry (shared/pdf-fonts.ts)
// so this report and the aligner labels can no longer drift onto different
// typefaces for the same patient name. `null` means no bundled TTF was readable —
// the document then falls back to PDFKit's built-in Helvetica, which renders
// Latin correctly and Arabic as tofu, and that is logged once at boot.

// =============================================================================
// PDF GENERATOR CLASS
// =============================================================================

/**
 * Generates PDF reports for appointment data
 */
class AppointmentPDFGenerator {
  private clinicName: string;
  private reportTitle: string;
  private arabicFontPath: string | null;

  /**
   * Create a new AppointmentPDFGenerator instance
   * @param options - Configuration options
   */
  constructor(options: PDFGeneratorOptions = {}) {
    this.clinicName = options.clinicName || 'Shwan Orthodontics';
    this.reportTitle = options.reportTitle || 'Daily Appointments Report';
    this.arabicFontPath = resolveArabicFontPath(options.arabicFont);

    if (!this.arabicFontPath) {
      log.warn('No bundled Arabic TTF is readable — Arabic names will render as tofu');
    }
  }

  /**
   * Register the document font under the single alias every draw call uses.
   * @private
   * @param doc - PDFKit document instance
   */
  private _registerFonts(doc: PDFKit.PDFDocument): void {
    try {
      if (this.arabicFontPath && isReadableFile(this.arabicFontPath)) {
        doc.registerFont(DOC_FONT, this.arabicFontPath);
        return;
      }
    } catch (error) {
      log.error('Failed to register Arabic font', { error: (error as Error).message });
    }
    // Built into PDFKit — always available.
    doc.registerFont(DOC_FONT, 'Helvetica');
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
      const results = await getAppointmentsWithPhones(date);

      return (results || []) as AppointmentData[];
    } catch (error) {
      log.error('Failed to fetch appointments', {
        date,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw new Error(`Failed to fetch appointments for ${date}: ${(error as Error).message}`, { cause: error });
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
    doc.fontSize(TYPOGRAPHY.FONTS.HEADER_SIZE).font(DOC_FONT).text(this.clinicName, {
      align: 'center',
    });

    doc.moveDown(0.5);

    // Report title
    doc.fontSize(TYPOGRAPHY.FONTS.TITLE_SIZE).text(this.reportTitle, { align: 'center' });

    doc.moveDown(0.5);

    // Date and count
    doc
      .fontSize(TYPOGRAPHY.FONTS.SUBTITLE_SIZE)
      .text(`Date: ${formatDatePattern(date, 'dddd, MMMM DD, YYYY')}`, { align: 'center' })
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

    // Iterate through all pages and add footer. switchToPage() takes the ABSOLUTE
    // page index, so it must be offset by range.start — that is 0 today (nothing
    // calls flushPages() early), but indexing by the loop counter would silently
    // footer the wrong pages the moment it isn't.
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(range.start + i);
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
      .font(DOC_FONT)
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
      .font(DOC_FONT)
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
        .font(DOC_FONT)
        .fillColor(TYPOGRAPHY.COLORS.MUTED)
        .text('No appointments scheduled for this date.', { align: 'center' });
      return;
    }

    // Add initial table header
    let currentY = this._addTableHeader(doc, doc.y);

    // Set font for table rows
    doc.font(DOC_FONT).fontSize(TYPOGRAPHY.FONTS.TABLE_ROW_SIZE);

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
        doc.font(DOC_FONT).fontSize(TYPOGRAPHY.FONTS.TABLE_ROW_SIZE);
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
   * Render a single table row — one pass over TABLE_CONFIG.COLUMNS, so a column's
   * width, heading and cell text all come from the same declaration. This used to
   * be five hand-written `doc.text` blocks indexing `COLUMNS[0..4]` by hand.
   * @private
   * @param doc - PDFKit document instance
   * @param appointment - Appointment data object
   * @param y - Y position for the row
   */
  private _renderTableRow(doc: PDFKit.PDFDocument, appointment: AppointmentData, y: number): void {
    for (const column of TABLE_CONFIG.COLUMNS) {
      const text = column.value(appointment);
      doc.text(text, COLUMN_POSITIONS[column.key], y, {
        width: column.width,
        align: column.align ?? 'left',
        // Arabic needs the RTL shaping feature; applying it to Latin reorders it.
        features: hasArabic(text) ? ['rtla'] : [],
        ellipsis: true,
        lineBreak: false,
      });
    }
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

// Only the singleton is consumed (routes/api/email.routes.ts); the class stays private.
const defaultGenerator = new AppointmentPDFGenerator();
export default defaultGenerator;
