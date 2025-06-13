// pages/appointments2.js
/**
 * Appointments2 Page Controller
 * A simplified version of the appointments page without patient images or screen requirements
 * Uses live WebSocket updates for real-time appointment data
 */
import websocketService from '../services/websocket.js';
import appointmentService from '../services/appointment.js';
import { 
  formatDateString, 
  findBasicElements,
  updateAppointmentsUI,
  updateAppointmentsTable,
  createAppointmentsTable,
  createConnectionIndicator,
  showError,
  setupDayChangeDetection,
  setupClock,
  updateTable,
  loadAppointments,
  handleDayChange,
  destroyAppointmentsController,
  initializeAppointmentsController
} from '../components/appointments-shared.js';

class Appointments2PageController {
  /**
   * Initialize the simplified appointments page controller
   */
  constructor() {
    // Current date
    this.date = new Date();
    this.dateString = formatDateString(this.date);
    this.weekday = this.date.toLocaleDateString(undefined, { weekday: 'long' });
    
    
    // Create connection status indicator
    this.connectionIndicator = createConnectionIndicator();
    
    // Find DOM elements using shared utility
    const elements = findBasicElements();
    Object.assign(this, elements);
    
    // Find new containers
    this.allAppointmentsContainer = document.getElementById('all-appointments-container');
    this.checkedInContainer = document.getElementById('checked-in-container');
    
    // Find date picker elements
    this.datePicker = document.getElementById('date-picker');
    this.loadDateBtn = document.getElementById('load-date-btn');
    
    // Initialize async setup
    this.init();
  }
  
  /**
   * Initialize the page
   * @private
   */
  async init() {
    // Set up date picker
    this.setupDatePicker();
    
    // Set up clock
    this.clock = await setupClock('#canvas');

    // Load initial appointments data
    await this.loadBothAppointmentLists();

    // Set up WebSocket connection
    this.setupWebSocket();

    // Set up day change detection
    this.setupDayChangeDetection();
  }
  
  /**
   * Load both appointment lists
   * @private
   */
  async loadBothAppointmentLists() {
    // Prevent multiple concurrent loads
    if (this.isLoading) {
      console.log('Already loading appointments, skipping...');
      return;
    }
    
    this.isLoading = true;
    console.log(`Loading appointments for date: ${this.dateString}`);
    
    try {
      // Load all appointments
      const allAppointmentsResponse = await fetch(`/api/getAllTodayApps?AppsDate=${this.dateString}`);
      const allAppointments = await allAppointmentsResponse.json();
      console.log(`Got ${allAppointments.length} all appointments:`, allAppointments);
      
      // Load checked-in appointments (including dismissed)
      const checkedInResponse = await fetch(`/api/getWebApps?PDate=${this.dateString}`);
      const checkedInData = await checkedInResponse.json();
      console.log(`Got ${checkedInData.appointments?.length || 0} checked-in appointments:`, checkedInData.appointments);
      
      // For simplified view, get all patients who have been checked in (including dismissed)
      const allCheckedInPatients = allAppointments.filter(apt => 
        apt.Present || apt.Seated || apt.Dismissed
      );
      
      this.updateAllAppointmentsTable(allAppointments);
      this.updateCheckedInTable(allCheckedInPatients);
      this.updateStats(checkedInData);
      
    } catch (error) {
      console.error('Failed to load appointments:', error);
      showError('Failed to load appointments data', this.allAppointmentsContainer);
    } finally {
      this.isLoading = false;
    }
  }
  
  /**
   * Update all appointments table
   * @param {Array} appointments - All appointments data
   * @private
   */
  updateAllAppointmentsTable(appointments) {
    console.log(`Updating all appointments table with ${appointments.length} appointments`);
    
    // Always clear the container first
    this.allAppointmentsContainer.innerHTML = '';
    
    if (!appointments || appointments.length === 0) {
      this.allAppointmentsContainer.innerHTML = '<p>No appointments scheduled for today</p>';
      return;
    }
    
    const table = this.createAppointmentTable(appointments, true);
    this.allAppointmentsContainer.appendChild(table);
  }
  
