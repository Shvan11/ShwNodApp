/**
 * WhatsApp Messaging Application - WebSocket Only
 * Handles real-time UI communication for sending WhatsApp messages
 */
import websocketService from '../services/websocket.js';

class WhatsAppMessenger {
  constructor() {
    // Core state
    this.urlParams = new URLSearchParams(window.location.search);
    this.defaultDate = this.urlParams.get('date') || new Date().toISOString().slice(0, 10);
    this.dateparam = this.defaultDate; // Will be updated when user selects different date
    this.finished = false;
    this.sendingStarted = false;
    this.clientReadyShown = false;
    
    // WebSocket connection via service - no manual state tracking needed
    
    // Message management
    this.persons = [];
    this.statusUpdateQueue = new Map();
    this.processedMessageIds = new Map();
    this.messageDeduplicationWindow = 5000;
    this.messageCount = null;
    
    // Resource tracking
    this.activeTimers = new Set();
    this.activeEventListeners = new Map();
    
    // DOM elements
    this.stateElement = document.getElementById("state");
    this.startButton = document.getElementById("startSendingBtn");
    this.qrImage = document.getElementById("qr");
    this.tableContainer = document.getElementById("table-container");
    this.restartButtonContainer = document.getElementById("restart-button-container");
    
    console.log('DOM elements found:');
    console.log('- state:', !!this.stateElement);
    console.log('- startSendingBtn:', !!this.startButton);
    console.log('- restart-button-container:', !!this.restartButtonContainer);
    
    // New date selection elements
    this.dateSelector = document.getElementById("dateSelector");
    this.refreshDateBtn = document.getElementById("refreshDateBtn");
    this.resetMessagingBtn = document.getElementById("resetMessagingBtn");
    this.messageCountElement = document.getElementById("messageCount");
    
    // Client action buttons
    this.restartClientBtn = document.getElementById("restartClientBtn");
    this.destroyClientBtn = document.getElementById("destroyClientBtn");
    this.logoutClientBtn = document.getElementById("logoutClientBtn");

    this.init();
  }

  init() {
    console.log("Initializing WebSocket-only messenger with default date:", this.dateparam);
    
    this.setupDateDropdown();
    this.bindEvents();
    this.setupCleanupHandlers();
    this.setupWebSocket();
    this.loadMessageCount(); // Load initial message count
  }

  setupDateDropdown() {
    if (!this.dateSelector) {
      console.error("Date selector element not found");
      return;
    }

    // Generate date options (last 7 days and next 30 days)
    const today = new Date();
    const dates = [];
    
    // Add past 7 days
    for (let i = 7; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      dates.push(date);
    }
    
    // Add next 30 days
    for (let i = 1; i <= 30; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push(date);
    }

    // Clear existing options
    this.dateSelector.innerHTML = '';

    // Add options to dropdown
    dates.forEach(date => {
      const option = document.createElement('option');
      const dateStr = date.toISOString().slice(0, 10);
      option.value = dateStr;
      
      // Format display text
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = dayNames[date.getDay()];
      const isToday = dateStr === today.toISOString().slice(0, 10);
      const isYesterday = dateStr === new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
      const isTomorrow = dateStr === new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
      
      let displayText = `${dateStr} (${dayName})`;
      if (isToday) displayText += ' - Today';
      else if (isYesterday) displayText += ' - Yesterday';
      else if (isTomorrow) displayText += ' - Tomorrow';
      
      option.textContent = displayText;
      
      // Set as selected if it matches the default date
      if (dateStr === this.defaultDate) {
        option.selected = true;
      }
      
      this.dateSelector.appendChild(option);
    });

    console.log(`Set up date dropdown with ${dates.length} options, default: ${this.defaultDate}`);
  }

  async loadMessageCount() {
    if (!this.messageCountElement) return;
    
    this.updateMessageCountDisplay('Loading message count...', 'loading');
    
    try {
      const response = await fetch(`${window.location.origin}/api/messaging/count/${this.dateparam}`);
      const data = await response.json();
      
      if (data.success) {
        const count = data.data;
        
        // Calculate actual sendable messages by excluding those with errors
        const statusCounts = this.countStatusTypes();
        const actualSendable = Math.max(0, count.eligibleForMessaging - statusCounts.error);
        
        let message = `${actualSendable} messages ready to send`;
        
        if (statusCounts.error > 0) {
          message += ` (${statusCounts.error} with errors)`;
        }
        
        if (count.alreadySent > 0) {
          message += ` (${count.alreadySent} already sent`;
          if (count.pending > 0) {
            message += `, ${count.pending} pending`;
          }
          message += ')';
        } else if (count.pending > 0) {
          message += ` (${count.pending} pending)`;
        }
        
        this.updateMessageCountDisplay(message, actualSendable > 0 ? 'success' : 'error');
        
        // Store message count for button enablement logic
        this.messageCount = count;
        this.updateButtonState();
        
        // Load existing message details if any exist
        if (count.alreadySent > 0 || count.pending > 0) {
          this.loadExistingMessages();
        }
      } else {
        this.updateMessageCountDisplay(`Error: ${data.error}`, 'error');
        this.messageCount = null;
        this.updateButtonState();
      }
    } catch (error) {
      console.error('Error loading message count:', error);
      this.updateMessageCountDisplay('Error loading message count', 'error');
      this.messageCount = null;
      this.updateButtonState();
    }
  }

