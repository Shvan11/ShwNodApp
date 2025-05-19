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
    console.log('Starting table update at:', new Date().toLocaleTimeString());
    console.log(`Updating table with ${appointments.length} appointments`);
    
    // Format appointment data to match expected format for Table component
    const formattedData = appointments.map(appointmentColumns => {
        // Ensure appointmentColumns is an array
        if (!Array.isArray(appointmentColumns)) {
            console.error('Invalid appointment format:', appointmentColumns);
            return {
                patientName: 'Error: Invalid data format',
                pid: ''
            };
        }
        
        // Extract values from each column
        const no = appointmentColumns[0]?.value || '';
        const time = appointmentColumns[1]?.value || '';
        const type = appointmentColumns[2]?.value || '';
        const patientName = appointmentColumns[3]?.value || 'Unknown';
        const detail = appointmentColumns[4]?.value || '';
        const present = appointmentColumns[5]?.value || '';
        const seated = appointmentColumns[6]?.value || '';
        const dismissed = appointmentColumns[7]?.value || '';
        const notes = appointmentColumns[8]?.value === 'true';
        const pid = appointmentColumns[9]?.value || '';
        
        // Return properly formatted data object
        return {
            no,
            time, 
            type,
            patientName,
            detail,
            present,
            seated,
            dismissed,
            notes,
            pid
        };
    });
    
    console.log(`Formatted ${formattedData.length} appointments for table`);
    
    // Initialize or update table component
    if (!this.appointmentsTable) {
        // Create table columns definition
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
                render: value => value ? '✔' : '✘'
            }
        ];
        
        // Create new table
        this.appointmentsTable = new Table(this.tableContainer, {
            columns,
            data: formattedData,
            className: 'appointments-table',
            responsive: true,
            rowClassName: row => this.activePID === row.pid ? 'active-patient' : '',
            onRowClick: (row) => {
                console.log('Row clicked:', row);
            }
        });
        
        console.log('Created new appointments table');
    } else {
        // Update existing table
        this.appointmentsTable.setData(formattedData);
        console.log('Updated existing appointments table');
    }
    
    // Also perform a direct DOM update as a fallback
    this.updateTableDirectly(appointments);
    
    // Force table to be visible and properly styled
    if (this.appointmentsTable && this.appointmentsTable.table) {
        const tableElement = this.appointmentsTable.table;
        tableElement.style.width = '100%';
        tableElement.style.borderCollapse = 'collapse';
        
        // Ensure all table cells are visible
        const cells = tableElement.querySelectorAll('th, td');
        cells.forEach(cell => {
            cell.style.display = 'table-cell';
            cell.style.padding = '8px';
            cell.style.border = '1px solid #ccc';
        });
    }
    
    // Create a visual indicator that the table has been updated
    this.showUpdateNotification();
}

