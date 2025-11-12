/**
 * Custom hook for fetching message count
 */
import { useState, useEffect, useCallback } from 'react';
import { API_ENDPOINTS } from '../utils/whatsapp-send-constants.js';
import { validateMessageCountResponse } from '../utils/whatsapp-validation.js';
import { APIClient } from '../utils/whatsapp-api-client.js';

const apiClient = new APIClient();

/**
 * Format message count for display
 */
function formatMessageCountDisplay(count) {
    const actualSendable = Math.max(0, count.eligibleForMessaging || 0);
    let message = `${actualSendable} messages ready to send`;

    if (count.alreadySent > 0) {
        message += ` (${count.alreadySent} already sent`;
        if (count.pending && count.pending > 0) {
            message += `, ${count.pending} pending`;
        }
        message += ')';
    } else if (count.pending && count.pending > 0) {
        message += ` (${count.pending} pending)`;
    }

    return message;
}

/**
 * Custom hook for message count
 */
export function useMessageCount(currentDate) {
    const [messageCount, setMessageCount] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [displayMessage, setDisplayMessage] = useState('');

    const fetchMessageCount = useCallback(async () => {
        if (!currentDate) return;

        setLoading(true);
        setError(null);
        setDisplayMessage('Loading message count...');

        try {
            const data = await apiClient.get(
                API_ENDPOINTS.MESSAGE_COUNT(currentDate),
                {
                    cancelPrevious: 'messageCount',
                    expectedFields: ['success', 'data']
                }
            );

            const count = validateMessageCountResponse(data);
            setMessageCount(count);

            const message = formatMessageCountDisplay(count);
            setDisplayMessage(message);
        } catch (err) {
            console.error('Failed to load message count:', err);
            setError(err.message || 'Failed to load message count');
            setDisplayMessage('Failed to load message count');
            setMessageCount(null);
        } finally {
            setLoading(false);
        }
    }, [currentDate]);

    // Fetch message count on mount and when date changes
    useEffect(() => {
        fetchMessageCount();
    }, [fetchMessageCount]);

    // Refresh function for manual refresh
    const refresh = useCallback(() => {
        fetchMessageCount();
    }, [fetchMessageCount]);

    return {
        messageCount,
        loading,
        error,
        displayMessage,
        refresh
    };
}
