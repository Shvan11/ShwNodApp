// pages/appointments.js
/**
 * Appointments Page Controller
 * Manages the appointments page functionality
 */
import Clock from '../components/clock.js';
import Table from '../components/table.js';
import websocketService from '../services/websocket.js';
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
    // Check if appointments is an array
    if (!Array.isArray(appointments)) {
      console.error('Invalid appointments format:', appointments);
      this.showError('Invalid appointments format');
      return;
    }

    console.log(`Updating table with ${appointments.length} appointments`);

    try {
      // Format appointment data for the table component
      const formattedData = this.formatAppointmentsData(appointments);

      if (!formattedData || !formattedData.length) {
        console.warn('No appointments data to display');
      }

      // Initialize or update table component
      if (!this.appointmentsTable) {
        this.createTable(formattedData);
      } else {
        this.updateTable(formattedData);
      }
    } catch (error) {
      console.error('Error updating appointments table:', error);
      this.showError('Error updating appointments table');
    }
  }

  /**
   * Format appointments data for table component
   * @param {Array} appointments - Raw appointments data
   * @returns {Array} - Formatted data
   * @private
   */
  formatAppointmentsData(appointments) {
    return appointments.map(appointmentColumns => {
      // Ensure appointmentColumns is an array
      if (!Array.isArray(appointmentColumns)) {
        console.warn('Invalid appointment row format:', appointmentColumns);
        return {
          patientName: 'Error: Invalid row format',
          pid: ''
        };
      }

      // Extract values with safe defaults
      return {
        no: this.getColumnValue(appointmentColumns, 0, ''),
        time: this.getColumnValue(appointmentColumns, 1, ''),
        type: this.getColumnValue(appointmentColumns, 2, ''),
        patientName: this.getColumnValue(appointmentColumns, 3, 'Unknown'),
        detail: this.getColumnValue(appointmentColumns, 4, ''),
        present: this.getColumnValue(appointmentColumns, 5, ''),
        seated: this.getColumnValue(appointmentColumns, 6, ''),
        dismissed: this.getColumnValue(appointmentColumns, 7, ''),
        notes: this.getColumnValue(appointmentColumns, 8, '') === 'true',
        pid: this.getColumnValue(appointmentColumns, 9, '')
      };
    });
  }

  /**
   * Get column value with error handling
   * @param {Array} row - Row data
   * @param {number} index - Column index
   * @param {*} defaultValue - Default value if column is missing
   * @returns {*} - Column value or default
   * @private
   */
  getColumnValue(row, index, defaultValue) {
    if (!row[index] || row[index].value === undefined) {
      return defaultValue;
    }
    return row[index].value;
  }

  /**
   * Create appointments table
   * @param {Array} data - Table data
   * @private
   */
  createTable(data) {
    // Define table columns
    const columns = [
      { field: 'no', title: 'No', width: 50 },
      { field: 'time', title: 'Time', width: 80 },
      { field: 'type', title: 'Type', width: 100 },
      {
        field: 'patientName',
        title: 'Patient Name',
        render: (value, row) => {
          return `<a href="/visits-summary?PID=${row.pid}">${value}</a>`;
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
        render: value => value ? '✓' : '✗'
      }
    ];

    // Create table
    this.appointmentsTable = new Table(this.tableContainer, {
      columns,
      data,
      className: 'appointments-table',
      responsive: true,
      rowClassName: row => this.activePID === row.pid ? 'active-patient' : '',
      onRowClick: this.handlePatientRowClick.bind(this)
    });

    console.log('Created new appointments table');
  }

  /**
   * Update existing table
   * @param {Array} data - Table data
   * @private
   */
  updateTable(data) {
    if (!this.appointmentsTable) {
      this.createTable(data);
      return;
    }

    try {
      // Update table data
      this.appointmentsTable.setData(data);
      console.log('Updated existing appointments table');
    } catch (error) {
      console.error('Error updating table:', error);

      // Recreate table on error
      this.appointmentsTable = null;
      this.createTable(data);
    }
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
   * Set up WebSocket connection for real-time updates
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

    // Handle appointment updates (both legacy 'updated' and new 'appointmentUpdate' events)
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
        // Update statistics first
        this.updateStatistics({
          all: data.tableData.all || 0,
          present: data.tableData.present || 0,
          waiting: data.tableData.waiting || 0,
          completed: data.tableData.completed || 0
        });

        // Then update table
        this.updateAppointmentsTable(appointments);

        // Also highlight active patient if needed
        this.highlightActivePatient();
      } catch (error) {
        console.error('Error handling WebSocket update:', error);
      }
    };

    // Handle legacy 'updated' event
    websocketService.on('updated', handleAppointmentUpdate);
    
    // Handle new 'appointmentUpdate' event (from appointment_update server message)
    websocketService.on('appointmentUpdate', handleAppointmentUpdate);

    // Handle patient loaded event
    websocketService.on('patientLoaded', async data => {
      console.log('Received patientLoaded event:', data);
      console.log('Current screen ID:', storage.screenId());
      
      this.activePID = data.pid;
      await this.showPatientData(data);
      this.highlightActivePatient();
    });

    // Handle patient unloaded event
    websocketService.on('patientUnloaded', () => {
      this.activePID = null;
      this.unloadPatientData();
      this.highlightActivePatient();
    });

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
   * Show error message
   * @param {string} message - Error message
   * @private
   */
  showError(message) {
    // Check if error container exists
    let errorContainer = document.getElementById('appointments-error');

    if (!errorContainer) {
      // Create error container
      errorContainer = document.createElement('div');
      errorContainer.id = 'appointments-error';
      errorContainer.className = 'error-message';

      // Style error container
      Object.assign(errorContainer.style, {
        backgroundColor: 'rgba(244, 67, 54, 0.1)',
        color: '#f44336',
        padding: '10px',
        margin: '10px 0',
        borderRadius: '4px',
        border: '1px solid #f44336',
        transition: 'opacity 0.5s ease'
      });

      // Add to container
      if (this.tableContainer) {
        this.tableContainer.parentNode.insertBefore(errorContainer, this.tableContainer);
      } else {
        document.body.appendChild(errorContainer);
      }
    }

    // Update error message
    errorContainer.textContent = message;
    errorContainer.style.opacity = '1';

    // Auto-hide after 10 seconds
    setTimeout(() => {
      if (errorContainer.parentNode) {
        errorContainer.style.opacity = '0';

        // Remove after fade out
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
        websocketService.disconnect(); // add before connecting
        // Reconnect WebSocket
        websocketService.connect();
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
    websocketService.disconnect();
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.appointmentsController = new AppointmentsPageController();
});