// pages/canvas.js
/**
 * Canvas page controller
 * Handles the photo comparison functionality in canvas.html
 */
import { ImageComparison } from '../components/comparison.js';
import { debounce } from '../core/utils.js';
import patientService from '../services/patient.js';
import api from '../services/api.js';
import { Modal } from '../components/modal.js';

class CanvasPageController {
  /**
   * Initialize the canvas page controller
   */
  constructor() {
    // Get URL parameters
    this.urlParams = new URLSearchParams(window.location.search);
    this.patientId = this.urlParams.get('code');
    this.phone = this.urlParams.get('phone');
    
    // Initialize state
    this.imgGroups = [];
    this.timerId = null;
    this.duration = 200; // Duration for continuous button press
    
    // Create comparison component
    this.comparison = new ImageComparison('canvas', {
      onSizeChange: this.handleSizeChange.bind(this)
    });
    
    // Find DOM elements
    this.findElements();
    
    // Initialize event handlers
    this.initEventHandlers();
    
    // Load timepoints and images
    this.loadTimepoints();
  }
  
  /**
   * Find DOM elements used by the controller
   * @private
   */
  findElements() {
    // Radio buttons
    this.radioButtons = document.querySelectorAll('input[type=radio]');
    
    // Control buttons
    this.moveRightBtn = document.querySelector('#m1r');
    this.moveLeftBtn = document.querySelector('#m1l');
    this.resetBtn = document.querySelector('#rst');
    this.zoomInBtn = document.querySelector('#z');
    this.zoomOutBtn = document.querySelector('#zo');
    this.moveUpBtn = document.querySelector('#m1u');
    this.moveDownBtn = document.querySelector('#m1d');
    this.selectionDropdown = document.querySelector('#sel');
    this.orientationBtn = document.querySelector('#orient');
    this.sizeDropdown = document.querySelector('#c_s');
    this.rotateClockwiseBtn = document.querySelector('#rot_cl');
    this.rotateCounterClockwiseBtn = document.querySelector('#rot_ccl');
    this.increaseClipBtn = document.querySelector('#Inc_clp');
    this.decreaseClipBtn = document.querySelector('#Dec_clp');
    this.bisectBtn = document.querySelector('#bis');
    this.removeLogoBtn = document.querySelector('#rlogo');
    this.whatsappBtn = document.querySelector('#wa');
    this.closeBtn = document.querySelector('#close');
    this.whatsappForm = document.querySelector('#popform');
    
    // Iframe for responses
    this.iframe = document.querySelector('#invIframe');
    
    // WhatsApp modal elements
    this.modalContainer = document.querySelector('#abc');
    this.phoneInput = document.querySelector('#phone');
    this.fileInput = document.querySelector('#file');
    this.waImgElement = document.querySelector('#waimg');
    
    // Progress bar elements
    this.filledBar = document.getElementById('filledBar');
    this.emptyBar = document.getElementById('emptyBar');
  }
  
  /**
   * Initialize event handlers
   * @private
   */
  initEventHandlers() {
    // Radio button change events
    this.radioButtons.forEach(radio => {
      radio.addEventListener('change', this.handleRadioChange.bind(this));
    });
    
    // Button click events
    this.moveRightBtn.addEventListener('click', () => this.comparison.moveRight());
    this.moveLeftBtn.addEventListener('click', () => this.comparison.moveLeft());
    this.resetBtn.addEventListener('click', () => this.comparison.reset());
    this.zoomInBtn.addEventListener('click', () => this.comparison.zoomIn());
    this.zoomOutBtn.addEventListener('click', () => this.comparison.zoomOut());
    this.moveUpBtn.addEventListener('click', () => this.comparison.moveUp());
    this.moveDownBtn.addEventListener('click', () => this.comparison.moveDown());
    this.orientationBtn.addEventListener('click', () => this.comparison.changeOrientation());
    this.rotateClockwiseBtn.addEventListener('click', () => this.comparison.rotateClockwise());
    this.rotateCounterClockwiseBtn.addEventListener('click', () => this.comparison.rotateCounterClockwise());
    this.increaseClipBtn.addEventListener('click', () => this.comparison.increaseClip());
    this.decreaseClipBtn.addEventListener('click', () => this.comparison.decreaseClip());
    this.bisectBtn.addEventListener('click', () => this.comparison.toggleBisect());
    this.removeLogoBtn.addEventListener('click', () => this.comparison.removeLogo());
    
    // Dropdown change events
    this.selectionDropdown.addEventListener('change', this.handleSelectionChange.bind(this));
    this.sizeDropdown.addEventListener('change', this.handleSizeChange.bind(this));
    
    // Button press and hold events
    this.setupPressAndHoldEvents();
    
    // Modal events
    this.whatsappBtn.addEventListener('click', this.showWhatsAppModal.bind(this));
    this.closeBtn.addEventListener('click', this.hideWhatsAppModal.bind(this));
    this.whatsappForm.addEventListener('submit', this.handleWhatsAppSubmit.bind(this));
    
    // Iframe load event
    this.iframe.addEventListener('load', this.checkIframeResponse.bind(this));
  }
  
