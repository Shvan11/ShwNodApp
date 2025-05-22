/**
 * WhatsApp Messaging Service
 * Implements a persistent WhatsApp client for sending messages and tracking delivery status
 */
import EventEmitter from 'events';
import messageState from '../state/messageState.js';
import stateEvents from '../state/stateEvents.js';
import * as database from '../database/queries/index.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

// Client state management at module scope
let whatsappClient = null;  // The actual client instance
let isInitializing = false; // Flag to prevent multiple initialization attempts
let lastActivity = Date.now(); // Track when the client was last active
let reconnectAttempts = 0;  // Track reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 10; // Maximum reconnection attempts before giving up
const RECONNECT_DELAY = 5000; // Base delay between reconnection attempts in ms
let wsEmitter = null; // Will be set via setEmitter method

// Main WhatsApp service class
class WhatsAppService extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Set the WebSocket emitter for event broadcasting
   * @param {EventEmitter} emitter - WebSocket event emitter
   */
  setEmitter(emitter) {
    wsEmitter = emitter;
    console.log("WebSocket emitter set for WhatsApp service");
  }

  /**
   * Check if the WhatsApp client is ready
   * @returns {boolean} - Whether client is ready
   */
  isReady() {
    return !!whatsappClient && messageState.clientReady;
  }

  /**
   * Get the status of the WhatsApp client
   * @returns {Object} - Status information
   */
  getStatus() {
    return {
      active: this.isReady(),
      initializing: isInitializing,
      lastActivity,
      reconnectAttempts,
      qrCode: messageState.qr
    };
  }

  /**
   * Initialize the WhatsApp client
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async initialize() {
    return initializeClient();
  }

  /**
   * Restart the WhatsApp client
   * @returns {Promise<boolean>} - Whether restart was successful
   */
  async restart() {
    return restartClient();
  }

  /**
   * Send WhatsApp messages for a specific date
   * @param {string} date - Date to send messages for
   */
  async send(date) {
    // Check if client is ready
    if (!this.isReady()) {
      console.error("WhatsApp client not ready to send messages");
      return;
    }
    
    try {
      console.log(`Sending WhatsApp messages for date: ${date}`);
      
      // Get messages to send
      const [numbers, messages, ids, names] = await database.getWhatsAppMessages(date);
      
      if (!numbers || numbers.length === 0) {
        console.log(`No messages to send for date ${date}`);
        messageState.finishedSending = true;
        this.emit('finishedSending');
        return;
      }
      
      console.log(`Sending ${numbers.length} messages`);
      
      // Process each message
      for (let i = 0; i < numbers.length; i++) {
        try {
          const number = numbers[i];
          const chatId = `${number}@c.us`;
          
          // Send the message using the persistent client
          const message = await whatsappClient.sendMessage(chatId, messages[i]);
          
          // Process sent message
          console.log(`Message sent to ${number}`);
          
          // Emit event with message details
          this.emit('MessageSent', {
            messageId: message.id.id,
            name: names[i],
            number
          });
          
          // Add small delay between messages to avoid rate limiting
          if (i < numbers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`Error sending message to ${numbers[i]}: ${error.message}`);
          
          // Emit failure event
          this.emit('MessageFailed', {
            name: names[i],
            number: numbers[i]
          });
        }
      }
      
      // Update finished state
      messageState.finishedSending = true;
      this.emit('finishedSending');
      
    } catch (error) {
      console.error(`Error in send process: ${error.message}`);
    }
  }

  /**
   * Generate report for a specific date
   * @param {string} date - Date to report on
   */
  async report(date) {
    // Check if client is ready
    if (!this.isReady()) {
      console.error("WhatsApp client not ready for report generation");
      return;
    }
    
    try {
      console.log(`Generating WhatsApp report for date: ${date}`);
      
      // Your existing report generation logic...
      // Use whatsappClient for any client operations
      
      // When finished:
      this.emit('finish_report', date);
    } catch (error) {
      console.error(`Error generating report: ${error.message}`);
    }
  }

  /**
   * Clear message state
   */
  async clear() {
    console.log("Clearing message state");
    messageState.reset();
  }
  
  /**
   * Clean up the client when no viewers have been present for some time
   */
  cleanupClient() {
    if (!messageState.clientReady && whatsappClient) {
      console.log("Stopping WhatsApp client as no viewers present for extended period");
      
      try {
        // Destroy the client to free resources
        whatsappClient.destroy().catch(err => console.error("Error destroying client:", err));
        whatsappClient = null;
        isInitializing = false;
        
        console.log("WhatsApp client stopped successfully");
      } catch (error) {
        console.error("Error stopping WhatsApp client:", error);
      }
    }
  }
}

/**
 * Initialize the WhatsApp client once and maintain the connection
 * @returns {Promise<boolean>} - Promise resolving to true if initialization successful
 */
