/**
 * Validation utilities for WhatsApp send page
 */

/**
 * Validate message count API response
 */
export function validateMessageCountResponse(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format');
    }

    if (!data.success) {
        throw new Error(data.error || 'Operation failed');
    }

    if (!data.data || typeof data.data !== 'object') {
        throw new Error('Invalid data structure');
    }

    const requiredFields = ['eligibleForMessaging', 'alreadySent'];
    for (const field of requiredFields) {
        if (typeof data.data[field] !== 'number') {
            throw new Error(`Missing or invalid field: ${field}`);
        }
    }

    return data.data;
}

/**
 * Validate generic API response
 */
export function validateApiResponse(data, expectedFields = []) {
    if (!data) {
        throw new Error('Invalid response format');
    }

    // Allow arrays as valid responses
    if (Array.isArray(data)) {
        return data;
    }

    if (typeof data !== 'object') {
        throw new Error('Invalid response format');
    }

    // Only validate required fields if explicitly specified
    for (const field of expectedFields) {
        if (!(field in data)) {
            throw new Error(`Missing required field: ${field}`);
        }
    }

    return data;
}

/**
 * Validate date string
 */
export function validateDate(dateString) {
    if (!dateString || typeof dateString !== 'string') {
        throw new Error('Invalid date format');
    }

    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        throw new Error('Invalid date value');
    }

    return dateString;
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}