  /**
   * Set up press and hold events for buttons
   * @private
   */
  setupPressAndHoldEvents() {
    const buttons = [
      this.moveRightBtn,
      this.moveLeftBtn,
      this.moveUpBtn,
      this.moveDownBtn
    ];
    
    buttons.forEach(button => {
      button.addEventListener('mousedown', this.startButtonTimer.bind(this));
      button.addEventListener('mouseup', this.stopButtonTimer.bind(this));
      button.addEventListener('mouseleave', this.stopButtonTimer.bind(this));
    });
  }
  
  /**
   * Start the button timer for repeating actions
   * @param {Event} event - Mouse event
   * @private
   */
  startButtonTimer(event) {
    const button = event.target;
    this.timerId = setInterval(() => {
      button.click();
    }, this.duration);
  }
  
  /**
   * Stop the button timer
   * @private
   */
  stopButtonTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
  
  /**
   * Handle radio button change
   * @param {Event} event - Change event
   * @private
   */
  async handleRadioChange(event) {
    const selectedCategory = event.target.value;
    await this.loadImagesByCategory(selectedCategory);
  }
  
  /**
   * Handle selection dropdown change
   * @param {Event} event - Change event
   * @private
   */
  handleSelectionChange(event) {
    const selectedImage = parseInt(event.target.value, 10);
    this.comparison.setSelectedImage(selectedImage);
  }
  
  /**
   * Handle size dropdown change
   * @param {Event} event - Change event
   * @private
   */
  handleSizeChange(event) {
    let size;
    
    if (event && event.target) {
      // This is a DOM event
      size = event.target.value;
    } else if (event && event.width) {
      // This is a size object from the comparison component
      size = { width: event.width, height: event.height };
      
      // Update the dropdown value
      if (this.sizeDropdown) {
        const opts = Array.from(this.sizeDropdown.options);
        const autoOpt = opts.find(opt => opt.value === 'auto');
        
        if (autoOpt) {
          autoOpt.textContent = `Auto (${size.width} * ${size.height})`;
          this.sizeDropdown.selectedIndex = opts.indexOf(autoOpt);
        }
      }
      
      return;
    } else {
      // No argument - nothing to do
      return;
    }
    
    this.comparison.setCanvasSize(size);
  }
  
  /**
   * Show the WhatsApp modal
   * @private
   */
  showWhatsAppModal() {
    if (this.modalContainer) {
      this.modalContainer.style.display = 'block';
      
      // Set the phone number if available
      if (this.phone && this.phoneInput) {
        this.phoneInput.value = this.phone;
      }
      
      // Set the file data
      if (this.fileInput) {
        this.fileInput.value = this.comparison.toDataURL();
      }
      
      // Set the preview image
      if (this.waImgElement) {
        this.waImgElement.src = this.comparison.toDataURL();
      }
      
      // Reset progress bar
      this.resetProgressBar();
    }
  }
  
  /**
   * Hide the WhatsApp modal
   * @private
   */
  hideWhatsAppModal() {
    if (this.modalContainer) {
      this.modalContainer.style.display = 'none';
    }
  }
  
  /**
   * Handle WhatsApp form submission
   * @private
   */
  handleWhatsAppSubmit() {
    this.initiateProgressBar();
  }
  
  /**
   * Reset the progress bar
   * @private
   */
  resetProgressBar() {
    if (this.filledBar && this.emptyBar) {
      clearInterval(this.progressBarTimer);
      this.filledBar.style.display = 'none';
      this.emptyBar.style.display = 'none';
      this.filledBar.style.width = '0%';
      this.filledBar.textContent = '';
    }
  }
  
  /**
   * Initiate the progress bar
   * @private
   */
  initiateProgressBar() {
    if (this.filledBar && this.emptyBar) {
      this.filledBar.style.width = '0%';
      this.filledBar.textContent = 'Sending...';
      this.filledBar.style.display = 'block';
      this.emptyBar.style.display = 'block';
      
      let width = 1;
      this.progressBarTimer = setInterval(() => {
        if (width >= 90) {
          clearInterval(this.progressBarTimer);
        } else {
          width++;
          this.filledBar.style.width = width + '%';
        }
      }, 100);
    }
  }
  
  /**
   * Complete the progress bar
   * @private
   */
  completeProgressBar() {
    if (this.filledBar) {
      clearInterval(this.progressBarTimer);
      this.filledBar.style.width = '100%';
      this.filledBar.textContent = 'Done!';
    }
  }
  
  /**
   * Check iframe response
   * @private
   */
  checkIframeResponse() {
    if (this.iframe && this.iframe.textContent === 'OK') {
      this.completeProgressBar();
    }
  }
  
