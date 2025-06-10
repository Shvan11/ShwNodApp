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
    this.clientStatus = {
      ready: false,
      error: null
    };
    
    // WebSocket connection
    this.connectionManager = null;
    
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
    
    // Initialize WebSocket for real-time client status
    await this.initializeWebSocket();
    
    // Initialize select2 for contacts
    await this.initializeContactSelect();
    
    // Check initial client status
    await this.checkInitialClientStatus();
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
   * Initialize WebSocket connection for real-time updates
   */
  async initializeWebSocket() {
    try {
      // Import websocket service
      const websocketService = (await import('../services/websocket.js')).default;
      this.connectionManager = websocketService;
      
      // Setup WebSocket event handlers - only listen to client ready events
      this.connectionManager.on('whatsapp_client_ready', (data) => {
        console.log('WhatsApp client ready:', data);
        this.updateClientStatus({
          ready: data.clientReady || data.state === 'ready',
          error: null
        });
      });
      
      this.connectionManager.on('whatsapp_initial_state_response', (data) => {
        console.log('Initial state received:', data);
        if (data) {
          this.updateClientStatus({
            ready: data.clientReady || false,
            error: data.error || null
          });
        }
      });
      
      // Connect to WebSocket - no QR events needed
      await this.connectionManager.connect({
        clientType: 'send-message',
        timestamp: Date.now()
      });
      
      console.log('WebSocket connection established for send-message');
      
    } catch (error) {
      console.error('Failed to initialize WebSocket:', error);
      // Fallback to API-only mode
      this.connectionManager = null;
    }
  }
  
  /**
   * Update client status and UI
   */
  updateClientStatus(status) {
    this.clientStatus = { ...this.clientStatus, ...status };
    console.log('Client status updated:', this.clientStatus);
    
    // Clear any existing status messages
    const existing = document.querySelector('.status-message');
    if (existing) {
      existing.remove();
    }
    
    // Update UI based on new status
    if (!this.clientStatus.ready) {
      if (this.clientStatus.error) {
        this.showErrorMessage(`WhatsApp Error: ${this.clientStatus.error}`);
      } else {
        this.showClientNotReadyMessage();
      }
    }
  }
  
  /**
   * Check initial client status
   */
  async checkInitialClientStatus() {
    // Request initial state if WebSocket is connected
    if (this.connectionManager && this.connectionManager.isConnected()) {
      this.connectionManager.send({
        type: 'request_whatsapp_initial_state',
        data: { timestamp: Date.now() }
      }).catch(error => {
        console.error('Failed to request initial state:', error);
        this.fallbackStatusCheck();
      });
    } else {
      // Fallback to API check
      this.fallbackStatusCheck();
    }
  }
  
  /**
   * Fallback API status check
   */
  async fallbackStatusCheck() {
    try {
      const response = await fetch('/api/wa/status');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      this.updateClientStatus({
        ready: data.clientReady || false,
        error: data.error || null
      });
      
    } catch (error) {
      console.error('Fallback status check failed:', error);
      this.updateClientStatus({
        ready: false,
        error: error.message
      });
    }
  }
  
  /**
   * Check WhatsApp client status
   * @returns {Promise<boolean>} - True if ready to send
   */
  async checkClientStatus() {
    // Use real-time status instead of making API call
    if (this.clientStatus.ready) {
      return true;
    } else {
      // Status message is already shown by updateClientStatus
      return false;
    }
  }
  
  /**
   * Show client not ready message with authentication options
   */
  showClientNotReadyMessage() {
    const message = `
      <div class="status-message auth-required">
        <h3>WhatsApp Authentication Required</h3>
        <p>The WhatsApp client needs to be authenticated before sending messages.</p>
        <div class="auth-actions">
          <button onclick="window.open('/auth', 'whatsappAuth', 'width=600,height=700,resizable=yes,scrollbars=yes')" class="auth-popup-btn">
            <span class="btn-icon">🔐</span>
            Authenticate WhatsApp
          </button>
          <button onclick="window.location.reload()" class="retry-btn">
            <span class="btn-icon">🔄</span>
            Check Again
          </button>
        </div>
        <div class="auth-help">
          <p><small>Click "Authenticate WhatsApp" to scan QR code in a popup window</small></p>
        </div>
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
    // Cleanup WebSocket connection
    this.cleanup();
    
    // Close the modal/window
    if (window.opener) {
      // If opened from another window, close this window
      window.close();
    } else {
      // If opened directly, redirect to home or hide the modal
      window.location.href = '/';
    }
  }
  
  /**
   * Cleanup resources
   */
  cleanup() {
    console.log('Cleaning up send-message controller');
    
    // Disconnect WebSocket
    if (this.connectionManager) {
      this.connectionManager.disconnect();
      this.connectionManager = null;
    }
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Need to wait for jQuery and Select2 to be available
  if (typeof $ !== 'undefined' && $.fn.select2) {
    const controller = new SendMessageController();
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      controller.cleanup();
    });
  } else {
    console.error('jQuery or Select2 not loaded. Required for this page.');
  }
});