// services/messaging/sms.js
import twilio from 'twilio';
import config from '../../config/config.js';
import * as database from '../database/queries/messaging-queries.js';

/**
 * Service for SMS messaging operations
 */
class SmsService {
    constructor() {
        const accountSid = config.twilio.accountSid;
        const authToken = config.twilio.authToken;
        
        if (!accountSid || !authToken) {
            console.warn('Twilio credentials not configured');
            this.client = null;
        } else {
            this.client = twilio(accountSid, authToken);
        }
        
        this.sentSmsList = [];
    }

    /**
     * Send SMS messages for a given date
     * @param {string} date - The date to send SMS for
     * @returns {Promise<Array>} - A promise that resolves with the list of sent SMS
     */
    async sendSms(date) {
        if (!this.client) {
            throw new Error('Twilio client not initialized');
        }
        
        this.sentSmsList = [];
        const smsList = await database.getSmsMessages(date);
        
        for (const sms of smsList) {
            if (sms.to) {
                try {
                    const message = await this.client.messages.create({
                        body: sms.body,
                        from: config.twilio.fromName || "Shwan Ortho",
                        to: sms.to,
                    });
                    
                    if (message) {
                        this.sentSmsList.push({ id: sms.id, sid: message.sid });
                    }
                } catch (error) {
                    console.error('Error sending SMS:', error);
                }
            }
        }
        
        if (this.sentSmsList.length > 0) {
            await database.updateSmsIds(this.sentSmsList);
        }
        
        // Schedule checking the status after 5 minutes
        setTimeout(() => this.checksms(date), 300000);
        
        return this.sentSmsList;
    }
    
    /**
     * Check the status of sent SMS messages
     * @param {string} date - The date to check SMS for
     * @returns {Promise<Array>} - A promise that resolves with the updated status list
     */
    async checksms(date) {
        if (!this.client) {
            throw new Error('Twilio client not initialized');
        }
        
        const sids = await database.getSmsIds(date);
        
        const newSids = await Promise.all(
            sids.map(async (sid) => {
                try {
                    return await this.client
                        .messages(sid.sid)
                        .fetch()
                        .then((message) => {
                            return { id: sid.id, status: message.status };
                        });
                } catch (error) {
                    console.error('Error checking SMS status:', error);
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