// js/pages/visits.js
/**
 * Visits Summary page controller
 */
import api from '../services/api.js';
import { formatDate } from '../core/utils.js';
import { Modal } from '../components/modal.js';
import { gettimepoints } from '../utils/navigation.js';

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
    // Use the universal navigation component
    if (this.patientId) {
      gettimepoints(this.patientId, "visitsSummary");
    }

  }
  
  async loadWiresData() {
    try {
      // Store wire options for later use
      this.wireOptions = await api.getWires();
      
      // Populate wire dropdowns
      this.populateWireOptions();
    } catch (error) {
      console.error('Error fetching wire options:', error);
      throw error;
    }
  }
  
  populateWireOptions() {
    const upperWireSelect = document.getElementById('upperWire');
    const lowerWireSelect = document.getElementById('lowerWire');
    
    if (!upperWireSelect || !lowerWireSelect || !this.wireOptions) return;
    
    // Clear existing options
    upperWireSelect.innerHTML = '';
    lowerWireSelect.innerHTML = '';
    
    // Add placeholder option
    const addPlaceholder = (select) => {
      const placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.text = 'Select Wire';
      select.add(placeholderOption);
    };
    
    addPlaceholder(upperWireSelect);
    addPlaceholder(lowerWireSelect);
    
    // Add wire options
    this.wireOptions.forEach(wire => {
      const upperOption = new Option(wire.name, wire.id);
      upperWireSelect.add(upperOption);
      
      const lowerOption = new Option(wire.name, wire.id);
      lowerWireSelect.add(lowerOption);
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
      
      // Create table
      const table = document.createElement('table');
      
      // Add header row
      const headerRow = document.createElement('tr');
      const headers = ['Visit Date', 'Summary', 'Actions'];
      
      headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        headerRow.appendChild(th);
      });
      
      table.appendChild(headerRow);
      
      // Add data rows
      visits.forEach(visit => {
        const row = document.createElement('tr');
        
        // Date cell
        const visitDateCell = document.createElement('td');
        visitDateCell.textContent = new Date(visit.VisitDate).toLocaleDateString();
        row.appendChild(visitDateCell);
        
        // Summary cell
        const summaryCell = document.createElement('td');
        summaryCell.innerHTML = visit.Summary;
        row.appendChild(summaryCell);
        
        // Actions cell
        const actionCell = document.createElement('td');
        
        // Edit button
        const editButton = document.createElement('button');
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => this.openEditModal(visit.ID));
        actionCell.appendChild(editButton);
        
        // Delete button
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', () => this.deleteVisit(visit.ID));
        actionCell.appendChild(deleteButton);
        
        row.appendChild(actionCell);
        table.appendChild(row);
      });
      
      this.visitsSummaryContainer.appendChild(table);
    } catch (error) {
      console.error('Error fetching visits summary:', error);
      this.showError('Failed to load visits summary');
    }
  }
  
  openModal() {
    if (this.modalElement) {
      this.modalElement.style.display = 'block';
    }
  }
  
  closeModal() {
    if (this.modalElement) {
      this.modalElement.style.display = 'none';
    }
  }
  
  async openAddVisitModal() {
    // Reset form
    const form = document.getElementById('visitForm');
    if (form) {
      form.reset();
    }
    
    // Set patient ID
    const pidInput = document.getElementById('PID');
    if (pidInput) {
      pidInput.value = this.patientId;
    }
    
    // Set default date to today
    const visitDateInput = document.getElementById('visitDate');
    if (visitDateInput) {
      visitDateInput.value = new Date().toISOString().substring(0, 10);
    }
    
    // Get latest wire if available
    try {
      const latestWire = await api.getLatestWire(this.patientId);
      
      if (latestWire) {
        // Set wire values
        const upperWireSelect = document.getElementById('upperWire');
        const lowerWireSelect = document.getElementById('lowerWire');
        
        if (upperWireSelect && latestWire.upperWireID) {
          upperWireSelect.value = latestWire.upperWireID;
        }
        
        if (lowerWireSelect && latestWire.lowerWireID) {
          lowerWireSelect.value = latestWire.lowerWireID;
        }
      }
    } catch (error) {
      console.error('Error getting latest wire:', error);
    }
    
    // Show add button, hide update button
    const updateVisitButton = document.getElementById('updateVisitButton');
    const addVisitButton = document.getElementById('addVisitButton');
    
    if (updateVisitButton) {
      updateVisitButton.style.display = 'none';
    }
    
    if (addVisitButton) {
      addVisitButton.style.display = 'inline-block';
    }
    
    // Open modal
    this.openModal();
  }
  
  async openEditModal(visitId) {
    try {
      // Get visit details
      const visit = await api.getVisitDetailsById(visitId);
      
      // Set form values
      const vidInput = document.getElementById('VID');
      const visitDateInput = document.getElementById('visitDate');
      const othersInput = document.getElementById('others');
      const nextInput = document.getElementById('next');
      
      if (vidInput) {
        vidInput.value = visitId;
      }
      
      if (visitDateInput && visit.visitDate) {
        visitDateInput.value = new Date(visit.visitDate).toISOString().slice(0, 10);
      }
      
      if (othersInput) {
        othersInput.value = visit.others || '';
      }
      
      if (nextInput) {
        nextInput.value = visit.next || '';
      }
      
      // Set wire values
      this.setSelectedWireOption('upperWire', visit.upperWireID);
      this.setSelectedWireOption('lowerWire', visit.lowerWireID);
      
      // Show update button, hide add button
      const updateVisitButton = document.getElementById('updateVisitButton');
      const addVisitButton = document.getElementById('addVisitButton');
      
      if (updateVisitButton) {
        updateVisitButton.style.display = 'inline-block';
      }
      
      if (addVisitButton) {
        addVisitButton.style.display = 'none';
      }
      
      // Open modal
      this.openModal();
    } catch (error) {
      console.error('Error opening edit modal:', error);
      alert('Failed to load visit details');
    }
  }
  
  setSelectedWireOption(selectId, wireId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    Array.from(select.options).forEach(option => {
      option.selected = option.value == wireId;
    });
  }
  
  async handleAddVisit(event) {
    event.preventDefault();
    
    // Get form data
    const form = document.getElementById('visitForm');
    if (!form) return;
    
    const formData = new FormData(form);
    
    // Prepare visit data
    const visitData = {
      PID: this.patientId,
      visitDate: formData.get('visitDate'),
      upperWireID: formData.get('upperWire') || null,
      lowerWireID: formData.get('lowerWire') || null,
      others: formData.get('others'),
      next: formData.get('next')
    };
    
    try {
      // Send request
      const result = await api.addVisit(visitData);
      
      if (result.status === 'success') {
        alert('Visit added successfully!');
        this.closeModal();
        await this.fetchAndDisplayVisitsSummary();
      } else {
        alert(result.message || 'Error adding visit');
      }
    } catch (error) {
      console.error('Error adding visit:', error);
      alert('Error adding visit');
    }
  }
  
  async handleUpdateVisit(event) {
    event.preventDefault();
    
    // Get form data
    const form = document.getElementById('visitForm');
    if (!form) return;
    
    const formData = new FormData(form);
    
    // Prepare visit data
    const visitData = {
      VID: formData.get('VID'),
      visitDate: formData.get('visitDate'),
      upperWireID: formData.get('upperWire') || null,
      lowerWireID: formData.get('lowerWire') || null,
      others: formData.get('others'),
      next: formData.get('next')
    };
    
    try {
      // Send request
      const result = await api.updateVisit(visitData);
      
      if (result.status === 'success') {
        alert('Visit updated successfully!');
        this.closeModal();
        await this.fetchAndDisplayVisitsSummary();
      } else {
        alert('Error updating visit');
      }
    } catch (error) {
      console.error('Error updating visit:', error);
      alert('Error updating visit');
    }
  }
  
  async deleteVisit(visitId) {
    if (!confirm('Are you sure you want to delete this visit?')) {
      return;
    }
    
    try {
      const result = await api.deleteVisit(visitId);
      
      if (result.status === 'success') {
        alert('Visit deleted successfully!');
        await this.fetchAndDisplayVisitsSummary();
      } else {
        alert('Error deleting visit');
      }
    } catch (error) {
      console.error('Error deleting visit:', error);
      alert('Error deleting visit');
    }
  }
  
  showEmptyState() {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No visits found for this patient.';
    
    this.visitsSummaryContainer.appendChild(emptyState);
  }
  
  showError(message) {
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    
    // Add to container or body
    if (this.visitsSummaryContainer) {
      this.visitsSummaryContainer.appendChild(errorElement);
    } else {
      document.body.appendChild(errorElement);
    }
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new VisitsSummaryController();
});