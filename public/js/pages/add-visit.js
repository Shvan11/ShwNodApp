// js/pages/add-visit.js
import api from '../services/api.js';

class AddVisitController {
  constructor() {
    // Get URL parameters
    this.urlParams = new URLSearchParams(window.location.search);
    this.patientId = this.urlParams.get('PID');
    
    // Find form elements
    this.form = document.getElementById('visitForm');
    this.pidInput = document.getElementById('PID');
    this.visitDateInput = document.getElementById('visitDate');
    this.upperWireSelect = document.getElementById('upperWire');
    this.lowerWireSelect = document.getElementById('lowerWire');
    
    // Initialize page
    this.init();
  }
  
  async init() {
    try {
      // Set patient ID
      if (this.pidInput && this.patientId) {
        this.pidInput.value = this.patientId;
      }
      
      // Set default date to today
      if (this.visitDateInput) {
        this.visitDateInput.value = new Date().toISOString().substring(0, 10);
      }
      
      // Load wire options
      await this.loadWireOptions();
      
      // Set up form submission
      if (this.form) {
        this.form.addEventListener('submit', this.handleSubmit.bind(this));
      }
    } catch (error) {
      console.error('Error initializing add visit page:', error);
    }
  }
  
  async loadWireOptions() {
    try {
      const wires = await api.getWires();
      
      // Populate wire selects
      this.populateWireSelect(this.upperWireSelect, wires);
      this.populateWireSelect(this.lowerWireSelect, wires);
    } catch (error) {
      console.error('Error loading wire options:', error);
    }
  }
  
  populateWireSelect(select, wires) {
    if (!select || !wires) return;
    
    // Clear any existing options
    select.innerHTML = '';
    
    // Add options for each wire
    wires.forEach(wire => {
      const option = document.createElement('option');
      option.value = wire.id;
      option.text = wire.name;
      select.add(option);
    });
  }
  
  async handleSubmit(event) {
    event.preventDefault();
    
    try {
      // Get form data
      const formData = new FormData(this.form);
      
      // Create visit data object
      const visitData = {
        PID: formData.get('PID'),
        visitDate: formData.get('visitDate'),
        upperWireID: formData.get('upperWire') || null,
        lowerWireID: formData.get('lowerWire') || null,
        visitSummary: formData.get('visitSummary')
      };
      
      // Submit to API
      const result = await api.addVisit(visitData);
      
      if (result.status === 'success') {
        alert('Visit added successfully!');
        // Redirect back to visits summary page
        window.location.href = `visitsSummary.html?PID=${this.patientId}`;
      } else {
        alert('Failed to add visit. Please try again.');
      }
    } catch (error) {
      console.error('Error adding visit:', error);
      alert('An error occurred while adding the visit.');
    }
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new AddVisitController();
});