// Add a direct DOM-based table update method as fallback
updateTableDirectly(appointments) {
    console.log('Performing direct DOM table update');
    
    // Find or create a fallback table if needed
    let fallbackTable = document.getElementById('fallback-appointments-table');
    if (!fallbackTable) {
        fallbackTable = document.createElement('table');
        fallbackTable.id = 'fallback-appointments-table';
        fallbackTable.style.width = '100%';
        fallbackTable.style.borderCollapse = 'collapse';
        fallbackTable.style.marginTop = '20px';
        
        // Create header row
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        ['No', 'Time', 'Type', 'Patient Name', 'Detail', 'Present', 'Seated', 'Dismissed', 'Notes'].forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            th.style.backgroundColor = '#f2f2f2';
            th.style.padding = '8px';
            th.style.border = '1px solid #ddd';
            th.style.textAlign = 'left';
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        fallbackTable.appendChild(thead);
        
        // Add tbody
        const tbody = document.createElement('tbody');
        fallbackTable.appendChild(tbody);
        
        // Add to DOM if main table is not working
        if (!this.appointmentsTable || !this.appointmentsTable.table || !this.appointmentsTable.table.isConnected) {
            const container = document.getElementById('appointments-container');
            if (container) {
                container.appendChild(fallbackTable);
                console.log('Added fallback table to DOM');
            }
        } else {
            // Create hidden but ready to use
            fallbackTable.style.display = 'none';
            document.body.appendChild(fallbackTable);
            console.log('Created hidden fallback table');
        }
    }
    
    // Get or create tbody
    const tbody = fallbackTable.querySelector('tbody') || fallbackTable.appendChild(document.createElement('tbody'));
    tbody.innerHTML = '';
    
    // Add rows directly
    appointments.forEach(appointmentColumns => {
        const row = document.createElement('tr');
        
        // Extract values
        const no = appointmentColumns[0]?.value || '';
        const time = appointmentColumns[1]?.value || '';
        const type = appointmentColumns[2]?.value || '';
        const patientName = appointmentColumns[3]?.value || 'Unknown';
        const detail = appointmentColumns[4]?.value || '';
        const present = appointmentColumns[5]?.value || '';
        const seated = appointmentColumns[6]?.value || '';
        const dismissed = appointmentColumns[7]?.value || '';
        const notes = appointmentColumns[8]?.value === 'true';
        const pid = appointmentColumns[9]?.value || '';
        
        // Create cells
        [
            { value: no },
            { value: time },
            { value: type },
            { 
                value: patientName,
                html: `<a href="/visits-summary?PID=${pid}">${patientName}</a>`
            },
            { value: detail },
            { 
                value: present,
                style: {
                    backgroundColor: dismissed ? 'lightgreen' : (seated ? 'lightyellow' : 'pink')
                }
            },
            { value: seated },
            { value: dismissed },
            { value: notes ? '✔' : '✘' }
        ].forEach(cellData => {
            const cell = document.createElement('td');
            
            // Apply value
            if (cellData.html) {
                cell.innerHTML = cellData.html;
            } else {
                cell.textContent = cellData.value;
            }
            
            // Apply styling
            cell.style.padding = '8px';
            cell.style.border = '1px solid #ddd';
            
            // Apply custom styling
            if (cellData.style) {
                Object.entries(cellData.style).forEach(([property, value]) => {
                    cell.style[property] = value;
                });
            }
            
            row.appendChild(cell);
        });
        
        tbody.appendChild(row);
    });
    
    console.log(`Direct table update completed with ${appointments.length} rows`);
    
    // Show fallback table if main table is not visible
    if (this.appointmentsTable && this.appointmentsTable.table && 
        (this.appointmentsTable.table.offsetHeight === 0 || 
         !this.appointmentsTable.table.isConnected)) {
        fallbackTable.style.display = 'table';
        console.log('Activated fallback table');
    }
}

// Add a visual notification method
showUpdateNotification() {
    const notification = document.createElement('div');
    notification.textContent = `Table updated: ${new Date().toLocaleTimeString()}`;
    notification.style.position = 'fixed';
    notification.style.top = '10px';
    notification.style.right = '10px';
    notification.style.backgroundColor = '#4CAF50';
    notification.style.color = 'white';
    notification.style.padding = '10px';
    notification.style.borderRadius = '5px';
    notification.style.zIndex = '1000';
    notification.style.transition = 'opacity 2s';
    
    document.body.appendChild(notification);
    
    // Fade out after 3 seconds
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            notification.remove();
        }, 2000);
    }, 3000);
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
    // Add status indicator to the page
    const statusIndicator = document.createElement('div');
    statusIndicator.id = 'ws-status';
    statusIndicator.style.position = 'fixed';
    statusIndicator.style.bottom = '10px';
    statusIndicator.style.right = '10px';
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
    websocket.connect();
    
    // Handle connection events
    websocket.on('connected', () => {
      updateStatus('connected');
      console.log('WebSocket connected');
    });
    
    websocket.on('disconnected', () => {
      updateStatus('disconnected');
      console.log('WebSocket disconnected');
    });
    
    websocket.on('error', (error) => {
      updateStatus('error');
      console.error('WebSocket error:', error);
    });
    

    // Handlesetu 'updated' event
    websocket.on('updated', data => {
      console.log('Received WebSocket update:', data);
      
      if (!data || !data.tableData) {
          console.error('Invalid data in "updated" event:', data);
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
          
          // Try direct update as last resort
          try {
              this.updateTableDirectly(appointments);
          } catch (directError) {
              console.error('Even direct table update failed:', directError);
          }
      }
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