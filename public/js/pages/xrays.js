// js/pages/xrays.js
/**
 * Xrays page controller
 */
import patientService from '../services/patient.js';
import { Modal } from '../components/modal.js';

class XraysPageController {
  constructor() {
    // Get URL parameters
    this.urlParams = new URLSearchParams(window.location.search);
    this.patientId = this.urlParams.get('code');
    this.phone = null;
    
    // Initialize page
    this.init();
  }
  
  async init() {
    try {
      // Load patient info
      const patientInfo = await patientService.getPatientInfo(this.patientId);
      this.phone = patientInfo.phone;
      
      // Fill xrays data
      this.fillXrays(patientInfo);
      
      // Load timepoints navigation
      this.loadTimepoints();
      
      // Create messaging modal
      this.setupMessagingModal();
    } catch (error) {
      console.error('Error initializing xrays page:', error);
    }
  }
  
  fillXrays(patientInfo) {
    if (!patientInfo.xrays || patientInfo.xrays.length === 0) return;
    
    const xraysList = document.querySelector('.xrays');
    if (!xraysList) return;
    
    patientInfo.xrays.forEach(xray => {
      // Skip PatientInfo.xml file
      if (xray.name === 'PatientInfo.xml') return;
      
      // Create xray item
      const xrayItem = document.createElement('li');
      xrayItem.className = 'x_item';
      
      // Create link
      const xrayLink = document.createElement('a');
      xrayLink.href = `api/getxray/?code=${this.patientId}&file=${xray.name}&imageF=${xray.imageFile}`;
      
      // Create date element
      const dateElement = document.createElement('p');
      dateElement.textContent = xray.date || xray.name;
      
      // Create image container
      const imageContainer = document.createElement('div');
      imageContainer.className = 'x_img_container';
      
      // Add preview image if available
      if (xray.previewImagePartialPath) {
        const img = document.createElement('img');
        img.src = `assets/${this.patientId}${xray.previewImagePartialPath}`;
        img.className = 'x_img';
        imageContainer.appendChild(img);
        xrayLink.appendChild(imageContainer);
      } else {
        xrayLink.textContent = 'Click to view X-ray';
      }
      
      // Add send button
      const sendButton = document.createElement('button');
      sendButton.textContent = 'Send';
      sendButton.addEventListener('click', () => this.showSendModal(xray));
      
      // Add elements to item
      xrayItem.appendChild(xrayLink);
      xrayItem.appendChild(dateElement);
      xrayItem.appendChild(sendButton);
      
      // Add item to list
      xraysList.appendChild(xrayItem);
    });
  }
  
