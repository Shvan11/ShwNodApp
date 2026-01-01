/**
 * Validation utilities for WhatsApp send page
 */

/**
 * Message count response data structure
 */
export interface MessageCountData {
  eligibleForMessaging: number;
  alreadySent: number;
  [key: string]: unknown;
}

/**
 * API Response with success flag
 */
export interface ApiSuccessResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Validate message count API response
 */
export function validateMessageCountResponse(
  data: unknown
): MessageCountData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response format');
  }

  const response = data as ApiSuccessResponse<MessageCountData>;

  if (!response.success) {
    throw new Error(response.error || 'Operation failed');
  }

  if (!response.data || typeof response.data !== 'object') {
    throw new Error('Invalid data structure');
  }

  const requiredFields: (keyof MessageCountData)[] = ['eligibleForMessaging', 'alreadySent'];
  for (const field of requiredFields) {
    if (typeof response.data[field] !== 'number') {
      throw new Error(`Missing or invalid field: ${field}`);
    }
  }

  return response.data;
}

/**
 * Validate generic API response
 */
export function validateApiResponse<T = unknown>(
  data: unknown,
  expectedFields: string[] = []
): T {
  if (!data) {
    throw new Error('Invalid response format');
  }

  // Allow arrays as valid responses
  if (Array.isArray(data)) {
    return data as T;
  }

  if (typeof data !== 'object') {
    throw new Error('Invalid response format');
  }

  const dataObj = data as Record<string, unknown>;

  // Only validate required fields if explicitly specified
  for (const field of expectedFields) {
    if (!(field in dataObj)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  return data as T;
}

/**
 * Validate date string
 */
export function validateDate(dateString: unknown): string {
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
export function escapeHtml(text: string | null | undefined): string {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
