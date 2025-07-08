// pages/appointments.js
/**
 * Appointments Page Controller with Integrated Utilities
 * Manages appointments page functionality with patient images and screen management
 * Includes all shared utilities previously in appointments-shared.js
 */

import websocketService from '../services/websocket.js';
import appointmentService from '../services/appointment.js';
import storage from '../core/storage.js';
import { getElement, getElements } from '../core/dom.js';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format date to YYYY-MM-DD string
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date
 */
function formatDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Update statistics display
 * @param {Object} statsElements - DOM elements for statistics
 * @param {Object} data - Statistics data
 */
function updateStatistics(statsElements, data) {
  if (!statsElements || !data) return;
  
  if (statsElements.all) {
    statsElements.all.textContent = data.all || 0;
  }

  if (statsElements.present) {
    statsElements.present.textContent = data.present || 0;
  }

  if (statsElements.waiting) {
    statsElements.waiting.textContent = data.waiting || 0;
  }

  if (statsElements.completed) {
    statsElements.completed.textContent = data.completed || 0;
  }
}

/**
 * Format appointments data for table component
 * @param {Array} appointments - Appointments data as objects
 * @returns {Array} - Standardized appointment objects
 */
function formatAppointmentsData(appointments) {
  if (!Array.isArray(appointments)) {
    console.warn('Invalid appointments format:', appointments);
    return [];
  }

  return appointments.map(appointment => {
    if (!appointment || typeof appointment !== 'object') {
      console.warn('Invalid appointment object:', appointment);
      return {
        no: '',
        time: '',
        type: '',
        patientName: 'Error: Invalid appointment',
        detail: '',
        present: '',
        seated: '',
        dismissed: '',
        notes: false,
        pid: ''
      };
    }

    return {
      no: appointment.Num || '',
      time: appointment.apptime || '',
      type: appointment.PatientType || '',
      patientName: appointment.PatientName || 'Unknown',
      detail: appointment.AppDetail || '',
      present: appointment.Present || '',
      seated: appointment.Seated || '',
      dismissed: appointment.Dismissed || '',
      notes: appointment.HasVisit || false,
      pid: appointment.appointmentID || ''
    };
  });
}

/**
 * Create appointments table columns configuration
 * @param {boolean} includePatientLinks - Whether to include links to patient pages
 * @returns {Array} - Table columns configuration
 */
