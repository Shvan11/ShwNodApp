// pages/appointments.js
/**
 * Appointments Page Controller
 * Manages the appointments page functionality with patient images and screen management
 */
import websocketService from '../services/websocket.js';
import appointmentService from '../services/appointment.js';
import storage from '../core/storage.js';
import { getElement, getElements } from '../core/dom.js';
import { 
  formatDateString, 
  findBasicElements,
  updateAppointmentsUI,
  updateAppointmentsTable,
  createAppointmentsTable,
  showError,
  setupDayChangeDetection,
  setupClock,
  updateTable,
  loadAppointments,
  handleDayChange,
  destroyAppointmentsController,
  initializeAppointmentsController
} from '../components/appointments-shared.js';

class AppointmentsPageController {
  /**
   * Initialize the appointments page controller
   */
  constructor() {
    // Current date
    this.date = new Date();
    this.dateString = formatDateString(this.date);
    this.weekday = this.date.toLocaleDateString(undefined, { weekday: 'long' });

    // Ensure screen ID is set
    this.ensureScreenIdSet();

    // Active patient ID
    this.activePID = null;


    // Find DOM elements (including patient-specific ones)
    this.findElements();
    
    // Initialize async setup
    this.init();
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
    // Get basic elements using shared utility
    const basicElements = findBasicElements();
    Object.assign(this, basicElements);

    // Add patient-specific elements
    this.imagesContainer = getElement('#images');
    this.latestVisitContainer = getElement('#latestVisit');
  }

  /**
   * Initialize the page
   * @private
   */
  async init() {
    // Set up clock
    this.clock = await setupClock('#canvas');

    // Load initial appointments data
    await loadAppointments(
      this,
      appointmentService,
      this.updateUI.bind(this),
      (error) => showError('Failed to load appointments data', this.tableContainer)
    );

    // Set up WebSocket connection
    this.setupWebSocket();

    // Set up day change detection
    this.setupDayChangeDetection();
  }

  /**
   * Update UI with appointments data
   * @param {Object} data - Appointments data
   * @private
   */
  updateUI(data) {
    updateAppointmentsUI(
      data,
      this.statsElements,
      this.updateTable.bind(this),
      this.highlightActivePatient.bind(this), // Include highlighting for full appointments page
      this.tableContainer
    );
  }

  /**
   * Update appointments table
   * @param {Array} appointments - Appointments data
   * @private
   */
  updateTable(appointments) {
    updateAppointmentsTable(
      appointments,
      { table: this.appointmentsTable },
      this.createTable.bind(this),
      this.updateExistingTable.bind(this),
      this.tableContainer
    );
  }

  /**
   * Create new table with patient features
   * @param {Array} data - Table data
   * @private
   */
  async createTable(data) {
    this.appointmentsTable = await createAppointmentsTable(
      data,
      this.tableContainer,
      false, // No patient links for screen display view
      {
        rowClassName: row => this.activePID === row.pid ? 'active-patient' : '',
        onRowClick: this.handlePatientRowClick.bind(this)
      }
    );
  }

  /**
   * Update existing table
   * @param {Array} data - Table data
   * @private
   */
  updateExistingTable(data) {
    updateTable(this.appointmentsTable, data, (data) => {
      this.appointmentsTable = null;
      this.createTable(data);
    });
  }

  /**
   * Handle row click event
   * @param {Object} rowData - Row data
   * @param {number} rowIndex - Row index
   * @param {Event} event - Click event
   * @private
   */
  handlePatientRowClick(rowData, rowIndex, event) {
    if (!rowData || !rowData.pid) return;

    // Set active patient ID
    this.activePID = rowData.pid;

    // Highlight active patient
    this.highlightActivePatient();

    // Load patient data and show it
    this.loadAndShowPatientData(rowData.pid);
  }

  /**
   * Load and show patient data
   * @param {string} patientId - Patient ID
   * @private
   */
  async loadAndShowPatientData(patientId) {
    try {
      // Get patient images
      const images = await appointmentService.getPatientImages(patientId);

      // Get latest visit
      const latestVisit = await appointmentService.getLatestVisitSummary(patientId);

      // Show patient data
      await this.showPatientData({
        pid: patientId,
        images,
        latestVisit
      });
    } catch (error) {
      console.error('Error loading patient data:', error);
    }
  }

  /**
   * Highlight active patient in the table
   * @private
   */
  highlightActivePatient() {
    if (!this.appointmentsTable) return;
    // Update the rowClassName function with the current activePID value
    this.appointmentsTable.options.rowClassName = row => {
      return String(this.activePID) === String(row.pid) ? 'active-patient' : '';
    };
    // Refresh the table which will reapply row classes
    this.appointmentsTable.refresh();
  }

