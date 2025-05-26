// services/messaging/whatsapp.js - Comprehensive Fix
import EventEmitter from 'events';
import messageState from '../state/messageState.js';
import stateEvents from '../state/stateEvents.js';
import transactionManager from '../database/TransactionManager.js';
import * as database from '../database/queries/index.js';
import { getWhatsAppMessages } from '../database/queries/messaging-queries.js';
import * as messagingQueries from '../database/queries/messaging-queries.js';
import { createWebSocketMessage, MessageSchemas } from './schemas.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

// Enhanced state management with proper locking
class ClientStateManager {
  constructor() {
    this.state = 'DISCONNECTED'; // DISCONNECTED, INITIALIZING, CONNECTED, ERROR, DESTROYED
    this.client = null;
    this.initializationPromise = null;
    this.initializationAbortController = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.destroyInProgress = false;
    this.initializationTimeout = null;
    
    // Initialization lock to prevent concurrent attempts
    this.initializationLock = false;
    this.lockWaiters = [];
    
    // Constants
    this.MAX_RECONNECT_ATTEMPTS = 10;
    this.RECONNECT_BASE_DELAY = 5000;
    this.INITIALIZATION_TIMEOUT = 300000; // 5 minutes (longer for QR scanning)
    this.MAX_LOCK_WAIT_TIME = 30000; // 30 seconds
  }

