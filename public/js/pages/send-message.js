// js/pages/send-message.js
/**
 * Send Message Controller
 * Handles the form for sending WhatsApp or Telegram messages
 */
import { formatPhoneNumber } from '../core/utils.js';
import { ProgressBar } from '../components/progress-bar.js';

class SendMessageController {
  /**
   * Initialize the controller
   */
  constructor() {
    // Parse URL parameters
    this.urlParams = new URLSearchParams(window.location.search);
    this.filePath = this.urlParams.get("file");
    this.path = this.filePath ? decodeURI(this.filePath) : '';
    this.pathsArray = this.path ? this.path.split(',') : [];
    
    // Initialize state
    this.selectedSource = 'pat';
    
    // Initialize components
    this.progressBar = new ProgressBar({
      filledBar: document.getElementById("filledBar"),
      emptyBar: document.getElementById("emptyBar"),
      interval: 200
    });
    
    // Find form elements
    this.form = document.getElementById("popform");
    this.fileInput = document.getElementById("file");
    this.sourceSelect = document.getElementById("source");
    this.peopleSelect = document.getElementById("people");
    this.phoneInput = document.getElementById("phone");
    
    // Initialize
    this.init();
  }
  
  /**
   * Initialize the page
   */
  async init() {
    // Set file path
    if (this.fileInput && this.path) {
      this.fileInput.value = this.path;
    }
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Initialize select2 for contacts
    await this.initializeContactSelect();
  }
  
  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Form submission
    if (this.form) {
      this.form.addEventListener('submit', this.handleSubmit.bind(this));
    }
    
    // Source change
    if (this.sourceSelect) {
      this.sourceSelect.addEventListener('change', this.handleSourceChange.bind(this));
    }
    