  async loadExistingMessages() {
    try {
      const response = await fetch(`${window.location.origin}/api/messaging/details/${this.dateparam}`);
      const data = await response.json();
      
      if (data.success && data.data.existingMessages.length > 0) {
        console.log(`Loaded ${data.data.existingMessages.length} existing messages for ${this.dateparam}`);
        
        // Convert existing messages to the format expected by the table
        const persons = data.data.existingMessages.map(msg => ({
          name: msg.patientName || msg.name || 'Unknown',
          number: msg.phoneNumber || msg.number || '',
          messageId: msg.messageId || msg.id,
          status: msg.status || 0,
          lastUpdated: msg.lastUpdated ? new Date(msg.lastUpdated).getTime() : Date.now()
        }));
        
        this.updatePersons(persons);
        this.createTable(this.persons);
      }
    } catch (error) {
      console.error('Error loading existing messages:', error);
    }
  }

  updateMessageCountDisplay(message, type = '') {
    if (!this.messageCountElement) return;
    
    this.messageCountElement.textContent = message;
    this.messageCountElement.className = `message-count-info ${type}`;
  }

  // Reset messaging functionality
  async handleResetMessaging() {
    if (!this.resetMessagingBtn) return;
    
    // First click - show confirmation
    if (!this.resetMessagingBtn.classList.contains('confirming')) {
      this.resetMessagingBtn.textContent = 'Click Again to Confirm';
      this.resetMessagingBtn.classList.add('confirming');
      
      // Reset confirmation after 3 seconds
      setTimeout(() => {
        if (this.resetMessagingBtn) {
          this.resetMessagingBtn.textContent = 'Reset Messages';
          this.resetMessagingBtn.classList.remove('confirming');
        }
      }, 3000);
      
      return;
    }
    
    // Second click - execute reset
    await this.executeReset();
  }

  async executeReset() {
    if (!this.resetMessagingBtn) return;
    
    try {
      // Disable button and show loading
      this.resetMessagingBtn.disabled = true;
      this.resetMessagingBtn.textContent = 'Resetting...';
      this.resetMessagingBtn.classList.remove('confirming');
      
      console.log(`Resetting messaging for date: ${this.dateparam}`);
      
      // Call the API to reset messaging
      const response = await fetch(`${window.location.origin}/api/messaging/reset/${this.dateparam}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('Reset successful:', result.data);
        
        // Clear frontend data
        this.clearAllMessagingData();
        
        // Show success message
        this.updateMessageCountDisplay(
          `Reset completed! ${result.data.appointmentsReset} appointments reset`, 
          'success'
        );
        
        // Reload message count to reflect changes
        setTimeout(() => {
          this.loadMessageCount();
        }, 1000);
        
        // Reset button text
        this.resetMessagingBtn.textContent = 'Reset Messages';
        this.resetMessagingBtn.disabled = false;
        
      } else {
        throw new Error(result.message || result.error || 'Reset failed');
      }
      
    } catch (error) {
      console.error('Error resetting messaging:', error);
      
      this.updateMessageCountDisplay(
        `Reset failed: ${error.message}`, 
        'error'
      );
      
      // Reset button
      this.resetMessagingBtn.textContent = 'Reset Messages';
      this.resetMessagingBtn.disabled = false;
    }
  }

  // Clear all messaging data from frontend
  clearAllMessagingData() {
    console.log('Clearing all message data from memory');
    
    // Clear persons array
    this.persons = [];
    
    // Clear status update queue
    this.statusUpdateQueue.clear();
    
    // Clear processed message IDs
    this.processedMessageIds.clear();
    
    // Clear table display
    this.tableContainer.innerHTML = '';
    
    // Reset message count
    this.messageCount = null;
    
    // Reset state flags
    this.finished = false;
    this.sendingStarted = false;
    
    // Hide start button
    if (this.startButton) {
      this.startButton.style.display = 'none';
      this.startButton.disabled = true;
    }
    
    console.log('All message data cleared from frontend memory');
  }

  // Restart client functionality - preserves authentication
  async handleRestartClient() {
    if (!this.restartClientBtn) return;
    
    try {
      this.restartClientBtn.disabled = true;
      this.restartClientBtn.textContent = 'Restarting...';
      this.restartClientBtn.classList.add('restarting');
      
      console.log('Restarting WhatsApp client - authentication preserved');
      this.updateState('<div class="loader"></div> Restarting WhatsApp client...');
      
      const response = await fetch(`${window.location.origin}/api/wa/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('Restart successful:', result.message);
        this.clientReadyShown = false;
        // Reconnection is handled by websocket service
        // Don't request initial state - let WebSocket real-time updates handle it
        
        this.updateMessageCountDisplay('Client restart initiated', 'success');
      } else {
        throw new Error(result.message || 'Restart failed');
      }
      
    } catch (error) {
      console.error('Error restarting client:', error);
      this.updateState(`<div class="error-state"><p>❌ Restart failed: ${error.message}</p></div>`);
      this.updateMessageCountDisplay(`Restart failed: ${error.message}`, 'error');
    } finally {
      this.restartClientBtn.textContent = 'Restart Client';
      this.restartClientBtn.disabled = false;
      this.restartClientBtn.classList.remove('restarting');
    }
  }