  /**
   * Update checked-in appointments table
   * @param {Array} appointments - Checked-in appointments data
   * @private
   */
  updateCheckedInTable(appointments) {
    console.log(`Updating checked-in table with ${appointments.length} appointments`);
    
    // Always clear the container first
    this.checkedInContainer.innerHTML = '';
    
    if (!appointments || appointments.length === 0) {
      this.checkedInContainer.innerHTML = '<p>No patients checked in yet</p>';
      return;
    }
    
    const table = this.createAppointmentTable(appointments, false);
    this.checkedInContainer.appendChild(table);
  }
  
  /**
   * Create appointment table
   * @param {Array} appointments - Appointments data
   * @param {boolean} showCheckInButton - Whether to show check-in button
   * @private
   */
  createAppointmentTable(appointments, showCheckInButton) {
    const table = document.createElement('table');
    table.className = 'appointments-table';
    
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['Time', 'Patient', 'Type', 'Actions'];
    
    headers.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    appointments.forEach(appointment => {
      const row = document.createElement('tr');
      
      // Add color coding for checked-in table based on patient status
      if (!showCheckInButton) {
        if (appointment.Dismissed) {
          row.className = 'patient-status-dismissed';
        } else if (appointment.Seated) {
          row.className = 'patient-status-seated';
        } else if (appointment.Present) {
          row.className = 'patient-status-waiting';
        }
      }
      
      // Time
      const timeCell = document.createElement('td');
      timeCell.textContent = appointment.apptime || appointment.time || '';
      row.appendChild(timeCell);
      
      // Patient
      const patientCell = document.createElement('td');
      patientCell.textContent = appointment.PatientName || appointment.name || '';
      row.appendChild(patientCell);
      
      // Type
      const typeCell = document.createElement('td');
      typeCell.textContent = appointment.PatientType || appointment.type || '';
      row.appendChild(typeCell);
      
      // Actions
      const actionsCell = document.createElement('td');
      
      if (showCheckInButton) {
        const checkInBtn = document.createElement('button');
        checkInBtn.textContent = 'Check In';
        checkInBtn.className = 'btn-primary';
        checkInBtn.onclick = () => this.checkInPatient(appointment.appointmentID);
        actionsCell.appendChild(checkInBtn);
      } else {
        // Show status or action buttons based on current state
        if (appointment.Dismissed) {
          actionsCell.textContent = 'Dismissed';
          actionsCell.style.color = '#4caf50';
          actionsCell.style.fontWeight = 'bold';
        } else {
          const seatedBtn = document.createElement('button');
          seatedBtn.textContent = 'Seated';
          seatedBtn.className = 'btn-secondary';
          seatedBtn.onclick = () => this.updatePatientState(appointment.appointmentID, 'Seated');
          actionsCell.appendChild(seatedBtn);
          
          const dismissedBtn = document.createElement('button');
          dismissedBtn.textContent = 'Dismissed';
          dismissedBtn.className = 'btn-danger';
          dismissedBtn.onclick = () => this.updatePatientState(appointment.appointmentID, 'Dismissed');
          actionsCell.appendChild(dismissedBtn);
        }
      }
      
      row.appendChild(actionsCell);
      tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
    return table;
  }
  
  /**
   * Check in a patient
   * @param {number} appointmentID - Appointment ID
   * @private
   */
  async checkInPatient(appointmentID) {
    try {
      console.log(`✅ [CLIENT] Checking in patient with appointmentID: ${appointmentID}`);
      const response = await fetch('/api/updateAppointmentState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentID,
          state: 'Present'
        })
      });
      
      const result = await response.json();
      console.log('✅ [CLIENT] Check-in API response:', result);
      
      if (response.ok) {
        console.log('✅ [CLIENT] Check-in successful, waiting for WebSocket update...');
        // Don't manually reload - wait for WebSocket event
        // await this.loadBothAppointmentLists();
      } else {
        console.error('❌ [CLIENT] Failed to check in patient:', result);
      }
    } catch (error) {
      console.error('❌ [CLIENT] Error checking in patient:', error);
    }
  }
  
  /**
   * Update patient state
   * @param {number} appointmentID - Appointment ID
   * @param {string} state - New state (Seated, Dismissed)
   * @private
   */
  async updatePatientState(appointmentID, state) {
    try {
      const response = await fetch('/api/updateAppointmentState', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentID,
          state
        })
      });
      
      if (response.ok) {
        await this.loadBothAppointmentLists();
      } else {
        console.error(`Failed to update patient state to ${state}`);
      }
    } catch (error) {
      console.error(`Error updating patient state to ${state}:`, error);
    }
  }
  
  /**
   * Update stats display
   * @param {Object} data - Stats data
   * @private
   */
  updateStats(data) {
    if (this.statsElements) {
      this.statsElements.all.textContent = data.all || 0;
      this.statsElements.present.textContent = data.present || 0;
      this.statsElements.waiting.textContent = data.waiting || 0;
      this.statsElements.completed.textContent = data.completed || 0;
    }
  }
  
  /**
   * Set up date picker functionality
   * @private
   */
  setupDatePicker() {
    // Set current date as default
    if (this.datePicker) {
      this.datePicker.value = this.dateString;
    }
    
    // Update title with current date
    this.updateTitle();
    
    // Handle load button click
    if (this.loadDateBtn) {
      this.loadDateBtn.addEventListener('click', () => {
        this.loadSelectedDate();
      });
    }
    
    // Handle enter key in date picker
    if (this.datePicker) {
      this.datePicker.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.loadSelectedDate();
        }
      });
    }
  }
  
  /**
   * Load appointments for selected date
   * @private
   */
  async loadSelectedDate() {
    const selectedDate = this.datePicker.value;
    if (!selectedDate) {
      alert('Please select a date');
      return;
    }
    
    // Update internal date properties
    this.date = new Date(selectedDate + 'T00:00:00');
    this.dateString = selectedDate;
    this.weekday = this.date.toLocaleDateString(undefined, { weekday: 'long' });
    
    // Update title
    this.updateTitle();
    
    // Load appointments for new date
    await this.loadBothAppointmentLists();
  }
  
  /**
   * Update page title with current date
   * @private
   */
  updateTitle() {
    if (this.titleElement) {
      this.titleElement.textContent = `Appointments for ${this.weekday} ${this.dateString}`;
    }
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
    const handleAppointmentUpdate = (eventData) => {
      console.log('🔄 [CLIENT] Received WebSocket appointment update event');
      console.log('🔄 [CLIENT] Event data:', JSON.stringify(eventData, null, 2));
      console.log('🔄 [CLIENT] Reloading both appointment lists...');
      this.loadBothAppointmentLists();
    };

    // Handle all WebSocket messages for debugging
    websocketService.on('message', (message) => {
      console.log('📨 [CLIENT] Raw WebSocket message received:', JSON.stringify(message, null, 2));
    });

    // Listen to universal appointment update events only
    console.log('📡 [CLIENT] Setting up WebSocket event listeners...');
    websocketService.on('appointments_updated', (data) => {
      console.log('📡 [CLIENT] Received appointments_updated event:', JSON.stringify(data, null, 2));
      handleAppointmentUpdate(data);
    });
    websocketService.on('appointments_data', (data) => {
      console.log('📡 [CLIENT] Received appointments_data event:', JSON.stringify(data, null, 2));
      handleAppointmentUpdate(data);
    });
    websocketService.on('data_updated', (data) => {
      console.log('📡 [CLIENT] Received data_updated event:', JSON.stringify(data, null, 2));
      handleAppointmentUpdate(data);
    });
    console.log('📡 [CLIENT] WebSocket event listeners set up complete');

    websocketService.connect({ clientType: 'simplified' });
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
        this.init.bind(this)
      ),
      this.dateString
    );
  }
  
  /**
   * Clean up resources
   */
  destroy() {
    destroyAppointmentsController(this, websocketService);
  }
}

// Initialize controller using shared utility
initializeAppointmentsController(Appointments2PageController, 'appointments2Controller');