  /**
   * Set up WebSocket connection
   * @private
   */
  setupWebSocket() {
    // Add status indicator to the page
    const statusIndicator = document.createElement('div');
    statusIndicator.id = 'ws-status';
    statusIndicator.style.position = 'fixed';
    statusIndicator.style.bottom = '10px';
    statusIndicator.style.left = '10px';
    statusIndicator.style.padding = '5px 10px';
    statusIndicator.style.borderRadius = '5px';
    statusIndicator.style.fontSize = '12px';
    document.body.appendChild(statusIndicator);

    const updateStatus = (status) => {
      const colors = {
        connecting: '#ffa500', // orange
        connected: '#00c853',  // green
        disconnected: '#ff3d00', // red
        error: '#d50000'       // deep red
      };

      statusIndicator.textContent = `WebSocket: ${status}`;
      statusIndicator.style.backgroundColor = colors[status] || '#9e9e9e';
      statusIndicator.style.color = '#ffffff';
    };

    // Connect websocket
    updateStatus('connecting');

    // Handle connection events
    websocketService.on('connected', () => {
      updateStatus('connected');
      console.log('WebSocket connected');
    });

    websocketService.on('disconnected', () => {
      updateStatus('disconnected');
      console.log('WebSocket disconnected');
    });

    websocketService.on('error', (error) => {
      updateStatus('error');
      console.error('WebSocket error:', error);
    });

    // Handle appointment updates
    const handleAppointmentUpdate = (data) => {
      console.log('Received WebSocket appointment update:', data);

      if (!data || !data.tableData) {
        console.error('Invalid data in appointment update event:', data);
        return;
      }

      // Check appointments data structure
      const appointments = data.tableData.appointments;
      if (!appointments || !Array.isArray(appointments)) {
        console.error('Invalid appointments data:', appointments);
        return;
      }

      console.log(`Processing ${appointments.length} appointments from WebSocket update`);

      try {
        this.updateUI(data.tableData);
      } catch (error) {
        console.error('Error handling WebSocket update:', error);
      }
    };

    // Listen to universal appointment update events only
    websocketService.on('appointments_updated', handleAppointmentUpdate);
    websocketService.on('appointments_data', handleAppointmentUpdate);

    // Handle patient loaded event
    const handlePatientLoaded = async (data) => {
      console.log('Received patient loaded event:', data);
      console.log('Current screen ID:', storage.screenId());
      
      this.activePID = data.pid;
      await this.showPatientData(data);
      this.highlightActivePatient();
    };

    // Listen to universal patient loaded events only
    websocketService.on('patient_loaded', handlePatientLoaded);

    // Handle patient unloaded event
    const handlePatientUnloaded = () => {
      console.log('Received patient unloaded event');
      this.activePID = null;
      this.unloadPatientData();
      this.highlightActivePatient();
    };

    // Listen to universal patient unloaded events only
    websocketService.on('patient_unloaded', handlePatientUnloaded);

    websocketService.connect();
  }

  /**
   * Show patient data (images and latest visit)
   * @param {Object} data - Patient data
   * @private
   */
  async showPatientData(data) {
    console.log('showPatientData called with:', data);
    
    // Show images
    console.log('Showing patient images:', data.images);
    this.showPatientImages(data.images);

    // Show latest visit
    console.log('Showing latest visit:', data.latestVisit);
    this.showLatestVisit(data.latestVisit);
  }

  /**
   * Show patient images
   * @param {Array} images - Image data
   * @private
   */
  showPatientImages(images) {
    console.log('showPatientImages called with:', images);
    console.log('Images container found:', !!this.imagesContainer);
    
    if (!this.imagesContainer || !images || images.length === 0) {
      console.log('Early return: container not found or no images');
      return;
    }

    const imageElements = getElements('.img', this.imagesContainer);
    console.log('Found image elements:', imageElements.length);

    for (let i = 0; i < imageElements.length; i++) {
      if (images[i]) {
        const imglink = 'DolImgs/' + images[i].name;
        console.log(`Setting image ${i} src to: ${imglink}`);
        imageElements[i].src = imglink;
      } else {
        console.log(`Clearing image ${i}`);
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
    this.dayChangeCleanup = setupDayChangeDetection(
      handleDayChange(
        this,
        () => {
          if (this.titleElement) {
            this.titleElement.textContent = `${this.weekday} ${this.dateString}`;
          }
        },
        websocketService,
        () => {
          this.init();
          websocketService.disconnect();
          websocketService.connect();
        }
      ),
      this.dateString
    );
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Remove patient event listeners
    websocketService.off('patient_loaded');
    websocketService.off('patient_unloaded');

    // Use shared destroy functionality
    destroyAppointmentsController(this, websocketService);
  }
}

// Initialize controller using shared utility
initializeAppointmentsController(AppointmentsPageController, 'appointmentsController');