  // Destroy client functionality - close browser but preserve authentication
  async handleDestroyClient() {
    if (!this.destroyClientBtn) return;
    
    // First click - show confirmation
    if (!this.destroyClientBtn.classList.contains('confirming')) {
      this.destroyClientBtn.textContent = 'Click Again to Confirm';
      this.destroyClientBtn.classList.add('confirming');
      
      setTimeout(() => {
        if (this.destroyClientBtn) {
          this.destroyClientBtn.textContent = 'Destroy Client';
          this.destroyClientBtn.classList.remove('confirming');
        }
      }, 3000);
      
      return;
    }
    
    try {
      this.destroyClientBtn.disabled = true;
      this.destroyClientBtn.textContent = 'Destroying...';
      this.destroyClientBtn.classList.remove('confirming');
      this.destroyClientBtn.classList.add('destroying');
      
      console.log('Destroying WhatsApp client - preserving authentication');
      this.updateState('<div class="loader"></div> Destroying client - preserving authentication...');
      
      const response = await fetch(`${window.location.origin}/api/wa/destroy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('Destroy successful:', result.message);
        this.clientReadyShown = false;
        
        if (this.qrImage) {
          this.qrImage.style.display = 'none';
        }
        
        this.updateState(`
          <div class="completion-status">
            <h3>🔄 WhatsApp client destroyed successfully!</h3>
            <p>${result.message}</p>
            <p class="note">Browser closed to save resources. Authentication preserved.</p>
            <p class="note">Use "Restart Client" to reconnect without scanning QR code.</p>
          </div>
        `);
        
        this.updateMessageCountDisplay('Client destroyed - authentication preserved', 'success');
      } else {
        throw new Error(result.message || 'Destroy failed');
      }
      
    } catch (error) {
      console.error('Error destroying client:', error);
      this.updateState(`<div class="error-state"><p>❌ Destroy failed: ${error.message}</p></div>`);
      this.updateMessageCountDisplay(`Destroy failed: ${error.message}`, 'error');
    } finally {
      this.destroyClientBtn.textContent = 'Destroy Client';
      this.destroyClientBtn.disabled = false;
      this.destroyClientBtn.classList.remove('destroying');
    }
  }

  // Logout client functionality - completely clear authentication
  async handleLogoutClient() {
    if (!this.logoutClientBtn) return;
    
    // First click - show confirmation
    if (!this.logoutClientBtn.classList.contains('confirming')) {
      this.logoutClientBtn.textContent = 'Click Again to Confirm';
      this.logoutClientBtn.classList.add('confirming');
      
      setTimeout(() => {
        if (this.logoutClientBtn) {
          this.logoutClientBtn.textContent = 'Logout Client';
          this.logoutClientBtn.classList.remove('confirming');
        }
      }, 5000);
      
      return;
    }
    
    try {
      this.logoutClientBtn.disabled = true;
      this.logoutClientBtn.textContent = 'Logging out...';
      this.logoutClientBtn.classList.remove('confirming');
      this.logoutClientBtn.classList.add('logging-out');
      
      console.log('Logging out WhatsApp client - clearing authentication');
      this.updateState('<div class="loader"></div> Logging out and clearing authentication...');
      
      const response = await fetch(`${window.location.origin}/api/wa/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('Logout successful:', result.message);
        
        // Clear all frontend data
        this.clearAllMessagingData();
        this.clientReadyShown = false;
        
        if (this.qrImage) {
          this.qrImage.style.display = 'none';
        }
        
        this.updateState(`
          <div class="completion-status">
            <h3>🚪 WhatsApp client logged out successfully!</h3>
            <p>${result.message}</p>
            <p class="note">Device removed from WhatsApp linked devices.</p>
            <p class="note">Authentication completely cleared - QR scan required for reconnection.</p>
          </div>
        `);
        
        this.updateMessageCountDisplay('Client logged out - authentication cleared', 'success');
      } else {
        throw new Error(result.message || 'Logout failed');
      }
      
    } catch (error) {
      console.error('Error logging out client:', error);
      this.updateState(`<div class="error-state"><p>❌ Logout failed: ${error.message}</p></div>`);
      this.updateMessageCountDisplay(`Logout failed: ${error.message}`, 'error');
    } finally {
      this.logoutClientBtn.textContent = 'Logout Client';
      this.logoutClientBtn.disabled = false;
      this.logoutClientBtn.classList.remove('logging-out');
    }
  }

  updateButtonState() {
    if (!this.startButton) return;
    
    // Calculate actual sendable messages (exclude errors)
    const statusCounts = this.countStatusTypes();
    const sendableMessages = this.messageCount ? 
      (this.messageCount.eligibleForMessaging - statusCounts.error) : 0;
    const hasUnsentMessages = sendableMessages > statusCounts.sent + statusCounts.delivered + statusCounts.read;
    
    // Enable button if there are unsent messages and client is ready
    const canEnable = hasUnsentMessages && this.clientReadyShown && !this.sendingStarted;
    
    this.startButton.disabled = !canEnable;
    
    if (this.messageCount && this.messageCount.eligibleForMessaging > 0 && this.clientReadyShown) {
      this.startButton.style.display = 'block';
      
      if (this.finished) {
        // Check if there are still unsent messages after completion
        if (hasUnsentMessages) {
          this.startButton.textContent = 'Send Remaining Messages';
          this.startButton.disabled = false;
        } else {
          this.startButton.textContent = 'Completed';
          this.startButton.disabled = true;
        }
      } else if (!this.sendingStarted) {
        this.startButton.textContent = 'Start Sending Messages';
        this.startButton.disabled = !canEnable;
      }
    }
    
    console.log(`Button state updated: sendableMessages=${sendableMessages}, hasUnsent=${hasUnsentMessages}, clientReady=${this.clientReadyShown}, canEnable=${canEnable}`);
  }

