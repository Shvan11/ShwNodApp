/**
 * Email Service - Handles email sending with Nodemailer
 * Uses database configuration from tbloptions table
 */

import nodemailer from 'nodemailer';
import { executeQuery, TYPES } from '../database/index.js';

class EmailService {
    constructor() {
        this.transporter = null;
        this.config = null;
    }

    /**
     * Load email configuration from database
     */
    async loadConfig() {
        try {
            const query = `
                SELECT OptionName, OptionValue
                FROM tbloptions
                WHERE OptionName LIKE 'EMAIL_%'
            `;

            const results = await executeQuery(
                query,
                [],
                (columns) => ({
                    OptionName: columns[0].value,
                    OptionValue: columns[1].value
                })
            );

            // Convert array to config object
            const config = {};
            results.forEach(row => {
                const key = row.OptionName.replace('EMAIL_', '').toLowerCase();
                config[key] = row.OptionValue;
            });

            // Parse port as integer
            if (config.smtp_port) {
                config.smtp_port = parseInt(config.smtp_port);
            }

            // Parse secure as boolean
            if (config.smtp_secure) {
                config.smtp_secure = config.smtp_secure === 'true';
            }

            this.config = config;
            console.log('Email configuration loaded successfully');
            return config;
        } catch (error) {
            console.error('Failed to load email configuration:', error);
            throw new Error('Email configuration not available');
        }
    }

    /**
     * Initialize nodemailer transporter
     */
    async initialize() {
        if (!this.config) {
            await this.loadConfig();
        }

        if (!this.config.smtp_user || !this.config.smtp_password) {
            throw new Error('Email credentials not configured in database');
        }

        this.transporter = nodemailer.createTransport({
            host: this.config.smtp_host || 'smtp.gmail.com',
            port: this.config.smtp_port || 465,
            secure: this.config.smtp_secure !== false, // true for 465, false for other ports
            auth: {
                user: this.config.smtp_user,
                pass: this.config.smtp_password,
            },
            tls: {
                rejectUnauthorized: false // For development - set to true in production
            }
        });

        console.log('Email transporter initialized');
        return this.transporter;
    }

    /**
     * Get employee email recipients from database
     * Uses the unified /api/employees endpoint with receiveEmail filter
     */
    async getEmployeeRecipients() {
        try {
            // Query employees with receiveEmail = true and valid email addresses
            const query = `
                SELECT e.ID, e.employeeName, e.Email
                FROM tblEmployees e
                WHERE e.receiveEmail = 1
                  AND e.Email IS NOT NULL
                  AND e.Email != ''
                ORDER BY e.employeeName
            `;

            const recipients = await executeQuery(
                query,
                [],
                (columns) => ({
                    ID: columns[0].value,
                    employeeName: columns[1].value,
                    Email: columns[2].value
                })
            );

            return recipients || [];
        } catch (error) {
            console.error('Failed to get employee recipients:', error);
            return [];
        }
    }

    /**
     * Send email with optional PDF attachment
     * @param {Object} options - Email options
     * @param {string} options.to - Recipient email(s) (optional - will use employee recipients if not provided)
     * @param {string} options.subject - Email subject
     * @param {string} options.html - HTML content
     * @param {string} options.text - Plain text content
     * @param {Buffer} options.pdfBuffer - PDF attachment buffer
     * @param {string} options.pdfFilename - PDF filename
     * @param {boolean} options.useEmployeeRecipients - If true, send to all eligible employees (default: true)
     */
    async sendEmail(options) {
        try {
            if (!this.transporter) {
                await this.initialize();
            }

            // Determine recipients
            let recipients = options.to;

            // If no recipients specified or explicitly requesting employee recipients, fetch from database
            if (!recipients || options.useEmployeeRecipients !== false) {
                const employees = await this.getEmployeeRecipients();
                if (employees.length > 0) {
                    recipients = employees.map(emp => emp.Email).join(', ');
                    console.log(`Sending email to ${employees.length} employee(s):`, employees.map(e => e.employeeName).join(', '));
                } else if (!recipients) {
                    throw new Error('No recipients configured. Please enable "Receive Email" for at least one employee in Settings > Employees.');
                }
            }

            const mailOptions = {
                from: {
                    name: this.config.from_name || 'Shwan Orthodontics',
                    address: this.config.from_address || this.config.smtp_user
                },
                to: recipients,
                subject: options.subject,
                text: options.text,
                html: options.html
            };

            // Add PDF attachment if provided
            if (options.pdfBuffer) {
                mailOptions.attachments = [{
                    filename: options.pdfFilename || 'appointments.pdf',
                    content: options.pdfBuffer,
                    contentType: 'application/pdf'
                }];
            }

            const info = await this.transporter.sendMail(mailOptions);

            console.log('Email sent successfully:', {
                messageId: info.messageId,
                to: mailOptions.to,
                subject: mailOptions.subject
            });

            return {
                success: true,
                messageId: info.messageId,
                response: info.response
            };
        } catch (error) {
            console.error('Failed to send email:', error);
            throw error;
        }
    }

    /**
     * Test email configuration
     */
    async testConnection() {
        try {
            if (!this.transporter) {
                await this.initialize();
            }

            await this.transporter.verify();
            console.log('Email connection test successful');
            return { success: true, message: 'Email configuration is valid' };
        } catch (error) {
            console.error('Email connection test failed:', error);
            return {
                success: false,
                message: error.message,
                error: error.toString()
            };
        }
    }

    /**
     * Get current email configuration (with masked password)
     */
    getConfig() {
        if (!this.config) {
            return null;
        }

        return {
            ...this.config,
            smtp_password: '********' // Mask password
        };
    }

    /**
     * Update email configuration in database
     */
    async updateConfig(newConfig) {
        try {
            const updates = [];
            const validKeys = [
                'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user',
                'smtp_password', 'from_address', 'from_name'
            ];

            for (const [key, value] of Object.entries(newConfig)) {
                if (validKeys.includes(key.toLowerCase())) {
                    const optionName = `EMAIL_${key.toUpperCase()}`;
                    const query = `
                        UPDATE tbloptions
                        SET OptionValue = @value
                        WHERE OptionName = @name;

                        IF @@ROWCOUNT = 0
                        BEGIN
                            INSERT INTO tbloptions (OptionName, OptionValue)
                            VALUES (@name, @value);
                        END
                    `;

                    await executeQuery(
                        query,
                        [
                            ['name', TYPES.NVarChar, optionName],
                            ['value', TYPES.NVarChar, String(value)]
                        ]
                    );

                    updates.push(optionName);
                }
            }

            // Reload configuration
            await this.loadConfig();

            // Reinitialize transporter with new config
            this.transporter = null;
            await this.initialize();

            console.log('Email configuration updated:', updates);
            return {
                success: true,
                updated: updates,
                message: 'Email configuration updated successfully'
            };
        } catch (error) {
            console.error('Failed to update email configuration:', error);
            throw error;
        }
    }
}

// Export singleton instance
export default new EmailService();
