// services/messaging/whatsapp.js - Comprehensive Fix with MessageSession Architecture
import EventEmitter from 'events';
import messageState from '../state/messageState.js';
import stateEvents from '../state/stateEvents.js';
import * as database from '../database/index.js';
import { getWhatsAppMessages } from '../database/queries/messaging-queries.js';
import * as messagingQueries from '../database/queries/messaging-queries.js';
import { createWebSocketMessage, MessageSchemas } from './schemas.js';
import { messageSessionManager } from './MessageSessionManager.js';
import { logger } from '../core/Logger.js';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

// Enhanced state management with proper locking
class ClientStateManager {
  constructor() {
    this.state = 'DISCONNECTED'; // DISCONNECTED, INITIALIZING, CONNECTED, ERROR, DESTROYED
    this.client = null;
    this.browser = null;  // MEMORY LEAK FIX: Track browser for force close
    this.page = null;     // MEMORY LEAK FIX: Track page for cleanup
    this.initializationPromise = null;
    this.initializationAbortController = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.destroyInProgress = false;
    this.initializationTimeout = null;

    // Session stabilization flag - tracks if session data has been persisted to disk
    // Based on whatsapp-web.js RemoteAuth best practice (60s delay for session stability)
    this.sessionStabilized = false;

    // Initialization lock to prevent concurrent attempts
    this.initializationLock = false;
    this.lockWaiters = [];

    // Constants
    this.MAX_RECONNECT_ATTEMPTS = 10;
    this.RECONNECT_BASE_DELAY = 5000;
    this.SESSION_RESTORATION_TIMEOUT = 120000; // 120 seconds (2 minutes) for valid session restoration
    this.FRESH_AUTH_TIMEOUT = 90000; // 90 seconds for fresh QR authentication
    this.INITIALIZATION_TIMEOUT = 60000; // 60 seconds - fallback/default
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
      logger.whatsapp.warn(`Force releasing stale lock`, { lockAge });
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
        logger.whatsapp.error('Error notifying next lock waiter', error);
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
        logger.whatsapp.error('Error rejecting lock waiter', error);
      }
    }
  }

  setState(newState, error = null) {
    const oldState = this.state;

    // Only proceed if state actually changes
    if (oldState === newState && !error) {
      return; // No change, no event emission, no resource waste
    }

    this.state = newState;
    this.lastError = error;

    if (oldState !== newState) {
      logger.whatsapp.info(`State: ${oldState} → ${newState}`, error ? { error: error.message } : undefined);
    }

    // Only emit state change event when state actually changes or there's an error
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
    logger.whatsapp.debug('Cleaning up ClientStateManager');

    // Clear all timers
    this.clearReconnectTimer();
    this.clearInitializationTimeout();

    // Abort any ongoing initialization
    if (this.initializationAbortController) {
      try {
        this.initializationAbortController.abort();
      } catch (error) {
        logger.whatsapp.error('Error aborting initialization', error);
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

    logger.whatsapp.debug('ClientStateManager cleanup completed');
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
      logger.whatsapp.debug(`Circuit breaker healing: ${operationName}`);
      this.transitionToClosed();
    } else if (this.state === 'CLOSED') {
      this.failureCount = Math.max(0, this.failureCount - 1); // Gradually reduce failure count
    }
  }

  onFailure(operationName, error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    logger.whatsapp.warn(`Circuit breaker failure ${this.failureCount}/${this.failureThreshold} for ${operationName}`, { error: error.message });

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.transitionToOpen();
    }
  }

  transitionToClosed() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    logger.whatsapp.info('Circuit breaker → CLOSED');
  }

  transitionToOpen() {
    this.state = 'OPEN';
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    logger.whatsapp.warn(`Circuit breaker → OPEN`, { failures: this.failureCount });
  }

  transitionToHalfOpen() {
    this.state = 'HALF_OPEN';
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    logger.whatsapp.info('Circuit breaker → HALF_OPEN');
  }

  reset() {
    this.transitionToClosed();
    logger.whatsapp.info('Circuit breaker manually reset');
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
    // Remove old mapping system - now handled by MessageSessionManager
    // this.messageIdToAppointmentId = new Map();

    // MEMORY LEAK FIX: Store event handler references for proper cleanup
    this.eventHandlers = {
      onQR: this.handleQR.bind(this),
      onReady: this.handleReady.bind(this),
      onAuthenticated: this.handleAuthenticated.bind(this),
      onMessageAck: this.handleMessageAck.bind(this),
      onDisconnected: this.handleDisconnected.bind(this),
      onAuthFailure: this.handleAuthFailure.bind(this),
      onLoadingScreen: this.handleLoadingScreen.bind(this)
    };

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
    logger.whatsapp.debug('WebSocket emitter set');
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
    logger.whatsapp.debug('QR viewer connected - checking session state');

    // Don't auto-initialize - let explicit requests handle initialization
    // This prevents creating new client instances that invalidate existing sessions
    if (this.clientState.isState('DISCONNECTED') && !this.clientState.client) {
      logger.whatsapp.debug('Client disconnected with no instance - will wait for explicit initialization request');
    } else {
      logger.whatsapp.debug('Skipping auto-initialization', {
        state: this.clientState.state,
        hasClient: !!this.clientState.client,
        qrViewers: this.messageState.activeQRViewers
      });
    }
  }

  // Main initialization method with comprehensive error handling
  async initialize(forceRestart = false) {
    // Check if we should skip initialization
    if (!forceRestart && this.clientState.isState('CONNECTED')) {
      logger.whatsapp.info('WhatsApp client already connected');
      return true;
    }

    if (!forceRestart && this.clientState.isState('INITIALIZING')) {
      logger.whatsapp.info('WhatsApp client already initializing, waiting for completion');
      return this.clientState.initializationPromise;
    }

    // Check circuit breaker
    if (this.circuitBreaker.getStatus().isOpen && !forceRestart) {
      throw new Error('Circuit breaker is open, cannot initialize WhatsApp client');
    }

    try {
      // Acquire initialization lock
      logger.whatsapp.debug('Acquiring initialization lock');
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
      logger.whatsapp.error('Initialization failed', error);
      throw error;
    } finally {
      // Always release lock and clean up
      this.clientState.initializationPromise = null;
      this.clientState.releaseInitializationLock();
    }
  }

  async performInitialization(forceRestart = false) {
    logger.whatsapp.info('Starting initialization', { forceRestart });

    try {
      // Clean up existing client if restarting
      if (forceRestart && this.clientState.client) {
        await this.destroyClient('restart');
      }

      // Pre-flight validation: Check session quality before initialization
      // SESSION PERSISTENCE FIX: Only cleanup if session is truly corrupted, not just empty
      if (!forceRestart && !this.clientState.client) {
        const sessionQuality = await this.validateSessionQuality();

        if (sessionQuality === 'valid') {
          logger.whatsapp.info('Found existing session - proceeding with client creation');
        } else if (sessionQuality === 'corrupted') {
          // Only cleanup truly corrupted sessions (read errors, permission issues)
          logger.whatsapp.warn(`Session quality: ${sessionQuality} - cleaning up corrupted session`);
          await this.cleanupInvalidSession();
          logger.whatsapp.info('Corrupted session cleaned up - will create fresh client and show QR');
        } else if (sessionQuality === 'empty') {
          // Empty session can be from fresh auth - don't cleanup, let Puppeteer write to it
          logger.whatsapp.info('Session is empty - will create client and let Puppeteer initialize storage');
        } else {
          logger.whatsapp.info('No existing session found - will create new client');
        }
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
        if (!this.clientState.isState('CONNECTED')) {
          this.clientState.setState('CONNECTED');
        }
        // Don't call setClientReady here - the ready event handler will do it
        this.clientState.reconnectAttempts = 0;
        logger.whatsapp.info('Client initialized successfully');
        return true;
      } else if (success === false) {
        // QR timeout - keep client in QR mode, don't treat as error
        logger.whatsapp.info('Client in QR mode - waiting for scan');
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
    logger.whatsapp.info('Creating WhatsApp client');

    // Check if aborted
    if (this.clientState.initializationAbortController?.signal.aborted) {
      throw new Error('Initialization aborted due to timeout');
    }

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: "client" }),
      puppeteer: {
        headless: true,
        //headless: false,
        timeout: 30000, // 30 second browser launch timeout
        protocolTimeout: 30000, // 30 second protocol timeout
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

    // Store client reference and reset session stabilization flag
    this.clientState.client = client;
    this.clientState.sessionStabilized = false; // Reset for new client - will be set to true after 60s delay

    // Set up event handlers before initialization
    await this.setupClientEventHandlers(client);

    // Check for existing session to adjust timeout
    const hasSession = await this.checkExistingSession();

    // Use different timeouts based on authentication scenario
    const timeoutDuration = hasSession ?
      this.clientState.SESSION_RESTORATION_TIMEOUT : // 120 seconds for session restoration
      this.clientState.FRESH_AUTH_TIMEOUT;           // 90 seconds for fresh QR auth

    // Start progress tracker OUTSIDE promise to ensure it runs
    const startTime = Date.now();
    let resolved = false;

    const progressInterval = setInterval(() => {
      if (!resolved) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        logger.whatsapp.debug(`Waiting for authentication... ${elapsed}s elapsed`);
      }
    }, 5000);

    // Create initialization promise
    const initPromise = new Promise((resolve, reject) => {

      const timeout = setTimeout(async () => {
        if (!resolved) {
          resolved = true;
          clearInterval(progressInterval);
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          logger.whatsapp.error('❌ Initialization timeout - no events fired', {
            elapsed: elapsed + 's',
            timeout: Math.floor(timeoutDuration / 1000) + 's',
            hasSession,
            clientState: this.clientState.state
          });

          // If session exists, it's likely corrupted - cleanup and retry
          if (hasSession) {
            logger.whatsapp.info('Cleaning up corrupted session files');
            try {
              await this.cleanupInvalidSession();
              logger.whatsapp.info('Session cleanup complete - will retry on next attempt');
            } catch (cleanupError) {
              logger.whatsapp.error('Failed to cleanup session', { error: cleanupError.message });
            }
          }

          reject(new Error('Client initialization timeout - no events'));
        }
      }, timeoutDuration);

      const onReady = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          clearInterval(progressInterval);
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          logger.whatsapp.info(`Client authenticated (${elapsed}s)`);
          client.removeListener('qr', onQR);
          client.removeListener('auth_failure', onAuthFailure);
          client.removeListener('disconnected', onDisconnected);
          this.clientState.setState('CONNECTED')
          resolve(true);
        }
      };

      const onQR = (qr) => {
        // QR received is normal, extend timeout for user to scan
        logger.whatsapp.info('QR code generated - waiting for scan');
        clearTimeout(timeout);
        clearInterval(progressInterval);
        // Give user more time to scan QR code
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            logger.whatsapp.info('QR scan timeout - client waiting for future scan');
            // IMPORTANT: Do NOT remove the ready listener!
            // The client is still alive and the ready event will fire when user scans QR
            // Remove QR, auth_failure and disconnected listeners to clean up
            client.removeListener('qr', onQR);
            client.removeListener('auth_failure', onAuthFailure);
            client.removeListener('disconnected', onDisconnected);
            // Don't reject here - let the client stay in QR mode
            resolve(false); // Return false to indicate not ready but not failed
          }
        }, this.clientState.FRESH_AUTH_TIMEOUT); // 90 seconds for user to scan QR
      };

      const onAuthFailure = (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          clearInterval(progressInterval);
          logger.whatsapp.error('Authentication failed', { error: error?.toString() });
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
          clearInterval(progressInterval);
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          logger.whatsapp.warn(`❌ onDisconnected event fired (${elapsed}s)`, { reason: reason?.toString() });
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
        clearInterval(progressInterval);
        reject(new Error('Initialization aborted'));
        return;
      }

      // Start initialization
      const initializeCall = client.initialize();

      initializeCall.then(() => {
        logger.whatsapp.debug('client.initialize() promise resolved');
      }).catch(error => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          clearInterval(progressInterval);
          logger.whatsapp.error('❌ client.initialize() promise rejected', {
            error: error.message,
            stack: error.stack
          });
          reject(error);
        }
      });
    });

    return initPromise;
  }

  /**
   * MEMORY LEAK FIX: Set up event handlers using bound method references
   * This allows proper cleanup via removeClientEventHandlers
   */
  async setupClientEventHandlers(client) {
    logger.whatsapp.debug('Setting up event handlers');

    // Use bound method references instead of inline functions
    client.on('qr', this.eventHandlers.onQR);
    client.on('ready', this.eventHandlers.onReady);
    client.on('authenticated', this.eventHandlers.onAuthenticated);
    client.on('message_ack', this.eventHandlers.onMessageAck);
    client.on('disconnected', this.eventHandlers.onDisconnected);
    client.on('auth_failure', this.eventHandlers.onAuthFailure);
    client.on('loading_screen', this.eventHandlers.onLoadingScreen);

    logger.whatsapp.debug('Event handlers registered successfully');
  }

  /**
   * MEMORY LEAK FIX: Remove all event handlers to prevent accumulation
   */
  removeClientEventHandlers(client) {
    if (!client || !this.eventHandlers) {
      logger.whatsapp.debug('No client or handlers to remove');
      return;
    }

    try {
      client.removeListener('qr', this.eventHandlers.onQR);
      client.removeListener('ready', this.eventHandlers.onReady);
      client.removeListener('authenticated', this.eventHandlers.onAuthenticated);
      client.removeListener('message_ack', this.eventHandlers.onMessageAck);
      client.removeListener('disconnected', this.eventHandlers.onDisconnected);
      client.removeListener('auth_failure', this.eventHandlers.onAuthFailure);
      client.removeListener('loading_screen', this.eventHandlers.onLoadingScreen);

      logger.whatsapp.debug('Event handlers removed successfully');
    } catch (error) {
      logger.whatsapp.error('Error removing event handlers', error);
    }
  }

  /**
   * Handle QR code generation
   *
   * IMPORTANT: QR event fires in multiple scenarios:
   * 1. Fresh authentication (no session exists) - NORMAL, show QR
   * 2. Existing session restoration (WhatsApp checking session validity) - NORMAL, may auto-resolve
   * 3. Session actually invalid - Will trigger auth_failure event separately
   *
   * DO NOT delete sessions here! Let auth_failure handler deal with invalid sessions.
   */
  async handleQR(qr) {
    // Quick diagnostic check only - DO NOT take destructive actions
    const sessionQuality = await this.validateSessionQuality();

    // Log session status for debugging, but don't delete anything
    if (sessionQuality === 'valid') {
      logger.whatsapp.info('QR received for existing session - WhatsApp may be verifying session validity');
    } else if (sessionQuality === 'none') {
      logger.whatsapp.info('QR received for fresh authentication - no existing session');
    } else {
      logger.whatsapp.debug(`QR received - session quality: ${sessionQuality}`);
    }

    // Client is definitely not ready when QR is received
    if (this.messageState.clientReady) {
      await this.messageState.setClientReady(false);
    }

    await this.messageState.setQR(qr);
    this.emit('qr', qr);

    if (this.wsEmitter) {
      // Convert QR string to data URL for client display
      try {
        const qrImageUrl = await qrcode.toDataURL(qr, {
          margin: 4,
          scale: 6,
          errorCorrectionLevel: 'M'
        });

        const message = createWebSocketMessage(
          MessageSchemas.WebSocketMessage.QR_UPDATE,
          { qr: qrImageUrl, clientReady: false }
        );
        this.broadcastToClients(message);
      } catch (error) {
        logger.whatsapp.error('Failed to convert QR code to data URL:', error);
        // Fallback: send raw QR string
        const message = createWebSocketMessage(
          MessageSchemas.WebSocketMessage.QR_UPDATE,
          { qr, clientReady: false }
        );
        this.broadcastToClients(message);
      }
    }
  }

  /**
   * Handle authenticated event
   * CRITICAL: Implements 60-second stabilization delay for session persistence
   * Based on whatsapp-web.js RemoteAuth best practice - session data needs time to flush to disk
   */
  async handleAuthenticated() {
    logger.whatsapp.info('Client authenticated successfully');

    // Clear QR code since we're authenticated
    await this.messageState.setQR(null);

    // CRITICAL: Wait 60 seconds for Puppeteer to flush session data to disk
    // Without this delay, session files (IndexedDB, leveldb) will be empty on quick restarts
    // See: whatsapp-web.js RemoteAuth implementation - "Initial delay sync required for session to be stable enough to recover"
    logger.whatsapp.info('Waiting 60s for session to stabilize...');

    const SESSION_STABILIZATION_DELAY = 60000; // 60 seconds

    // Wait for full stabilization period (silent)
    await new Promise(resolve => setTimeout(resolve, SESSION_STABILIZATION_DELAY));

    // Mark session as stabilized - safe to restart now
    this.clientState.sessionStabilized = true;
    logger.whatsapp.info('Session stabilized - safe to restart');
  }

  /**
   * Handle ready event
   */
  async handleReady() {
    logger.whatsapp.info('Client ready');

    // MEMORY LEAK FIX: Store browser references for cleanup
    if (this.clientState.client) {
      try {
        this.clientState.browser = this.clientState.client.pupBrowser;
        this.clientState.page = this.clientState.client.pupPage;
      } catch (error) {
        logger.whatsapp.warn('Could not store browser references', error);
      }
    }

    // If ready event fires without authenticated event, session was restored from disk
    // In this case, session is already stable (no need to wait 60 seconds)
    if (!this.clientState.sessionStabilized) {
      logger.whatsapp.info('Session restored from existing files');
      this.clientState.sessionStabilized = true;
    }

    // IMPORTANT: Update client state to CONNECTED when ready event fires
    this.clientState.setState('CONNECTED');
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
    }
  }

  /**
   * Handle message acknowledgment
   */
  async handleMessageAck(msg, ack) {
    const messageId = msg.id.id;

    // Use MessageSessionManager to get appointment ID with date validation
    const messageInfo = messageSessionManager.getAppointmentIdForMessage(messageId);

    logger.whatsapp.debug(`Message status updated`, {
      messageId,
      ack,
      messageInfo
    });

    if (!messageInfo) {
      logger.whatsapp.debug('Message not found in any active session - may be from previous session or external message', {
        messageId,
        ackStatus: ack
      });
      return;
    }

    const { appointmentId, sessionDate, sessionId } = messageInfo;

    try {
      // Record the delivery status update in the session
      messageSessionManager.recordDeliveryStatusUpdate(messageId, ack);

      await this.messageState.updateMessageStatus(messageId, ack, async () => {
        // Use the optimized single message update function
        logger.whatsapp.debug('Updating database status', {
          messageId,
          appointmentId,
          sessionDate,
          sessionId,
          ackStatus: ack
        });

        return await messagingQueries.updateSingleMessageStatus(messageId, ack);
      });

      if (this.wsEmitter) {
        const message = createWebSocketMessage(
          MessageSchemas.WebSocketMessage.MESSAGE_STATUS,
          {
            messageId,
            appointmentId,
            sessionDate,
            status: ack
          }
        );
        this.broadcastToClients(message);
      }

    } catch (error) {
      logger.whatsapp.error('Error updating message status', {
        messageId,
        appointmentId,
        sessionDate,
        sessionId,
        error: error.message
      });
    }
  }

  /**
   * Handle disconnected event
   */
  async handleDisconnected(reason) {
    logger.whatsapp.warn(`Client disconnected`, { reason });
    this.clientState.setState('DISCONNECTED');
    await this.messageState.setClientReady(false);

    // Don't set client to null immediately, let cleanup handle it
    stateEvents.emit('client_disconnected', reason);

    if (!this.messageState.manualDisconnect && !this.clientState.destroyInProgress) {
      this.scheduleReconnect(new Error(`Disconnected: ${reason}`));
    }
  }

  /**
   * Handle authentication failure
   */
  async handleAuthFailure(error) {
    logger.whatsapp.error('WhatsApp authentication failed', error);
    this.clientState.setState('ERROR', error);
    await this.messageState.setClientReady(false);

    if (!this.messageState.manualDisconnect && !this.clientState.destroyInProgress) {
      this.scheduleReconnect(error);
    }
  }

  /**
   * Handle loading screen
   */
  handleLoadingScreen(percent, message) {
    logger.whatsapp.debug(`WhatsApp loading: ${percent}% - ${message}`);
  }

  scheduleReconnect(error) {
    this.clientState.reconnectAttempts++;

    if (this.clientState.reconnectAttempts > this.clientState.MAX_RECONNECT_ATTEMPTS) {
      logger.whatsapp.warn(`Exceeded maximum reconnection attempts (${this.clientState.MAX_RECONNECT_ATTEMPTS})`);
      this.circuitBreaker.onFailure('max-reconnect-attempts', error);
      return;
    }

    const delay = Math.min(
      this.clientState.RECONNECT_BASE_DELAY * Math.pow(1.5, this.clientState.reconnectAttempts - 1),
      60000
    ) * (0.75 + Math.random() * 0.5);

    logger.whatsapp.info(`Scheduling reconnection attempt ${this.clientState.reconnectAttempts} in ${Math.round(delay)}ms`);

    this.clientState.clearReconnectTimer();
    this.clientState.reconnectTimer = setTimeout(async () => {
      logger.whatsapp.info(`Attempting to reconnect (attempt ${this.clientState.reconnectAttempts})`);
      try {
        await this.initialize();
      } catch (err) {
        logger.whatsapp.error('Error during reconnection attempt', err);
      }
    }, delay);
  }

  async restart() {
    logger.whatsapp.info('Restarting WhatsApp client - preserving authentication');

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
          logger.whatsapp.debug('Broadcasted restarting state to clients');
        } catch (error) {
          logger.whatsapp.error('Error broadcasting restarting state', error);
        }
      }

      // First destroy the current client (preserves authentication)
      if (this.clientState.client) {
        try {
          await this.clientState.client.destroy();
          logger.whatsapp.info('Client destroyed for restart - authentication preserved');
        } catch (error) {
          logger.whatsapp.error('Error destroying client during restart', error);
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
          logger.whatsapp.debug('Broadcasted initializing state to clients');
        } catch (error) {
          logger.whatsapp.error('Error broadcasting initializing state', error);
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

  /**
   * MEMORY LEAK FIX: Force close browser instance
   */
  async forceCloseBrowser() {
    if (!this.clientState.browser) {
      logger.whatsapp.debug('No browser reference to close');
      return;
    }

    try {
      logger.whatsapp.warn('Force closing Puppeteer browser');

      // Get all pages and close them
      const pages = await this.clientState.browser.pages();
      await Promise.all(pages.map(page =>
        page.close().catch(err =>
          logger.whatsapp.error('Error closing page', err)
        )
      ));

      // Close the browser with timeout
      await Promise.race([
        this.clientState.browser.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Browser close timeout')), 10000)
        )
      ]);

      logger.whatsapp.info('Browser force closed successfully');
    } catch (error) {
      logger.whatsapp.error('Error force closing browser', error);

      // Last resort: kill the process
      try {
        const browserProcess = this.clientState.browser.process();
        if (browserProcess) {
          browserProcess.kill('SIGKILL');
          logger.whatsapp.warn('Browser process killed with SIGKILL');
        }
      } catch (killError) {
        logger.whatsapp.error('Could not kill browser process', killError);
      }
    } finally {
      this.clientState.browser = null;
      this.clientState.page = null;
    }
  }

  async destroyClient(reason = 'manual') {
    logger.whatsapp.info(`Destroying WhatsApp client (reason: ${reason})`);

    // CRITICAL: Warn if session has not stabilized yet
    if (this.clientState.client && !this.clientState.sessionStabilized && reason === 'restart') {
      logger.whatsapp.warn('⚠️  WARNING: Session has NOT stabilized yet - session data may be incomplete!');
      logger.whatsapp.warn('⚠️  Restarting before 60-second stabilization delay completes may result in session loss');
      logger.whatsapp.warn('⚠️  QR code will be required on next startup if session data is incomplete');
    }

    this.clientState.destroyInProgress = true;

    try {
      // MEMORY LEAK FIX: Remove event listeners FIRST
      if (this.clientState.client) {
        this.removeClientEventHandlers(this.clientState.client);
      }

      // Try graceful destroy with timeout
      if (this.clientState.client) {
        try {
          await Promise.race([
            // Graceful destroy
            (async () => {
              if (reason !== 'restart') {
                await this.clientState.client.logout();
                logger.whatsapp.info('WhatsApp client logged out successfully');
              } else {
                await this.clientState.client.destroy();
                logger.whatsapp.info('WhatsApp client destroyed for restart (session preserved)');
              }
            })(),
            // Timeout after 30 seconds
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Client destroy timeout')), 30000)
            )
          ]);

        } catch (destroyError) {
          logger.whatsapp.error('Graceful destroy failed, attempting force close', destroyError);

          // MEMORY LEAK FIX: Force close browser if graceful destroy fails
          await this.forceCloseBrowser();
        }

        this.clientState.client = null;
      }

      // Final cleanup
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);

    } catch (error) {
      logger.whatsapp.error('Error destroying client', error);
      // Ensure browser is closed even on error
      await this.forceCloseBrowser();
    } finally {
      this.clientState.browser = null;
      this.clientState.page = null;
      this.clientState.destroyInProgress = false;
    }
  }

  scheduleClientCleanup() {
    // Automatic cleanup removed - preserve authenticated sessions permanently
    // Only manual destruction allowed to maintain authentication investment
    logger.whatsapp.debug('Automatic cleanup disabled - client will persist until manually destroyed');
  }

  broadcastToClients(message) {
    if (this.wsEmitter) {
      this.wsEmitter.emit('broadcast_message', message);
    }
  }

  // Send functionality with proper state management and MessageSession
  async send(date) {
    if (!this.isReady()) {
      throw new Error("WhatsApp client not ready to send messages");
    }

    return this.circuitBreaker.execute(async () => {
      logger.whatsapp.info(`Starting message sending session for date: ${date}`);

      // Create and start a new message session for this date
      const session = messageSessionManager.startSession(date, this);

      try {
        const [numbers, messages, ids, names] = await getWhatsAppMessages(date);

        if (!numbers || numbers.length === 0) {
          logger.whatsapp.info(`No messages to send for date ${date}`);
          await this.messageState.setFinishedSending(true);
          this.emit('finishedSending');

          // Complete the session even if no messages
          messageSessionManager.completeSession(date);
          return;
        }

        logger.whatsapp.info(`Sending ${numbers.length} messages with session ${session.sessionId}`);

        // Broadcast sending started with total count
        if (this.wsEmitter) {
          const message = {
            type: 'whatsapp_sending_started',
            data: {
              total: numbers.length,
              sent: 0,
              failed: 0,
              started: true,
              finished: false,
              sessionId: session.sessionId,
              date: date
            },
            timestamp: Date.now()
          };
          this.wsEmitter.emit('broadcast_message', message);
        }

        const results = [];
        for (let i = 0; i < numbers.length; i++) {
          // Check if client is still ready before each message
          if (!this.isReady()) {
            throw new Error('Client disconnected during sending');
          }

          try {
            const result = await this.sendSingleMessage(numbers[i], messages[i], names[i], ids[i], date, session);
            results.push(result);

            if (i < numbers.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          } catch (error) {
            logger.whatsapp.error(`Error sending message to ${numbers[i]}`, error);
            results.push({ success: false, error: error.message });
          }
        }

        await this.messageState.setFinishedSending(true);
        this.emit('finishedSending');

        // DO NOT complete session immediately - let it stay active to receive status updates
        // Session will auto-expire after ackTrackingWindow (extended to 7 days)
        // messageSessionManager.completeSession(date);

        logger.whatsapp.info(`Message sending finished - session remains active for status updates`, {
          sessionId: session.sessionId,
          date: date,
          totalResults: results.length,
          sessionStats: session.getStats()
        });

        return results;

      } catch (error) {
        // Complete session on error too
        messageSessionManager.completeSession(date);
        throw error;
      }
    }, 'send-messages');
  }

  async sendSingleMessage(number, message, name, appointmentId, appointmentDate, session) {
    // Remove + prefix if present for WhatsApp chat ID format
    const cleanNumber = number.startsWith('+') ? number.substring(1) : number;
    const chatId = `${cleanNumber}@c.us`;

    try {
      const sentMessage = await this.clientState.client.sendMessage(chatId, message);

      logger.whatsapp.debug(`Message sent to ${number}`);

      // Register message in session with date validation (only if session is provided)
      if (session) {
        const registered = session.registerMessage(sentMessage.id.id, appointmentId, appointmentDate);

        if (!registered) {
          logger.whatsapp.warn('Failed to register message in session', {
            messageId: sentMessage.id.id,
            appointmentId,
            appointmentDate,
            sessionId: session.sessionId
          });
        }

        // Record successful send in session
        session.recordMessageSent(sentMessage.id.id);
      }

      const person = {
        messageId: sentMessage.id.id,
        appointmentId: appointmentId,
        name,
        number,
        success: '&#10004;'
      };

      // Mark message as sent in database to prevent duplicates (only for appointment messages)
      if (appointmentId) {
        try {
          await messagingQueries.updateWhatsAppStatus([appointmentId], [sentMessage.id.id]);
          logger.whatsapp.debug(`Marked appointment ${appointmentId} as sent in database`);
        } catch (dbError) {
          logger.whatsapp.error(`Failed to mark appointment ${appointmentId} as sent`, dbError);
          // Continue anyway - don't fail the send because of database update issue
        }
      }

      this.emit('MessageSent', person);

      return { success: true, messageId: sentMessage.id.id };

    } catch (error) {
      // Record failure in session if we have one
      if (session) {
        session.recordMessageFailed(null, error.message); // No messageId since send failed
      }

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
        logger.whatsapp.info(`Generating WhatsApp report for date: ${date}`);

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
              logger.whatsapp.error(`Error checking message ${msg.wamid}`, error);
            }
          }

          // Update database with new statuses
          if (statusUpdates.length > 0) {
            await database.updateWhatsAppDeliveryStatus(statusUpdates);
          }
        }

        await this.messageState.setFinishReport(true);
        this.emit('finishedSending');

        logger.whatsapp.info(`Report generated for ${messages.length} messages`);
        return { success: true, messagesChecked: messages.length };

      } catch (error) {
        logger.whatsapp.error('Error generating report', error);
        throw error;
      }
    }, 'generate-report');
  }

  async clear() {
    logger.whatsapp.info('Clearing message state');
    await this.messageState.reset();
    return { success: true };
  }

  // Initialize on demand when QR viewers connect
  async initializeOnDemand() {
    logger.whatsapp.debug('initializeOnDemand called - checking conditions');

    // Don't initialize if already connected or initializing
    if (this.clientState.isState('CONNECTED') || this.clientState.isState('INITIALIZING')) {
      logger.whatsapp.debug('Client already connected or initializing');
      return this.clientState.initializationPromise || true;
    }

    // Only initialize if there are active QR viewers
    if (this.messageState.activeQRViewers === 0) {
      logger.whatsapp.debug('No QR viewers, skipping initialization');
      return false;
    }

    // Check if circuit breaker allows initialization
    if (this.circuitBreaker.getStatus().isOpen) {
      logger.whatsapp.warn('Circuit breaker is open, cannot auto-initialize');
      return false;
    }

    logger.whatsapp.info('Auto-initializing WhatsApp client');
    try {
      return await this.initialize();
    } catch (error) {
      logger.whatsapp.error('Failed to auto-initialize', error);
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
        logger.whatsapp.debug(`Executing queued operation: ${operationName}`);
        const result = await operation(this.clientState.client);
        logger.whatsapp.debug(`Queued operation completed successfully: ${operationName}`);
        return result;
      } catch (error) {
        logger.whatsapp.error(`Queued operation failed: ${operationName}`, error);
        throw error;
      }
    }, operationName);
  }

  async gracefulShutdown(signal = 'manual') {
    logger.whatsapp.info(`Graceful shutdown initiated (${signal})`);

    try {
      // Set manual disconnect flag to prevent reconnection attempts
      this.messageState.manualDisconnect = true;

      // Clear all timers and pending operations
      this.clientState.cleanup();

      // Destroy client if it exists
      await this.destroyClient('shutdown');

      // Clean up message state
      await this.messageState.cleanup();

      logger.whatsapp.info('Graceful shutdown completed');
    } catch (error) {
      logger.whatsapp.error('Error during graceful shutdown', error);
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
    logger.whatsapp.warn('Force destroying WhatsApp client');

    this.clientState.destroyInProgress = true;

    try {
      // MEMORY LEAK FIX: Remove event listeners first
      if (this.clientState.client) {
        this.removeClientEventHandlers(this.clientState.client);
      }

      // Clear all timers
      this.clientState.cleanup();

      // Try to destroy client
      if (this.clientState.client) {
        try {
          await this.clientState.client.destroy();
        } catch (error) {
          logger.whatsapp.error('Error during force destroy', error);
        }
        this.clientState.client = null;
      }

      // Force close browser
      await this.forceCloseBrowser();

      // Reset states
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      this.circuitBreaker.reset();

    } finally {
      this.clientState.browser = null;
      this.clientState.page = null;
      this.clientState.destroyInProgress = false;
    }
  }

  // Simple destroy - close browser but preserve authentication
  async simpleDestroy() {
    logger.whatsapp.info('Destroying WhatsApp client - closing browser but preserving authentication');

    this.clientState.destroyInProgress = true;
    this.messageState.manualDisconnect = true;

    try {
      // MEMORY LEAK FIX: Remove event listeners first
      if (this.clientState.client) {
        this.removeClientEventHandlers(this.clientState.client);

        try {
          await this.clientState.client.destroy();
          logger.whatsapp.info('WhatsApp client destroyed successfully - authentication preserved');
        } catch (error) {
          logger.whatsapp.error('Error during destroy', error);
          // Force close browser on error
          await this.forceCloseBrowser();
        }
        this.clientState.client = null;
      }

      // Clear all timers and state
      this.clientState.cleanup();
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      await this.messageState.setQR(null);

      // Complete all active message sessions
      messageSessionManager.completeAllSessions();
      this.circuitBreaker.reset();

      return { success: true, message: "Client destroyed - browser closed, authentication preserved" };

    } catch (error) {
      logger.whatsapp.error('Error during simple destruction', error);
      await this.forceCloseBrowser();
      return { success: false, error: "Destroy failed: " + error.message };
    } finally {
      this.clientState.browser = null;
      this.clientState.page = null;
      this.clientState.destroyInProgress = false;
      this.messageState.manualDisconnect = false;
    }
  }

  // Complete logout with authentication cleanup
  async completeLogout() {
    logger.whatsapp.info('Starting complete WhatsApp client logout with authentication cleanup');

    this.clientState.destroyInProgress = true;
    this.messageState.manualDisconnect = true;

    try {
      // MEMORY LEAK FIX: Remove event listeners first
      if (this.clientState.client) {
        this.removeClientEventHandlers(this.clientState.client);

        try {
          await this.clientState.client.logout();
          logger.whatsapp.info('WhatsApp client logged out successfully - authentication cleared by logout()');
        } catch (error) {
          logger.whatsapp.error('Error during logout', error);
          // Try to destroy anyway
          try {
            await this.clientState.client.destroy();
          } catch (destroyError) {
            logger.whatsapp.error('Error during destroy', destroyError);
            // Force close browser on error
            await this.forceCloseBrowser();
          }
        }
        this.clientState.client = null;
      }

      // Clear all timers and state
      this.clientState.cleanup();
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      await this.messageState.setQR(null);

      // Complete all active message sessions
      messageSessionManager.completeAllSessions();
      this.circuitBreaker.reset();

      // Note: No need to manually delete folders - logout() method handles this
      return { success: true, message: "Client logged out - authentication completely cleared" };

    } catch (error) {
      logger.whatsapp.error('Error during complete logout', error);
      await this.forceCloseBrowser();
      return { success: false, error: "Logout failed: " + error.message };
    } finally {
      this.clientState.browser = null;
      this.clientState.page = null;
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

  /**
   * Validate session quality - detect empty/corrupted sessions
   * CONSERVATIVE APPROACH: Only returns 'corrupted' when 100% certain there's a problem
   * Returns: 'valid', 'empty', 'corrupted', or 'none'
   *
   * Philosophy: False positives (claiming good session is bad) are WORSE than false negatives
   * - False positive = forces user to re-authenticate unnecessarily (bad UX)
   * - False negative = QR code shown but session restores anyway (harmless)
   */
  async validateSessionQuality() {
    try {
      const fs = await import('fs');
      const path = await import('path');

      const sessionPath = '.wwebjs_auth/session-client/Default';

      // Check 1: Session path exists
      if (!fs.default.existsSync(sessionPath)) {
        logger.whatsapp.debug('Session quality: none (path does not exist)');
        return 'none';
      }

      // Check 2: Get session age to avoid checking brand-new sessions
      // Check BOTH the session directory AND IndexedDB directory age
      try {
        const sessionStats = fs.default.statSync(sessionPath);
        const sessionAgeMs = Date.now() - sessionStats.birthtimeMs;

        // CRITICAL: Skip validation for very new sessions (< 10 seconds old)
        // Puppeteer needs time to create IndexedDB and LocalStorage directories
        if (sessionAgeMs < 10000) {
          logger.whatsapp.debug(`Session quality: new (session created ${Math.floor(sessionAgeMs / 1000)}s ago, assuming valid)`);
          return 'valid'; // Assume new sessions are valid to avoid false positives
        }
      } catch (statError) {
        logger.whatsapp.debug('Could not determine session age, continuing validation');
      }

      // Check 3: IndexedDB directory exists (CRITICAL for WhatsApp authentication)
      const indexedDBPath = path.default.join(sessionPath, 'IndexedDB');
      const indexedDBWhatsAppPath = path.default.join(indexedDBPath, 'https_web.whatsapp.com_0.indexeddb.leveldb');

      if (!fs.default.existsSync(indexedDBPath)) {
        // IndexedDB missing - check if this is a brand-new initialization
        // If session directory exists but IndexedDB doesn't, check IndexedDB parent age
        try {
          const parentStats = fs.default.statSync(sessionPath);
          const parentAgeMs = Date.now() - parentStats.mtimeMs; // Use mtime (last modified)

          // If session directory was just modified (< 30s), Puppeteer is likely still initializing
          if (parentAgeMs < 30000) {
            logger.whatsapp.debug(`Session quality: initializing (modified ${Math.floor(parentAgeMs / 1000)}s ago, waiting for IndexedDB)`);
            return 'valid'; // Give Puppeteer time to create IndexedDB
          }
        } catch (ageError) {
          // Can't determine age, continue with validation
        }

        // IndexedDB missing after 30s = likely empty
        logger.whatsapp.debug('Session quality: empty (IndexedDB directory missing after 30s)');
        return 'empty';
      }

      // Check 4: IndexedDB has actual WhatsApp data files (.ldb files)
      // CONSERVATIVE: Only check WhatsApp-specific IndexedDB, not all IndexedDB
      let indexedDBDataFileCount = 0;
      if (fs.default.existsSync(indexedDBWhatsAppPath)) {
        try {
          const indexedDBFiles = fs.default.readdirSync(indexedDBWhatsAppPath);
          indexedDBDataFileCount = indexedDBFiles.filter(f => f.endsWith('.ldb')).length;

          logger.whatsapp.debug(`IndexedDB contains ${indexedDBDataFileCount} WhatsApp data files`);
        } catch (error) {
          // Read error = definitely corrupted (permissions, filesystem issues)
          logger.whatsapp.warn('Session quality: corrupted (IndexedDB read error)', { error: error.message });
          return 'corrupted';
        }
      }

      // Check 5: Local Storage leveldb (contains WANoiseInfo encryption keys)
      const leveldbPath = path.default.join(sessionPath, 'Local Storage/leveldb');

      if (fs.default.existsSync(leveldbPath)) {
        try {
          const leveldbFiles = fs.default.readdirSync(leveldbPath);

          // CONSERVATIVE: Just check that directory is readable, don't validate content
          // Log files can be empty (0 bytes) in fresh sessions - this is NORMAL
          logger.whatsapp.debug(`Local Storage contains ${leveldbFiles.length} files`);
        } catch (error) {
          // Read error = definitely corrupted
          logger.whatsapp.warn('Session quality: corrupted (leveldb read error)', { error: error.message });
          return 'corrupted';
        }
      }

      // Check 6: Calculate total session size (most reliable indicator)
      let totalSize = 0;
      const calculateDirSize = (dirPath) => {
        try {
          const files = fs.default.readdirSync(dirPath, { withFileTypes: true });
          for (const file of files) {
            const filePath = path.default.join(dirPath, file.name);
            try {
              if (file.isDirectory()) {
                calculateDirSize(filePath);
              } else {
                const stats = fs.default.statSync(filePath);
                totalSize += stats.size;
              }
            } catch (fileError) {
              // Skip individual file errors (permissions, locked files)
              logger.whatsapp.debug(`Skipping file in size calculation: ${filePath}`);
            }
          }
        } catch (dirError) {
          // Skip directory read errors
          logger.whatsapp.debug(`Skipping directory in size calculation: ${dirPath}`);
        }
      };

      calculateDirSize(sessionPath);

      // DECISION LOGIC: Conservative approach

      // Scenario 1: Large session (> 1MB) = definitely valid (even if some files are empty)
      if (totalSize > 1024 * 1024) {
        logger.whatsapp.info(`Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, mature session)`);
        return 'valid';
      }

      // Scenario 2: Medium session (> 100KB) with IndexedDB = valid
      if (totalSize > 100 * 1024 && indexedDBDataFileCount >= 5) {
        logger.whatsapp.info(`Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, ${indexedDBDataFileCount} IndexedDB files)`);
        return 'valid';
      }

      // Scenario 3: Small session (> 10KB) with some IndexedDB files = probably valid, give benefit of doubt
      if (totalSize > 10 * 1024 && indexedDBDataFileCount > 0) {
        logger.whatsapp.info(`Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, ${indexedDBDataFileCount} IndexedDB files, fresh session)`);
        return 'valid';
      }

      // Scenario 4: Tiny session (< 10KB) after 10 seconds = likely empty
      if (totalSize < 10 * 1024) {
        logger.whatsapp.debug(`Session quality: empty (size ${totalSize} bytes < 10KB after 10s)`);
        return 'empty';
      }

      // Scenario 5: No IndexedDB data after 10 seconds = empty
      if (indexedDBDataFileCount === 0) {
        logger.whatsapp.debug(`Session quality: empty (no IndexedDB data files after 10s)`);
        return 'empty';
      }

      // Default: If we're unsure, assume valid to avoid false positives
      logger.whatsapp.info(`Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, assuming valid by default)`);
      return 'valid';

    } catch (error) {
      // Only return 'corrupted' for critical errors (filesystem access issues)
      logger.whatsapp.error('Error validating session quality', { error: error.message });
      return 'corrupted';
    }
  }

  /**
   * SESSION VALIDATION FIX: Comprehensive session validation with integrity checks
   * Returns: boolean (simple) for backward compatibility
   * Uses validateSessionQuality() internally for detailed validation
   */
  async checkExistingSession() {
    const quality = await this.validateSessionQuality();
    return quality === 'valid';  // Only return true for truly valid sessions
  }

  /**
   * LEGACY: Old comprehensive validation (kept for reference)
   * Now replaced by validateSessionQuality()
   */
  async checkExistingSession_LEGACY() {
    try {
      const fs = await import('fs');
      const path = await import('path');

      const sessionPath = '.wwebjs_auth/session-client/Default';
      const localStoragePath = path.default.join(sessionPath, 'Local Storage/leveldb');
      const indexedDBPath = path.default.join(sessionPath, 'IndexedDB');

      // Check 1: Directories exist
      if (!fs.default.existsSync(localStoragePath)) {
        logger.whatsapp.debug('Session validation failed: local storage missing');
        return false;
      }

      if (!fs.default.existsSync(indexedDBPath)) {
        logger.whatsapp.debug('Session validation failed: indexed DB missing');
        return false;
      }

      // Check 2: Has data files
      const localStorageFiles = fs.default.readdirSync(localStoragePath);
      const dataFiles = localStorageFiles.filter(f =>
        f.endsWith('.ldb') || f.endsWith('.log')
      );

      if (dataFiles.length === 0) {
        logger.whatsapp.debug('Session validation failed: no data files found');
        return false;
      }

      // Check 3: Files are not too old (30 days)
      const maxAge = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let newestFile = null;

      for (const file of dataFiles) {
        const filePath = path.default.join(localStoragePath, file);
        const stats = fs.default.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (!newestFile || age < (now - newestFile.mtime)) {
          newestFile = { name: file, mtime: stats.mtimeMs, age };
        }

        if (age > maxAge) {
          logger.whatsapp.warn('Session validation failed: files too old', {
            file,
            ageDays: Math.round(age / 1000 / 60 / 60 / 24)
          });
          return false;
        }
      }

      // Check 4: Files are not empty
      let totalSize = 0;
      for (const file of dataFiles) {
        const filePath = path.default.join(localStoragePath, file);
        const stats = fs.default.statSync(filePath);

        if (stats.size === 0) {
          logger.whatsapp.warn('Session validation failed: empty file detected', { file });
          return false;
        }

        // Check if file is readable
        try {
          fs.default.accessSync(filePath, fs.constants.R_OK);
          totalSize += stats.size;
        } catch (accessError) {
          logger.whatsapp.warn('Session validation failed: file not readable', { file });
          return false;
        }
      }

      // Check 5: Reasonable total size (at least 1KB)
      if (totalSize < 1024) {
        logger.whatsapp.warn('Session validation failed: total size too small', {
          totalSize,
          totalSizeKB: Math.round(totalSize / 1024)
        });
        return false;
      }

      // All checks passed
      logger.whatsapp.debug('Session validation passed', {
        fileCount: dataFiles.length,
        totalSizeKB: Math.round(totalSize / 1024),
        ageMinutes: newestFile ? Math.round((now - newestFile.mtime) / 1000 / 60) : 0
      });

      return true;

    } catch (error) {
      logger.whatsapp.error('Error validating session', error);
      return false;
    }
  }

  /**
   * SESSION CLEANUP FIX: Clean up invalid session with retry logic for Windows
   * Handles locked files by retrying with exponential backoff
   */
  async cleanupInvalidSession(maxRetries = 3) {
    const fs = await import('fs');
    const sessionPath = '.wwebjs_auth/session-client';

    if (!fs.default.existsSync(sessionPath)) {
      logger.whatsapp.debug('No session directory to clean up');
      return { success: true, reason: 'no_session' };
    }

    // Direct deletion without backup (backups create clutter and are rarely useful)
    // If debugging is needed, backups are already in production logs
    logger.whatsapp.info('Deleting session directory without backup');

    // Retry deletion with exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.whatsapp.info(`Attempting session cleanup (attempt ${attempt}/${maxRetries})`);

        // Use force option to handle permissions issues
        fs.default.rmSync(sessionPath, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 1000
        });

        logger.whatsapp.info('Session cleaned up successfully', { attempt });
        return { success: true, reason: 'deleted', attempt };

      } catch (error) {
        logger.whatsapp.error(`Session cleanup attempt ${attempt} failed`, {
          error: error.message,
          code: error.code
        });

        if (attempt < maxRetries) {
          // Wait before retry (exponential backoff)
          const delay = 1000 * Math.pow(2, attempt - 1);
          logger.whatsapp.info(`Waiting ${delay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          logger.whatsapp.error('Session cleanup failed after all retries', {
            maxRetries,
            error: error.message
          });
          return { success: false, reason: 'cleanup_failed', error: error.message };
        }
      }
    }

    return { success: false, reason: 'max_retries_exceeded' };
  }
}

// Export singleton instance
export default new WhatsAppService();