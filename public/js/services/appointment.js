// services/appointment.js
/**
 * Appointment Service
 * Handles appointments data and operations
 */
import { fetchJSON, postJSON } from '../core/http.js';
import { formatDate } from '../core/utils.js';

/**
 * Appointment Service
 */
export class AppointmentService {
  /**
   * Create a new appointment service
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.options = Object.assign({
      apiBase: '/api'
    }, options);
  }
  
  /**
   * Get appointments for a specific date
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<Object>} - Appointments data
   */
  async getAppointments(date) {
    try {
      return await fetchJSON(`${this.options.apiBase}/getWebApps?PDate=${date}`);
    } catch (error) {
      console.error('Error fetching appointments:', error);
      throw error;
    }
  }
  
  /**
   * Format appointment data for display
   * @param {Object} appointmentsData - Raw appointments data
   * @returns {Object} - Formatted appointments data
   */
  formatAppointmentsData(appointmentsData) {
    if (!appointmentsData) {
      return {
        all: 0,
        present: 0,
        waiting: 0,
        completed: 0,
        appointments: []
      };
    }
    
    return {
      all: appointmentsData.all || 0,
      present: appointmentsData.present || 0,
      waiting: appointmentsData.waiting || 0,
      completed: appointmentsData.completed || 0,
      appointments: this.formatAppointments(appointmentsData.appointments || [])
    };
  }
  
  /**
   * Format appointments array
   * @param {Array} appointments - Raw appointments
   * @returns {Array} - Formatted appointments
   * @private
   */
  formatAppointments(appointments) {
    return appointments.map(appointment => {
      // Process appointment data if necessary
      return appointment;
    });
  }
  
  /**
   * Get patient images for a specific timepoint
   * @param {string} patientId - Patient ID
   * @param {string} [timepoint='0'] - Timepoint code
   * @returns {Promise<Array>} - Patient images
   */
  async getPatientImages(patientId, timepoint = '0') {
    try {
      const images = await fetchJSON(`${this.options.apiBase}/getTimePointImgs?code=${patientId}&tp=${timepoint}`);
      
      // Transform image names to proper format
      return images.map(code => {
        const name = `${patientId}0${timepoint}.i${code}`;
        return { name };
      });
    } catch (error) {
      console.error('Error getting patient images:', error);
      return [];
    }
  }
  
  /**
   * Get latest visit summary for a patient
   * @param {string} patientId - Patient ID
   * @returns {Promise<Object>} - Latest visit summary
   */
  async getLatestVisitSummary(patientId) {
    try {
      return await fetchJSON(`${this.options.apiBase}/getLatestVisitsSum?PID=${patientId}`);
    } catch (error) {
      console.error('Error getting latest visit summary:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new AppointmentService();