  onDateChange() {
    const newDate = this.dateSelector.value;
    if (newDate && newDate !== this.dateparam) {
      console.log(`Date changed from ${this.dateparam} to ${newDate}`);
      this.dateparam = newDate;
      
      // Clear existing data
      this.persons = [];
      this.statusUpdateQueue.clear();
      this.tableContainer.innerHTML = '';
      
      // Reset state
      this.finished = false;
      this.sendingStarted = false;
      this.clientReadyShown = false;
      
      // Clean up previous websocket handlers and reconnect with new date
      this.cleanupWebSocketHandlers();
      this.setupWebSocket();
      
      // Load new message count
      this.loadMessageCount();
      
      console.log(`Switched to date: ${newDate}`);
    }
  }

  bindEvents() {
    // Date selector functionality
    if (this.dateSelector) {
      this.dateSelector.addEventListener('change', () => {
        this.onDateChange();
      });
    }

    // Refresh button functionality
    if (this.refreshDateBtn) {
      this.refreshDateBtn.addEventListener('click', () => {
        this.loadMessageCount();
      });
    }

    // Reset messaging button functionality
    if (this.resetMessagingBtn) {
      this.resetMessagingBtn.addEventListener('click', () => {
        this.handleResetMessaging();
      });
    }

    // Client action button functionality
    if (this.restartClientBtn) {
      this.restartClientBtn.addEventListener('click', () => {
        this.handleRestartClient();
      });
    }

    if (this.destroyClientBtn) {
      this.destroyClientBtn.addEventListener('click', () => {
        this.handleDestroyClient();
      });
    }

    if (this.logoutClientBtn) {
      this.logoutClientBtn.addEventListener('click', () => {
        this.handleLogoutClient();
      });
    }

    // Start button functionality
    if (this.startButton) {
      this.startButton.addEventListener('click', () => {
        if (this.startButton.dataset.action === 'retry') {
          this.retryInitialization();
          return;
        }
        this.startSending();
        this.startButton.disabled = true;
      });
    }

    // Prevent accidental navigation during sending
    const beforeUnloadHandler = (event) => {
      if (!this.finished && this.sendingStarted) {
        const message = 'Leaving this page will interrupt the WhatsApp sending process.';
        event.returnValue = message;
        return message;
      }
    };
    
    window.addEventListener('beforeunload', beforeUnloadHandler);
    this.activeEventListeners.set('beforeunload', beforeUnloadHandler);
  }

  // Resource Management
  addTimerWithTracking(callback, delay, isInterval = false) {
    const timerId = isInterval ? 
      setInterval(callback, delay) : 
      setTimeout(callback, delay);
    
    this.activeTimers.add(timerId);
    
    if (!isInterval) {
      setTimeout(() => this.activeTimers.delete(timerId), delay + 100);
    }
    
    return timerId;
  }

  clearTimerWithTracking(timerId) {
    if (this.activeTimers.has(timerId)) {
      clearTimeout(timerId);
      clearInterval(timerId);
      this.activeTimers.delete(timerId);
    }
  }

  clearAllTimers() {
    console.log(`Clearing ${this.activeTimers.size} active timers`);
    this.activeTimers.forEach(timerId => {
      clearTimeout(timerId);
      clearInterval(timerId);
    });
    this.activeTimers.clear();
  }

  // Message Deduplication
  isDuplicateMessage(messageId, messageType) {
    if (!messageId) return false;
    
    const key = `${messageType}_${messageId}`;
    const now = Date.now();
    
    // Clean old entries
    for (const [processedKey, timestamp] of this.processedMessageIds) {
      if (now - timestamp > this.messageDeduplicationWindow) {
        this.processedMessageIds.delete(processedKey);
      }
    }
    
    if (this.processedMessageIds.has(key)) {
      console.log(`Duplicate message detected: ${key}`);
      return true;
    }
    
    this.processedMessageIds.set(key, now);
    return false;
  }

  // Message Validation
  validateMessage(message) {
    if (!message || typeof message !== 'object') {
      console.warn("Message must be an object");
      return false;
    }
    
    // Security: Prevent prototype pollution
    if (message.hasOwnProperty('__proto__') || 
        message.hasOwnProperty('constructor') || 
        message.hasOwnProperty('prototype')) {
      console.error("Message contains forbidden properties - potential security risk");
      return false;
    }
    
    if (!message.type || typeof message.type !== 'string' || message.type.length === 0) {
      console.warn("Message missing or invalid type field");
      return false;
    }
    
    const validTypes = [
      'qr_update', 'client_ready', 'message_status', 'batch_status',
      'appointment_update', 'sending_finished', 'error',
      'initial_state_response', 'request_initial_state',
      'ping', 'pong', 'heartbeat', 'ack'
    ];
    
    if (!validTypes.includes(message.type)) {
      console.warn(`Unknown message type: ${message.type}`);
      return false;
    }
    
    const controlMessages = ['ping', 'pong', 'heartbeat', 'ack'];
    
    if (!controlMessages.includes(message.type)) {
      if (message.data === undefined || message.data === null) {
        console.warn("Message missing data field:", message.type);
        return false;
      }
      
      if (typeof message.data !== 'object') {
        console.warn("Message data must be an object");
        return false;
      }
    }
    
    if (message.timestamp !== undefined && 
        (typeof message.timestamp !== 'number' || message.timestamp <= 0)) {
      console.warn("Invalid timestamp in message");
      return false;
    }
    
    return true;
  }

