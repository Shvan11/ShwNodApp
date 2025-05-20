// pages/appointments2.js
/**
 * Appointments2 Page Controller
 * A simplified version of the appointments page without patient images
 */
import Clock from '../components/clock.js';
import Table from '../components/table.js';
import websocketService from '../services/websocket.js';
import appointmentService from '../services/appointment.js';
import storage from '../core/storage.js';
import { getElement } from '../core/dom.js';

class Appointments2PageController {
  /**
   * Initialize the simplified appointments page controller
   */
  constructor() {
    // Current date
    this.date = new Date();
    this.dateString = this.formatDateString(this.date);
    this.weekday = this.date.toLocaleDateString(undefined, { weekday: 'long' });
    
    // Ensure screen ID is set
    this.ensureScreenIdSet();
    
    // Create connection status indicator
    this.createConnectionIndicator();
    
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
   * Create connection status indicator
   * @private
   */
  createConnectionIndicator() {
    // Create connection status indicator
    this.connectionIndicator = document.createElement('div');
    this.connectionIndicator.id = 'connection-status';
    this.connectionIndicator.className = 'connection-status';
    this.connectionIndicator.title = 'WebSocket Connection Status';
    
    // Style the indicator
    Object.assign(this.connectionIndicator.style, {
      position: 'fixed',
      bottom: '10px',
      right: '10px',
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      backgroundColor: '#cccccc', // Gray (initial state)
      border: '2px solid white',
      boxShadow: '0 0 4px rgba(0, 0, 0, 0.3)',
      transition: 'background-color 0.3s ease',
      zIndex: 1000
    });
    
    // Add to document
    document.body.appendChild(this.connectionIndicator);
  }
  
  /**
   * Update connection status indicator
   * @param {string} status - Connection status
   * @private
   */
  updateConnectionStatus(status) {
    if (!this.connectionIndicator) return;
    
    const colors = {
      disconnected: '#ff3d00', // Red
      connecting: '#ffc107',   // Yellow/amber
      connected: '#4caf50',    // Green
      error: '#f44336'         // Error red
    };
    
    this.connectionIndicator.style.backgroundColor = colors[status] || '#cccccc';
    this.connectionIndicator.title = `WebSocket: ${status}`;
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
      this.showError('Failed to load appointments data');
    }
  }
  
  /**
   * Update appointments UI
   * @param {Object} data - Appointments data
   * @private
   */
  updateAppointmentsUI(data) {
    if (!data) {
      console.error('Invalid appointments data:', data);
      this.showError('Invalid appointments data');
      return;
    }
    
    // Update statistics
    this.updateStatistics(data);
    
    // Update table
    this.updateAppointmentsTable(data.appointments || []);
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
   * Update statistics display
   * @param {Object} data - Appointments data
   * @private
   */
  updateStatistics(data) {
    // Safely update statistics with defaults if values are missing
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
      responsive: true
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
   * Set up WebSocket connection for real-time updates
   * @private
   */
  setupWebSocket() {
    // Update connection status
    this.updateConnectionStatus('connecting');
    
    // Configure WebSocket service
    websocketService.options.debug = true;
    
    // Register event handlers
    websocketService.on('connecting', () => {
      this.updateConnectionStatus('connecting');
      console.log('WebSocket connecting...');
    });
    
    websocketService.on('connected', () => {
      this.updateConnectionStatus('connected');
      console.log('WebSocket connected');
      
      // Send capabilities update
      websocketService.send({
        type: 'capabilities',
        capabilities: {
          supportsJson: true,
          supportsPing: true,
          handlesDisconnects: true
        }
      });
      
      // Request initial appointments data
      websocketService.send({
        type: 'getAppointments',
        date: this.dateString
      });
    });
    
    websocketService.on('disconnected', () => {
      this.updateConnectionStatus('disconnected');
      console.log('WebSocket disconnected');
    });
    
    websocketService.on('error', (error) => {
      this.updateConnectionStatus('error');
      console.error('WebSocket error:', error);
      this.showError('WebSocket connection error');
    });
    
    // Handle 'updated' event (appointments data)
    websocketService.on('updated', data => {
      console.log('Received appointments update:', data);
      
      if (!data || !data.tableData) {
        console.error('Invalid data in "updated" event:', data);
        return;
      }
      
      this.updateAppointmentsUI(data.tableData);
    });
    
    // Connect WebSocket
    websocketService.connect({
      clientType: 'screen'
    }).catch(error => {
      console.error('Error connecting WebSocket:', error);
      this.showError('Failed to connect to server');
      
      // Fallback to regular API
      this.loadAppointments();
    });
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
        console.log('Day changed, updating to new date:', currentDateString);
        
        // Update date properties
        this.date = currentDate;
        this.dateString = currentDateString;
        this.weekday = currentDate.toLocaleDateString(undefined, { weekday: 'long' });
        
        // Update UI
        if (this.titleElement) {
          this.titleElement.textContent = `${this.weekday} ${this.dateString}`;
        }
        
        // Request new data via WebSocket if connected
        if (websocketService.isConnected) {
          websocketService.send({
            type: 'getAppointments',
            date: this.dateString
          });
        } else {
          // Fallback to API
          this.loadAppointments();
        }
      }
    }, 60000); // Check every minute
  }
  
  /**
   * Clean up resources
   */
  destroy() {
    // Remove event listeners
    websocketService.off('connecting');
    websocketService.off('connected');
    websocketService.off('disconnected');
    websocketService.off('error');
    websocketService.off('updated');
    
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
    
    // Remove connection indicator
    if (this.connectionIndicator) {
      this.connectionIndicator.remove();
    }
  }
}

// Initialize controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.appointments2Controller = new Appointments2PageController();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
  if (window.appointments2Controller) {
    window.appointments2Controller.destroy();
  }
});