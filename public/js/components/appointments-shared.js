// js/components/appointments-shared.js
/**
 * Shared utilities for appointments functionality
 * Common functions used by both appointments.js and appointments2.js
 */

/**
 * Format date to YYYY-MM-DD string
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date
 */
export function formatDateString(date) {
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
export function updateStatistics(statsElements, data) {
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
export function formatAppointmentsData(appointments) {
  if (!Array.isArray(appointments)) {
    console.warn('Invalid appointments format:', appointments);
    return [];
  }

  return appointments.map(appointment => {
    // Expect modern object format
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

    // Standardize object properties
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
export function createTableColumns(includePatientLinks = true) {
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

  return columns;
}

/**
 * Create connection status indicator
 * @returns {HTMLElement} - Status indicator element
 */
export function createConnectionIndicator() {
  const connectionIndicator = document.createElement('div');
  connectionIndicator.id = 'connection-status';
  connectionIndicator.className = 'connection-status';
  connectionIndicator.title = 'WebSocket Connection Status';
  
  // Style the indicator
  Object.assign(connectionIndicator.style, {
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
  document.body.appendChild(connectionIndicator);
  return connectionIndicator;
}

/**
 * Update connection status indicator
 * @param {HTMLElement} indicator - Status indicator element
 * @param {string} status - Connection status
 */
export function updateConnectionStatus(indicator, status) {
  if (!indicator) return;
  
  const colors = {
    disconnected: '#ff3d00', // Red
    connecting: '#ffc107',   // Yellow/amber
    connected: '#4caf50',    // Green
    error: '#f44336'         // Error red
  };
  
  indicator.style.backgroundColor = colors[status] || '#cccccc';
  indicator.title = `WebSocket: ${status}`;
}

/**
 * Show error message
 * @param {string} message - Error message
 * @param {HTMLElement} container - Container to show error in
 */
export function showError(message, container = null) {
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
    if (container) {
      container.parentNode.insertBefore(errorContainer, container);
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
 * @param {Function} onDayChange - Callback when day changes
 * @param {string} currentDateString - Current date string
 * @returns {Function} - Function to clear the interval
 */
export function setupDayChangeDetection(onDayChange, currentDateString) {
  // Check for day change every minute
  const interval = setInterval(() => {
    const currentDate = new Date();
    const newDateString = formatDateString(currentDate);
    
    if (newDateString !== currentDateString) {
      console.log('Day changed, updating to new date:', newDateString);
      onDayChange(newDateString, currentDate);
    }
  }, 60000); // Check every minute
  
  // Return cleanup function
  return () => clearInterval(interval);
}

/**
 * Set up analog clock
 * @param {string} canvasSelector - CSS selector for canvas element
 * @returns {Object|null} - Clock instance or null
 */
export function setupClock(canvasSelector) {
  const canvasElement = document.querySelector(canvasSelector);
  
  if (canvasElement) {
    // Import Clock dynamically to avoid circular dependencies
    return import('../components/clock.js').then(({ default: Clock }) => {
      return new Clock(canvasElement, {
        updateInterval: 10000 // Update every 10 seconds
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
export function updateTable(table, data, createTableFn) {
  if (!table) {
    createTableFn(data);
    return;
  }
  
  try {
    // Update table data
    table.setData(data);
    console.log('Updated existing appointments table');
  } catch (error) {
    console.error('Error updating table:', error);
    
    // Recreate table on error
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
export async function loadAppointments(context, appointmentService, updateUIFn, errorFn = null) {
  try {
    // Update title
    if (context.titleElement) {
      context.titleElement.textContent = `${context.weekday} ${context.dateString}`;
    }

    // Fetch appointments
    const appointmentsData = await appointmentService.getAppointments(context.dateString);

    // Update UI with data
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
export function findBasicElements(selectors = {}) {
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
 * @param {Function} highlightFn - Optional function for highlighting (for full appointments page)
 * @param {HTMLElement} errorContainer - Container for error messages
 */
export function updateAppointmentsUI(data, statsElements, updateTableFn, highlightFn = null, errorContainer = null) {
  if (!data) {
    console.error('Invalid appointments data:', data);
    showError('Invalid appointments data', errorContainer);
    return;
  }
  
  // Update statistics using shared utility
  updateStatistics(statsElements, data);
  
  // Update table
  updateTableFn(data.appointments || []);
  
  // Highlight active patient (only for full appointments page)
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
export function updateAppointmentsTable(appointments, tableInstance, createTableFn, updateTableFn, errorContainer) {
  // Check if appointments is an array
  if (!Array.isArray(appointments)) {
    console.error('Invalid appointments format:', appointments);
    showError('Invalid appointments format', errorContainer);
    return;
  }
  
  console.log(`Updating table with ${appointments.length} appointments`);
  
  try {
    // Format appointment data using shared utility
    const formattedData = formatAppointmentsData(appointments);
    
    if (!formattedData || !formattedData.length) {
      console.warn('No appointments data to display');
    }
    
    // Initialize or update table component
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
export function createAppointmentsTable(data, container, includePatientLinks = false, additionalOptions = {}) {
  // Import Table dynamically to avoid circular dependencies
  return import('../components/table.js').then(({ default: Table }) => {
    // CRITICAL: Clear container to prevent duplicate tables
    container.innerHTML = '';
    
    // Get table columns from shared utility
    const columns = createTableColumns(includePatientLinks);
    
    // Create table
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
 * Setup WebSocket for appointments with simplified or full features
 * @param {Object} context - Context with dateString and other properties
 * @param {Object} websocketService - WebSocket service instance
 * @param {Function} updateUIFn - Function to update UI
 * @param {Function} loadAppointmentsFn - Fallback function to load appointments
 * @param {HTMLElement} connectionIndicator - Connection status indicator
 * @param {HTMLElement} errorContainer - Error container
 * @param {Object} options - Options (clientType, includePatientEvents, etc.)
 */
export function setupAppointmentsWebSocket(context, websocketService, updateUIFn, loadAppointmentsFn, connectionIndicator, errorContainer, options = {}) {
  const {
    clientType = 'simplified',
    includePatientEvents = false
  } = options;

  // Update connection status using shared utility
  updateConnectionStatus(connectionIndicator, 'connecting');
  
  // Configure WebSocket service
  websocketService.options.debug = true;
  
  // Register event handlers
  websocketService.on('connecting', () => {
    updateConnectionStatus(connectionIndicator, 'connecting');
    console.log('WebSocket connecting...');
  });
  
  websocketService.on('connected', () => {
    updateConnectionStatus(connectionIndicator, 'connected');
    console.log('WebSocket connected');
    
    // Request initial appointments data
    websocketService.send({
      type: 'request_appointments',
      data: { date: context.dateString }
    });
  });
  
  websocketService.on('disconnected', () => {
    updateConnectionStatus(connectionIndicator, 'disconnected');
    console.log('WebSocket disconnected');
  });
  
  websocketService.on('error', (error) => {
    updateConnectionStatus(connectionIndicator, 'error');
    console.error('WebSocket error:', error);
    showError('WebSocket connection error', errorContainer);
  });
  
  // Handle appointment update events
  const handleAppointmentUpdate = (data) => {
    console.log('Received appointments update:', data);
    
    if (!data || !data.tableData) {
      console.error('Invalid data in appointment update event:', data);
      return;
    }
    
    updateUIFn(data.tableData);
  };

  // Listen to universal appointment events for live updates
  websocketService.on('appointments_updated', handleAppointmentUpdate);
  websocketService.on('appointments_data', handleAppointmentUpdate);
  
  // Connect WebSocket
  websocketService.connect({
    clientType
  }).catch(error => {
    console.error('Error connecting WebSocket:', error);
    showError('Failed to connect to server', errorContainer);
    
    // Fallback to regular API
    loadAppointmentsFn();
  });
}

/**
 * Handle day change with automatic UI updates
 * @param {Object} context - Context object with date properties
 * @param {Function} updateTitleFn - Function to update title
 * @param {Object} websocketService - WebSocket service
 * @param {Function} fallbackFn - Fallback function if WebSocket not connected
 */
export function handleDayChange(context, updateTitleFn, websocketService, fallbackFn) {
  return (newDateString, newDate) => {
    // Update date properties
    context.date = newDate;
    context.dateString = newDateString;
    context.weekday = newDate.toLocaleDateString(undefined, { weekday: 'long' });
    
    // Update UI
    updateTitleFn();
    
    // Request new data via WebSocket if connected
    if (websocketService.isConnected) {
      websocketService.send({
        type: 'request_appointments',
        data: { date: context.dateString }
      });
    } else {
      // Fallback to API
      fallbackFn();
    }
  };
}

/**
 * Destroy appointments controller resources
 * @param {Object} resources - Resources to clean up
 * @param {Object} websocketService - WebSocket service
 */
export function destroyAppointmentsController(resources, websocketService) {
  // Clean up day change detection
  if (resources.dayChangeCleanup) {
    resources.dayChangeCleanup();
  }
  
  // Remove event listeners
  websocketService.off('connecting');
  websocketService.off('connected');
  websocketService.off('disconnected');
  websocketService.off('error');
  websocketService.off('appointments_updated');
  websocketService.off('appointments_data');
  
  // Stop clock
  if (resources.clock && resources.clock.destroy) {
    resources.clock.destroy();
  }
  
  // Destroy table
  if (resources.appointmentsTable && resources.appointmentsTable.destroy) {
    resources.appointmentsTable.destroy();
  }
  
  // Disconnect WebSocket
  websocketService.disconnect();
  
  // Remove connection indicator
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
export function initializeAppointmentsController(ControllerClass, controllerName) {
  let controller = null;
  
  // Initialize controller when DOM is loaded
  document.addEventListener('DOMContentLoaded', () => {
    controller = new ControllerClass();
    window[controllerName] = controller;
  });

  // Handle page unload
  window.addEventListener('beforeunload', () => {
    if (controller && controller.destroy) {
      controller.destroy();
    }
  });
  
  return controller;
}