  // UI Management - addRestartButton removed as buttons are now in HTML

  updateState(html) {
    if (this.stateElement) {
      this.stateElement.innerHTML = html;
    }
  }

  updateQR(qr) {
    if (!this.qrImage) {
      console.error("No QR image element found!");
      return;
    }

    if (!qr) {
      console.log("No QR provided, hiding QR image");
      this.qrImage.style.display = 'none';
      return;
    }

    console.log("Updating QR code display");
    
    if (typeof qr === 'string') {
      if (qr.startsWith('data:image')) {
        this.qrImage.src = qr;
      } else {
        this.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
      }
      this.qrImage.style.display = 'block';
    } else {
      console.error("Invalid QR code format received:", typeof qr);
    }
  }

  // Client Management - moved to handleRestartClient()

  retryInitialization() {
    console.log("Retrying WhatsApp client initialization");
    // Reconnection is handled by websocket service
    this.updateState('<div class="loader"></div> Reinitializing WhatsApp client...');
    this.startButton.style.display = 'none';

    fetch(`${window.location.origin}/api/wa/restart`, { method: 'POST' })
      .then(response => response.json())
      .then(data => {
        console.log("Restart response:", data);
        this.updateState(data.message || 'Restarting WhatsApp client...');
        this.cleanupWebSocketHandlers();
        this.setupWebSocket();
      })
      .catch(error => {
        console.error("Error restarting WhatsApp client:", error);
        this.updateState('Error restarting WhatsApp client. Please refresh the page.');
      });
  }

  startSending() {
    console.log("Starting sending process...");
    this.sendingStarted = true;
    this.sendWa();
  }

  // WebSocket Connection Management using websocket service
  setupWebSocket() {
    // Set up event handlers for the websocket service
    websocketService.on('connected', () => {
      console.log("WebSocket connected successfully");
      this.requestInitialState();
    });

    websocketService.on('disconnected', (event) => {
      console.log("WebSocket connection closed", event.code, event.reason);
      // The service handles automatic reconnection
    });

    websocketService.on('error', (error) => {
      console.error("WebSocket error:", error);
    });

    // Handle all message types
    websocketService.on('qrUpdate', (data) => this.handleQRUpdate(data));
    websocketService.on('clientReady', (data) => this.handleClientReady(data));
    websocketService.on('messageStatus', (data) => this.handleSingleStatusUpdate(data));
    websocketService.on('batchStatus', (data) => this.handleBatchStatusUpdate(data));
    websocketService.on('appointmentUpdate', (data) => this.handleAppointmentUpdate(data));
    websocketService.on('sendingFinished', (data) => this.handleSendingFinished(data));
    websocketService.on('initialStateResponse', (data) => {
      console.log("Received initial state response via WebSocket");
      this.processInitialState(data);
    });
    websocketService.on('error', (data) => {
      if (data && data.error) {
        this.handleError(data);
      } else {
        console.error("Received error message without details:", data);
      }
    });

    // Legacy message handling for backwards compatibility
    websocketService.on('message', (message) => {
      this.handleLegacyMessage(message);
    });

    // Connect with the required parameters
    const connectionParams = {
      PDate: this.dateparam,
      clientType: 'waStatus',
      needsQR: 'true'
    };
    
    websocketService.connect(connectionParams);
  }

  // WebSocket message handling is now done via specific event handlers in setupWebSocket()

  cleanupWebSocketHandlers() {
    // Remove all event handlers to prevent duplicates
    websocketService.off('connected');
    websocketService.off('disconnected');
    websocketService.off('error');
    websocketService.off('qrUpdate');
    websocketService.off('clientReady');
    websocketService.off('messageStatus');
    websocketService.off('batchStatus');
    websocketService.off('appointmentUpdate');
    websocketService.off('sendingFinished');
    websocketService.off('initialStateResponse');
    websocketService.off('message');
  }

  // Reconnection is now handled automatically by the websocket service

  // State Management
  requestInitialState() {
    if (websocketService.isConnected) {
      console.log("Requesting initial state via WebSocket");
      try {
        websocketService.send({
          type: 'request_initial_state',
          data: {
            date: this.dateparam,
            timestamp: Date.now()
          }
        });
      } catch (error) {
        console.error("Error requesting initial state:", error);
        this.requestInitialStateAPI();
      }
    } else {
      console.warn("WebSocket not ready, using API fallback for initial state");
      this.requestInitialStateAPI();
    }
  }
  
  async requestInitialStateAPI() {
    try {
      console.log("Fetching initial state via API");
      const response = await fetch(`${window.location.origin}/api/update`);
      const data = await response.json();
      console.log("Initial state response:", data);
      
      this.processInitialState(data);
    } catch (error) {
      console.error('Error fetching initial state:', error);
      this.updateState('Error loading initial state');
    }
  }
  
