/**
 * Appointment PDF Generator
 * Generates PDF reports from appointment data using PDFKit
 */

import PDFDocument from 'pdfkit';
import { executeStoredProcedure, TYPES } from '../database/index.js';

class AppointmentPDFGenerator {
    constructor() {
        // Font paths for Arabic/Unicode support
        this.fonts = {
            arabic: '/home/administrator/projects/ShwNodApp/fonts/NotoSansArabic.ttf',
            regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
        };
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

        const tableTop = doc.y;
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

        // Table header
        doc.fontSize(10)
            .font('NotoArabic')
            .fillColor('#000000');

        let x = 50;
        const headers = [
            { label: 'Time', width: colWidths.time },
            { label: 'Patient Name', width: colWidths.patient },
            { label: 'Phone', width: colWidths.phone },
            { label: 'Type', width: colWidths.type },
            { label: 'Detail', width: colWidths.detail }
        ];

        headers.forEach(header => {
            doc.text(header.label, x, tableTop, { width: header.width, align: 'left' });
            x += header.width;
        });

        // Header underline
        doc.strokeColor('#cccccc')
            .lineWidth(1)
            .moveTo(50, tableTop + 15)
            .lineTo(545, tableTop + 15)
            .stroke();

        // Table rows
        doc.font('NotoArabic').fontSize(9);

        appointments.forEach((apt, index) => {
            const y = tableTop + 20 + (index + 1) * rowHeight;

            // Check if we need a new page
            if (y > 700) {
                doc.addPage();
                // Re-add headers on new page
                const newTableTop = 50;
                doc.font('NotoArabic').fontSize(10);
                let newX = 50;
                headers.forEach(header => {
                    doc.text(header.label, newX, newTableTop, { width: header.width, align: 'left' });
                    newX += header.width;
                });
                doc.strokeColor('#cccccc')
                    .lineWidth(1)
                    .moveTo(50, newTableTop + 15)
                    .lineTo(545, newTableTop + 15)
                    .stroke();

                doc.font('NotoArabic').fontSize(9);
            }

            const currentY = y > 700 ? 70 : y;

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
