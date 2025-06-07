// js/pages/patient-front.js
import { formatDate } from '../core/utils.js';
import patientService from '../services/patient.js';
import { Modal } from '../components/modal.js';

class PatientDetailsController {
  constructor() {
    // Get URL parameters
    this.urlParams = new URLSearchParams(window.location.search);
    this.patientId = this.urlParams.get("code");
    this.phone = null;
    this.timer = null;
    
    // Initialize page when DOM is loaded
    this.init();
  }
  
  async init() {
    // Set up event listeners
    document.getElementById("invisible").addEventListener("load", this.checkResponse.bind(this));
    
    // Set payment link
    document.querySelector(".plink").href = `payments?code=${this.patientId}`;
    
    // Set photo source
    document.querySelector(".photo").src = `DolImgs/${this.patientId}00.I13`;
    
    // Load patient info and timepoints
    await this.loadPatientInfo();
    await this.loadTimepoints();
  }
  
  async loadPatientInfo() {
    try {
      const patientInfo = await patientService.getPatientInfo(this.patientId);
      this.fillPatientInfo(patientInfo);
      this.phone = patientInfo.phone;
    } catch (error) {
      console.error('Error loading patient info:', error);
    }
  }
  
  async loadTimepoints() {
    try {
      const timepoints = await patientService.getTimepoints(this.patientId);
      this.fillTimepoints(timepoints);
    } catch (error) {
      console.error('Error loading timepoints:', error);
    }
  }
  
  fillPatientInfo(infos) {
    // Existing logic to fill patient info...
  }
  
  fillTimepoints(timepoints) {
    // Existing logic to fill timepoints...
  }
  
  compare() {
    window.location.href = `canvas?code=${this.patientId}&phone=${this.phone}`;
  }
  
  // Rest of methods converted from original functions...
  
  initiateProgressBar() {
    // Modernized progress bar code...
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PatientDetailsController();
});