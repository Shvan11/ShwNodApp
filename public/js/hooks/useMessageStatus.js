/**
 * Custom hook for fetching and displaying message status
 */
import { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS, MESSAGE_STATUS_TEXT, MESSAGE_STATUS_CLASS } from '../utils/whatsapp-send-constants.js';
import { escapeHtml } from '../utils/whatsapp-validation.js';
import { APIClient } from '../utils/whatsapp-api-client.js';

const apiClient = new APIClient();

/**
 * Format display date
 */
function formatDisplayDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Custom hook for message status
 */
export function useMessageStatus(currentDate, messageStatusUpdate) {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchMessageStatus = useCallback(async () => {
        if (!currentDate) return;

        setLoading(true);
        setError(null);

        try {
            console.log(`Loading message status table for date: ${currentDate}`);

            const data = await apiClient.get(
                API_ENDPOINTS.MESSAGE_STATUS(currentDate),
                {
                    cancelPrevious: 'messageStatus'
                }
            );

            console.log('Message status API response:', data);

            // Handle different API response formats
            let messagesData = null;
            let hasValidResponse = false;

            if (data && typeof data === 'object') {
                // Try different possible response structures
                if (data.success === true || data.success === undefined) {
                    if (data.messages && Array.isArray(data.messages)) {
                        messagesData = data.messages;
                        hasValidResponse = true;
                    } else if (data.data && Array.isArray(data.data)) {
                        messagesData = data.data;
                        hasValidResponse = true;
                    } else if (Array.isArray(data)) {
                        messagesData = data;
                        hasValidResponse = true;
                    }
                } else if (data.success === false) {
                    console.log('API returned success=false:', data.error || 'No data available');
                    hasValidResponse = true; // Valid response, just no data
                }
            }

            if (hasValidResponse) {
                if (messagesData && messagesData.length > 0) {
                    setMessages(messagesData);
                } else {
                    setMessages([]);
                    console.log(`No messages found for date: ${currentDate}`);
                }
            } else {
                console.warn('Invalid API response structure:', data);
                setMessages([]);
            }
        } catch (err) {
            // Ignore AbortError - this is expected when a request is cancelled
            if (err.name === 'AbortError') {
                return;
            }

            // Don't show error for missing data - it's normal for dates with no messages
            if (err.message.includes('HTTP 404') || err.message.includes('Not Found')) {
                console.log(`No message data available for date: ${currentDate}`);
                setMessages([]);
            } else {
                console.warn('Failed to load message status table:', err.message);
                setMessages([]);
            }
        } finally {
            setLoading(false);
        }
    }, [currentDate]);

    // Fetch message status on mount and when date changes
    useEffect(() => {
        fetchMessageStatus();
    }, [fetchMessageStatus]);

    // Reload when message status updates
    useEffect(() => {
        if (messageStatusUpdate) {
            fetchMessageStatus();
        }
    }, [messageStatusUpdate, fetchMessageStatus]);

    // Calculate summary statistics
    const summary = {
        total: messages.length,
        pending: messages.filter(m => m.status === 0).length,
        server: messages.filter(m => m.status === 1).length,
        device: messages.filter(m => m.status === 2).length,
        read: messages.filter(m => m.status === 3).length,
        played: messages.filter(m => m.status === 4).length,
        failed: messages.filter(m => m.status < 0).length
    };

    return {
        messages,
        loading,
        error,
        summary,
        refresh: fetchMessageStatus,
        formatDisplayDate,
        MESSAGE_STATUS_TEXT,
        MESSAGE_STATUS_CLASS,
        escapeHtml
    };
}
