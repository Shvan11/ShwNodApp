// js/pages/visits-summary.js
import api from '../services/api.js';
import { formatDate } from '../core/utils.js';

class VisitsSummaryController {
  constructor() {
    // Get patient ID from URL
    this.urlParams = new URLSearchParams(window.location.search);
    this.patientId = this.urlParams.get('PID');
    
    // Find DOM elements
    this.visitsSummaryContainer = document.getElementById('visitsSummary');
    this.addVisitBtn = document.getElementById('showAddBtn');
    this.modalElement = document.getElementById('addVisitModal');
    this.closeModalBtn = document.querySelector('.close');
    
    // Initialize page
    this.init();
  }
  
  async init() {
    // Check if patient ID is present
    if (!this.patientId) {
      this.showError('Patient ID is missing');
      return;
    }
    
    try {
      // Initialize event listeners
      this.setupEventListeners();
      
      // Load timepoints for navigation
      this.loadTimepoints();
      
      // Load wires data for form
      await this.loadWiresData();
      
      // Fetch and display visits summary
      await this.fetchAndDisplayVisitsSummary();
    } catch (error) {
      console.error('Error initializing visits page:', error);
      this.showError('Failed to initialize page');
    }
  }
  
  // All other methods from the original file follow here...
  // Only keeping the most important ones for brevity
  
  setupEventListeners() {
    // Add visit button click
    if (this.addVisitBtn) {
      this.addVisitBtn.addEventListener('click', () => this.openAddVisitModal());
    }
    
    // Modal close button
    if (this.closeModalBtn) {
      this.closeModalBtn.addEventListener('click', () => this.closeModal());
    }
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
      if (event.target === this.modalElement) {
        this.closeModal();
      }
    });
    
    // Form buttons
    const updateVisitBtn = document.getElementById('updateVisitButton');
    const addVisitBtn = document.getElementById('addVisitButton');
    
    if (updateVisitBtn) {
      updateVisitBtn.addEventListener('click', (event) => this.handleUpdateVisit(event));
    }
    
    if (addVisitBtn) {
      addVisitBtn.addEventListener('click', (event) => this.handleAddVisit(event));
    }
  }
  
  loadTimepoints() {
    // Import the gettimepoints function dynamically
    import('../utils/navigation.js').then(module => {
      module.gettimepoints(this.patientId, "visitsSummary");
    });
  }
  
  async fetchAndDisplayVisitsSummary() {
    try {
      const visits = await api.getVisitsSummary(this.patientId);
      
      if (!this.visitsSummaryContainer) return;
      
      this.visitsSummaryContainer.innerHTML = '';
      
      if (!visits || visits.length === 0) {
        this.showEmptyState();
        return;
      }
      
      // Create and populate table
      const table = document.createElement("table");
      
      // Add header row
      const headerRow = document.createElement("tr");
      const headers = ["Visit Date", "Summary", "Actions"];
      
      headers.forEach(header => {
        const th = document.createElement("th");
        th.textContent = header;
        headerRow.appendChild(th);
      });
      
      table.appendChild(headerRow);
      
      // Add visit rows
      // ... implement visit rows
      
      this.visitsSummaryContainer.appendChild(table);
    } catch (error) {
      console.error('Error fetching visits summary:', error);
      this.showError('Failed to load visits summary');
    }
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new VisitsSummaryController();
});