async function initializeClient() {
  // Prevent multiple initialization attempts
  if (whatsappClient || isInitializing) {
    return !!whatsappClient;
  }
  
  try {
    isInitializing = true;
    console.log("Initializing persistent WhatsApp client");
    
    whatsappClient = new Client({
      authStrategy: new LocalAuth({ clientId: "client" }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    });
    
    // Set up event handlers before initialization
    setupEventHandlers();
    
    // Initialize the client
    await whatsappClient.initialize();
    
    console.log("WhatsApp client initialized successfully");
    messageState.clientReady = true;
    reconnectAttempts = 0; // Reset reconnect counter on successful connection
    lastActivity = Date.now();
    
    return true;
  } catch (error) {
    console.error(`WhatsApp client initialization failed: ${error.message}`);
    whatsappClient = null;
    messageState.clientReady = false;
    
    // Schedule reconnect if not manually disconnected
    if (!messageState.manualDisconnect) {
      scheduleReconnect();
    }
    
    return false;
  } finally {
    isInitializing = false;
  }
}

/**
 * Setup WhatsApp client event handlers
 */
function setupEventHandlers() {
  if (!whatsappClient) return;
  
  whatsappClient.on('qr', (qr) => {
    // Reset ready state if we receive a QR code
    if (messageState.clientReady) {
      console.log('Received QR code, resetting clientReady flag to false');
      messageState.clientReady = false;
    }
    
    // Only emit QR if there are active viewers
    if (messageState.activeQRViewers <= 0) {
      console.log('QR code received but no active viewers, suppressing emission');
      // Still store the QR code in case viewers connect soon
      messageState.qr = qr;
      messageState.updateActivity('qr-received-suppressed');
      return; // Don't emit if no active viewers
    }
    
    // Process and emit the QR code
    messageState.qr = qr;
    messageState.updateActivity('qr-received');
    whatsappService.emit('qr', qr);
    wsEmitter.emit('qr', qr);
    console.log('QR code received, emitting to clients');
  });
  
  whatsappClient.on('ready', () => {
    console.log('WhatsApp client is ready');
    messageState.clientReady = true;
    messageState.qr = null;
    lastActivity = Date.now();
    
    // Emit event for WebSocket clients
    if (wsEmitter) {
      wsEmitter.emit('ClientIsReady');
    }
  });
  
  whatsappClient.on('message_ack', async (msg, ack) => {
    const messageId = msg.id.id;
    console.log(`Message ${messageId} status updated to ${ack}`);
    
    // Update message state
    messageState.updateMessageStatus(messageId, ack);
    lastActivity = Date.now();
    
    // Update database directly
    try {
      await database.updateWhatsAppDeliveryStatus([{
        id: messageId, 
        ack: ack
      }]);
    } catch (error) {
      console.error(`Error updating message status in database: ${error.message}`);
    }
    
    // Emit event for WebSocket clients
    if (wsEmitter) {
      wsEmitter.emit('wa_message_update', messageId, ack);
    }
  });
  
  whatsappClient.on('disconnected', (reason) => {
    console.log(`WhatsApp client disconnected: ${reason}`);
    messageState.clientReady = false;
    whatsappClient = null;
    
    // Only attempt reconnection if not manually disconnected
    if (!messageState.manualDisconnect) {
      scheduleReconnect();
    }
  });
  
  whatsappClient.on('auth_failure', (error) => {
    console.error(`WhatsApp authentication failed: ${error.message}`);
    whatsappClient = null;
    messageState.clientReady = false;
    
    // Schedule reconnect to retry authentication
    scheduleReconnect();
  });
}

/**
 * Schedule reconnection attempt with exponential backoff
 */
function scheduleReconnect() {
  reconnectAttempts++;
  
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.log(`Exceeded maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS})`);
    messageState.clientReady = false;
    return;
  }
  
  // Calculate backoff delay with jitter
  const delay = Math.min(
    RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1), // Exponential backoff
    60000 // Max 1 minute delay
  ) * (0.75 + Math.random() * 0.5); // Add 25% jitter
  
  console.log(`Scheduling reconnection attempt ${reconnectAttempts} in ${Math.round(delay)}ms`);
  
  setTimeout(() => {
    console.log(`Attempting to reconnect (attempt ${reconnectAttempts})`);
    initializeClient().catch(err => {
      console.error('Error during reconnection attempt:', err);
    });
  }, delay);
}

/**
 * Restart the WhatsApp client
 * @returns {Promise<boolean>} - Promise resolving to true if restart successful
 */
async function restartClient() {
  console.log("Restarting WhatsApp client");
  
  // Set manual disconnect flag to prevent auto-reconnect
  messageState.manualDisconnect = true;
  
  // Disconnect existing client if any
  if (whatsappClient) {
    try {
      await whatsappClient.logout();
      console.log("Existing client disconnected");
    } catch (error) {
      console.error(`Error disconnecting client: ${error.message}`);
    }
    
    whatsappClient = null;
  }
  
  // Reset state
  messageState.reset();
  messageState.manualDisconnect = false;
  reconnectAttempts = 0;
  
  // Initialize new client
  return initializeClient();
}

// Create singleton instance
const whatsappService = new WhatsAppService();

// Subscribe to the cleanup event
stateEvents.on('qr_cleanup_required', () => {
  whatsappService.cleanupClient();
});
// Add this near the stateEvents listener at the bottom
stateEvents.on('qr_viewer_connected', () => {
  console.log("QR viewer connected, initializing WhatsApp client if needed");
  
  // Only initialize if not already initialized
  if (!whatsappClient && !isInitializing && !messageState.clientReady) {
    initializeClient().catch(err => {
      console.error("Error initializing client:", err);
    });
  }
});
export default whatsappService;