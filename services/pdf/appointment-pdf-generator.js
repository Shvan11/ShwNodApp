/**
 * Appointment PDF Generator
 * Generates PDF reports from appointment data using PDFKit
 */

import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeStoredProcedure, TYPES } from '../database/index.js';
import { resolvePath } from '../../utils/path-resolver.js';

// Get project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

class AppointmentPDFGenerator {
    constructor() {
        // Font paths for Arabic/Unicode support - using cross-platform path resolution
        const fontsDir = path.join(projectRoot, 'fonts');
        const platform = process.platform;

        this.fonts = {
            // Custom Arabic font - relative to project root
            arabic: path.join(fontsDir, 'NotoSansArabic.ttf'),
            // System fonts (platform-specific fallbacks)
            regular: platform === 'win32'
                ? 'C:\\Windows\\Fonts\\arial.ttf'
                : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            bold: platform === 'win32'
                ? 'C:\\Windows\\Fonts\\arialbd.ttf'
                : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
        };

        console.log(`PDF Generator initialized with fonts:`, this.fonts);
    }

    /**
     * Check if text contains Arabic characters
     */
    isArabic(text) {
        if (!text) return false;
        const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
        return arabicPattern.test(text);
    }
    /**
     * Fetch appointment data from ProAppsPhones stored procedure
     * @param {string} date - Appointment date (YYYY-MM-DD)
     */
    async fetchAppointments(date) {
        try {
            const results = await executeStoredProcedure(
                'ProAppsPhones',
                [['AppsDate', TYPES.Date, date]],
                null, // beforeExec
                (columns) => ({ // rowMapper
                    appointmentID: columns[0].value,
                    PersonID: columns[1].value,
                    AppDetail: columns[2].value,
                    AppDay: columns[3].value,
                    PatientType: columns[4].value,
                    PatientName: columns[5].value,
                    Phone: columns[6].value,
                    apptime: columns[7].value,
                    employeeName: columns[8].value
                })
            );

            return results;
        } catch (error) {
            console.error('Failed to fetch appointments:', error);
            throw new Error(`Failed to fetch appointments for ${date}: ${error.message}`);
        }
    }

    /**
     * Generate PDF buffer from appointment data
     * @param {Array} appointments - Array of appointment objects
     * @param {string} date - Appointment date for title
     */
    async generatePDF(appointments, date) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({
                    size: 'A4',
                    margin: 50,
                    bufferPages: true, // Enable page buffering for footer
                    info: {
                        Title: `Appointments - ${date}`,
                        Author: 'Shwan Orthodontics',
                        Subject: 'Daily Appointments Report',
                        CreationDate: new Date()
                    }
                });

                // Register Noto Sans Arabic font for everything
                doc.registerFont('NotoArabic', this.fonts.arabic);

                const chunks = [];

                // Collect PDF chunks
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                // Header
                this.addHeader(doc, date, appointments.length);

                // Table
                this.addAppointmentsTable(doc, appointments);

                // Footer (must be added before doc.end())
                this.addFooter(doc);

                // Finalize PDF
                doc.end();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Add PDF header
     */
    addHeader(doc, date, count) {
        // Clinic Name
        doc.fontSize(24)
            .font('NotoArabic')
            .text('Shwan Orthodontics', { align: 'center' });

        doc.moveDown(0.5);

        // Title
        doc.fontSize(18)
            .font('NotoArabic')
            .text('Daily Appointments Report', { align: 'center' });

        doc.moveDown(0.5);

        // Date and count
        doc.fontSize(12)
            .font('NotoArabic')
            .text(`Date: ${this.formatDate(date)}`, { align: 'center' })
            .text(`Total Appointments: ${count}`, { align: 'center' });

        doc.moveDown(1);

        // Separator line
        doc.strokeColor('#0066cc')
            .lineWidth(2)
            .moveTo(50, doc.y)
            .lineTo(545, doc.y)
            .stroke();

        doc.moveDown(1);
    }

