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
    
    // Initialize async setup
    this.init();
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
      () => showError('Failed to load appointments data', this.tableContainer)
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
      null, // No highlighting for simplified view
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
   * Create new table
   * @param {Array} data - Table data
   * @private
   */
  async createTable(data) {
    this.appointmentsTable = await createAppointmentsTable(
      data,
      this.tableContainer,
      true // Include patient links for simplified interactive view
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