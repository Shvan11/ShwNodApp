/**
 * HTTP utility functions for making API requests.
 *
 * These helpers transparently unwrap the backend success envelope (see
 * `unwrapEnvelope`), so a caller receives the inner payload — not the
 * `{ success, data, timestamp }` wrapper. This is what makes flipping a route
 * onto `sendSuccess()` (audit item H4) invisible to everything funneled
 * through here.
 */

export interface HttpError extends Error {
  status?: number;
  response?: Response;
  data?: unknown;
  url?: string;
  options?: RequestInit;
}

export interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

/**
 * Default fetch options
 */
const defaultOptions: FetchOptions = {
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'same-origin',
};

/**
 * Unwrap the backend success envelope.
 *
 * `sendSuccess()` (utils/error-response.ts) wraps every payload as
 * `{ success: true, data, timestamp, message? }`. We return `body.data` for
 * exactly that shape and pass every other body through untouched, so callers
 * consume the inner payload directly and a route adopting the envelope (H4)
 * stays transparent to all funneled callers.
 *
 * Deliberately conservative — we unwrap only when `success === true` AND a
 * `data` key is present. That leaves alone:
 *  - bare arrays / plain objects (no `success`);
 *  - non-enveloped `{ success: true, ... }` custom shapes that carry their
 *    payload at the top level (e.g. photo-editor `{ success, tp_code }`,
 *    `/auth/me` `{ success, user }`) — unwrapping these would drop their data.
 * Error envelopes never reach here: a non-2xx response is thrown as an
 * HttpError below, before any unwrapping.
 */
function unwrapEnvelope(body: unknown): unknown {
  if (
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    (body as { success?: unknown }).success === true &&
    'data' in body
  ) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/**
 * Handle fetch response
 * @param response - Fetch response
 * @returns Response data
 */
async function handleResponse<T>(response: Response): Promise<T> {
  // Check if response is successful
  if (!response.ok) {
    const error: HttpError = new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.response = response;

    try {
      error.data = await response.json();
    } catch {
      error.data = await response.text();
    }

    throw error;
  }

  // Check content type
  const contentType = response.headers.get('content-type');

  if (contentType?.includes('application/json')) {
    const body = await response.json();
    return unwrapEnvelope(body) as T;
  }

  return response.text() as unknown as T;
}

/**
 * Extract a human-readable message from a thrown error.
 *
 * Prefers the server's `{ error }` / `{ message }` carried on an `HttpError`'s
 * parsed body (`error.data`), then the Error's own message, then the fallback.
 * Use this in `catch` blocks of funneled callers so the backend's friendly
 * message still surfaces (a bare `err.message` would only show
 * `"HTTP Error: 400 …"`).
 */
export function httpErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: string; message?: string } })?.data;
  return data?.error || data?.message || (err as Error)?.message || fallback;
}

/**
 * Make a fetch request
 * @param url - Request URL
 * @param options - Fetch options
 * @returns Response data
 */
export async function fetchData<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  // Merge default options with provided options
  const mergedOptions: FetchOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers,
    },
  };

  // A FormData body must set its own multipart boundary — forcing the default
  // application/json Content-Type makes the browser skip the boundary and the
  // server routes the binary body through express.json() (→ PayloadTooLarge).
  if (mergedOptions.body instanceof FormData && mergedOptions.headers) {
    delete mergedOptions.headers['Content-Type'];
  }

  try {
    const response = await fetch(url, mergedOptions);
    return await handleResponse<T>(response);
  } catch (error) {
    // Add request metadata to error
    const httpError = error as HttpError;
    httpError.url = url;
    httpError.options = mergedOptions;
    throw httpError;
  }
}

/**
 * Make a GET request
 * @param url - Request URL
 * @param options - Fetch options
 * @returns Response data
 */
export function fetchJSON<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  return fetchData<T>(url, {
    method: 'GET',
    ...options,
  });
}

/**
 * Make a POST request
 * @param url - Request URL
 * @param data - Request data
 * @param options - Fetch options
 * @returns Response data
 */
export function postJSON<T = unknown, D = unknown>(
  url: string,
  data: D,
  options: FetchOptions = {}
): Promise<T> {
  return fetchData<T>(url, {
    ...options,
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Make a PUT request
 * @param url - Request URL
 * @param data - Request data
 * @param options - Fetch options
 * @returns Response data
 */
export function putJSON<T = unknown, D = unknown>(
  url: string,
  data: D,
  options: FetchOptions = {}
): Promise<T> {
  return fetchData<T>(url, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * Make a PATCH request
 * @param url - Request URL
 * @param data - Request data
 * @param options - Fetch options
 * @returns Response data
 */
export function patchJSON<T = unknown, D = unknown>(
  url: string,
  data: D,
  options: FetchOptions = {}
): Promise<T> {
  return fetchData<T>(url, {
    ...options,
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

/**
 * Make a DELETE request
 * @param url - Request URL
 * @param options - Fetch options
 * @returns Response data
 */
export function deleteJSON<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  return fetchData<T>(url, {
    ...options,
    method: 'DELETE',
  });
}

/**
 * Make a form data POST request
 * @param url - Request URL
 * @param formData - Form data
 * @param options - Fetch options
 * @returns Response data
 */
export function postFormData<T = unknown>(
  url: string,
  formData: FormData,
  options: FetchOptions = {}
): Promise<T> {
  return fetchData<T>(url, {
    method: 'POST',
    body: formData,
    headers: {}, // Remove Content-Type so boundary is set automatically
    ...options,
  });
}

export default {
  fetchData,
  fetchJSON,
  postJSON,
  putJSON,
  patchJSON,
  deleteJSON,
  postFormData,
  httpErrorMessage,
};
