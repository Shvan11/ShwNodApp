/**
 * Validation utilities for WhatsApp send page.
 *
 * Runtime validation at a trust boundary (parsing API responses) — backed by
 * Zod. Export signatures are stable; the schemas are the source of truth.
 */
import { z } from 'zod';

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

// Schema source of truth for the WhatsApp boundary responses.
const apiSuccessSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

const messageCountDataSchema = z.object({
  eligibleForMessaging: z.number(),
  alreadySent: z.number(),
});

/**
 * Validate message count API response
 */
export function validateMessageCountResponse(
  data: unknown
): MessageCountData {
  const response = apiSuccessSchema.safeParse(data);
  if (!response.success) {
    throw new Error('Invalid response format');
  }

  if (!response.data.success) {
    throw new Error(response.data.error || 'Operation failed');
  }

  if (!messageCountDataSchema.safeParse(response.data.data).success) {
    throw new Error('Invalid data structure');
  }

  // Return the original payload (not the parsed copy) so extra passthrough
  // fields on MessageCountData are preserved.
  return response.data.data as MessageCountData;
}

/**
 * Validate generic API response
 */
export function validateApiResponse<T = unknown>(
  data: unknown,
  expectedFields: string[] = []
): T {
  // Allow arrays as valid responses
  if (Array.isArray(data)) {
    return data as T;
  }

  const parsed = z.record(z.string(), z.unknown()).safeParse(data);
  if (!parsed.success) {
    throw new Error('Invalid response format');
  }

  // Only validate required fields if explicitly specified
  for (const field of expectedFields) {
    if (!(field in parsed.data)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  return data as T;
}

/**
 * Validate date string
 */
export function validateDate(dateString: unknown): string {
  if (typeof dateString !== 'string') {
    throw new Error('Invalid date format');
  }

  const parsed = z
    .string()
    .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Invalid date value')
    .safeParse(dateString);
  if (!parsed.success) {
    throw new Error('Invalid date value');
  }

  return parsed.data;
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: string | null | undefined): string {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}
