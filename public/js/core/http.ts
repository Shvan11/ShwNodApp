/**
 * HTTP utility functions for making API requests
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
    return response.json() as Promise<T>;
  }

  return response.text() as unknown as T;
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
    method: 'POST',
    body: JSON.stringify(data),
    ...options,
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
    method: 'PUT',
    body: JSON.stringify(data),
    ...options,
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
    method: 'DELETE',
    ...options,
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
  deleteJSON,
  postFormData,
};
