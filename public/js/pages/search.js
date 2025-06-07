// js/pages/search.js
/**
 * Search page controller
 * Handles patient search functionality
 */
import api from '../services/api.js';

class SearchPageController {
  /**
   * Initialize the search page controller
   */
  constructor() {
    // DOM elements
    this.firstNameSelect = document.getElementById('firstName');
    this.phoneSelect = document.getElementById('phone');
    this.idSelect = document.getElementById('id');
    
    // Load patient data and initialize selects
    this.init();
  }
  
  /**
   * Initialize the page
   */
  async init() {
    try {
      // Fetch patient data
      const patients = await api.getPatientPhones();
      
      // Format data for selects
      const formattedData = this.formatDataForSelects(patients);
      
      // Initialize TomSelect instances
      this.initializeTomSelect(formattedData);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      this.showError('Failed to load patient data. Please try again later.');
    }
  }
  
  /**
   * Format patient data for TomSelect dropdowns
   * @param {Array} patients - Patient data from API
   * @returns {Object} - Formatted data for different selects
   */
  formatDataForSelects(patients) {
    return {
      names: patients.map(patient => ({
        value: patient.id,
        text: patient.name
      })),
      phones: patients.map(patient => ({
        value: patient.id,
        text: patient.phone
      })),
      ids: patients.map(patient => ({
        value: patient.id,
        text: patient.id
      }))
    };
  }
  
  /**
   * Initialize TomSelect dropdowns
   * @param {Object} data - Formatted dropdown data
   */
  initializeTomSelect(data) {
    // Common settings
    const baseSettings = {
      maxItems: 1,
    };
    
    // Initialize name dropdown
    this.nameSelect = new TomSelect(this.firstNameSelect, {
      ...baseSettings,
      options: data.names
    });
    
    // Initialize phone dropdown
    this.phoneSelect = new TomSelect(this.phoneSelect, {
      ...baseSettings,
      options: data.phones
    });
    
    // Initialize ID dropdown
    this.idSelect = new TomSelect(this.idSelect, {
      ...baseSettings,
      options: data.ids
    });
    
    // Add change handlers
    this.addChangeHandlers();
  }
  
  /**
   * Add change handlers to selects
   */
  addChangeHandlers() {
    // Common change handler
    const handleChange = (value) => {
      // Clear all selects
      this.nameSelect.clear();
      this.phoneSelect.clear();
      this.idSelect.clear();
      
      // Redirect to grid page
      window.location.href = `grid?code=${value}`;
    };
    
    // Apply to all selects
    this.nameSelect.on('change', function() {
      handleChange(this.items[0]);
    });
    
    this.phoneSelect.on('change', function() {
      handleChange(this.items[0]);
    });
    
    this.idSelect.on('change', function() {
      handleChange(this.items[0]);
    });
  }
  
  /**
   * Show error message
   * @param {string} message - Error message
   */
  showError(message) {
    const errorElement = document.getElementById('error-message');
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
    }
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SearchPageController();
});