  async acquireInitializationLock(timeoutMs = this.MAX_LOCK_WAIT_TIME) {
    // If lock is available, acquire it immediately
    if (!this.initializationLock) {
      this.initializationLock = Date.now(); // Store timestamp instead of boolean
      return true;
    }

    // Check if current lock has timed out (safety mechanism)
    const lockAge = Date.now() - this.initializationLock;
    if (lockAge > this.INITIALIZATION_TIMEOUT) {
      console.warn(`Force releasing stale initialization lock (age: ${lockAge}ms)`);
      this.forceReleaseLock();
      this.initializationLock = Date.now();
      return true;
    }

    // Wait for lock to be released
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove this waiter from the queue
        const waiterIndex = this.lockWaiters.findIndex(w => w.resolve === resolve);
        if (waiterIndex > -1) {
          this.lockWaiters.splice(waiterIndex, 1);
        }
        reject(new Error(`Initialization lock timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const waitEntry = {
        resolve: () => {
          clearTimeout(timeout);
          this.initializationLock = Date.now();
          resolve(true);
        },
        reject: () => {
          clearTimeout(timeout);
          reject(new Error('Lock acquisition cancelled'));
        },
        timeout,
        timestamp: Date.now()
      };

      this.lockWaiters.push(waitEntry);
    });
  }

  releaseInitializationLock() {
    if (!this.initializationLock) {
      return; // Already released
    }

    this.initializationLock = false;
    
    // Notify next waiter with proper error handling
    if (this.lockWaiters.length > 0) {
      const nextWaiter = this.lockWaiters.shift();
      try {
        process.nextTick(() => {
          if (nextWaiter && typeof nextWaiter.resolve === 'function') {
            nextWaiter.resolve();
          }
        });
      } catch (error) {
        console.error('Error notifying next lock waiter:', error);
      }
    }
  }

  forceReleaseLock() {
    this.initializationLock = false;
    
    // Reject all waiters with timeout
    while (this.lockWaiters.length > 0) {
      const waiter = this.lockWaiters.shift();
      try {
        if (waiter && typeof waiter.reject === 'function') {
          waiter.reject();
        }
      } catch (error) {
        console.error('Error rejecting lock waiter:', error);
      }
    }
  }

  setState(newState, error = null) {
    const oldState = this.state;
    this.state = newState;
    this.lastError = error;
    
    console.log(`WhatsApp client state: ${oldState} -> ${newState}${error ? ` (${error.message})` : ''}`);
    
    // Emit state change event
    stateEvents.emit('whatsapp_state_changed', {
      from: oldState,
      to: newState,
      error
    });
  }

  isState(state) {
    return this.state === state;
  }

  getStatus() {
    return {
      state: this.state,
      connected: this.isState('CONNECTED'),
      initializing: this.isState('INITIALIZING'),
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError?.message,
      hasActivePromise: !!this.initializationPromise
    };
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  clearInitializationTimeout() {
    if (this.initializationTimeout) {
      clearTimeout(this.initializationTimeout);
      this.initializationTimeout = null;
    }
  }

  cleanup() {
    console.log('Cleaning up ClientStateManager');
    
    // Clear all timers
    this.clearReconnectTimer();
    this.clearInitializationTimeout();
    
    // Abort any ongoing initialization
    if (this.initializationAbortController) {
      try {
        this.initializationAbortController.abort();
      } catch (error) {
        console.error('Error aborting initialization:', error);
      }
      this.initializationAbortController = null;
    }
    
    // Clear initialization promise
    if (this.initializationPromise) {
      this.initializationPromise = null;
    }
    
    // Force release lock and clear all waiters
    this.forceReleaseLock();
    
    // Reset state
    this.state = 'DISCONNECTED';
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.destroyInProgress = false;
    
    console.log('ClientStateManager cleanup completed');
  }
}

// Enhanced Circuit Breaker with better state management
class EnhancedCircuitBreaker {
  constructor(threshold = 5, timeout = 60000, halfOpenMaxCalls = 3) {
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.halfOpenMaxCalls = halfOpenMaxCalls;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
  }

  async execute(operation, operationName = 'operation') {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.transitionToHalfOpen();
      } else {
        const timeUntilRetry = this.timeout - (Date.now() - this.lastFailureTime);
        throw new Error(`Circuit breaker is OPEN. Retry in ${Math.ceil(timeUntilRetry / 1000)} seconds`);
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new Error('Circuit breaker is HALF_OPEN with max calls reached');
    }

    try {
      if (this.state === 'HALF_OPEN') {
        this.halfOpenCalls++;
      }

      const result = await operation();
      this.onSuccess(operationName);
      return result;
    } catch (error) {
      this.onFailure(operationName, error);
      throw error;
    }
  }

  onSuccess(operationName) {
    if (this.state === 'HALF_OPEN') {
      console.log(`Circuit breaker healing: successful ${operationName}`);
      this.transitionToClosed();
    } else if (this.state === 'CLOSED') {
      this.failureCount = Math.max(0, this.failureCount - 1); // Gradually reduce failure count
    }
  }

  onFailure(operationName, error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    console.error(`Circuit breaker failure ${this.failureCount}/${this.failureThreshold} for ${operationName}:`, error.message);
    
    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.transitionToOpen();
    }
  }

  transitionToClosed() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    console.log('Circuit breaker transitioned to CLOSED');
  }

  transitionToOpen() {
    this.state = 'OPEN';
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    console.log(`Circuit breaker OPENED after ${this.failureCount} failures`);
  }

  transitionToHalfOpen() {
    this.state = 'HALF_OPEN';
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    console.log('Circuit breaker transitioned to HALF_OPEN');
  }

  reset() {
    this.transitionToClosed();
    console.log('Circuit breaker manually reset');
  }

  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      isOpen: this.state === 'OPEN',
      timeInCurrentState: Date.now() - this.lastStateChange,
      halfOpenCalls: this.halfOpenCalls
    };
  }
}

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.clientState = new ClientStateManager();
    this.circuitBreaker = new EnhancedCircuitBreaker();
    this.wsEmitter = null;
    this.messageState = messageState;
    
    // Map WhatsApp message IDs to appointment IDs
    this.messageIdToAppointmentId = new Map();
    
    this.setupCleanupHandlers();
    this.setupEventListeners();
  }

  setupCleanupHandlers() {
    // Handle process termination
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
    
    // Handle cleanup events
    stateEvents.on('qr_cleanup_required', () => {
      this.scheduleClientCleanup();
    });

    stateEvents.on('qr_viewer_connected', () => {
      this.handleViewerConnected();
    });
  }

  setupEventListeners() {
    // Listen for state events to trigger initialization
    stateEvents.on('whatsapp_initialization_requested', () => {
      this.initializeOnDemand();
    });
  }

  setEmitter(emitter) {
    this.wsEmitter = emitter;
    console.log("WebSocket emitter set for WhatsApp service");
  }

  isReady() {
    return this.clientState.isState('CONNECTED') && this.messageState.clientReady;
  }

  getStatus() {
    const clientStatus = this.clientState.getStatus();
    const circuitStatus = this.circuitBreaker.getStatus();
    
    return {
      active: this.isReady(),
      initializing: clientStatus.initializing,
      state: clientStatus.state,
      reconnectAttempts: clientStatus.reconnectAttempts,
      circuitBreakerOpen: circuitStatus.isOpen,
      circuitBreakerState: circuitStatus.state,
      qrCode: this.messageState.qr,
      lastError: clientStatus.lastError,
      hasClient: !!this.clientState.client
    };
  }

  async handleViewerConnected() {
    console.log("QR viewer connected - checking if initialization needed");
    
    // Only auto-initialize if we have actual QR viewers (not just status checkers)
    // and the client is in a clean DISCONNECTED state (not ERROR or INITIALIZING)
    if (this.clientState.isState('DISCONNECTED') && 
        this.messageState.activeQRViewers > 0 && 
        !this.clientState.isState('ERROR') &&
        !this.clientState.isState('INITIALIZING')) {
      
      console.log("Auto-initializing WhatsApp client for QR viewer");
      try {
        await this.initialize();
      } catch (error) {
        console.error("Failed to auto-initialize for QR viewer:", error);
        // Don't retry immediately on failure to avoid loops
      }
    } else {
      console.log(`Skipping auto-initialization - State: ${this.clientState.currentState}, QR Viewers: ${this.messageState.activeQRViewers}`);
    }
  }

  // Main initialization method with comprehensive error handling
  async initialize(forceRestart = false) {
    // Check if we should skip initialization
    if (!forceRestart && this.clientState.isState('CONNECTED')) {
      console.log("WhatsApp client already connected");
      return true;
    }

    if (!forceRestart && this.clientState.isState('INITIALIZING')) {
      console.log("WhatsApp client already initializing, waiting for completion");
      return this.clientState.initializationPromise;
    }

    // Check circuit breaker
    if (this.circuitBreaker.getStatus().isOpen && !forceRestart) {
      throw new Error('Circuit breaker is open, cannot initialize WhatsApp client');
    }

    try {
      // Acquire initialization lock
      console.log("Acquiring initialization lock...");
      await this.clientState.acquireInitializationLock();
      
      // Double-check state after acquiring lock
      if (!forceRestart && (this.clientState.isState('CONNECTED') || this.clientState.isState('INITIALIZING'))) {
        this.clientState.releaseInitializationLock();
        return this.clientState.initializationPromise || true;
      }

      // Start initialization
      this.clientState.initializationPromise = this.performInitialization(forceRestart);
      
      const result = await this.clientState.initializationPromise;
      return result;

    } catch (error) {
      console.error(`WhatsApp initialization failed: ${error.message}`);
      throw error;
    } finally {
      // Always release lock and clean up
      this.clientState.initializationPromise = null;
      this.clientState.releaseInitializationLock();
    }
  }

  async performInitialization(forceRestart = false) {
    console.log(`Starting WhatsApp client initialization (forceRestart: ${forceRestart})`);
    
    try {
      // Clean up existing client if restarting
      if (forceRestart && this.clientState.client) {
        await this.destroyClient('restart');
      }

      // Set initializing state
      this.clientState.setState('INITIALIZING');
      
      // Create abort controller for timeout handling
      this.clientState.initializationAbortController = new AbortController();
      
      // Set initialization timeout
      this.clientState.initializationTimeout = setTimeout(() => {
        if (this.clientState.initializationAbortController) {
          this.clientState.initializationAbortController.abort();
        }
      }, this.clientState.INITIALIZATION_TIMEOUT);

      // Create new client within circuit breaker
      const success = await this.circuitBreaker.execute(async () => {
        return this.createAndInitializeClient();
      }, 'whatsapp-initialization');

      if (success === true) {
        this.clientState.setState('CONNECTED');
        // Don't call setClientReady here - the ready event handler will do it
        this.clientState.reconnectAttempts = 0;
        console.log("WhatsApp client initialized successfully");
        return true;
      } else if (success === false) {
        // QR timeout - keep client in QR mode, don't treat as error
        console.log("WhatsApp client in QR mode - waiting for scan");
        this.clientState.setState('INITIALIZING'); // Keep in initializing state
        // Don't broadcast here either - QR event handler will do it
        return false;
      } else {
        throw new Error('Client initialization returned unexpected value');
      }

    } catch (error) {
      this.clientState.setState('ERROR', error);
      await this.messageState.setClientReady(false);
      
      // Schedule reconnect if not manually disconnected
      if (!this.messageState.manualDisconnect && !this.clientState.destroyInProgress) {
        this.scheduleReconnect(error);
      }
      
      throw error;
    } finally {
      this.clientState.clearInitializationTimeout();
      if (this.clientState.initializationAbortController) {
        this.clientState.initializationAbortController = null;
      }
    }
  }

  async createAndInitializeClient() {
    console.log("Creating WhatsApp client instance");
    
    // Check if aborted
    if (this.clientState.initializationAbortController?.signal.aborted) {
      throw new Error('Initialization aborted due to timeout');
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: "client" }),
      puppeteer: {
        headless: true,
        //headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      }
    });

    // Store client reference
    this.clientState.client = client;

    // Set up event handlers before initialization
    await this.setupClientEventHandlers(client);

    // Create initialization promise
    const initPromise = new Promise((resolve, reject) => {
      let resolved = false;
      
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Client initialization timeout'));
        }
      }, this.clientState.INITIALIZATION_TIMEOUT - 10000); // Leave 10s buffer

      const onReady = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.removeListener('qr', onQR);
          client.removeListener('auth_failure', onAuthFailure);
          client.removeListener('disconnected', onDisconnected);
          resolve(true);
        }
      };

      const onQR = (qr) => {
        // QR received is normal, extend timeout for user to scan
        console.log('QR code received during initialization - extending timeout');
        clearTimeout(timeout);
        // Give user more time to scan QR code
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log('QR scan timeout - but keeping client alive for manual retry');
            client.removeListener('ready', onReady);
            client.removeListener('auth_failure', onAuthFailure);
            client.removeListener('disconnected', onDisconnected);
            // Don't reject here - let the client stay in QR mode
            resolve(false); // Return false to indicate not ready but not failed
          }
        }, this.clientState.INITIALIZATION_TIMEOUT);
      };

      const onAuthFailure = (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.removeListener('ready', onReady);
          client.removeListener('qr', onQR);
          client.removeListener('disconnected', onDisconnected);
          reject(new Error(`Authentication failed: ${error}`));
        }
      };

      const onDisconnected = (reason) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          client.removeListener('ready', onReady);
          client.removeListener('qr', onQR);
          client.removeListener('auth_failure', onAuthFailure);
          reject(new Error(`Client disconnected during init: ${reason}`));
        }
      };

      // Set up one-time listeners
      client.once('ready', onReady);
      client.on('qr', onQR);
      client.once('auth_failure', onAuthFailure);
      client.once('disconnected', onDisconnected);

      // Check for abort signal
      if (this.clientState.initializationAbortController?.signal.aborted) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error('Initialization aborted'));
        return;
      }

      // Start initialization
      client.initialize().catch(error => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(error);
        }
      });
    });

    return initPromise;
  }

  async setupClientEventHandlers(client) {
    console.log("Setting up WhatsApp client event handlers");

    client.on('qr', async (qr) => {
      console.log('QR code received');
      
      // Client is definitely not ready when QR is received
      if (this.messageState.clientReady) {
        await this.messageState.setClientReady(false);
      }
      
      await this.messageState.setQR(qr);
      this.emit('qr', qr);
      
      if (this.wsEmitter) {
        const message = createWebSocketMessage(
          MessageSchemas.WebSocketMessage.QR_UPDATE,
          { qr, clientReady: false }
        );
        this.broadcastToClients(message);
      }
    });

    client.on('ready', async () => {
      console.log('WhatsApp client is ready - broadcasting to frontend');
      await this.messageState.setClientReady(true);
      await this.messageState.setQR(null);

      this.emit('ClientIsReady');
      if (this.wsEmitter) {
        const message = createWebSocketMessage(
          MessageSchemas.WebSocketMessage.CLIENT_READY,
          { 
            clientReady: true,
            state: 'ready',
            message: 'WhatsApp client is ready!'
          }
        );
        this.broadcastToClients(message);
        console.log('Broadcasted client ready state to frontend');
      }
    });

    client.on('message_ack', async (msg, ack) => {
      const messageId = msg.id.id;
      const appointmentId = this.messageIdToAppointmentId.get(messageId);
      
      console.log(`Message ${messageId} status updated to ${ack}, appointmentId: ${appointmentId}`);

      if (!appointmentId) {
        console.warn(`No appointment ID found for message ${messageId}, skipping database update`);
        return;
      }

      try {
        await this.messageState.updateMessageStatus(messageId, ack, async () => {
          // Use the original function with appointment ID and WhatsApp message ID
          return await messagingQueries.updateWhatsAppDeliveryStatus([{
            id: appointmentId, // Use appointment ID for database lookup
            ack: ack,
            whatsappMessageId: messageId // Store WhatsApp message ID for reference
          }]);
        });

        if (this.wsEmitter) {
          const message = createWebSocketMessage(
            MessageSchemas.WebSocketMessage.MESSAGE_STATUS,
            { messageId, status: ack }
          );
          this.broadcastToClients(message);
        }

      } catch (error) {
        console.error(`Error updating message status: ${error.message}`);
      }
    });

    client.on('disconnected', async (reason) => {
      console.log(`WhatsApp client disconnected: ${reason}`);
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      
      // Don't set client to null immediately, let cleanup handle it
      stateEvents.emit('client_disconnected', reason);
      
      if (!this.messageState.manualDisconnect && !this.clientState.destroyInProgress) {
        this.scheduleReconnect(new Error(`Disconnected: ${reason}`));
      }
    });

    client.on('auth_failure', async (error) => {
      console.error(`WhatsApp authentication failed: ${error}`);
      this.clientState.setState('ERROR', error);
      await this.messageState.setClientReady(false);
      
      if (!this.messageState.manualDisconnect && !this.clientState.destroyInProgress) {
        this.scheduleReconnect(error);
      }
    });

    // Handle loading screen
    client.on('loading_screen', (percent, message) => {
      console.log(`WhatsApp loading: ${percent}% - ${message}`);
    });
  }

  scheduleReconnect(error) {
    this.clientState.reconnectAttempts++;
    
    if (this.clientState.reconnectAttempts > this.clientState.MAX_RECONNECT_ATTEMPTS) {
      console.log(`Exceeded maximum reconnection attempts (${this.clientState.MAX_RECONNECT_ATTEMPTS})`);
      this.circuitBreaker.onFailure('max-reconnect-attempts', error);
      return;
    }

    const delay = Math.min(
      this.clientState.RECONNECT_BASE_DELAY * Math.pow(1.5, this.clientState.reconnectAttempts - 1),
      60000
    ) * (0.75 + Math.random() * 0.5);

    console.log(`Scheduling reconnection attempt ${this.clientState.reconnectAttempts} in ${Math.round(delay)}ms`);

    this.clientState.clearReconnectTimer();
    this.clientState.reconnectTimer = setTimeout(async () => {
      console.log(`Attempting to reconnect (attempt ${this.clientState.reconnectAttempts})`);
      try {
        await this.initialize();
      } catch (err) {
        console.error('Error during reconnection attempt:', err);
      }
    }, delay);
  }

  async restart() {
    console.log("Restarting WhatsApp client - preserving authentication");
    
    this.messageState.manualDisconnect = true;
    
    try {
      // Broadcast restarting state to frontend clients
      if (this.wsEmitter) {
        try {
          const restartingMessage = createWebSocketMessage(
            MessageSchemas.WebSocketMessage.CLIENT_READY,
            {
              clientReady: false,
              state: 'restarting',
              message: 'Restarting WhatsApp client...'
            }
          );
          this.wsEmitter.emit('broadcast_message', restartingMessage);
          console.log('Broadcasted restarting state to clients');
        } catch (error) {
          console.error('Error broadcasting restarting state:', error);
        }
      }
      
      // First destroy the current client (preserves authentication)
      if (this.clientState.client) {
        try {
          await this.clientState.client.destroy();
          console.log("Client destroyed for restart - authentication preserved");
        } catch (error) {
          console.error("Error destroying client during restart:", error.message);
        }
        this.clientState.client = null;
      }

      // Clear timers and reset state
      this.clientState.cleanup();
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      await this.messageState.setQR(null);
      
      // State will be updated by the client's event handlers during initialization
      
      // Reset circuit breaker
      this.circuitBreaker.reset();
      
      // Broadcast that we're about to start initialization
      if (this.wsEmitter) {
        try {
          const initializingMessage = createWebSocketMessage(
            MessageSchemas.WebSocketMessage.CLIENT_READY,
            {
              clientReady: false,
              state: 'initializing',
              message: 'Initializing WhatsApp client...'
            }
          );
          this.wsEmitter.emit('broadcast_message', initializingMessage);
          console.log('Broadcasted initializing state to clients');
        } catch (error) {
          console.error('Error broadcasting initializing state:', error);
        }
      }
      
      // Initialize with existing authentication
      const result = await this.initialize();
      
      this.messageState.manualDisconnect = false;
      await this.messageState.reset();
      this.clientState.reconnectAttempts = 0;
      
      return result;
    } catch (error) {
      this.messageState.manualDisconnect = false;
      throw error;
    }
  }

  async destroyClient(reason = 'manual') {
    console.log(`Destroying WhatsApp client (reason: ${reason})`);
    
    this.clientState.destroyInProgress = true;
    
    try {
      if (this.clientState.client) {
        try {
          // Only logout if explicitly requested, not during restart
          if (reason !== 'restart') {
            await this.clientState.client.logout();
            console.log("WhatsApp client logged out successfully");
          } else {
            // For restart, just destroy without logout to preserve session
            await this.clientState.client.destroy();
            console.log("WhatsApp client destroyed for restart (session preserved)");
          }
        } catch (error) {
          console.error(`Error during ${reason !== 'restart' ? 'logout' : 'destroy'}: ${error.message}`);
          // Try to destroy anyway
          try {
            await this.clientState.client.destroy();
          } catch (destroyError) {
            console.error(`Error during destroy: ${destroyError.message}`);
          }
        }
        
        this.clientState.client = null;
      }
      
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      
    } catch (error) {
      console.error(`Error destroying client: ${error.message}`);
    } finally {
      this.clientState.destroyInProgress = false;
    }
  }

  scheduleClientCleanup() {
    // Automatic cleanup removed - preserve authenticated sessions permanently
    // Only manual destruction allowed to maintain authentication investment
    console.log("Automatic cleanup disabled - client will persist until manually destroyed");
  }

  broadcastToClients(message) {
    if (this.wsEmitter) {
      this.wsEmitter.emit('broadcast_message', message);
    }
  }

  // Send functionality with proper state management
  async send(date) {
    if (!this.isReady()) {
      throw new Error("WhatsApp client not ready to send messages");
    }

    return this.circuitBreaker.execute(async () => {
      console.log(`Sending WhatsApp messages for date: ${date}`);
      
      const [numbers, messages, ids, names] = await getWhatsAppMessages(date);
      
      if (!numbers || numbers.length === 0) {
        console.log(`No messages to send for date ${date}`);
        await this.messageState.setFinishedSending(true);
        this.emit('finishedSending');
        return;
      }

      console.log(`Sending ${numbers.length} messages`);
      
      const results = [];
      for (let i = 0; i < numbers.length; i++) {
        // Check if client is still ready before each message
        if (!this.isReady()) {
          throw new Error('Client disconnected during sending');
        }
        
        try {
          const result = await this.sendSingleMessage(numbers[i], messages[i], names[i], ids[i]);
          results.push(result);
          
          if (i < numbers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.error(`Error sending message to ${numbers[i]}: ${error.message}`);
          results.push({ success: false, error: error.message });
        }
      }

      await this.messageState.setFinishedSending(true);
      this.emit('finishedSending');
      
      return results;
    }, 'send-messages');
  }

  async sendSingleMessage(number, message, name, appointmentId) {
    const chatId = `${number}@c.us`;
    
    try {
      const sentMessage = await this.clientState.client.sendMessage(chatId, message);
      
      console.log(`Message sent to ${number}`);
      
      // Store mapping between WhatsApp message ID and appointment ID
      this.messageIdToAppointmentId.set(sentMessage.id.id, appointmentId);
      
      const person = {
        messageId: sentMessage.id.id,
        appointmentId: appointmentId,
        name,
        number,
        success: '&#10004;'
      };
      
      await this.messageState.addPerson(person);
      
      // Mark message as sent in database to prevent duplicates
      try {
        await messagingQueries.updateWhatsAppStatus([appointmentId], [sentMessage.id.id]);
        console.log(`Marked appointment ${appointmentId} as sent in database`);
      } catch (dbError) {
        console.error(`Failed to mark appointment ${appointmentId} as sent:`, dbError.message);
        // Continue anyway - don't fail the send because of database update issue
      }
      
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
      
      await this.messageState.addPerson(person);
      this.emit('MessageFailed', person);
      
      throw error;
    }
  }

  async report(date) {
    if (!this.isReady()) {
      throw new Error("WhatsApp client not ready for report generation");
    }

    return this.circuitBreaker.execute(async () => {
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
              const chat = await this.clientState.client.getChatById(msg.number);
              const fetchedMessages = await chat.fetchMessages({ limit: 50 });
              
              // Find our message and get its status
              const ourMessage = fetchedMessages.find(m => m.id.id === msg.wamid);
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
        
        await this.messageState.setFinishReport(true);
        this.emit('finishedSending');
        
        console.log(`Report generated for ${messages.length} messages`);
        return { success: true, messagesChecked: messages.length };
        
      } catch (error) {
        console.error(`Error generating report: ${error.message}`);
        throw error;
      }
    }, 'generate-report');
  }

  async clear() {
    console.log("Clearing message state");
    await this.messageState.reset();
    return { success: true };
  }

  // Initialize on demand when QR viewers connect
  async initializeOnDemand() {
    console.log("initializeOnDemand called - checking conditions");
    
    // Don't initialize if already connected or initializing
    if (this.clientState.isState('CONNECTED') || this.clientState.isState('INITIALIZING')) {
      console.log("Client already connected or initializing");
      return this.clientState.initializationPromise || true;
    }
    
    // Only initialize if there are active QR viewers
    if (this.messageState.activeQRViewers === 0) {
      console.log("No QR viewers, skipping initialization");
      return false;
    }
    
    // Check if circuit breaker allows initialization
    if (this.circuitBreaker.getStatus().isOpen) {
      console.log("Circuit breaker is open, cannot auto-initialize");
      return false;
    }
    
    console.log("Auto-initializing WhatsApp client");
    try {
      return await this.initialize();
    } catch (error) {
      console.error("Failed to auto-initialize:", error);
      return false;
    }
  }

  // Queue operation to ensure proper client state management
  async queueOperation(operation, operationName = 'operation') {
    if (!this.isReady()) {
      throw new Error('WhatsApp client is not ready for operations');
    }

    // Check circuit breaker
    if (this.circuitBreaker.getStatus().isOpen) {
      throw new Error('Circuit breaker is open, operation cannot be executed');
    }

    return this.circuitBreaker.execute(async () => {
      try {
        console.log(`Executing queued operation: ${operationName}`);
        const result = await operation(this.clientState.client);
        console.log(`Queued operation completed successfully: ${operationName}`);
        return result;
      } catch (error) {
        console.error(`Queued operation failed: ${operationName}`, error);
        throw error;
      }
    }, operationName);
  }

  async gracefulShutdown(signal = 'manual') {
    console.log(`Graceful shutdown initiated (${signal})`);
    
    try {
      // Set manual disconnect flag to prevent reconnection attempts
      this.messageState.manualDisconnect = true;
      
      // Clear all timers and pending operations
      this.clientState.cleanup();
      
      // Destroy client if it exists
      await this.destroyClient('shutdown');
      
      // Clean up message state
      await this.messageState.cleanup();
      
      console.log("Graceful shutdown completed");
    } catch (error) {
      console.error("Error during graceful shutdown:", error);
    }
  }

  // Get comprehensive status including all subsystems
  getDetailedStatus() {
    const clientStatus = this.clientState.getStatus();
    const circuitStatus = this.circuitBreaker.getStatus();
    const messageStats = this.messageState.dump();
    
    return {
      service: {
        ready: this.isReady(),
        state: clientStatus.state,
        hasClient: !!this.clientState.client,
        activeViewers: this.messageState.activeQRViewers
      },
      client: clientStatus,
      circuitBreaker: circuitStatus,
      messageState: messageStats,
      timestamp: Date.now()
    };
  }

  // Force client destruction (emergency use only)
  async forceDestroy() {
    console.warn("Force destroying WhatsApp client");
    
    this.clientState.destroyInProgress = true;
    
    try {
      // Clear all timers
      this.clientState.cleanup();
      
      // Try to destroy client
      if (this.clientState.client) {
        try {
          await this.clientState.client.destroy();
        } catch (error) {
          console.error("Error during force destroy:", error);
        }
        this.clientState.client = null;
      }
      
      // Reset states
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      this.circuitBreaker.reset();
      
    } finally {
      this.clientState.destroyInProgress = false;
    }
  }

  // Simple destroy - close browser but preserve authentication
  async simpleDestroy() {
    console.log("Destroying WhatsApp client - closing browser but preserving authentication");
    
    this.clientState.destroyInProgress = true;
    this.messageState.manualDisconnect = true;
    
    try {
      if (this.clientState.client) {
        try {
          await this.clientState.client.destroy();
          console.log("WhatsApp client destroyed successfully - authentication preserved");
        } catch (error) {
          console.error("Error during destroy:", error.message);
        }
        this.clientState.client = null;
      }

      // Clear all timers and state
      this.clientState.cleanup();
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      await this.messageState.setQR(null);
      this.circuitBreaker.reset();

      return { success: true, message: "Client destroyed - browser closed, authentication preserved" };
      
    } catch (error) {
      console.error("Error during simple destruction:", error);
      return { success: false, error: "Destroy failed: " + error.message };
    } finally {
      this.clientState.destroyInProgress = false;
      this.messageState.manualDisconnect = false;
    }
  }

  // Complete logout with authentication cleanup
  async completeLogout() {
    console.log("Starting complete WhatsApp client logout with authentication cleanup");
    
    this.clientState.destroyInProgress = true;
    this.messageState.manualDisconnect = true;
    
    try {
      if (this.clientState.client) {
        try {
          await this.clientState.client.logout();
          console.log("WhatsApp client logged out successfully - authentication cleared by logout()");
        } catch (error) {
          console.error("Error during logout:", error.message);
          // Try to destroy anyway
          try {
            await this.clientState.client.destroy();
          } catch (destroyError) {
            console.error("Error during destroy:", destroyError.message);
          }
        }
        this.clientState.client = null;
      }

      // Clear all timers and state
      this.clientState.cleanup();
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      await this.messageState.setQR(null);
      this.circuitBreaker.reset();

      // Note: No need to manually delete folders - logout() method handles this
      return { success: true, message: "Client logged out - authentication completely cleared" };
      
    } catch (error) {
      console.error("Error during complete logout:", error);
      return { success: false, error: "Logout failed: " + error.message };
    } finally {
      this.clientState.destroyInProgress = false;
      this.messageState.manualDisconnect = false;
    }
  }

  // Health check method
  async healthCheck() {
    const status = this.getDetailedStatus();
    
    // Perform active health check if client exists
    if (this.clientState.client && this.clientState.isState('CONNECTED')) {
      try {
        // Try to get state from client
        const state = await this.clientState.client.getState();
        status.healthCheck = {
          clientResponsive: true,
          clientState: state,
          timestamp: Date.now()
        };
      } catch (error) {
        status.healthCheck = {
          clientResponsive: false,
          error: error.message,
          timestamp: Date.now()
        };
      }
    }
    
    return status;
  }
}

// Export singleton instance
export default new WhatsAppService();