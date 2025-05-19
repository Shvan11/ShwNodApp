// core/http.js
/**
 * HTTP utility functions for making API requests
 */

/**
 * Default fetch options
 * @type {Object}
 * @private
 */
const defaultOptions = {
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'same-origin'
  };
  
  /**
   * Handle fetch response
   * @param {Response} response - Fetch response
   * @returns {Promise<Object>} - Response data
   * @private
   */
  async function handleResponse(response) {
    // Check if response is successful
    if (!response.ok) {
      const error = new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      error.status = response.status;
      error.response = response;
      
      try {
        error.data = await response.json();
      } catch (e) {
        error.data = await response.text();
      }
      
      throw error;
    }
    
    // Check content type
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      return response.json();
    }
    
    return response.text();
  }
  
  /**
   * Make a fetch request
   * @param {string} url - Request URL
   * @param {Object} [options={}] - Fetch options
   * @returns {Promise<any>} - Response data
   */
  export async function fetchData(url, options = {}) {
    // Merge default options with provided options
    const mergedOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers
      }
    };
    
    try {
      const response = await fetch(url, mergedOptions);
      return await handleResponse(response);
    } catch (error) {
      // Add request metadata to error
      error.url = url;
      error.options = mergedOptions;
      throw error;
    }
  }
  
  /**
   * Make a GET request
   * @param {string} url - Request URL
   * @param {Object} [options={}] - Fetch options
   * @returns {Promise<any>} - Response data
   */
  export function fetchJSON(url, options = {}) {
    return fetchData(url, {
      method: 'GET',
      ...options
    });
  }
  
  /**
   * Make a POST request
   * @param {string} url - Request URL
   * @param {Object} data - Request data
   * @param {Object} [options={}] - Fetch options
   * @returns {Promise<any>} - Response data
   */
  export function postJSON(url, data, options = {}) {
    return fetchData(url, {
      method: 'POST',
      body: JSON.stringify(data),
      ...options
    });
  }
  
  /**
   * Make a PUT request
   * @param {string} url - Request URL
   * @param {Object} data - Request data
   * @param {Object} [options={}] - Fetch options
   * @returns {Promise<any>} - Response data
   */
  export function putJSON(url, data, options = {}) {
    return fetchData(url, {
      method: 'PUT',
      body: JSON.stringify(data),
      ...options
    });
  }
  
  /**
   * Make a DELETE request
   * @param {string} url - Request URL
   * @param {Object} [options={}] - Fetch options
   * @returns {Promise<any>} - Response data
   */
  export function deleteJSON(url, options = {}) {
    return fetchData(url, {
      method: 'DELETE',
      ...options
    });
  }
  
  /**
   * Make a form data POST request
   * @param {string} url - Request URL
   * @param {FormData} formData - Form data
   * @param {Object} [options={}] - Fetch options
   * @returns {Promise<any>} - Response data
   */
  export function postFormData(url, formData, options = {}) {
    return fetchData(url, {
      method: 'POST',
      body: formData,
      headers: {}, // Remove Content-Type so boundary is set automatically
      ...options
    });
  }
  
  export default {
    fetchData,
    fetchJSON,
    postJSON,
    putJSON,
    deleteJSON,
    postFormData
  };