  loadTimepoints() {
    // Use the existing module.js function for navigation
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import { gettimepoints } from "/js/utils/navigation.js";
      gettimepoints("${this.patientId}", "xrays");
    `;
    document.body.appendChild(script);
  }
  
  setupMessagingModal() {
    // Check if modal already exists
    const modalContainer = document.getElementById('send-modal');
    if (modalContainer) return;
    
    // Create modal elements
    const modalContent = `
      <form id="sendForm" class="waform">
        <h2>Send X-ray</h2>
        <hr>
        <select id="prog" name="prog" class="wainput">
          <option value="WhatsApp">WhatsApp</option>
          <option value="Telegram">Telegram</option>
        </select>
        <input id="phone" name="phone" placeholder="Phone" type="number" class="wainput">
        <input id="file" name="file" type="hidden">
        <div id="emptyBar">
          <div id="filledBar"></div>
        </div>
        <button type="submit" class="submit-btn">Send</button>
      </form>
    `;
    
    // Create the modal
    this.sendModal = new Modal({
      id: 'send-modal',
      title: 'Send X-ray',
      content: modalContent
    });
    
    // Add form submit handler
    const form = document.getElementById('sendForm');
    if (form) {
      form.addEventListener('submit', (event) => this.handleSendSubmit(event));
    }
  }
  
  showSendModal(xray) {
    if (!this.sendModal) return;
    
    // Set form values
    const phoneInput = document.getElementById('phone');
    const fileInput = document.getElementById('file');
    
    if (phoneInput && this.phone) {
      phoneInput.value = this.phone;
    }
    
    if (fileInput) {
      fileInput.value = JSON.stringify(xray);
    }
    
    // Show the modal
    this.sendModal.open();
    
    // Reset progress bar
    this.resetProgressBar();
  }
  
  async handleSendSubmit(event) {
    event.preventDefault();
    
    this.initiateProgressBar();
    
    // Get form data
    const formData = new FormData(event.target);
    const phone = formData.get('phone');
    const fileData = JSON.parse(formData.get('file'));
    const program = formData.get('prog');
    
    try {
      // Prepare request data
      const requestData = new FormData();
      requestData.append('prog', program);
      requestData.append('phone', phone);
      requestData.append('file', fileData.name);
      
      // Send request
      const response = await fetch(`${window.location.origin}/sendmedia2`, {
        method: 'POST',
        body: requestData
      });
      
      const data = await response.json();
      
      if (data.qr) {
        this.handleQrCode(data.qr);
      } else if (data.result === 'OK') {
        this.completeProgressBar();
        setTimeout(() => {
          this.sendModal.close();
        }, 1500);
      }
    } catch (error) {
      console.error('Error sending file:', error);
      this.resetProgressBar();
      alert('Failed to send file. Please try again.');
    }
  }
  
  handleQrCode(qrUrl) {
    // Check if QR container already exists
    let qrContainer = document.getElementById('qr-container');
    
    if (!qrContainer) {
      // Create container
      qrContainer = document.createElement('div');
      qrContainer.id = 'qr-container';
      qrContainer.style.textAlign = 'center';
      
      // Create image
      const qrImg = document.createElement('img');
      qrImg.id = 'qr-img';
      qrImg.style.maxWidth = '200px';
      qrImg.style.margin = '20px auto';
      
      qrContainer.appendChild(qrImg);
      
      // Add to modal
      const modalBody = this.sendModal.element.querySelector('.modal-body');
      if (modalBody) {
        modalBody.appendChild(qrContainer);
      }
    }
    
    // Update QR image
    const qrImg = document.getElementById('qr-img');
    if (qrImg) {
      qrImg.src = qrUrl;
    }
    
    // Hide form
    const form = document.getElementById('sendForm');
    if (form) {
      form.style.display = 'none';
    }
    
    // Start checking QR status
    this.checkQrStatus();
  }
  
  async checkQrStatus() {
    try {
      const response = await fetch(`${window.location.origin}/checkqr`);
      const data = await response.json();
      
      if (data.qr) {
        // Update QR image
        const qrImg = document.getElementById('qr-img');
        if (qrImg) {
          qrImg.src = data.qr;
        }
        
        // Continue checking
        setTimeout(() => this.checkQrStatus(), 2000);
      } else if (data.status === 'success') {
        alert('Authorized successfully');
        
        // Show form again
        const form = document.getElementById('sendForm');
        if (form) {
          form.style.display = 'block';
        }
        
        // Remove QR container
        const qrContainer = document.getElementById('qr-container');
        if (qrContainer) {
          qrContainer.remove();
        }
      }
    } catch (error) {
      console.error('Error checking QR status:', error);
    }
  }
  
  initiateProgressBar() {
    const filledBar = document.getElementById('filledBar');
    const emptyBar = document.getElementById('emptyBar');
    
    if (filledBar && emptyBar) {
      filledBar.style.width = '0%';
      filledBar.textContent = 'Sending...';
      filledBar.style.display = 'block';
      emptyBar.style.display = 'block';
      
      let width = 1;
      this.progressTimer = setInterval(() => {
        if (width >= 90) {
          clearInterval(this.progressTimer);
        } else {
          width++;
          filledBar.style.width = width + '%';
        }
      }, 100);
    }
  }
  
  completeProgressBar() {
    const filledBar = document.getElementById('filledBar');
    
    if (filledBar) {
      clearInterval(this.progressTimer);
      filledBar.style.width = '100%';
      filledBar.textContent = 'Done!';
    }
  }
  
  resetProgressBar() {
    const filledBar = document.getElementById('filledBar');
    const emptyBar = document.getElementById('emptyBar');
    
    if (filledBar && emptyBar) {
      clearInterval(this.progressTimer);
      filledBar.style.display = 'none';
      emptyBar.style.display = 'none';
      filledBar.style.width = '0%';
      filledBar.textContent = '';
    }
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new XraysPageController();
});