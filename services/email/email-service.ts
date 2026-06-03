/**
 * Email Service - Handles email sending with Nodemailer
 * Uses database configuration from tbloptions table
 */

import nodemailer, { Transporter, SentMessageInfo } from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import { sql } from 'kysely';
import { getKysely } from '../database/kysely.js';
import { log } from '../../utils/logger.js';

// ===========================================
// TYPES
// ===========================================

/**
 * Email configuration from database
 */
interface EmailConfig {
  smtp_host?: string;
  smtp_port?: number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_password?: string;
  from_address?: string;
  from_name?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Database option row
 */
interface OptionRow {
  option_name: string;
  option_value: string;
}

/**
 * Employee recipient
 */
interface EmployeeRecipient {
  id: number;
  employee_name: string;
  email: string;
}

/**
 * Email send options
 */
export interface EmailOptions {
  to?: string;
  subject: string;
  html?: string;
  text?: string;
  pdfBuffer?: Buffer;
  pdfFilename?: string;
  useEmployeeRecipients?: boolean;
}

/**
 * Email send result
 */
export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  response?: string;
}

/**
 * Connection test result
 */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Config update result
 */
export interface ConfigUpdateResult {
  success: boolean;
  updated: string[];
  message: string;
}

// ===========================================
// EMAIL SERVICE CLASS
// ===========================================

class EmailService {
  private transporter: Transporter<SentMessageInfo> | null;
  private config: EmailConfig | null;

  constructor() {
    this.transporter = null;
    this.config = null;
  }

  /**
   * Load email configuration from database
   */
  async loadConfig(): Promise<EmailConfig> {
    try {
      const db = getKysely();
      const { rows: results } = await sql<OptionRow>`
                SELECT "option_name", "option_value"
                FROM "options"
                WHERE "option_name" LIKE 'EMAIL_%'
            `.execute(db);

      // Convert array to config object
      const config: EmailConfig = {};
      results.forEach((row) => {
        const key = row.option_name.replace('EMAIL_', '').toLowerCase();
        config[key] = row.option_value;
      });

      // Parse port as integer
      if (config.smtp_port) {
        config.smtp_port = parseInt(String(config.smtp_port));
      }

      // Parse secure as boolean
      if (config.smtp_secure !== undefined) {
        config.smtp_secure = config.smtp_secure === true || String(config.smtp_secure) === 'true';
      }

      this.config = config;
      log.info('Email configuration loaded successfully');
      return config;
    } catch (error) {
      log.error('Failed to load email configuration', { error: (error as Error).message });
      throw new Error('Email configuration not available', { cause: error });
    }
  }

  /**
   * Initialize nodemailer transporter
   */
  async initialize(): Promise<Transporter<SentMessageInfo>> {
    if (!this.config) {
      await this.loadConfig();
    }

    if (!this.config?.smtp_user || !this.config?.smtp_password) {
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
        rejectUnauthorized: false, // For development - set to true in production
      },
    });

    log.info('Email transporter initialized');
    return this.transporter;
  }

  /**
   * Get employee email recipients from database
   * Uses the unified /api/employees endpoint with receiveEmail filter
   */
  async getEmployeeRecipients(): Promise<EmployeeRecipient[]> {
    try {
      // Query employees with receiveEmail = true and valid email addresses
      const db = getKysely();
      const { rows: recipients } = await sql<EmployeeRecipient>`
                SELECT e."id", e."employee_name", e."email"
                FROM "employees" e
                WHERE e."receive_email" = true
                  AND e."email" IS NOT NULL
                  AND e."email" != ''
                ORDER BY e."employee_name"
            `.execute(db);

      return recipients || [];
    } catch (error) {
      log.error('Failed to get employee recipients', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Send email with optional PDF attachment
   * @param options - Email options
   */
  async sendEmail(options: EmailOptions): Promise<EmailSendResult> {
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
          recipients = employees.map((emp) => emp.email).join(', ');
          log.info('Sending email to employees', {
            count: employees.length,
            names: employees.map((e) => e.employee_name).join(', '),
          });
        } else if (!recipients) {
          throw new Error(
            'No recipients configured. Please enable "Receive Email" for at least one employee in Settings > Employees.'
          );
        }
      }

      const mailOptions: SendMailOptions = {
        from: {
          name: this.config?.from_name || 'Shwan Orthodontics',
          address: this.config?.from_address || this.config?.smtp_user || '',
        },
        to: recipients,
        subject: options.subject,
        text: options.text,
        html: options.html,
      };

      // Add PDF attachment if provided
      if (options.pdfBuffer) {
        mailOptions.attachments = [
          {
            filename: options.pdfFilename || 'appointments.pdf',
            content: options.pdfBuffer,
            contentType: 'application/pdf',
          },
        ];
      }

      const info = await this.transporter!.sendMail(mailOptions);

      log.info('Email sent successfully', {
        messageId: info.messageId,
        to: mailOptions.to,
        subject: mailOptions.subject,
      });

      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
      };
    } catch (error) {
      log.error('Failed to send email', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Test email configuration
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      if (!this.transporter) {
        await this.initialize();
      }

      await this.transporter!.verify();
      log.info('Email connection test successful');
      return { success: true, message: 'Email configuration is valid' };
    } catch (error) {
      log.error('Email connection test failed', { error: (error as Error).message });
      return {
        success: false,
        message: (error as Error).message,
        error: String(error),
      };
    }
  }

  /**
   * Get current email configuration (with masked password)
   */
  getConfig(): EmailConfig | null {
    if (!this.config) {
      return null;
    }

    return {
      ...this.config,
      smtp_password: '********', // Mask password
    };
  }

  /**
   * Update email configuration in database
   */
  async updateConfig(newConfig: Partial<EmailConfig>): Promise<ConfigUpdateResult> {
    try {
      const updates: string[] = [];
      const validKeys = [
        'smtp_host',
        'smtp_port',
        'smtp_secure',
        'smtp_user',
        'smtp_password',
        'from_address',
        'from_name',
      ];

      const db = getKysely();
      for (const [key, value] of Object.entries(newConfig)) {
        if (validKeys.includes(key.toLowerCase())) {
          const optionName = `EMAIL_${key.toUpperCase()}`;
          const optionValue = String(value);

          // Upsert: UPDATE first, INSERT only if no row matched (PG has no T-SQL MERGE).
          const res = await sql`
            UPDATE "options" SET "option_value" = ${optionValue} WHERE "option_name" = ${optionName}
          `.execute(db);
          if (Number(res.numAffectedRows ?? 0n) === 0) {
            await sql`
              INSERT INTO "options" ("option_name", "option_value") VALUES (${optionName}, ${optionValue})
            `.execute(db);
          }

          updates.push(optionName);
        }
      }

      // Reload configuration
      await this.loadConfig();

      // Reinitialize transporter with new config
      this.transporter = null;
      await this.initialize();

      log.info('Email configuration updated', { updates });
      return {
        success: true,
        updated: updates,
        message: 'Email configuration updated successfully',
      };
    } catch (error) {
      log.error('Failed to update email configuration', { error: (error as Error).message });
      throw error;
    }
  }
}

// Export singleton instance
export default new EmailService();
