// services/messaging/whatsapp.js
import EventEmitter from 'events';
import messageState from '../state/messageState.js';
import stateEvents from '../state/stateEvents.js';
import transactionManager from '../database/TransactionManager.js';
import * as database from '../database/queries/index.js';
import { createWebSocketMessage, MessageSchemas } from './schemas.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

// Client state management
let whatsappClient = null;
let isInitializing = false;
let reconnectAttempts = 0;
let wsEmitter = null;
let clientInitPromise = null; // Track initialization promise

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000;

/**
 * Circuit breaker for handling failures
 */
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  isOpen() {
    return this.state === 'OPEN';
  }
}

const circuitBreaker = new CircuitBreaker();

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.setupCleanupHandlers();
  }

  setupCleanupHandlers() {
    // Handle process termination
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
    
    // Handle cleanup events
    stateEvents.on('qr_cleanup_required', () => {
      this.cleanupClient();
    });

    stateEvents.on('qr_viewer_connected', () => {
      this.initializeOnDemand();
    });
  }

  setEmitter(emitter) {
    wsEmitter = emitter;
    console.log("WebSocket emitter set for WhatsApp service");
  }

  isReady() {
    return !!whatsappClient && messageState.clientReady;
  }

  getStatus() {
    return {
      active: this.isReady(),
      initializing: isInitializing,
      reconnectAttempts,
      circuitBreakerOpen: circuitBreaker.isOpen(),
      qrCode: messageState.qr
    };
  }

  /**
   * Initialize client only when needed
   */
  async initializeOnDemand() {
    if (whatsappClient || isInitializing) {
      return clientInitPromise || Promise.resolve(!!whatsappClient);
    }

    if (messageState.activeQRViewers === 0) {
      console.log("No QR viewers, skipping initialization");
      return false;
    }

    return this.initialize();
  }

  /**
   * Initialize with circuit breaker protection
   */
  async initialize() {
    if (clientInitPromise) {
      return clientInitPromise;
    }

    clientInitPromise = this.doInitialize();
    
    try {
      return await clientInitPromise;
    } finally {
      clientInitPromise = null;
    }
  }

  async doInitialize() {
    if (circuitBreaker.isOpen()) {
      throw new Error('Circuit breaker is open, cannot initialize WhatsApp client');
    }

    return circuitBreaker.execute(async () => {
      if (whatsappClient || isInitializing) {
        return !!whatsappClient;
      }

      try {
        isInitializing = true;
        console.log("Initializing WhatsApp client");

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

        await this.setupEventHandlers();
        await whatsappClient.initialize();

        console.log("WhatsApp client initialized successfully");
        await messageState.setClientReady(true);
        reconnectAttempts = 0;

        return true;

      } catch (error) {
        console.error(`WhatsApp client initialization failed: ${error.message}`);
        whatsappClient = null;
        await messageState.setClientReady(false);
        
        if (!messageState.manualDisconnect) {
          this.scheduleReconnect();
        }
        
        throw error;
      } finally {
        isInitializing = false;
      }
    });
  }

  async setupEventHandlers() {
    if (!whatsappClient) return;

    whatsappClient.on('qr', async (qr) => {
      console.log('QR code received');
      
      // Always store QR code
      await messageState.setQR(qr);
      
      // Only emit if there are active viewers
      if (messageState.activeQRViewers > 0) {
        this.emit('qr', qr);
        if (wsEmitter) {
          const message = createWebSocketMessage(
            MessageSchemas.WebSocketMessage.QR_UPDATE,
            { qr, clientReady: false }
          );
          this.broadcastToClients(message);
        }
        console.log('QR code emitted to active viewers');
      } else {
        console.log('QR code stored but not emitted (no active viewers)');
      }
    });

    whatsappClient.on('ready', async () => {
      console.log('WhatsApp client is ready');
      await messageState.setClientReady(true);
      await messageState.setQR(null); // Clear QR when ready

      // Emit ready event
      this.emit('ClientIsReady');
      if (wsEmitter) {
        const message = createWebSocketMessage(
          MessageSchemas.WebSocketMessage.CLIENT_READY,
          { clientReady: true }
        );
        this.broadcastToClients(message);
      }
    });

    whatsappClient.on('message_ack', async (msg, ack) => {
      const messageId = msg.id.id;
      console.log(`Message ${messageId} status updated to ${ack}`);

      try {
        // Use atomic update with database transaction
        await messageState.updateMessageStatus(messageId, ack, async () => {
          // Database operation within transaction
          await transactionManager.withTransaction([
            async (connection) => {
              return database.updateWhatsAppDeliveryStatus([{
                id: messageId,
                ack: ack
              }]);
            }
          ]);
        });

        // Broadcast status update
        if (wsEmitter) {
          const message = createWebSocketMessage(
            MessageSchemas.WebSocketMessage.MESSAGE_STATUS,
            { messageId, status: ack }
          );
          this.broadcastToClients(message);
        }

      } catch (error) {
        console.error(`Error updating message status: ${error.message}`);
        // Status update failed - the atomic operation will have rolled back
      }
    });

    whatsappClient.on('disconnected', async (reason) => {
      console.log(`WhatsApp client disconnected: ${reason}`);
      await messageState.setClientReady(false);
      whatsappClient = null;
      
      stateEvents.emit('client_disconnected', reason);
      
      if (!messageState.manualDisconnect) {
        this.scheduleReconnect();
      }
    });

    whatsappClient.on('auth_failure', async (error) => {
      console.error(`WhatsApp authentication failed: ${error.message}`);
      whatsappClient = null;
      await messageState.setClientReady(false);
      this.scheduleReconnect();
    });
  }

  broadcastToClients(message) {
    if (wsEmitter) {
      wsEmitter.emit('broadcast_message', message);
    }
  }

  scheduleReconnect() {
    reconnectAttempts++;
    
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.log(`Exceeded maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS})`);
      circuitBreaker.onFailure(); // Open circuit breaker
      return;
    }

    const delay = Math.min(
      RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1),
      60000
    ) * (0.75 + Math.random() * 0.5);

    console.log(`Scheduling reconnection attempt ${reconnectAttempts} in ${Math.round(delay)}ms`);

    setTimeout(() => {
      console.log(`Attempting to reconnect (attempt ${reconnectAttempts})`);
      this.initialize().catch(err => {
        console.error('Error during reconnection attempt:', err);
      });
    }, delay);
  }

  async restart() {
    console.log("Restarting WhatsApp client");
    
    // Set manual disconnect flag
    messageState.manualDisconnect = true;
    
    // Clean up existing client
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
    await messageState.reset();
    messageState.manualDisconnect = false;
    reconnectAttempts = 0;
    circuitBreaker.onSuccess(); // Reset circuit breaker

    // Initialize new client
    return this.initialize();
  }

  async send(date) {
    if (!this.isReady()) {
      throw new Error("WhatsApp client not ready to send messages");
    }

    if (circuitBreaker.isOpen()) {
      throw new Error("Circuit breaker is open, cannot send messages");
    }

    return circuitBreaker.execute(async () => {
      console.log(`Sending WhatsApp messages for date: ${date}`);
      
      const [numbers, messages, ids, names] = await database.getWhatsAppMessages(date);
      
      if (!numbers || numbers.length === 0) {
        console.log(`No messages to send for date ${date}`);
        await messageState.setFinishedSending(true);
        this.emit('finishedSending');
        return;
      }

      console.log(`Sending ${numbers.length} messages`);
      
      // Process messages with proper error handling
      const results = [];
      for (let i = 0; i < numbers.length; i++) {
        try {
          const result = await this.sendSingleMessage(numbers[i], messages[i], names[i]);
          results.push(result);
          
          // Small delay between messages
          if (i < numbers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`Error sending message to ${numbers[i]}: ${error.message}`);
          results.push({ success: false, error: error.message });
        }
      }

      await messageState.setFinishedSending(true);
      this.emit('finishedSending');
      
      return results;
    });
  }

  async sendSingleMessage(number, message, name) {
    const chatId = `${number}@c.us`;
    
    try {
      const sentMessage = await whatsappClient.sendMessage(chatId, message);
      
      console.log(`Message sent to ${number}`);
      
      // Add person to state
      const person = {
        messageId: sentMessage.id.id,
        name,
        number,
        success: '&#10004;'
      };
      
      await messageState.addPerson(person);
      
      // Emit success event
      this.emit('MessageSent', person);
      
      return { success: true, messageId: sentMessage.id.id };
      
    } catch (error) {
      // Add failed person to state
      const person = {
        name,
        number,
        success: '&times;',
        error: error.message
      };
      
      await messageState.addPerson(person);
      this.emit('MessageFailed', person);
      
      throw error;
    }
  }

  async report(date) {
    if (!this.isReady()) {
      throw new Error("WhatsApp client not ready for report generation");
    }

    try {
      console.log(`Generating WhatsApp report for date: ${date}`);
      
      // Get delivery status and update database
      const messages = await database.getWhatsAppDeliveryStatus(date);
      
      if (messages.length > 0) {
        // Check status for each message
        const statusUpdates = [];
        
        for (const msg of messages) {
          try {
            // Get message from WhatsApp
            const chat = await whatsappClient.getChatById(msg.number);
            const message = await chat.fetchMessages({ limit: 50 });
            
            // Find our message and get its status
            const ourMessage = message.find(m => m.id.id === msg.wamid);
            if (ourMessage) {
              statusUpdates.push({
                id: msg.id,
                ack: ourMessage.ack || 1
              });
            }
          } catch (error) {
            console.error(`Error checking message ${msg.wamid}:`, error);
          }
        }
        
        // Update database with new statuses
        if (statusUpdates.length > 0) {
          await database.updateWhatsAppDeliveryStatus(statusUpdates);
        }
      }
      
      this.emit('finish_report', date);
      
    } catch (error) {
      console.error(`Error generating report: ${error.message}`);
      throw error;
    }
  }

  async clear() {
    console.log("Clearing message state");
    await messageState.reset();
  }

  cleanupClient() {
    if (!messageState.clientReady && whatsappClient) {
      console.log("Stopping WhatsApp client as no viewers present");
      
      try {
        whatsappClient.destroy().catch(err => 
          console.error("Error destroying client:", err)
        );
        whatsappClient = null;
        isInitializing = false;
        
        console.log("WhatsApp client stopped successfully");
      } catch (error) {
        console.error("Error stopping WhatsApp client:", error);
      }
    }
  }

  async gracefulShutdown() {
    console.log("Graceful shutdown initiated");
    
    try {
      if (whatsappClient) {
        await whatsappClient.logout();
        whatsappClient = null;
      }
      
      await messageState.cleanup();
      
      console.log("Graceful shutdown completed");
    } catch (error) {
      console.error("Error during graceful shutdown:", error);
    }
  }
}

export default new WhatsAppService();