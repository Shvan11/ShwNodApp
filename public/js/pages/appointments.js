// pages/appointments.js
/**
 * Appointments Page Controller
 * Manages the appointments page functionality
 */
import Clock from '../components/clock.js';
import Table from '../components/table.js';
import websocket from '../services/websocket.js';
import appointmentService from '../services/appointment.js';
import storage from '../core/storage.js';
import { getElement, getElements } from '../core/dom.js';
import { formatDate } from '../core/utils.js';

class AppointmentsPageController {
  /**
   * Initialize the appointments page controller
   */
  constructor() {
    // Current date
    this.date = new Date();
    this.dateString = this.formatDateString(this.date);
    this.weekday = this.date.toLocaleDateString(undefined, { weekday: 'long' });
    
    // Ensure screen ID is set
    this.ensureScreenIdSet();
    
    // Active patient ID
    this.activePID = null;
    
    // Initialize properties
    this.findElements();
    this.setupClock();
    
    // Load appointments data
    this.loadAppointments();
    
    // Set up WebSocket connection
    this.setupWebSocket();
    
    // Set up day change detection
    this.setupDayChangeDetection();
  }
  
  /**
   * Ensure screen ID is set in storage
   * @private
   */
  ensureScreenIdSet() {
    // This will prompt for screen ID if not already set
    storage.screenId();
  }
  
  /**
   * Find DOM elements used by the controller
   * @private
   */
  findElements() {
    // Title element
    this.titleElement = getElement('#title');
    
    // Appointment table container
    this.tableContainer = getElement('#appointments-container');
    
    // Statistics elements
    this.statsElements = {
      all: getElement('#all'),
      present: getElement('#present'),
      waiting: getElement('#waiting'),
      completed: getElement('#completed')
    };
    
    // Images container
    this.imagesContainer = getElement('#images');
    
    // Latest visit container
    this.latestVisitContainer = getElement('#latestVisit');
  }
  
