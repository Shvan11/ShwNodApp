// services/patient.js
/**
 * Patient service - Handles operations related to patients
 */
import api from './api.js';
import { formatDate } from '../core/utils.js';

/**
 * Patient service class
 */
export class PatientService {
  /**
   * Get patient information
   * @param {string} patientId - Patient ID
   * @returns {Promise<Object>} - Patient information
   */
  async getPatientInfo(patientId) {
    try {
      const patientInfo = await api.getPatientInfo(patientId);
      return this.formatPatientInfo(patientInfo);
    } catch (error) {
      console.error('Error fetching patient info:', error);
      throw error;
    }
  }

  /**
   * Get patient timepoints
   * @param {string} patientId - Patient ID
   * @returns {Promise<Array>} - Patient timepoints
   */
  async getTimepoints(patientId) {
    try {
      const timepoints = await api.getPatientTimepoints(patientId);
      return timepoints.map(tp => ({
        ...tp,
        tpDateTime: formatDate(tp.tpDateTime)
      }));
    } catch (error) {
      console.error('Error fetching timepoints:', error);
      throw error;
    }
  }

  /**
   * Get timepoint images
   * @param {string} patientId - Patient ID
   * @param {string} timepoint - Timepoint code
   * @returns {Promise<Array>} - Timepoint images
   */
  async getTimepointImages(patientId, timepoint) {
    try {
      return await api.getTimepointImages(patientId, timepoint);
    } catch (error) {
      console.error('Error fetching timepoint images:', error);
      throw error;
    }
  }

  /**
   * Get patient gallery images
   * @param {string} patientId - Patient ID
   * @param {string} timepoint - Timepoint code
   * @returns {Promise<Array>} - Gallery images
   */
  async getGalleryImages(patientId, timepoint) {
    try {
      const images = await api.getGalleryImages(patientId, timepoint);
      return images.filter(Boolean); // Filter out null values
    } catch (error) {
      console.error('Error fetching gallery images:', error);
      throw error;
    }
  }

  /**
   * Get patient payments
   * @param {string} patientId - Patient ID
   * @returns {Promise<Array>} - Patient payments
   */
  async getPayments(patientId) {
    try {
      const payments = await api.getPatientPayments(patientId);
      return payments.map(payment => ({
        ...payment,
        Date: formatDate(payment.Date)
      }));
    } catch (error) {
      console.error('Error fetching payments:', error);
      throw error;
    }
  }

  /**
   * Format patient information
   * @param {Object} patientInfo - Raw patient info
   * @returns {Object} - Formatted patient info
   * @private
   */
  formatPatientInfo(patientInfo) {
    if (!patientInfo) return {};
    
    return {
      ...patientInfo,
      startdate: patientInfo.StartDate ? formatDate(patientInfo.StartDate) : '',
      assets: patientInfo.assets || [],
      xrays: (patientInfo.xrays || []).map(xray => ({
        ...xray,
        date: xray.date || this.extractDateFromXrayName(xray.name)
      }))
    };
  }

  /**
   * Extract date from X-ray file name
   * @param {string} fileName - X-ray file name
   * @returns {string} - Extracted date
   * @private
   */
  extractDateFromXrayName(fileName) {
    // Extract date pattern from filename
    // This is a placeholder implementation that you can customize
    const datePattern = /(\d{2})[-_]?(\d{2})[-_]?(\d{4})/; // DD-MM-YYYY or DD_MM_YYYY
    const match = fileName && fileName.match(datePattern);
    
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    
    return '';
  }
}

// Export a singleton instance
export default new PatientService();