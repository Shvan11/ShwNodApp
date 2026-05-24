// services/messaging/sms.ts
import twilio from 'twilio';
import config from '../../config/config.js';
import * as database from '../database/queries/messaging-queries.js';
import { log } from '../../utils/logger.js';
import ResourceManager from '../core/ResourceManager.js';

// ===========================================
// TYPES
// ===========================================

/**
 * Twilio client type
 */
type TwilioClient = ReturnType<typeof twilio>;

/**
 * SMS message from database
 */
interface SmsMessage {
  id: number;
  to: string;
  body: string;
}

/**
 * Sent SMS record
 */
interface SentSms {
  id: number;
  sid: string;
}

/**
 * SMS status update record
 */
interface SmsStatus {
  id: number;
  status: string;
}

/**
 * SMS SID record from database
 */
interface SmsSid {
  id: number;
  sid: string;
}

// ===========================================
// SMS SERVICE CLASS
// ===========================================

/**
 * Service for SMS messaging operations
 */
class SmsService {
  private client: TwilioClient | null;
  private sentSmsList: SentSms[];
  // Pending 5-min status-check timers, keyed by date — so repeated sends don't
  // stack timers and graceful shutdown can clear them.
  private statusCheckTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor() {
    const accountSid = config.twilio.accountSid;
    const authToken = config.twilio.authToken;

    if (!accountSid || !authToken) {
      log.warn('Twilio credentials not configured');
      this.client = null;
    } else {
      this.client = twilio(accountSid, authToken);
    }

    this.sentSmsList = [];

    ResourceManager.register('sms-service', this, () => this.cleanup());
  }

  /**
   * Send SMS messages for a given date
   * @param date - The date to send SMS for
   * @returns A promise that resolves with the list of sent SMS
   */
  async sendSms(date: string): Promise<SentSms[]> {
    if (!this.client) {
      throw new Error('Twilio client not initialized');
    }

    this.sentSmsList = [];
    const smsList = (await database.getSmsMessages(date)) as SmsMessage[];

    for (const sms of smsList) {
      if (sms.to) {
        try {
          const message = await this.client.messages.create({
            body: sms.body,
            from: config.twilio.fromName || 'Shwan Ortho',
            to: sms.to,
          });

          if (message) {
            this.sentSmsList.push({ id: sms.id, sid: message.sid });
          }
        } catch (error) {
          log.error('Error sending SMS:', { error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    if (this.sentSmsList.length > 0) {
      await database.updateSmsIds(this.sentSmsList);
    }

    // Schedule a status check in 5 min, replacing any pending check for the same
    // date so repeated sends can't stack timers.
    this.scheduleStatusCheck(date);

    return this.sentSmsList;
  }

  /**
   * (Re)arm the deferred status check for a date. The handle is tracked so it can
   * be replaced on a repeat send and cleared on graceful shutdown.
   */
  private scheduleStatusCheck(date: string): void {
    const existing = this.statusCheckTimers.get(date);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.statusCheckTimers.delete(date);
      this.checksms(date).catch((error) =>
        log.error('Deferred SMS status check failed:', {
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }, 300000);
    this.statusCheckTimers.set(date, timer);
  }

  /**
   * Cancel all pending status-check timers (graceful shutdown).
   */
  cleanup(): void {
    for (const timer of this.statusCheckTimers.values()) {
      clearTimeout(timer);
    }
    this.statusCheckTimers.clear();
  }

  /**
   * Check the status of sent SMS messages
   * @param date - The date to check SMS for
   * @returns A promise that resolves with the updated status list
   */
  async checksms(date: string): Promise<SmsStatus[]> {
    if (!this.client) {
      throw new Error('Twilio client not initialized');
    }

    const sids = (await database.getSmsIds(date)) as SmsSid[];

    const newSids = await Promise.all(
      sids.map(async (sid): Promise<SmsStatus> => {
        try {
          const message = await this.client!.messages(sid.sid).fetch();
          return { id: sid.id, status: message.status };
        } catch (error) {
          log.error('Error checking SMS status:', { error: error instanceof Error ? error.message : String(error) });
          return { id: sid.id, status: 'error' };
        }
      })
    );

    if (newSids.length > 0) {
      await database.updateSmsStatus(newSids);
    }

    return newSids;
  }
}

// Export a singleton instance
export default new SmsService();
