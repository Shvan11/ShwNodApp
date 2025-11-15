/**
 * API Client for WhatsApp send page with validation and retry
 */
import { CONFIG } from './whatsapp-send-constants.js';
import { validateApiResponse } from './whatsapp-validation.js';

/**
 * Retry Manager with Exponential Backoff
 */
export class RetryManager {
    static async withRetry(operation, options = {}) {
        const {
            maxAttempts = CONFIG.RETRY_MAX_ATTEMPTS,
            baseDelay = CONFIG.RETRY_BASE_DELAY_MS,
            maxDelay = CONFIG.RETRY_MAX_DELAY_MS,
            onRetry = null
        } = options;

        let lastError;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;

                if (attempt === maxAttempts) {
                    break;
                }

                const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

                if (onRetry) {
                    onRetry(error, attempt, delay);
                }

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }
}

/**
 * API Client with Validation and Retry
 */
export class APIClient {
    constructor() {
        this.abortControllers = new Map();
    }

    async request(url, options = {}) {
        const requestId = `${Date.now()}-${Math.random()}`;

        // Cancel previous request with same ID if needed
        if (options.cancelPrevious && this.abortControllers.has(options.cancelPrevious)) {
            this.abortControllers.get(options.cancelPrevious).abort('Request superseded by new request');
        }

        // Create abort controller
        const abortController = new AbortController();
        const requestKey = options.cancelPrevious || requestId;
        this.abortControllers.set(requestKey, abortController);

        try {
            return await RetryManager.withRetry(async () => {
                const response = await fetch(url, {
                    signal: abortController.signal,
                    credentials: 'include', // Include session cookies for authentication
                    headers: {
                        'Content-Type': 'application/json',
                        ...options.headers
                    },
                    ...options
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const contentType = response.headers.get('content-type');
                if (!contentType?.includes('application/json')) {
                    const text = await response.text();
                    console.error('[API Client] Expected JSON but got:', contentType);
                    throw new Error(`Expected JSON but got ${contentType}`);
                }

                const data = await response.json();
                return validateApiResponse(data, options.expectedFields || []);
            }, {
                maxAttempts: url.includes('/messaging/status/') ? 1 : CONFIG.RETRY_MAX_ATTEMPTS,
                onRetry: (error, attempt) => {
                    // Only log retries for important requests
                    if (!url.includes('/messaging/status/') && !url.includes('/messaging/count/')) {
                        console.warn(`Retry ${attempt}: ${error.message}`);
                    }
                }
            });
        } finally {
            this.abortControllers.delete(requestKey);
        }
    }

    async get(url, options = {}) {
        return this.request(url, { method: 'GET', ...options });
    }

    async post(url, data = null, options = {}) {
        return this.request(url, {
            method: 'POST',
            body: data ? JSON.stringify(data) : undefined,
            ...options
        });
    }

    cancelRequest(requestKey) {
        if (this.abortControllers.has(requestKey)) {
            this.abortControllers.get(requestKey).abort('Request cancelled manually');
            this.abortControllers.delete(requestKey);
        }
    }

    cancelAllRequests() {
        for (const [, controller] of this.abortControllers) {
            controller.abort('All requests cancelled');
        }
        this.abortControllers.clear();
    }
}
