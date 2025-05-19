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
    if (source === 'pat') {
      const response = await fetch('/api/patientsPhones');
      return await response.json();
    } else {
      const response = await fetch('/api/google?source=' + source);
      return await response.json();
    }
  }
  
  /**
   * Handle form submission
   * @param {Event} event - Submit event
   */
  async handleSubmit(event) {
    event.preventDefault();
    
    // Start progress bar
    this.progressBar.initiate();
    
    // Get form data
    const phone = this.phoneInput.value;
    const prog = document.getElementById("prog").value;
    const formData = new FormData();
    
    formData.append("prog", prog);
    formData.append("phone", phone);
    formData.append("file", this.fileInput.value);
    
    try {
      // Send form data
      const response = await fetch(`${window.location.origin}/sendmedia2`, {
        method: "POST",
        body: formData
      });
      
      const data = await response.json();
      
      // Handle response
      if (data.qr) {
        // Show QR code for authentication
        this.showQRCode(data.qr);
        this.updateQR();
      } else if (data.result === "OK") {
        // Complete progress bar
        this.progressBar.finish();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      this.progressBar.reset();
    }
  }
  
  /**
   * Show QR code
   * @param {string} qrData - QR code data URL
   */
  showQRCode(qrData) {
    const img = document.createElement("img");
    img.setAttribute('id', 'qr_img');
    img.src = qrData;
    document.body.appendChild(img);
    
    if (this.form) {
      this.form.style.display = "none";
    }
  }
  
  /**
   * Update QR code status
   */
  async updateQR() {
    try {
      const response = await fetch(`${window.location.origin}/checkqr`);
      const data = await response.json();
      
      if (data.qr) {
        // Update QR code image
        const img = document.getElementById("qr_img");
        if (img) {
          img.src = data.qr;
        }
        // Continue checking
        this.updateQR();
      } else if (data.status === "success") {
        // Authentication successful
        alert("Authorized successfully");
        
        if (this.form) {
          this.form.style.display = "block";
        }
        
        const qrImg = document.getElementById("qr_img");
        if (qrImg) {
          qrImg.remove();
        }
      }
    } catch (error) {
      console.error('Error checking QR status:', error);
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