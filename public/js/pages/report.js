// js/pages/report.js
/**
 * Report page controller
 * Handles WhatsApp report display
 */
class ReportPageController {
    constructor() {
      // Get URL parameters
      this.urlParams = new URLSearchParams(window.location.search);
      this.date = this.urlParams.get('date');
      
      // State
      this.repeating = true;
      
      // DOM elements
      this.stateElement = document.getElementById('state');
      
      // Initialize page
      this.init();
    }
    
    async init() {
      try {
        // Start the report process
        await this.startReport();
        
        // Begin polling for updates
        this.loadState();
      } catch (error) {
        console.error('Error initializing report page:', error);
        this.updateState('Error initializing report');
      }
    }
    
    async startReport() {
      try {
        const response = await fetch(`/api/wa/report?date=${this.date}`);
        const data = await response.json();
        this.updateState(data.htmltext);
      } catch (error) {
        console.error('Error starting report:', error);
        this.updateState('Error starting report process');
        throw error;
      }
    }
    
    async loadState() {
      while (this.repeating) {
        try {
          const response = await fetch('/api/updaterp');
          const data = await response.json();
          
          this.updateState(data.htmltext);
          
          if (data.finished) {
            this.repeating = false;
          }
          
          // Wait a moment before polling again
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error('Error loading state:', error);
          this.updateState('Error updating status');
          this.repeating = false;
        }
      }
    }
    
    updateState(html) {
      if (this.stateElement) {
        this.stateElement.innerHTML = html;
      }
    }
  }
  
  // Initialize controller when DOM is loaded
  document.addEventListener('DOMContentLoaded', () => {
    new ReportPageController();
  });