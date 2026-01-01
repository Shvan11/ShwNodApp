/**
 * API Client for WhatsApp send page with validation and retry
 */
import { CONFIG } from './whatsapp-send-constants';
import { validateApiResponse } from './whatsapp-validation';

/**
 * Retry options for the retry manager
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Request options for the API client
 */
export interface RequestOptions extends RequestInit {
  cancelPrevious?: string;
  expectedFields?: string[];
}

/**
 * Retry Manager with Exponential Backoff
 */
export class RetryManager {
  static async withRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const {
      maxAttempts = CONFIG.RETRY_MAX_ATTEMPTS,
      baseDelay = CONFIG.RETRY_BASE_DELAY_MS,
      maxDelay = CONFIG.RETRY_MAX_DELAY_MS,
      onRetry = null,
    } = options;

    let lastError: Error = new Error('Unknown error');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === maxAttempts) {
          break;
        }

        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

        if (onRetry) {
          onRetry(lastError, attempt, delay);
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}

/**
 * API Client with Validation and Retry
 */
export class APIClient {
  private abortControllers: Map<string, AbortController>;

  constructor() {
    this.abortControllers = new Map();
  }

  async request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const requestId = `${Date.now()}-${Math.random()}`;

    // Cancel previous request with same ID if needed
    if (options.cancelPrevious && this.abortControllers.has(options.cancelPrevious)) {
      this.abortControllers.get(options.cancelPrevious)!.abort();
    }

    // Create abort controller
    const abortController = new AbortController();
    const requestKey = options.cancelPrevious || requestId;
    this.abortControllers.set(requestKey, abortController);

    // Extract custom options before passing to fetch
    const { cancelPrevious, expectedFields, ...fetchOptions } = options;

    try {
      return await RetryManager.withRetry<T>(
        async () => {
          const response = await fetch(url, {
            signal: abortController.signal,
            credentials: 'include', // Include session cookies for authentication
            headers: {
              'Content-Type': 'application/json',
              ...fetchOptions.headers,
            },
            ...fetchOptions,
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const contentType = response.headers.get('content-type');
          if (!contentType?.includes('application/json')) {
            const text = await response.text();
            console.error('[API Client] Expected JSON but got:', contentType, text);
            throw new Error(`Expected JSON but got ${contentType}`);
          }

          const data = await response.json();
          return validateApiResponse<T>(data, expectedFields || []);
        },
        {
          maxAttempts: url.includes('/messaging/status/') ? 1 : CONFIG.RETRY_MAX_ATTEMPTS,
          onRetry: (error, attempt) => {
            // Only log retries for important requests
            if (!url.includes('/messaging/status/') && !url.includes('/messaging/count/')) {
              console.warn(`Retry ${attempt}: ${error.message}`);
            }
          },
        }
      );
    } finally {
      this.abortControllers.delete(requestKey);
    }
  }

  async get<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(url, { method: 'GET', ...options });
  }

  async post<T = unknown>(
    url: string,
    data: unknown = null,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.request<T>(url, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    });
  }

  cancelRequest(requestKey: string): void {
    if (this.abortControllers.has(requestKey)) {
      this.abortControllers.get(requestKey)!.abort();
      this.abortControllers.delete(requestKey);
    }
  }

  cancelAllRequests(): void {
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();
  }
}