  /**
   * Format date to YYYY-M-D string
   * @param {Date} date - Date to format
   * @returns {string} - Formatted date
   * @private
   */
  formatDateString(date) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }
  
  /**
   * Set up the analog clock
   * @private
   */
  setupClock() {
    const canvasElement = getElement('#canvas');
    
    if (canvasElement) {
      this.clock = new Clock(canvasElement, {
        updateInterval: 10000 // Update every 10 seconds
      });
    }
  }
  
  /**
   * Load appointments data
   * @private
   */
  async loadAppointments() {
    try {
      // Update title
      if (this.titleElement) {
        this.titleElement.textContent = `${this.weekday} ${this.dateString}`;
      }
      
      // Fetch appointments
      const appointmentsData = await appointmentService.getAppointments(this.dateString);
      
      // Update UI with data
      this.updateAppointmentsUI(appointmentsData);
    } catch (error) {
      console.error('Error loading appointments:', error);
    }
  }
  
  /**
   * Update appointments UI
   * @param {Object} data - Appointments data
   * @private
   */
  updateAppointmentsUI(data) {
    // Update statistics
    this.updateStatistics(data);
    
    // Update table
    this.updateAppointmentsTable(data.appointments);
    
    // Highlight active patient
    this.highlightActivePatient();
  }
  
  /**
   * Update statistics display
   * @param {Object} data - Appointments data
   * @private
   */
  updateStatistics(data) {
    if (this.statsElements.all) {
      this.statsElements.all.textContent = data.all || 0;
    }
    
    if (this.statsElements.present) {
      this.statsElements.present.textContent = data.present || 0;
    }
    
    if (this.statsElements.waiting) {
      this.statsElements.waiting.textContent = data.waiting || 0;
    }
    
    if (this.statsElements.completed) {
      this.statsElements.completed.textContent = data.completed || 0;
    }
  }
  
  /**
   * Update appointments table
   * @param {Array} appointments - Appointments data
   * @private
   */
  updateAppointmentsTable(appointments) {
    // Format appointment data for the table component
    const formattedData = appointments.map(appointment => {
      // Transform the appointment array to an object with named properties
      return {
        no: appointment[0].value,
        time: appointment[1].value,
        type: appointment[2].value,
        patientName: appointment[3].value,
        detail: appointment[4].value,
        present: appointment[5].value,
        seated: appointment[6].value,
        dismissed: appointment[7].value,
        notes: appointment[8].value === 'true',
        pid: appointment[9].value
      };
    });
    
    // Define table columns
    const columns = [
      { field: 'no', title: 'No', width: 50 },
      { field: 'time', title: 'Time', width: 80 },
      { field: 'type', title: 'Type', width: 100 },
      { 
        field: 'patientName', 
        title: 'Patient Name',
        render: (value, row) => {
          // Create link to patient summary
          return `<a href="/visitsSummary.html?PID=${row.pid}">${value}</a>`;
        }
      },
      { field: 'detail', title: 'Detail' },
      { 
        field: 'present', 
        title: 'Present',
        cellClassName: 'status-cell',
        render: (value, row) => {
          // Apply cell styling based on appointment status
          let backgroundColor = 'pink'; // Default - waiting
          
          if (row.dismissed) {
            backgroundColor = 'lightgreen'; // Completed
          } else if (row.seated) {
            backgroundColor = 'lightyellow'; // Seated
          }
          
          return {
            content: value || '',
            style: { backgroundColor }
          };
        }
      },
      { field: 'seated', title: 'Seated' },
      { field: 'dismissed', title: 'Dismissed' },
      { 
        field: 'notes', 
        title: 'Notes',
        render: value => value ? '✔' : '✘'
      }
      // PID column is not visible in the table
    ];
    
    // Initialize or update table
    if (!this.appointmentsTable) {
      // Create new table
      this.appointmentsTable = new Table(this.tableContainer, {
        columns,
        data: formattedData,
        className: 'appointments-table',
        responsive: true,
        rowClassName: row => this.activePID === row.pid ? 'active-patient' : '',
        onRowClick: (row) => {
          // Handle row click - could be used to show details, etc.
          console.log('Row clicked:', row);
        }
      });
    } else {
      // Update existing table
      this.appointmentsTable.setData(formattedData);
    }
    
    // Highlight active patient
    this.highlightActivePatient();
  }
  
  /**
   * Highlight active patient in the table
   * @private
   */
  highlightActivePatient() {
    if (!this.appointmentsTable) return;
    
    // Refresh the table which will reapply row classes
    this.appointmentsTable.refresh();
  }
  
  /**
   * Set up WebSocket connection for real-time updates
   * @private
   */
  setupWebSocket() {
    // Connect websocket
    websocket.connect();
    
    // Handle 'updated' event
    websocket.on('updated', data => {
      this.updateAppointmentsUI(data.tableData);
    });
    
    // Handle patient loaded event
    websocket.on('patientLoaded', async data => {
      this.activePID = data.pid;
      await this.showPatientData(data);
      this.highlightActivePatient();
    });
    
    // Handle patient unloaded event
    websocket.on('patientunLoaded', () => {
      this.activePID = null;
      this.unloadPatientData();
      this.highlightActivePatient();
    });
  }
  
  /**
   * Show patient data (images and latest visit)
   * @param {Object} data - Patient data
   * @private
   */
  async showPatientData(data) {
    // Show images
    this.showPatientImages(data.images);
    
    // Show latest visit
    this.showLatestVisit(data.latestVisit);
  }
  
  /**
   * Show patient images
   * @param {Array} images - Image data
   * @private
   */
  showPatientImages(images) {
    if (!this.imagesContainer || !images || images.length === 0) return;
    
    const imageElements = getElements('.img', this.imagesContainer);
    
    for (let i = 0; i < imageElements.length; i++) {
      if (images[i]) {
        const imglink = 'DolImgs/' + images[i].name;
        imageElements[i].src = imglink;
      } else {
        imageElements[i].src = '';
      }
    }
  }
  
  /**
   * Show latest visit information
   * @param {Object} latestVisit - Latest visit data
   * @private
   */
  showLatestVisit(latestVisit) {
    if (!this.latestVisitContainer || !latestVisit) return;
    
    // Clear container
    this.latestVisitContainer.innerHTML = '';
    
    // Create table
    const table = document.createElement('table');
    
    // Add header row
    const headerRow = document.createElement('tr');
    const headers = ['Visit Date', 'Summary'];
    
    headers.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      headerRow.appendChild(th);
    });
    
    table.appendChild(headerRow);
    
    // Add data row
    const row = document.createElement('tr');
    
    // Date cell
    const dateCell = document.createElement('td');
    dateCell.textContent = new Date(latestVisit.VisitDate).toLocaleDateString('en-GB');
    row.appendChild(dateCell);
    
    // Summary cell
    const summaryCell = document.createElement('td');
    summaryCell.innerHTML = latestVisit.Summary;
    row.appendChild(summaryCell);
    
    table.appendChild(row);
    
    // Add table to container
    this.latestVisitContainer.appendChild(table);
  }
  
  /**
   * Unload patient data
   * @private
   */
  unloadPatientData() {
    // Clear images
    if (this.imagesContainer) {
      const imageElements = getElements('.img', this.imagesContainer);
      imageElements.forEach(img => {
        img.src = '';
      });
    }
    
    // Clear latest visit
    if (this.latestVisitContainer) {
      this.latestVisitContainer.innerHTML = '';
    }
  }
  
  /**
   * Set up day change detection
   * @private
   */
  setupDayChangeDetection() {
    // Check for day change every minute
    setInterval(() => {
      const currentDate = new Date();
      const currentDateString = this.formatDateString(currentDate);
      
      if (currentDateString !== this.dateString) {
        // Date has changed
        this.date = currentDate;
        this.dateString = currentDateString;
        this.weekday = currentDate.toLocaleDateString(undefined, { weekday: 'long' });
        
        // Update UI
        if (this.titleElement) {
          this.titleElement.textContent = `${this.weekday} ${this.dateString}`;
        }
        
        // Reload appointments
        this.loadAppointments();
        
        // Reconnect WebSocket
        websocket.connect();
      }
    }, 60000); // Check every minute
  }
  
  /**
   * Clean up resources
   */
  destroy() {
    // Stop clock
    if (this.clock) {
      this.clock.destroy();
    }
    
    // Destroy table
    if (this.appointmentsTable) {
      this.appointmentsTable.destroy();
    }
    
    // Disconnect WebSocket
    websocket.disconnect();
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.appointmentsController = new AppointmentsPageController();
});