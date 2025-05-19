// services/api.js
/**
 * API service - Provides methods for interacting with the backend API
 */
import { fetchJSON, postJSON, putJSON, deleteJSON } from '../core/http.js';

/**
 * Base class for API services
 */
export class ApiService {
  /**
   * Constructor
   * @param {string} baseUrl - Base URL for API endpoints
   */
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  /**
   * Build full URL from endpoint
   * @param {string} endpoint - API endpoint
   * @param {Object} params - URL parameters
   * @returns {string} - Full URL
   */
  buildUrl(endpoint, params = {}) {
    let url = this.baseUrl + endpoint;
    
    // Add query parameters if provided
    const queryParams = new URLSearchParams();
    for (const key in params) {
      if (params[key] !== undefined && params[key] !== null) {
        queryParams.append(key, params[key]);
      }
    }
    
    const queryString = queryParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
    
    return url;
  }

  /**
   * GET request
   * @param {string} endpoint - API endpoint
   * @param {Object} params - URL parameters
   * @param {Object} options - Fetch options
   * @returns {Promise<any>} - Response data
   */
  async get(endpoint, params = {}, options = {}) {
    const url = this.buildUrl(endpoint, params);
    return fetchJSON(url, options);
  }

  /**
   * POST request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data
   * @param {Object} options - Fetch options
   * @returns {Promise<any>} - Response data
   */
  async post(endpoint, data, options = {}) {
    const url = this.buildUrl(endpoint);
    return postJSON(url, data, options);
  }

  /**
   * PUT request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data
   * @param {Object} options - Fetch options
   * @returns {Promise<any>} - Response data
   */
  async put(endpoint, data, options = {}) {
    const url = this.buildUrl(endpoint);
    return putJSON(url, data, options);
  }

  /**
   * DELETE request
   * @param {string} endpoint - API endpoint
   * @param {Object} params - URL parameters
   * @param {Object} options - Fetch options
   * @returns {Promise<any>} - Response data
   */
  async delete(endpoint, params = {}, options = {}) {
    const url = this.buildUrl(endpoint, params);
    return deleteJSON(url, options);
  }
}

/**
 * API client for the application
 */
export class Api extends ApiService {
  constructor() {
    super('/api');
  }

  /**
   * Get patient information
   * @param {string} patientId - Patient ID
   * @returns {Promise<Object>} - Patient information
   */
  async getPatientInfo(patientId) {
    return this.get('/getinfos', { code: patientId });
  }

  /**
   * Get patient timepoints
   * @param {string} patientId - Patient ID
   * @returns {Promise<Array>} - Patient timepoints
   */
  async getPatientTimepoints(patientId) {
    return this.get('/gettimepoints', { code: patientId });
  }

  /**
   * Get timepoint images
   * @param {string} patientId - Patient ID
   * @param {string} timepoint - Timepoint code
   * @returns {Promise<Array>} - Timepoint images
   */
  async getTimepointImages(patientId, timepoint) {
    return this.get('/gettimepointimgs', { code: patientId, tp: timepoint });
  }

  /**
   * Get gallery images
   * @param {string} patientId - Patient ID
   * @param {string} timepoint - Timepoint code
   * @returns {Promise<Array>} - Gallery images
   */
  async getGalleryImages(patientId, timepoint) {
    return this.get('/getgal', { code: patientId, tp: timepoint });
  }

  /**
   * Get patient payments
   * @param {string} patientId - Patient ID
   * @returns {Promise<Array>} - Patient payments
   */
  async getPatientPayments(patientId) {
    return this.get('/getpayments', { code: patientId });
  }

  /**
   * Get visits summary
   * @param {string} patientId - Patient ID
   * @returns {Promise<Array>} - Visits summary
   */
  async getVisitsSummary(patientId) {
    return this.get('/visitsSummary', { PID: patientId });
  }

  /**
   * Get available wires
   * @returns {Promise<Array>} - Available wires
   */
  async getWires() {
    return this.get('/getWires');
  }

  /**
   * Get latest wire for a patient
   * @param {string} patientId - Patient ID
   * @returns {Promise<Object>} - Latest wire information
   */
  async getLatestWire(patientId) {
    return this.get('/getLatestwire', { PID: patientId });
  }

  /**
   * Get visit details by ID
   * @param {string} visitId - Visit ID
   * @returns {Promise<Object>} - Visit details
   */
  async getVisitDetailsById(visitId) {
    return this.get('/getVisitDetailsByID', { VID: visitId });
  }

  /**
   * Add a new visit
   * @param {Object} visitData - Visit data
   * @returns {Promise<Object>} - Result
   */
  async addVisit(visitData) {
    return this.post('/addVisit', visitData);
  }

  /**
   * Update a visit
   * @param {Object} visitData - Visit data
   * @returns {Promise<Object>} - Result
   */
  async updateVisit(visitData) {
    return this.put('/updateVisit', visitData);
  }

  /**
   * Delete a visit
   * @param {string} visitId - Visit ID
   * @returns {Promise<Object>} - Result
   */
  async deleteVisit(visitId) {
    return this.delete('/deleteVisit', { VID: visitId });
  }

  /**
   * Get appointments for a date
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<Object>} - Appointments
   */
  async getAppointments(date) {
    return this.get('/getWebApps', { PDate: date });
  }

  /**
   * Get patient phone numbers
   * @returns {Promise<Array>} - Patient phone numbers
   */
  async getPatientPhones() {
    return this.get('/patientsPhones');
  }
}

// Export a singleton instance
export default new Api();