    /**
     * Add appointments table
     */
    addAppointmentsTable(doc, appointments) {
        if (!appointments || appointments.length === 0) {
            doc.fontSize(12)
                .font('NotoArabic')
                .fillColor('#666666')
                .text('No appointments scheduled for this date.', { align: 'center' });
            return;
        }

        const rowHeight = 25;
        const colWidths = {
            time: 70,
            patient: 160,
            phone: 110,
            type: 90,
            detail: 110
        };

        // Column X positions
        const colX = {
            time: 50,
            patient: 120,      // time + timeWidth
            phone: 280,        // patient + patientWidth
            type: 390,         // phone + phoneWidth
            detail: 480        // type + typeWidth
        };

        const headers = [
            { label: 'Time', width: colWidths.time },
            { label: 'Patient Name', width: colWidths.patient },
            { label: 'Phone', width: colWidths.phone },
            { label: 'Type', width: colWidths.type },
            { label: 'Detail', width: colWidths.detail }
        ];

        // Helper function to add table headers
        const addTableHeader = (startY) => {
            doc.fontSize(10)
                .font('NotoArabic')
                .fillColor('#000000');

            let x = 50;
            headers.forEach(header => {
                doc.text(header.label, x, startY, { width: header.width, align: 'left' });
                x += header.width;
            });

            // Header underline
            doc.strokeColor('#cccccc')
                .lineWidth(1)
                .moveTo(50, startY + 15)
                .lineTo(545, startY + 15)
                .stroke();

            return startY + 20; // Return Y position after header
        };

        // Add initial header
        let currentY = addTableHeader(doc.y);

        // Table rows
        doc.font('NotoArabic').fontSize(9);

        appointments.forEach((apt, index) => {
            // Calculate next row position
            const nextY = currentY + rowHeight;

            // Check if we need a new page (leave 100px margin at bottom for footer)
            if (nextY > doc.page.height - 100) {
                doc.addPage();
                currentY = addTableHeader(50);
                doc.font('NotoArabic').fontSize(9);
            }

            // Alternate row background
            if (index % 2 === 0) {
                doc.rect(50, currentY - 5, 495, rowHeight).fill('#f9f9f9');
            }

            doc.fillColor('#000000');

            // Time
            const time = this.formatTime(apt.apptime);
            doc.font('NotoArabic').text(time, colX.time, currentY, {
                width: colWidths.time,
                align: 'left',
                ellipsis: true
            });

            // Patient Name - Use same font with RTL features for consistency
            const patientName = apt.PatientName || 'N/A';
            doc.font('NotoArabic').text(patientName, colX.patient, currentY, {
                width: colWidths.patient,
                align: 'center',
                features: ['rtla'], // Enable right-to-left Arabic feature
                ellipsis: true
            });

            // Phone
            doc.font('NotoArabic').text(apt.Phone || 'N/A', colX.phone, currentY, {
                width: colWidths.phone,
                align: 'left',
                ellipsis: true
            });

            // Patient Type
            doc.font('NotoArabic').text(apt.PatientType || 'N/A', colX.type, currentY, {
                width: colWidths.type,
                align: 'left',
                ellipsis: true
            });

            // Detail
            doc.font('NotoArabic').text(apt.AppDetail || 'N/A', colX.detail, currentY, {
                width: colWidths.detail,
                align: 'left',
                ellipsis: true
            });

            // Move to next row
            currentY += rowHeight;
        });
    }

    /**
     * Add PDF footer
     */
    addFooter(doc) {
        const range = doc.bufferedPageRange();
        const pageCount = range.count;

        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);

            doc.fontSize(8)
                .font('NotoArabic')
                .fillColor('#666666')
                .text(
                    `Generated on ${new Date().toLocaleString()} | Page ${i + 1} of ${pageCount}`,
                    50,
                    doc.page.height - 50,
                    { align: 'center' }
                );
        }

        // Return to the last page
        doc.switchToPage(pageCount - 1);
    }

    /**
     * Format date for display
     */
    formatDate(dateString) {
        const date = new Date(dateString);
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        return date.toLocaleDateString('en-US', options);
    }

    /**
     * Format time from HH:MM format
     */
    formatTime(timeString) {
        if (!timeString) return 'N/A';

        // Handle HH:MM format
        const parts = timeString.split(':');
        if (parts.length >= 2) {
            let hours = parseInt(parts[0]);
            const minutes = parts[1];
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            return `${hours}:${minutes} ${ampm}`;
        }

        return timeString;
    }

    /**
     * Main method: Fetch appointments and generate PDF
     * @param {string} date - Appointment date (YYYY-MM-DD)
     */
    async generateAppointmentPDF(date) {
        try {
            console.log(`Generating appointment PDF for ${date}`);

            // Fetch appointments
            const appointments = await this.fetchAppointments(date);
            console.log(`Found ${appointments.length} appointments for ${date}`);

            // Generate PDF
            const pdfBuffer = await this.generatePDF(appointments, date);
            console.log(`PDF generated successfully (${pdfBuffer.length} bytes)`);

            return {
                success: true,
                buffer: pdfBuffer,
                appointmentCount: appointments.length,
                date: date
            };
        } catch (error) {
            console.error('Failed to generate appointment PDF:', error);
            throw error;
        }
    }
}

// Export singleton instance
export default new AppointmentPDFGenerator();