  processInitialState(data) {
    if (data.qr && !data.clientReady) {
      console.log("QR code received in initial state");
      this.updateQR(data.qr);
      this.updateState('<p>Please scan the QR code with your WhatsApp</p>');
    }

    if (data.clientReady && !this.clientReadyShown && !this.sendingStarted) {
      console.log("Client is ready from initial state!");
      if (this.qrImage) {
        this.qrImage.style.display = 'none';
      }
      
      this.clientReadyShown = true;
      this.startButton.dataset.action = 'send';
      this.updateState(`<p>Client is ready! ${data.sentMessages || 0} Messages Sent, ${data.failedMessages || 0} Failed</p><p>Click "Start Sending Messages" to begin</p>`);
      
      // Update button state based on message count
      this.updateButtonState();
    } else if (!data.clientReady && !this.clientReadyShown) {
      this.updateState(data.htmltext || 'Initializing the client...');
    }

    if (data.persons && data.persons.length > 0) {
      this.updatePersons(data.persons);
      this.createTable(this.persons);
    }

    if (data.statusUpdates && data.statusUpdates.length > 0) {
      data.statusUpdates.forEach(update => {
        this.updateMessageStatus(update.messageId, update.status);
      });
      this.createTable(this.persons);
    }

    if (data.finished) {
      this.finished = true;
      this.updateFinishedState();
    }
  }

  // Message Handlers
  handleQRUpdate(data) {
    console.log("QR code received via WebSocket");
    
    if (data.qr && !data.clientReady) {
      this.updateQR(data.qr);
      this.updateState('<p>Please scan the QR code with your WhatsApp</p>');
    }
  }
  
  handleClientReady(data) {
    console.log("Client ready state update received:", data);
    
    // Handle different client states
    if (data.state === 'restarting') {
      console.log("Client is restarting");
      this.clientReadyShown = false;
      this.updateState('<div class="loader"></div> Restarting WhatsApp client...');
      
      if (this.qrImage) {
        this.qrImage.style.display = 'none';
      }
      
      if (this.startButton) {
        this.startButton.style.display = 'none';
        this.startButton.disabled = true;
      }
      
    } else if (data.state === 'initializing') {
      console.log("Client is initializing (from restart)");
      this.clientReadyShown = false;
      this.updateState('<div class="loader"></div> Initializing WhatsApp client after restart...');
      
      if (this.qrImage) {
        this.qrImage.style.display = 'none';
      }
      
      if (this.startButton) {
        this.startButton.style.display = 'none';
        this.startButton.disabled = true;
      }
      
    } else if (data.clientReady || data.state === 'ready') {
      console.log("Client is ready from WebSocket!", data);
      
      if (this.qrImage) {
        this.qrImage.style.display = 'none';
      }
      
      if (!this.clientReadyShown && !this.sendingStarted) {
        this.clientReadyShown = true;
        this.startButton.dataset.action = 'send';
        const message = data.message || 'Client is ready! Click "Start Sending Messages" to begin';
        this.updateState(`<p>${message}</p>`);
        
        // Update button state based on message count
        this.updateButtonState();
      }
      
    } else {
      // Client not ready - might be disconnected or error state
      console.log("Client not ready (fallback case):", data);
      this.clientReadyShown = false;
      
      const message = data.message || 'Client disconnected - initializing...';
      this.updateState(`<div class="loader"></div> ${message}`);
      
      if (this.startButton) {
        this.startButton.style.display = 'none';
        this.startButton.disabled = true;
      }
    }
  }
  
  handleSingleStatusUpdate(data) {
    console.log("Single status update received:", data);
    
    if (data.messageId && data.status !== undefined) {
      // If this is a newly sent message (includes person data), add it to our list
      if (data.person && !this.persons.find(p => p.messageId === data.messageId)) {
        console.log("Adding newly sent message to client list:", data.person);
        const person = {
          messageId: data.person.messageId,
          appointmentId: data.person.appointmentId,
          name: data.person.name,
          number: data.person.number,
          status: data.status,
          success: data.person.success,
          lastUpdated: Date.now(),
          addedAt: Date.now()
        };
        this.persons.push(person);
      }
      
      // Update the status
      this.updateMessageStatus(data.messageId, data.status);
      this.createTable(this.persons);
    }
  }
  
  handleBatchStatusUpdate(data) {
    console.log("Batch status update received:", data);
    
    if (data.statusUpdates && Array.isArray(data.statusUpdates)) {
      let updatesProcessed = 0;
      
      data.statusUpdates.forEach(update => {
        if (update.messageId && update.status !== undefined) {
          this.updateMessageStatus(update.messageId, update.status);
          updatesProcessed++;
        }
      });
      
      if (updatesProcessed > 0) {
        this.createTable(this.persons);
        console.log(`Processed ${updatesProcessed} status updates`);
      }
    }
  }
  
  handleAppointmentUpdate(data) {
    console.log("Appointment update received:", data);
    
    if (data.tableData) {
      this.updateUI(data);
    }
  }
  
  handleSendingFinished(data) {
    console.log("Sending finished received:", data);
    
    if (data.finished && !this.finished) {
      this.finished = true;
      this.updateFinishedState();
      
      // Refresh message count to show updated numbers
      this.loadMessageCount();
    }
  }
  