    // Close button
    const closeButton = document.getElementById('close');
    if (closeButton) {
      closeButton.addEventListener('click', this.handleClose.bind(this));
    }
  }
  
  /**
   * Initialize contact select with select2
   */
  async initializeContactSelect() {
    try {
      // Get current source
      const source = this.sourceSelect ? this.sourceSelect.value : 'pat';
      this.selectedSource = source;
      
      // Fetch contacts data
      const data = await this.fetchContacts(source);
      
      // Initialize select2
      $(this.peopleSelect).select2({
        data: data,
        templateResult: this.formatOption,
        templateSelection: this.formatOption
      });
      
      // Handle contact selection
      $(this.peopleSelect).on('select2:select', this.handleContactSelect.bind(this));
    } catch (error) {
      console.error('Error initializing contact select:', error);
    }
  }
  
  /**
   * Format option for select2
   * @param {Object} option - Select option
   * @returns {jQuery} - Formatted option
   */
  formatOption(option) {
    return $(
      `<div class="two-column-option">
        <div class="column">${option.name || ''}</div>
        <div class="column">${option.phone || ''}</div>
      </div>`
    );
  }
  
  /**
   * Handle source change
   * @param {Event} event - Change event
   */
  async handleSourceChange(event) {
    const selectedSource = event.target.value;
    this.selectedSource = selectedSource;
    
    try {
      // Fetch new data
      const newData = await this.fetchContacts(selectedSource);
      
      // Update select2
      $(this.peopleSelect).empty().select2({
        data: newData,
        templateResult: this.formatOption,
        templateSelection: this.formatOption
      });
    } catch (error) {
      console.error('Error changing source:', error);
    }
  }
  
  /**
   * Handle contact selection
   * @param {Event} event - Select2 event
   */
  handleContactSelect(event) {
    if (!event.params || !event.params.data) return;
    
    const phoneNo = event.params.data.phone;
    if (!phoneNo) return;
    
    if (this.selectedSource === 'pat') {
      // Format patient phone
      this.phoneInput.value = '964' + phoneNo;
    } else {
      // Format other phone types
      const match = phoneNo.match(/(?:(?:(?:00)|\+)(?:964)|0)[ ]?(\d{3})[ ]?(\d{3})[ ]?(\d{4})/);
      if (match) {
        this.phoneInput.value = '964' + match[1] + match[2] + match[3];
      } else {
        this.phoneInput.value = phoneNo;
      }
    }
  }
  
  /**
   * Fetch contacts from server
   * @param {string} source - Contact source
   * @returns {Promise<Array>} - Contact data
   */
  async fetchContacts(source) {
    try {
      let response;
      if (source === 'pat') {
        response = await fetch('/api/patientsPhones');
      } else {
        response = await fetch('/api/google?source=' + encodeURIComponent(source));
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching contacts:', error);
      this.showErrorMessage(`Failed to load contacts: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Handle form submission
   * @param {Event} event - Submit event
   */
  async handleSubmit(event) {
    event.preventDefault();
    
    // Get form data
    const phone = this.phoneInput.value;
    const prog = document.getElementById("prog").value;
    const file = this.fileInput.value;
    
    // Validate inputs
    if (!phone || !phone.trim()) {
      this.showErrorMessage('Please enter a phone number');
      return;
    }
    
    if (!file || !file.trim()) {
      this.showErrorMessage('Please select a file to send');
      return;
    }
    
    // Only check WhatsApp client status if WhatsApp is selected
    if (prog === "WhatsApp") {
      const isReady = await this.checkClientStatus();
      if (!isReady) {
        return; // Error message already shown
      }
    }
    
    // Start progress bar
    this.progressBar.initiate();
    const formData = new FormData();
    
    formData.append("prog", prog);
    formData.append("phone", phone);
    formData.append("file", this.fileInput.value);
    
    try {
      // Send form data
      const response = await fetch(`${window.location.origin}/api/sendmedia2`, {
        method: "POST",
        body: formData
      });
      
      // Check response status
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Handle response
      if (data.result === "OK") {
        this.progressBar.finish();
        const platform = prog === "WhatsApp" ? "WhatsApp" : "Telegram";
        const fileCount = this.fileInput.value.split(',').length;
        this.showSuccessMessage(`${platform} message sent successfully! (${data.sentMessages || 0}/${fileCount} files sent)`);
      } else if (data.error) {
        this.progressBar.reset();
        const platform = prog === "WhatsApp" ? "WhatsApp" : "Telegram";
        this.showErrorMessage(`${platform} Error: ${data.error}`);
      } else {
        this.progressBar.reset();
        this.showErrorMessage('Unknown error occurred while sending message');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      this.progressBar.reset();
      const platform = prog === "WhatsApp" ? "WhatsApp" : "Telegram";
      this.showErrorMessage(`Failed to send ${platform} message: ${error.message}`);
    }
  }
  
  /**
   * Check WhatsApp client status
   * @returns {Promise<boolean>} - True if ready to send
   */
  async checkClientStatus() {
    try {
      const response = await fetch('/api/wa/status');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      console.log('Client status check result:', data);
      
      if (data.success === false) {
        this.showErrorMessage(`WhatsApp service error: ${data.message || 'Unknown error'}`);
        return false;
      }
      
      if (data.clientReady) {
        return true;
      } else {
        // Check if client is initializing
        if (data.initializing) {
          this.showClientInitializingMessage();
        } else {
          this.showClientNotReadyMessage();
        }
        return false;
      }
    } catch (error) {
      console.error('Error checking client status:', error);
      this.showErrorMessage(`Unable to check WhatsApp client status: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Show client not ready message
   */
  showClientNotReadyMessage() {
    const message = `
      <div class="status-message error">
        <h3>WhatsApp Client Not Ready</h3>
        <p>The WhatsApp client is not logged in or not ready to send messages.</p>
        <p>Please go to <a href="/send" target="_blank">Send Page</a> to authenticate and initialize the WhatsApp client.</p>
        <button onclick="window.location.reload()" class="retry-btn">Retry</button>
      </div>
    `;
    this.showMessage(message);
  }

  /**
   * Show client initializing message
   */
  showClientInitializingMessage() {
    const message = `
      <div class="status-message warning">
        <h3>WhatsApp Client Initializing</h3>
        <p>The WhatsApp client is currently starting up. Please wait a moment and try again.</p>
        <button onclick="window.location.reload()" class="retry-btn">Retry</button>
      </div>
    `;
    this.showMessage(message);
  }
  
  /**
   * Show success message
   * @param {string} text - Success message
   */
  showSuccessMessage(text) {
    const message = `<div class="status-message success">${text}</div>`;
    this.showMessage(message);
  }
  
  /**
   * Show error message
   * @param {string} text - Error message
   */
  showErrorMessage(text) {
    const message = `<div class="status-message error">${text}</div>`;
    this.showMessage(message);
  }
  
  /**
   * Show message in popup
   * @param {string} html - Message HTML
   */
  showMessage(html) {
    // Remove existing messages
    const existing = document.querySelector('.status-message');
    if (existing) {
      existing.remove();
    }
    
    // Create message element
    const messageDiv = document.createElement('div');
    messageDiv.innerHTML = html;
    const messageElement = messageDiv.firstElementChild;
    
    // Insert after form
    if (this.form && this.form.parentNode) {
      this.form.parentNode.insertBefore(messageElement, this.form.nextSibling);
    } else {
      document.body.appendChild(messageElement);
    }
    
    // Auto-remove success messages after 5 seconds
    if (messageElement.classList.contains('success')) {
      setTimeout(() => {
        if (messageElement.parentNode) {
          messageElement.remove();
        }
      }, 5000);
    }
  }
  
  /**
   * Handle close button click
   */
  handleClose() {
    // Close the modal/window
    if (window.opener) {
      // If opened from another window, close this window
      window.close();
    } else {
      // If opened directly, redirect to home or hide the modal
      window.location.href = '/';
    }
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Need to wait for jQuery and Select2 to be available
  if (typeof $ !== 'undefined' && $.fn.select2) {
    new SendMessageController();
  } else {
    console.error('jQuery or Select2 not loaded. Required for this page.');
  }
});