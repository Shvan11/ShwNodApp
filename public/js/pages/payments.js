// js/pages/payments.js
/**
 * Payments page controller
 */
import patientService from '../services/patient.js';

class PaymentsPageController {
  constructor() {
    // Get patient ID from URL
    this.urlParams = new URLSearchParams(window.location.search);
    this.patientId = this.urlParams.get('code');
    
    // Initialize page
    this.init();
  }
  
  async init() {
    try {
      // Fetch payment data
      const payments = await patientService.getPayments(this.patientId);
      
      // Update payments table
      this.updatePaymentsTable(payments);
    } catch (error) {
      console.error('Error loading payments:', error);
      this.showError('Failed to load payment data');
    }
  }
  
  updatePaymentsTable(payments) {
    if (!payments || payments.length === 0) {
      this.showEmptyState();
      return;
    }
    
    const table = document.querySelector('table');
    if (!table) return;
    
    const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
    tbody.innerHTML = ''; // Clear existing rows
    
    // Add rows for each payment
    payments.forEach((payment, index) => {
      const row = tbody.insertRow();
      
      // Index cell
      const indexCell = row.insertCell();
      indexCell.textContent = index + 1;
      
      // Date cell
      const dateCell = row.insertCell();
      dateCell.textContent = payment.Date;
      
      // Amount cell
      const amountCell = row.insertCell();
      amountCell.textContent = payment.Payment.toLocaleString('en-US');
    });
  }
  
  showEmptyState() {
    const container = document.querySelector('.container');
    if (!container) return;
    
    // Create empty state message
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No payment records found for this patient.';
    
    // Replace table with empty state
    const table = document.querySelector('table');
    if (table) {
      container.replaceChild(emptyState, table);
    } else {
      container.appendChild(emptyState);
    }
  }
  
  showError(message) {
    const container = document.querySelector('.container');
    if (!container) return;
    
    // Create error message
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    
    // Add to container
    container.appendChild(errorElement);
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PaymentsPageController();
});