  handleError(data) {
    console.error("Error message received:", data);
    
    if (data.error) {
      this.updateState(`<p class="error">Error: ${data.error}</p>`);
    }
  }
  
  handleLegacyMessage(message) {
    if (message.messageType === "updated") {
      this.updateUI(message.tableData);
    } else if (message.messageType === "messageAckUpdated") {
      this.updateMessageStatus(message.messageId, message.status);
      this.createTable(this.persons);
    } else if (message.finished && !this.finished) {
      this.finished = true;
      this.updateFinishedState();
    }
  }

  // Data Management
  updatePersons(newPersons) {
    newPersons.forEach(newPerson => {
      const existingIndex = this.persons.findIndex(p => 
        p.messageId === newPerson.messageId || 
        (p.name === newPerson.name && p.number === newPerson.number)
      );
  
      if (existingIndex >= 0) {
        const existingPerson = this.persons[existingIndex];
        this.persons[existingIndex] = {
          ...existingPerson,
          ...newPerson,
          status: Math.max(existingPerson.status || 0, newPerson.status || 0),
          lastUpdated: Date.now()
        };
      } else {
        this.persons.push({
          ...newPerson,
          addedAt: Date.now(),
          lastUpdated: Date.now()
        });
      }
    });
  }

  updateMessageStatus(messageId, status) {
    const existingUpdate = this.statusUpdateQueue.get(messageId);
    if (existingUpdate && existingUpdate.status >= status) {
      return;
    }
  
    this.statusUpdateQueue.set(messageId, { 
      messageId, 
      status, 
      timestamp: Date.now() 
    });
  
    const personIndex = this.persons.findIndex(p => p.messageId === messageId);
  
    if (personIndex >= 0) {
      const currentStatus = this.persons[personIndex].status || 0;
      
      // FIXED: Prevent error status (-1) from being overwritten by pending (0)
      // Only update if the new status is better than current, unless current is error
      if (currentStatus === -1 && status === 0) {
        console.log(`Ignoring pending status for message ${messageId} that already has error status`);
        return;
      }
      
      if (status > currentStatus || (currentStatus !== -1 && status >= 0)) {
        this.persons[personIndex].status = status;
        this.persons[personIndex].lastUpdated = Date.now();
      }
    } else {
      console.warn(`Received status update for unknown message ID: ${messageId}`);
    }
  }

  getStatusText(status) {
    switch (status) {
      case -1: return '<span class="status-error">&#10060; Error</span>';
      case 0: return '<span class="status-pending">&#8987; Pending</span>';
      case 1: return '<span class="status-sent">&#10004; Sent</span>';
      case 2: return '<span class="status-delivered">&#10004;&#10004; Delivered</span>';
      case 3: return '<span class="status-read">&#10004;&#10004; Read</span>';
      case 4: return '<span class="status-read">&#10004;&#10004; Played</span>';
      default: return '<span class="status-sent">&#10004; Sent</span>';
    }
  }

  countStatusTypes() {
    let sent = 0, delivered = 0, read = 0, error = 0, pending = 0;

    this.persons.forEach(person => {
      const status = person.status || (person.success === '&#10004;' ? 1 : -1);
      if (status === -1) error++;
      else if (status === 0) pending++;
      else if (status === 1) sent++;
      else if (status === 2) delivered++;
      else if (status >= 3) read++;
    });

    return { sent, delivered, read, error, pending };
  }

  getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) {
      return 'Just now';
    } else if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    } else if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }
  }

  updateUI(data) {
    if (!data) return;
    
    this.updateState(data.htmltext);

    if (data.persons && data.persons.length > 0) {
      this.updatePersons(data.persons);
      this.createTable(this.persons);
    }

    if (data.finished) {
      this.finished = true;
      this.updateFinishedState();
    }
  }

  createTable(tableData) {
    if (!tableData || tableData.length === 0) return;
  
    const table = document.createElement('table');
    table.border = "1";
    table.id = 'p_table';
    table.className = 'message-status-table';
    
    const tableBody = document.createElement('tbody');
  
    // Create header
    const header = table.createTHead();
    const headerRow = header.insertRow(0);
    ['Name', 'Phone', 'Status', 'Last Updated'].forEach(text => {
      const cell = headerRow.insertCell();
      cell.textContent = text;
      cell.style.fontWeight = 'bold';
      cell.className = 'table-header';
    });
  
    // Sort table data by status and last updated
    const sortedData = [...tableData].sort((a, b) => {
      const statusA = a.status || (a.success === '&#10004;' ? 1 : 0);
      const statusB = b.status || (b.success === '&#10004;' ? 1 : 0);
      
      if (statusA !== statusB) {
        return statusB - statusA;
      }
      
      const timeA = a.lastUpdated || a.addedAt || 0;
      const timeB = b.lastUpdated || b.addedAt || 0;
      return timeB - timeA;
    });
  
    sortedData.forEach(rowData => {
      const row = document.createElement('tr');
      if (rowData.messageId) {
        row.dataset.messageId = rowData.messageId;
      }
  
      let status = 0;
      if (rowData.status !== undefined) {
        status = rowData.status;
      } else if (rowData.success === '&#10004;') {
        status = 1;
      } else if (rowData.success === '&times;') {
        status = -1;
      }
  
      row.className = status >= 1 ? 'status-success' : 'status-error';
  
      // Name cell
      const nameCell = document.createElement('td');
      nameCell.textContent = rowData.name;
      nameCell.className = 'name-cell';
      row.appendChild(nameCell);
  
      // Phone cell
      const phoneCell = document.createElement('td');
      phoneCell.textContent = rowData.number;
      phoneCell.className = 'phone-cell';
      row.appendChild(phoneCell);
  
      // Status cell
      const statusCell = document.createElement('td');
      statusCell.className = 'status-cell';
      statusCell.innerHTML = this.getStatusText(status);
      row.appendChild(statusCell);
  
      // Last updated cell
      const updatedCell = document.createElement('td');
      const lastUpdated = rowData.lastUpdated || rowData.addedAt;
      if (lastUpdated) {
        const timeAgo = this.getTimeAgo(lastUpdated);
        updatedCell.textContent = timeAgo;
        updatedCell.className = 'time-cell';
      } else {
        updatedCell.textContent = '-';
      }
      row.appendChild(updatedCell);
  
      tableBody.appendChild(row);
    });
  
    table.appendChild(tableBody);
  
    // Add status summary
    const statusCounts = this.countStatusTypes();
    const summary = document.createElement('div');
    summary.className = 'message-count';
    summary.innerHTML = `
      <div class="status-summary">
        <span class="summary-item">Total: <strong>${tableData.length}</strong></span>
        <span class="summary-item status-error">Failed: <strong>${statusCounts.error}</strong></span>
        <span class="summary-item status-pending">Pending: <strong>${statusCounts.pending}</strong></span>
        <span class="summary-item status-sent">Sent: <strong>${statusCounts.sent}</strong></span>
        <span class="summary-item status-delivered">Delivered: <strong>${statusCounts.delivered}</strong></span>
        <span class="summary-item status-read">Read: <strong>${statusCounts.read}</strong></span>
      </div>
    `;
  
    this.tableContainer.innerHTML = '';
    this.tableContainer.appendChild(summary);
    this.tableContainer.appendChild(table);
  }

  // Send Operations
  async sendWa() {
    try {
      const statusResponse = await fetch(`${window.location.origin}/api/wa/status`);
      const statusData = await statusResponse.json();

      if (!statusData.clientReady) {
        alert("WhatsApp client is not ready. Please wait for initialization to complete or restart the client.");
        this.startButton.disabled = false;
        return;
      }

      console.log("Client is ready, sending messages for date:", this.dateparam);
      const response = await fetch(`${window.location.origin}/api/wa/send?date=${this.dateparam}`, {
        redirect: 'follow'
      });

      const data = await response.json();
      console.log("sendWa response:", data);
      this.updateState(data.htmltext || 'Starting to send messages...');
      // Updates will come via WebSocket real-time
    } catch (error) {
      console.error('Error sending WA:', error);
      this.updateState('Error starting process. Please try restarting the client.');
      this.startButton.disabled = false;
      // Error handling will be managed via WebSocket or manual retry
    }
  }

  updateFinishedState() {
    if (this.stateElement) {
      const statusCounts = this.countStatusTypes();
      this.stateElement.innerHTML = `
        <div class="completion-status">
          <h3>✅ Messages sent successfully!</h3>
          <p>Status updates will continue to be received via WebSocket.</p>
          <div class="final-stats">
            <span class="stat-item status-sent">Sent: ${statusCounts.sent}</span>
            <span class="stat-item status-delivered">Delivered: ${statusCounts.delivered}</span>
            <span class="stat-item status-read">Read: ${statusCounts.read}</span>
            <span class="stat-item status-error">Failed: ${statusCounts.error}</span>
          </div>
          <p class="note">Message statuses are being stored in the database and will be accessible for 24 hours.</p>
        </div>
      `;
    }

    console.log("Message sending completed - WebSocket remains active for status updates");

    if (this.startButton) {
      this.startButton.disabled = true;
      this.startButton.textContent = 'Completed';
    }
  }

  // Cleanup Management
  setupCleanupHandlers() {
    const beforeUnloadHandler = (event) => {
      if (!this.finished && this.sendingStarted) {
        const message = 'Leaving this page will interrupt the WhatsApp sending process.';
        event.returnValue = message;
        return message;
      }
      this.cleanup();
    };
    
    window.addEventListener('beforeunload', beforeUnloadHandler);
    this.activeEventListeners.set('beforeunload', beforeUnloadHandler);
  }

  cleanup() {
    console.log('Starting comprehensive WhatsAppMessenger cleanup');
    
    this.finished = true;
    
    this.clearAllTimers();
    
    // Clean up websocket service event handlers
    this.cleanupWebSocketHandlers();
    
    // Disconnect websocket service
    websocketService.disconnect();
    
    this.persons = [];
    this.statusUpdateQueue.clear();
    this.processedMessageIds.clear();
    
    this.cleanupEventListeners();
    
    console.log('WhatsAppMessenger cleanup completed - WebSocket service approach');
  }

  cleanupEventListeners() {
    if (this.activeEventListeners.has('beforeunload')) {
      window.removeEventListener('beforeunload', this.activeEventListeners.get('beforeunload'));
      this.activeEventListeners.delete('beforeunload');
    }
    
    this.activeEventListeners.clear();
  }
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
  window.messenger = new WhatsAppMessenger();
});