function createTableColumns(includePatientLinks = true) {
  const columns = [
    { field: 'no', title: 'No', width: 50 },
    { field: 'time', title: 'Time', width: 80 },
    { field: 'type', title: 'Type', width: 100 },
    { 
      field: 'patientName', 
      title: 'Patient Name',
      render: includePatientLinks ? 
        (value, row) => `<a href="/visits-summary?PID=${row.pid}">${value}</a>` :
        (value) => value
    },
    { field: 'detail', title: 'Detail' },
    { 
      field: 'present', 
      title: 'Present',
      cellClassName: 'status-cell',
      render: (value, row) => {
        let backgroundColor = 'pink';
        
        if (row.dismissed) {
          backgroundColor = 'lightgreen';
        } else if (row.seated) {
          backgroundColor = 'lightyellow';
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
      render: value => value ? '✓' : '✗'
    }
  ];

  return columns;
}

/**
 * Show error message
 * @param {string} message - Error message
 * @param {HTMLElement} container - Container to show error in
 */
function showError(message, container = null) {
  let errorContainer = document.getElementById('appointments-error');
  
  if (!errorContainer) {
    errorContainer = document.createElement('div');
    errorContainer.id = 'appointments-error';
    errorContainer.className = 'error-message';
    
    Object.assign(errorContainer.style, {
      backgroundColor: 'rgba(244, 67, 54, 0.1)',
      color: '#f44336',
      padding: '10px',
      margin: '10px 0',
      borderRadius: '4px',
      border: '1px solid #f44336',
      transition: 'opacity 0.5s ease'
    });
    
    if (container) {
      container.parentNode.insertBefore(errorContainer, container);
    } else {
      document.body.appendChild(errorContainer);
    }
  }
  
  errorContainer.textContent = message;
  errorContainer.style.opacity = '1';
  
  setTimeout(() => {
    if (errorContainer.parentNode) {
      errorContainer.style.opacity = '0';
      
      setTimeout(() => {
        if (errorContainer.parentNode) {
          errorContainer.parentNode.removeChild(errorContainer);
        }
      }, 500);
    }
  }, 10000);
}

/**
 * Set up day change detection
 * @param {Function} onDayChange - Callback when day changes
 * @param {string} currentDateString - Current date string
 * @returns {Function} - Function to clear the interval
 */
function setupDayChangeDetection(onDayChange, currentDateString) {
  const interval = setInterval(() => {
    const currentDate = new Date();
    const newDateString = formatDateString(currentDate);
    
    if (newDateString !== currentDateString) {
      console.log('Day changed, updating to new date:', newDateString);
      onDayChange(newDateString, currentDate);
    }
  }, 60000);
  
  return () => clearInterval(interval);
}

/**
 * Set up analog clock
 * @param {string} canvasSelector - CSS selector for canvas element
 * @returns {Object|null} - Clock instance or null
 */
function setupClock(canvasSelector) {
  const canvasElement = document.querySelector(canvasSelector);
  
  if (canvasElement) {
    return import('../components/clock.js').then(({ default: Clock }) => {
      return new Clock(canvasElement, {
        updateInterval: 10000
      });
    });
  }
  
  return Promise.resolve(null);
}

/**
 * Update existing table with new data
 * @param {Object} table - Table instance
 * @param {Array} data - New table data
 * @param {Function} createTableFn - Function to recreate table if update fails
 */
function updateTable(table, data, createTableFn) {
  if (!table) {
    createTableFn(data);
    return;
  }
  
  try {
    table.setData(data);
    console.log('Updated existing appointments table');
  } catch (error) {
    console.error('Error updating table:', error);
    createTableFn(data);
  }
}

/**
 * Load appointments data
 * @param {Object} context - Context object with titleElement, weekday, dateString
 * @param {Object} appointmentService - Appointment service instance
 * @param {Function} updateUIFn - Function to update UI with appointments data
 * @param {Function} errorFn - Function to handle errors (optional)
 */
async function loadAppointments(context, appointmentService, updateUIFn, errorFn = null) {
  try {
    if (context.titleElement) {
      context.titleElement.textContent = `${context.weekday} ${context.dateString}`;
    }

    const appointmentsData = await appointmentService.getAppointments(context.dateString);
    updateUIFn(appointmentsData);
  } catch (error) {
    console.error('Error loading appointments:', error);
    if (errorFn) {
      errorFn(error);
    }
  }
}

/**
 * Find basic DOM elements for appointments page
 * @param {Object} selectors - Object with element selectors
 * @returns {Object} - Object with found elements
 */
function findBasicElements(selectors = {}) {
  const defaultSelectors = {
    title: '#title',
    tableContainer: '#appointments-container',
    all: '#all',
    present: '#present', 
    waiting: '#waiting',
    completed: '#completed'
  };

  const elements = { ...defaultSelectors, ...selectors };
  
  return {
    titleElement: document.querySelector(elements.title),
    tableContainer: document.querySelector(elements.tableContainer),
    statsElements: {
      all: document.querySelector(elements.all),
      present: document.querySelector(elements.present),
      waiting: document.querySelector(elements.waiting),
      completed: document.querySelector(elements.completed)
    }
  };
}

/**
 * Update appointments UI with data
 * @param {Object} data - Appointments data
 * @param {Object} statsElements - Statistics elements
 * @param {Function} updateTableFn - Function to update table
 * @param {Function} highlightFn - Optional function for highlighting
 * @param {HTMLElement} errorContainer - Container for error messages
 */
function updateAppointmentsUI(data, statsElements, updateTableFn, highlightFn = null, errorContainer = null) {
  if (!data) {
    console.error('Invalid appointments data:', data);
    showError('Invalid appointments data', errorContainer);
    return;
  }
  
  updateStatistics(statsElements, data);
  updateTableFn(data.appointments || []);
  
  if (highlightFn) {
    highlightFn();
  }
}

/**
 * Update appointments table with validation and error handling
 * @param {Array} appointments - Appointments data
 * @param {Object} tableInstance - Current table instance
 * @param {Function} createTableFn - Function to create new table
 * @param {Function} updateTableFn - Function to update existing table
 * @param {HTMLElement} errorContainer - Container for error messages
 */
function updateAppointmentsTable(appointments, tableInstance, createTableFn, updateTableFn, errorContainer) {
  if (!Array.isArray(appointments)) {
    console.error('Invalid appointments format:', appointments);
    showError('Invalid appointments format', errorContainer);
    return;
  }
  
  console.log(`Updating table with ${appointments.length} appointments`);
  
  try {
    const formattedData = formatAppointmentsData(appointments);
    
    if (!formattedData || !formattedData.length) {
      console.warn('No appointments data to display');
    }
    
    if (!tableInstance.table) {
      createTableFn(formattedData);
    } else {
      updateTableFn(formattedData);
    }
  } catch (error) {
    console.error('Error updating appointments table:', error);
    showError('Error updating appointments table', errorContainer);
  }
}

/**
 * Create appointments table
 * @param {Array} data - Table data
 * @param {HTMLElement} container - Table container
 * @param {boolean} includePatientLinks - Whether to include patient links
 * @param {Object} additionalOptions - Additional table options
 * @returns {Object} - Table instance
 */
function createAppointmentsTable(data, container, includePatientLinks = false, additionalOptions = {}) {
  return import('../components/table.js').then(({ default: Table }) => {
    container.innerHTML = '';
    
    const columns = createTableColumns(includePatientLinks);
    
    const table = new Table(container, {
      columns,
      data,
      className: 'appointments-table',
      responsive: true,
      ...additionalOptions
    });
    
    console.log('Created new appointments table');
    return table;
  });
}

/**
 * Handle day change with automatic UI updates
 * @param {Object} context - Context object with date properties
 * @param {Function} updateTitleFn - Function to update title
 * @param {Object} websocketService - WebSocket service
 * @param {Function} fallbackFn - Fallback function if WebSocket not connected
 */
function handleDayChange(context, updateTitleFn, websocketService, fallbackFn) {
  return (newDateString, newDate) => {
    context.date = newDate;
    context.dateString = newDateString;
    context.weekday = newDate.toLocaleDateString(undefined, { weekday: 'long' });
    
    updateTitleFn();
    
    if (websocketService.isConnected) {
      websocketService.send({
        type: 'request_appointments',
        data: { date: context.dateString }
      });
    } else {
      fallbackFn();
    }
  };
}

/**
 * Destroy appointments controller resources
 * @param {Object} resources - Resources to clean up
 * @param {Object} websocketService - WebSocket service
 */
function destroyAppointmentsController(resources, websocketService) {
  if (resources.dayChangeCleanup) {
    resources.dayChangeCleanup();
  }
  
  websocketService.off('connecting');
  websocketService.off('connected');
  websocketService.off('disconnected');
  websocketService.off('error');
  websocketService.off('appointments_updated');
  websocketService.off('appointments_data');
  
  if (resources.clock && resources.clock.destroy) {
    resources.clock.destroy();
  }
  
  if (resources.appointmentsTable && resources.appointmentsTable.destroy) {
    resources.appointmentsTable.destroy();
  }
  
  websocketService.disconnect();
  
  if (resources.connectionIndicator) {
    resources.connectionIndicator.remove();
  }
}

/**
 * Initialize appointments controller with DOM events
 * @param {Function} ControllerClass - Controller class to instantiate
 * @param {string} controllerName - Name for window property
 * @returns {Object} - Controller instance
 */
function initializeAppointmentsController(ControllerClass, controllerName) {
  let controller = null;
  
  document.addEventListener('DOMContentLoaded', () => {
    controller = new ControllerClass();
    window[controllerName] = controller;
  });

  window.addEventListener('beforeunload', () => {
    if (controller && controller.destroy) {
      controller.destroy();
    }
  });
  
  return controller;
}

// ============================================================================
// MAIN APPOINTMENTS PAGE CONTROLLER
// ============================================================================

class AppointmentsPageController {
  /**
   * Initialize the appointments page controller
   */
  constructor() {
    this.date = new Date();
    this.dateString = formatDateString(this.date);
    this.weekday = this.date.toLocaleDateString(undefined, { weekday: 'long' });

    this.ensureScreenIdSet();
    this.activePID = null;

    this.findElements();
    this.init();
  }

  /**
   * Ensure screen ID is set in storage
   * @private
   */
  ensureScreenIdSet() {
    storage.screenId();
  }

  /**
   * Find DOM elements used by the controller
   * @private
   */
  findElements() {
    const basicElements = findBasicElements();
    Object.assign(this, basicElements);

    this.imagesContainer = getElement('#images');
    this.latestVisitContainer = getElement('#latestVisit');
  }

  /**
   * Initialize the page
   * @private
   */
  async init() {
    this.clock = await setupClock('#canvas');

    await loadAppointments(
      this,
      appointmentService,
      this.updateUI.bind(this),
      () => showError('Failed to load appointments data', this.tableContainer)
    );

    this.setupWebSocket();
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
      this.highlightActivePatient.bind(this),
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
      false,
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
  handlePatientRowClick(rowData) {
    if (!rowData || !rowData.pid) return;

    this.activePID = rowData.pid;
    this.highlightActivePatient();
    this.loadAndShowPatientData(rowData.pid);
  }

  /**
   * Load and show patient data
   * @param {string} patientId - Patient ID
   * @private
   */
  async loadAndShowPatientData(patientId) {
    try {
      const images = await appointmentService.getPatientImages(patientId);
      const latestVisit = await appointmentService.getLatestVisitSummary(patientId);

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
    
    this.appointmentsTable.options.rowClassName = row => {
      return String(this.activePID) === String(row.pid) ? 'active-patient' : '';
    };
    this.appointmentsTable.refresh();
  }

  /**
   * Set up WebSocket connection
   * @private
   */
  setupWebSocket() {
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
        connecting: '#ffa500',
        connected: '#00c853',
        disconnected: '#ff3d00',
        error: '#d50000'
      };

      statusIndicator.textContent = `WebSocket: ${status}`;
      statusIndicator.style.backgroundColor = colors[status] || '#9e9e9e';
      statusIndicator.style.color = '#ffffff';
    };

    updateStatus('connecting');

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

    const handleAppointmentUpdate = (data) => {
      console.log('Received WebSocket appointment update');

      if (!data || !data.tableData) {
        console.error('Invalid data in appointment update event:', data);
        return;
      }

      try {
        this.updateUI(data.tableData);
      } catch (error) {
        console.error('Error handling WebSocket update:', error);
      }
    };

    websocketService.on('appointments_updated', handleAppointmentUpdate);
    websocketService.on('appointments_data', handleAppointmentUpdate);

    const handlePatientLoaded = async (data) => {
      console.log('Received patient loaded event:', data);
      console.log('Current screen ID:', storage.screenId());
      
      this.activePID = data.pid;
      await this.showPatientData(data);
      this.highlightActivePatient();
    };

    websocketService.on('patient_loaded', handlePatientLoaded);

    const handlePatientUnloaded = () => {
      console.log('Received patient unloaded event');
      this.activePID = null;
      this.unloadPatientData();
      this.highlightActivePatient();
    };

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
    
    console.log('Showing patient images:', data.images);
    this.showPatientImages(data.images);

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

    this.latestVisitContainer.innerHTML = '';

    const table = document.createElement('table');

    const headerRow = document.createElement('tr');
    const headers = ['Visit Date', 'Summary'];

    headers.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      headerRow.appendChild(th);
    });

    table.appendChild(headerRow);

    const row = document.createElement('tr');

    const dateCell = document.createElement('td');
    dateCell.textContent = new Date(latestVisit.VisitDate).toLocaleDateString('en-GB');
    row.appendChild(dateCell);

    const summaryCell = document.createElement('td');
    summaryCell.innerHTML = latestVisit.Summary;
    row.appendChild(summaryCell);

    table.appendChild(row);
    this.latestVisitContainer.appendChild(table);
  }

  /**
   * Unload patient data
   * @private
   */
  unloadPatientData() {
    if (this.imagesContainer) {
      const imageElements = getElements('.img', this.imagesContainer);
      imageElements.forEach(img => {
        img.src = '';
      });
    }

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
    websocketService.off('patient_loaded');
    websocketService.off('patient_unloaded');

    destroyAppointmentsController(this, websocketService);
  }
}

// Initialize controller
initializeAppointmentsController(AppointmentsPageController, 'appointmentsController');