  /**
   * Load timepoints for the patient
   * @private
   */
  async loadTimepoints() {
    try {
      const timepoints = await patientService.getTimepoints(this.patientId);
      this.fillTimepoints(timepoints);
      
      // Load the "compare" tab from module.js
      const moduleScript = document.createElement('script');
      moduleScript.type = 'module';
      moduleScript.textContent = `
        import { gettimepoints } from "./module.js";
        gettimepoints("${this.patientId}", "compare");
      `;
      document.body.appendChild(moduleScript);
    } catch (error) {
      console.error('Error loading timepoints:', error);
    }
  }
  
  /**
   * Fill the timepoints in the UI
   * @param {Array} timepoints - Timepoint data
   * @private
   */
  fillTimepoints(timepoints) {
    if (!timepoints || timepoints.length === 0) return;
    
    const tpForm = document.querySelector('.times');
    if (!tpForm) return;
    
    timepoints.forEach((timepoint, index) => {
      const tpCheck = document.createElement('input');
      tpCheck.setAttribute('type', 'checkbox');
      tpCheck.setAttribute('value', timepoint.tpCode);
      tpCheck.setAttribute('id', timepoint.tpCode);
      tpCheck.setAttribute('name', 'tpCheck');
      tpCheck.addEventListener('click', this.handleTimepointSelection.bind(this));
      
      const tpLabel = document.createElement('label');
      tpLabel.setAttribute('for', timepoint.tpCode);
      tpLabel.innerHTML = `<strong>${timepoint.tpDescription}</strong><br />`;
      
      tpForm.appendChild(tpCheck);
      tpForm.appendChild(tpLabel);
      
      // Check the first and last timepoints by default
      if (index === 0 || index === timepoints.length - 1) {
        tpCheck.click();
      }
    });
  }
  
  /**
   * Handle timepoint selection
   * @param {Event} event - Click event
   * @private
   */
  async handleTimepointSelection(event) {
    const radios = document.querySelectorAll('[code]');
    
    if (!event.target.checked) {
      // Remove from imgGroups if unchecked
      for (let i = 0; i < this.imgGroups.length; i++) {
        if (this.imgGroups[i].tpCode === event.target.value) {
          // Hide radio buttons for unchecked timepoint
          for (const img of this.imgGroups[i].imgs) {
            for (const radio of radios) {
              if (img === radio.getAttribute('code')) {
                radio.setAttribute('style', 'display:none');
              }
            }
          }
          this.imgGroups.splice(i, 1);
          break;
        }
      }
      
      // Show only available images for remaining timepoint
      if (this.imgGroups.length === 1) {
        for (const radio of radios) {
          for (const img of this.imgGroups[0].imgs) {
            if (img === radio.getAttribute('code')) {
              radio.setAttribute('style', 'display:inline');
            }
          }
        }
      }
    } else {
      // Check if more than 2 timepoints are selected
      const selectedCount = Array.from(document.getElementsByName('tpCheck'))
        .filter(checkbox => checkbox.checked).length;
      
      if (selectedCount > 2) {
        alert('You can only choose two time points');
        event.target.checked = false;
        return;
      }
      
      // Add new timepoint images
      try {
        const timepointImages = await patientService.getTimepointImages(
          this.patientId, 
          event.target.value
        );
        
        this.imgGroups.push({ 
          tpCode: event.target.value, 
          imgs: timepointImages 
        });
        
        // Update visible radio buttons
        for (const radio of radios) {
          radio.setAttribute('style', 'display:inline');
          if (!timepointImages.includes(radio.getAttribute('code'))) {
            radio.setAttribute('style', 'display:none');
          }
        }
      } catch (error) {
        console.error('Error loading timepoint images:', error);
        event.target.checked = false;
      }
    }
  }
  
  /**
   * Load images by category
   * @param {string} category - Image category
   * @private
   */
  async loadImagesByCategory(category) {
    // Get timepoints
    const tps = this.imgGroups.map(group => group.tpCode);
    
    // Check if two timepoints are selected
    if (tps.length !== 2) {
      alert('You need to select two times');
      return;
    }
    
    // Sort timepoints chronologically
    tps.sort((a, b) => a - b);
    
    // Get category code
    const categoryCode = this.getCategoryCode(category);
    
    // Prepare image URLs
    const urls = [
      `DolImgs/${this.patientId}0${tps[0]}${categoryCode}`,
      `DolImgs/${this.patientId}0${tps[1]}${categoryCode}`,
      'logo_white.png'
    ];
    
    // Load images into comparison component
    try {
      await this.comparison.loadImages(urls);
    } catch (error) {
      console.error('Error loading images:', error);
      alert('Failed to load images');
    }
  }
  
  /**
   * Get image category code
   * @param {string} category - Image category
   * @returns {string} - Category code
   * @private
   */
  getCategoryCode(category) {
    const categoryMap = {
      'profile': '.i10',
      'rest': '.i12',
      'smile': '.i13',
      'upper': '.i23',
      'lower': '.i24',
      'right': '.i20',
      'center': '.i22',
      'left': '.i21'
    };
    
    return categoryMap[category] || '';
  }
}

// Initialize the controller when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new CanvasPageController();
});