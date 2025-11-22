// services/websocket.js
/**
 * WebSocket Service
 * A robust WebSocket client with automatic reconnection, heartbeat, and message queuing
 */
import EventEmitter from '../core/events.js';
import storage from '../core/storage.js';
import { WebSocketEvents } from '../constants/websocket-events.js';

class WebSocketService extends EventEmitter {
  /**
   * Create a new WebSocket service
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    super();
    
    // Default options
    this.options = {
      // Base URL for WebSocket connection
      // In development, use VITE_API_URL from .env.development
      // In production, use the same host/port as the page
      baseUrl: (() => {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const apiUrl = import.meta.env.VITE_API_URL;

        if (apiUrl) {
          const url = new URL(apiUrl);
          return `${protocol}//${url.host}`;
        }

        return `${protocol}//${location.host}`;
      })(),

      // Connection parameters
      reconnectInterval: 2000,      // How long to wait before reconnect attempts (ms)
      reconnectDecay: 1.5,          // Backoff factor for reconnect attempts
      maxReconnectInterval: 30000,  // Maximum reconnect interval (ms)
      maxReconnectAttempts: 20,     // Maximum number of reconnect attempts (null = infinite)

      // Connection timeout (progressive) - INCREASED to accommodate database queries
      initialConnectionTimeout: 45000,   // First connection: 45s (allows for backend startup + DB queries)
      reconnectionTimeout: 15000,        // Reconnections: 15s (increased from 10s for slow DB)

      // Heartbeat configuration
      heartbeatInterval: 30000,     // Interval for sending heartbeats (ms)
      heartbeatTimeout: 20000,      // Timeout for heartbeat response (increased from 15000)

      // Message handling
      maxQueueSize: 100,            // Maximum number of queued messages
      autoReconnect: true,          // Whether to automatically reconnect
      debug: false,                 // Enable debug logging

      // Override with provided options
      ...options
    };
    
    // Connection state
    this.state = {
      status: 'disconnected',   // disconnected, connecting, connected, error
      ws: null,                 // WebSocket instance
      reconnectAttempts: 0,     // Current reconnect attempt count
      lastMessageId: 0,         // Last message ID (for tracking)
      lastActivity: Date.now(), // Last activity timestamp (for timeout detection)
      reconnectTimer: null,     // Timer for reconnection
      heartbeatTimer: null,     // Timer for sending heartbeats
      heartbeatTimeoutTimer: null, // Timer for heartbeat timeout
      messageQueue: [],         // Queue for messages to send when reconnected
      pendingMessages: new Map(), // Map of message ID -> { resolve, reject, timeout }
      forceClose: false,        // Whether close was requested (to prevent auto-reconnect)
      screenId: null,           // Screen ID for this connection (loaded on demand)
      hasConnectedBefore: false, // Track if we've ever successfully connected
      lastConnectionParams: null, // Store connection params for auto-reconnection

      // PHASE 1: ACK and sequence number tracking
      sequenceNumbers: new Map(), // Map of date -> last received sequence number
      missedEventRequests: new Set(), // Track dates we've requested missed events for
      syncStatus: 'synced',     // 'synced', 'syncing', 'out_of_sync'
      pendingEventCount: 0,     // Number of events being processed
    };
    
    // Bind methods to ensure correct 'this' context
    this.connect = this.connect.bind(this);
    this.disconnect = this.disconnect.bind(this);
    this.send = this.send.bind(this);
    this.onMessage = this.onMessage.bind(this);
    this.onOpen = this.onOpen.bind(this);
    this.onClose = this.onClose.bind(this);
    this.onError = this.onError.bind(this);
    
    // Auto-connect if specified
    if (this.options.autoConnect) {
      this.connect();
    }
  }
  
  /**
   * Get current connection status
   * @returns {string} - Connection status
   */
  get status() {
    return this.state.status;
  }
  
  /**
   * Check if connection is active
   * @returns {boolean} - Whether connection is active
   */
  get isConnected() {
    return this.state.status === 'connected' && 
           this.state.ws && 
           this.state.ws.readyState === WebSocket.OPEN;
  }
  
  /**
   * Connect to WebSocket server
   * @param {Object} [params={}] - Connection parameters
   * @returns {Promise<WebSocketService>} - This service instance
   */
  connect(params = {}) {
    this.log('Connecting to WebSocket server...');

    // If already connected or connecting, return
    if (this.state.status === 'connected' || this.state.status === 'connecting') {
      this.log('Already connected or connecting');
      return Promise.resolve(this);
    }

    // Store connection params for auto-reconnection
    // This ensures that when scheduleReconnect() runs, it preserves clientType and PDate
    this.state.lastConnectionParams = params;

    // Reset force close flag
    this.state.forceClose = false;

    // Update state
    this.state.status = 'connecting';
    this.emit('connecting');

    // Clear any existing timers
    this.clearTimers();

    // Clean up any existing WebSocket connection
    if (this.state.ws) {
      try {
        // Remove event listeners from old connection
        this.state.ws.onopen = null;
        this.state.ws.onmessage = null;
        this.state.ws.onclose = null;
        this.state.ws.onerror = null;

        // Close old connection if still open
        if (this.state.ws.readyState === WebSocket.OPEN ||
            this.state.ws.readyState === WebSocket.CONNECTING) {
          this.state.ws.close(1000, 'Reconnecting');
        }
      } catch (error) {
        this.log('Error cleaning up old WebSocket:', error);
      }
      this.state.ws = null;
    }

    // Build connection URL with parameters
    const url = this.buildConnectionUrl(params);

    // Log connection attempt
    this.log(`Attempting to connect to: ${url}`);
    console.log('[WebSocket] Connecting to:', url);

    // Create WebSocket
    try {
      this.state.ws = new WebSocket(url);

      // Set up event handlers
      this.state.ws.onopen = this.onOpen;
      this.state.ws.onclose = this.onClose;
      this.state.ws.onerror = this.onError;
      this.state.ws.onmessage = this.onMessage;
      
      // Create a promise that resolves when connected
      return new Promise((resolve, reject) => {
        const onConnect = () => {
          this.off('connected', onConnect);
          this.off('error', onError);
          resolve(this);
        };
        
        const onError = (error) => {
          this.off('connected', onConnect);
          this.off('error', onError);
          reject(error);
        };
        
        this.once('connected', onConnect);
        this.once('error', onError);

        // Progressive timeout: First connection gets more time, reconnections are faster
        const isFirstConnection = !this.state.hasConnectedBefore;
        const timeoutDuration = isFirstConnection
          ? this.options.initialConnectionTimeout
          : this.options.reconnectionTimeout;

        this.log(`Setting connection timeout: ${timeoutDuration}ms (${isFirstConnection ? 'initial' : 'reconnection'})`);

        // For initial connection, show helpful message halfway through
        if (isFirstConnection) {
          setTimeout(() => {
            if (this.state.status === 'connecting') {
              console.log('[WebSocket] Still connecting... Server may be starting up. Please wait.');
              this.emit('connecting_slow', {
                message: 'Server may be starting up',
                elapsed: timeoutDuration / 2
              });
            }
          }, timeoutDuration / 2);
        }

        // Set timeout for connection
        setTimeout(() => {
          this.off('connected', onConnect);
          this.off('error', onError);

          if (this.state.status !== 'connected') {
            const error = new Error(`Connection timeout after ${timeoutDuration}ms`);

            // Close the underlying WebSocket to trigger onClose → scheduleReconnect
            // This ensures auto-reconnect starts immediately instead of leaving a hanging connection
            if (this.state.ws) {
              try {
                this.state.ws.close(1000, 'Connection timeout');
              } catch (e) {
                this.log('Error closing WebSocket on timeout:', e);
              }
            }

            this.emit('error', error);
            reject(error);
          }
        }, timeoutDuration);
      });
    } catch (error) {
      this.log('Error creating WebSocket:', error);
      this.state.status = 'error';
      this.emit('error', error);
      
      // Schedule reconnect
      this.scheduleReconnect();
      
      return Promise.reject(error);
    }
  }
  
  /**
   * Disconnect from WebSocket server
   * @param {number} [code=1000] - Close code
   * @param {string} [reason=''] - Close reason
   */
  disconnect(code = 1000, reason = '') {
    this.log(`Disconnecting WebSocket (${code}: ${reason})`);
    
    // Set force close flag to prevent auto-reconnect
    this.state.forceClose = true;
    
    // Clear timers
    this.clearTimers();
    
    // Clear message queue
    this.state.messageQueue = [];
    
    // Reject all pending messages
    for (const [id, { reject }] of this.state.pendingMessages) {
      reject(new Error('WebSocket disconnected'));
    }
    this.state.pendingMessages.clear();
    
    // Close WebSocket if it exists
    if (this.state.ws) {
      try {
        // Remove event listeners to prevent memory leaks
        this.state.ws.onopen = null;
        this.state.ws.onmessage = null;
        this.state.ws.onclose = null;
        this.state.ws.onerror = null;

        // Close the connection if still open
        if (this.state.ws.readyState === WebSocket.OPEN ||
            this.state.ws.readyState === WebSocket.CONNECTING) {
          this.state.ws.close(code, reason);
        }
      } catch (error) {
        this.log('Error closing WebSocket:', error);
      }

      this.state.ws = null;
    }

    // Update state
    this.state.status = 'disconnected';
    this.emit('disconnected', { code, reason });
  }
  
  /**
   * Send a message to the WebSocket server
   * @param {string|Object} message - Message to send
   * @param {Object} [options={}] - Send options
   * @returns {Promise<any>} - Promise that resolves with the response
   */
  send(message, options = {}) {
    const defaultOptions = {
      timeout: 30000,       // Timeout for response (ms)
      expectResponse: false, // Whether to expect a response
      responseId: null,     // Response ID (if expectResponse is true)
      retries: 3,           // Number of retries
      queueIfDisconnected: true, // Whether to queue if disconnected
      priority: 'normal'    // Priority for queue: 'high', 'normal', 'low'
    };
    
    const sendOptions = { ...defaultOptions, ...options };
    
    // Create a new message ID
    const messageId = ++this.state.lastMessageId;
    
    // Prepare message data
    let messageData;
    if (typeof message === 'string') {
      // If it's a simple string message, use as is
      messageData = message;
    } else {
      // For objects, add message ID and stringify
      messageData = JSON.stringify({
        id: messageId,
        ...message
      });
    }
    
    // If not connected, queue message or reject
    if (!this.isConnected) {
      if (sendOptions.queueIfDisconnected) {
        // Queue message for later
        this.log(`Queueing message (${messageId}): ${messageData.substring(0, 100)}${messageData.length > 100 ? '...' : ''}`);
        
        // If queue is full, remove oldest messages
        if (this.state.messageQueue.length >= this.options.maxQueueSize) {
          // Remove messages based on priority
          const removeIndex = this.state.messageQueue.findIndex(item => item.priority === 'low');
          if (removeIndex >= 0) {
            this.state.messageQueue.splice(removeIndex, 1);
          } else {
            // If no low priority messages, remove oldest
            this.state.messageQueue.shift();
          }
        }
        
        // Add to queue
        this.state.messageQueue.push({
          id: messageId,
          data: messageData,
          options: sendOptions,
          timestamp: Date.now()
        });
        
        // Try to connect if not already
        if (this.state.status === 'disconnected' && this.options.autoReconnect) {
          this.connect();
        }
        
        // Return a promise that resolves when the message is actually sent
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            // If message is still in queue after timeout, reject
            const queueIndex = this.state.messageQueue.findIndex(m => m.id === messageId);
            if (queueIndex >= 0) {
              this.state.messageQueue.splice(queueIndex, 1);
              reject(new Error(`Message ${messageId} timed out in queue`));
            }
          }, sendOptions.timeout);
          
          // Store promise handlers in pending messages
          this.state.pendingMessages.set(messageId, {
            resolve,
            reject,
            timeout: timeoutId,
            expectResponse: sendOptions.expectResponse,
            responseId: sendOptions.responseId,
            retries: sendOptions.retries
          });
        });
      } else {
        // Reject immediately if not queueing
        return Promise.reject(new Error('WebSocket not connected'));
      }
    }
    
    // Send message directly
    try {
      this.log(`Sending message (${messageId}): ${messageData.substring(0, 100)}${messageData.length > 100 ? '...' : ''}`);
      this.state.ws.send(messageData);
      
      // Update last activity
      this.state.lastActivity = Date.now();
      
      // If expecting response, return promise that resolves when response is received
      if (sendOptions.expectResponse) {
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            this.state.pendingMessages.delete(messageId);
            reject(new Error(`Message ${messageId} timed out waiting for response`));
          }, sendOptions.timeout);
          
          this.state.pendingMessages.set(messageId, {
            resolve,
            reject,
            timeout: timeoutId,
            expectResponse: true,
            responseId: sendOptions.responseId
          });
        });
      } else {
        // If not expecting response, resolve immediately
        return Promise.resolve();
      }
    } catch (error) {
      this.log('Error sending message:', error);
      
      // If should retry, queue message
      if (sendOptions.retries > 0) {
        sendOptions.retries--;
        return this.send(message, sendOptions);
      } else {
        return Promise.reject(error);
      }
    }
  }
  
  /**
   * Handle WebSocket open event
   * @param {Event} event - Open event
   * @private
   */
  onOpen(event) {
    this.log('WebSocket connected');

    // Update state
    this.state.status = 'connected';
    this.state.reconnectAttempts = 0;
    this.state.lastActivity = Date.now();
    const wasReconnect = this.state.hasConnectedBefore;
    this.state.hasConnectedBefore = true; // Mark that we've successfully connected

    // Start heartbeat
    this.startHeartbeat();

    // Process queued messages
    this.processQueue();

    // PHASE 1: Request state verification on reconnect
    if (wasReconnect) {
      this.log('[PHASE 1] Reconnected - requesting state verification');
      this.state.syncStatus = 'syncing';

      // Emit event for app to verify state
      this.emit('reconnected', {
        sequenceNumbers: Object.fromEntries(this.state.sequenceNumbers)
      });

      // Clear sync status after 5 seconds (assume synced if no issues)
      setTimeout(() => {
        if (this.state.syncStatus === 'syncing') {
          this.state.syncStatus = 'synced';
        }
      }, 5000);
    }

    // Emit event
    this.emit('connected', event);
  }
  
  /**
   * Handle WebSocket close event
   * @param {CloseEvent} event - Close event
   * @private
   */
  onClose(event) {
    this.log(`WebSocket closed: ${event.code} - ${event.reason}`);
    
    // Clear timers
    this.clearTimers();
    
    // Update state
    this.state.status = 'disconnected';
    this.state.ws = null;
    
    // Emit event
    this.emit('disconnected', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean
    });
    
    // Reconnect if not force closed and auto-reconnect enabled
    if (!this.state.forceClose && this.options.autoReconnect) {
      this.scheduleReconnect();
    }
  }
  
  /**
   * Handle WebSocket error event
   * @param {Event} event - Error event
   * @private
   */
  onError(event) {
    this.log('WebSocket error:', event);
    console.error('[WebSocket] Error occurred:', {
      type: event.type,
      target: event.target,
      readyState: this.state.ws?.readyState,
      url: this.state.ws?.url
    });

    // Emit event
    this.emit('error', event);

    // Set status to error
    this.state.status = 'error';
  }
  
  /**
   * Handle WebSocket message event
   * @param {MessageEvent} event - Message event
   * @private
   */

  onMessage(event) {
    // Update last activity
    this.state.lastActivity = Date.now();

    // Process message
    try {
      let message;

      // Try to parse as JSON
      try {
        message = JSON.parse(event.data);
      } catch (e) {
        // Not JSON, use raw data
        message = event.data;
      }

      this.log(`Received message: ${typeof message === 'string' ? message : JSON.stringify(message).substring(0, 100)}`);

      // PHASE 1: Send ACK for messages that require it
      if (typeof message === 'object' && message.requiresAck && message.id) {
        this.log(`[PHASE 1] Sending ACK for message ${message.id}`);
        this.send({
          type: 'ack',
          messageId: message.id
        }, { queueIfDisconnected: false });
      }

      // PHASE 1: Handle sequence numbers for appointment events
      if (typeof message === 'object' && message.sequenceNum !== undefined && message.date) {
        const lastSeq = this.state.sequenceNumbers.get(message.date) || 0;
        const receivedSeq = message.sequenceNum;

        this.log(`[PHASE 1] Sequence check - Date: ${message.date}, Last: ${lastSeq}, Received: ${receivedSeq}`);

        // Check for sequence gap
        if (receivedSeq > lastSeq + 1) {
          console.warn(`[PHASE 1] Sequence gap detected! Expected ${lastSeq + 1}, got ${receivedSeq}`);
          this.handleSequenceGap(message.date, lastSeq, receivedSeq);
        }

        // Update last sequence number
        this.state.sequenceNumbers.set(message.date, receivedSeq);
      }

      // PHASE 1: Handle full refresh request from server
      if (typeof message === 'object' && message.fullRefreshRequired) {
        console.warn(`[PHASE 1] Server requesting full refresh: ${message.reason || 'unknown'}`);
        this.emit('fullRefreshRequired', { date: message.date, reason: message.reason });
        return;
      }

      // Check if it's a heartbeat/ping response
      if (typeof message === 'object' && (
          message.type === WebSocketEvents.HEARTBEAT_PING ||
          message.type === WebSocketEvents.HEARTBEAT_PONG
        )) {
        // Handle ping/pong
        if (message.type === WebSocketEvents.HEARTBEAT_PING) {
          // Respond to ping with pong
          this.send({ type: WebSocketEvents.HEARTBEAT_PONG }, { queueIfDisconnected: false });
        } else if (message.type === WebSocketEvents.HEARTBEAT_PONG) {
          this.log('Received heartbeat pong response');

          // Clear the timeout timer since we got a response
          if (this.state.heartbeatTimeoutTimer) {
            clearTimeout(this.state.heartbeatTimeoutTimer);
            this.state.heartbeatTimeoutTimer = null;
          }

          // Schedule the next heartbeat ping
          this.scheduleNextHeartbeat();
        }

        return;
      }

      // Check if it's a response to a pending message
      if (typeof message === 'object' && message.id) {
        const pendingMessage = this.state.pendingMessages.get(message.id);

        if (pendingMessage) {
          // Clear timeout
          clearTimeout(pendingMessage.timeout);

          // Resolve promise
          pendingMessage.resolve(message);

          // Remove from pending messages
          this.state.pendingMessages.delete(message.id);

          // Also emit the message as an event
          this.emit('message', message);

          return;
        }
      }

      // Not a response to a pending message, emit as event
      // Specific events based on message type (for backward compatibility)
      if (typeof message === 'object' && message.messageType) {
        this.emit(message.messageType, message);
      }

      // Handle messages with 'type' field
      if (typeof message === 'object' && message.type) {
        this.log(`Emitting event for message type '${message.type}'`);

        // Debug logging - only logs when debug mode is enabled
        if (this.options.debug) {
          console.log(`📡 [WebSocket Service] Message received - Type: ${message.type}`);
          console.log(`📡 [WebSocket Service] Full message:`, JSON.stringify(message, null, 2));
          console.log(`📡 [WebSocket Service] Data payload:`, JSON.stringify(message.data || message, null, 2));
        }

        // Emit the universal event
        this.emit(message.type, message.data || message);

        if (this.options.debug) {
          console.log(`📡 [WebSocket Service] Event '${message.type}' emitted successfully`);
        }
      }

      // Always emit generic message event
      this.emit('message', message);
    } catch (error) {
      this.log('Error processing message:', error);
      this.emit('error', error);
    }
  }

  /**
   * Handle sequence gap - request missed events
   * PHASE 1 ENHANCEMENT
   * @param {string} date - Date for which events were missed
   * @param {number} lastSeq - Last sequence number we have
   * @param {number} receivedSeq - Sequence number we just received
   * @private
   */
  handleSequenceGap(date, lastSeq, receivedSeq) {
    // Avoid duplicate requests
    if (this.state.missedEventRequests.has(date)) {
      this.log(`[PHASE 1] Already requested missed events for ${date}, skipping`);
      return;
    }

    this.log(`[PHASE 1] Requesting missed events for ${date} (seq ${lastSeq + 1} to ${receivedSeq - 1})`);
    this.state.syncStatus = 'syncing';
    this.state.missedEventRequests.add(date);

    // Request missed events from server
    this.send({
      type: 'request_missed_events',
      date: date,
      lastSequenceNum: lastSeq
    }, { queueIfDisconnected: false });

    // Clear the request flag after 10 seconds to allow retry if needed
    setTimeout(() => {
      this.state.missedEventRequests.delete(date);
      this.state.syncStatus = 'synced';
    }, 10000);
  }
  
  setHeartbeatTimeout() {
    // Clear any existing timeout timer
    if (this.state.heartbeatTimeoutTimer) {
      clearTimeout(this.state.heartbeatTimeoutTimer);
    }
    
    this.log('Setting heartbeat timeout timer');
    
    // Set timer to detect missing pong
    this.state.heartbeatTimeoutTimer = setTimeout(() => {
      this.log('Heartbeat timeout - no pong received');
      
      // If still connected, force close and reconnect
      if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
        this.log('Forcing close due to heartbeat timeout');
        
        // Don't set force close flag, so it will reconnect
        this.state.ws.close(1000, 'Heartbeat timeout');
        this.state.ws = null;
        
        // Update state
        this.state.status = 'disconnected';
        
        // Schedule reconnect
        this.scheduleReconnect();
      }
    }, this.options.heartbeatTimeout);
  }

  scheduleNextHeartbeat(delay = null) {
    // Clear any existing heartbeat timer
    if (this.state.heartbeatTimer) {
      clearTimeout(this.state.heartbeatTimer);
    }
    
    const interval = delay || this.options.heartbeatInterval;
    this.log(`Scheduling next heartbeat in ${interval}ms`);
    
    // Schedule next heartbeat
    this.state.heartbeatTimer = setTimeout(() => {
      this.sendHeartbeat();
    }, interval);
  }
  
  


  /**
   * Process queued messages
   * @private
   */
  processQueue() {
    if (this.state.messageQueue.length === 0) return;
    
    this.log(`Processing message queue (${this.state.messageQueue.length} messages)`);
    
    // Sort queue by priority and timestamp
    this.state.messageQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      const aPriority = priorityOrder[a.options.priority] || 1;
      const bPriority = priorityOrder[b.options.priority] || 1;
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      } else {
        return a.timestamp - b.timestamp;
      }
    });
    
    // Process messages
    const queue = [...this.state.messageQueue];
    this.state.messageQueue = [];
    
    for (const message of queue) {
      try {
        // Send message
        this.state.ws.send(message.data);
        
        // Resolve pending promise
        const pendingMessage = this.state.pendingMessages.get(message.id);
        if (pendingMessage) {
          if (pendingMessage.expectResponse) {
            // If expecting response, keep in pending messages
            // but update timeout
            clearTimeout(pendingMessage.timeout);
            pendingMessage.timeout = setTimeout(() => {
              this.state.pendingMessages.delete(message.id);
              pendingMessage.reject(new Error(`Message ${message.id} timed out waiting for response`));
            }, message.options.timeout);
          } else {
            // If not expecting response, resolve immediately
            clearTimeout(pendingMessage.timeout);
            pendingMessage.resolve();
            this.state.pendingMessages.delete(message.id);
          }
        }
      } catch (error) {
        this.log(`Error sending queued message ${message.id}:`, error);
        
        // If should retry, requeue message
        if (message.options.retries > 0) {
          message.options.retries--;
          this.state.messageQueue.push(message);
        } else {
          // Otherwise reject promise
          const pendingMessage = this.state.pendingMessages.get(message.id);
          if (pendingMessage) {
            clearTimeout(pendingMessage.timeout);
            pendingMessage.reject(error);
            this.state.pendingMessages.delete(message.id);
          }
        }
      }
    }
  }
  
  /**
   * Schedule reconnect attempt
   * @private
   */
  scheduleReconnect() {
    // Don't reconnect if force closed
    if (this.state.forceClose) return;
    
    // Don't reconnect if max attempts reached
    if (this.options.maxReconnectAttempts !== null && 
        this.state.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.log('Maximum reconnect attempts reached');
      return;
    }
    
    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.options.reconnectInterval * Math.pow(this.options.reconnectDecay, this.state.reconnectAttempts),
      this.options.maxReconnectInterval
    );
    
    this.log(`Scheduling reconnect attempt ${this.state.reconnectAttempts + 1} in ${delay}ms`);
    
    // Clear any existing timer
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
    }
    
    // Set timer
    this.state.reconnectTimer = setTimeout(() => {
      this.state.reconnectAttempts++;
      // Reuse last connection params to preserve clientType and PDate
      this.connect(this.state.lastConnectionParams || {}).catch(() => {}); // Ignore errors
    }, delay);
  }
  
  /**
   * Start heartbeat
   * @private
   */

  startHeartbeat() {
    this.log('Starting heartbeat');
    
    // Clear any existing timers
    this.clearHeartbeatTimers();
    
    // Send first heartbeat immediately
    this.sendHeartbeat();
  }

  clearHeartbeatTimers() {
    // Clear heartbeat timer
    if (this.state.heartbeatTimer) {
      this.log('Clearing existing heartbeat timer');
      clearTimeout(this.state.heartbeatTimer);
      this.state.heartbeatTimer = null;
    }
    
    // Clear heartbeat timeout timer
    if (this.state.heartbeatTimeoutTimer) {
      this.log('Clearing existing heartbeat timeout timer');
      clearTimeout(this.state.heartbeatTimeoutTimer);
      this.state.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * Send heartbeat
   * @private
   */
  sendHeartbeat() {
    this.log('Sending heartbeat (ping)');
    
    // Send ping message
    this.send({ type: WebSocketEvents.HEARTBEAT_PING }, { queueIfDisconnected: false })
      .then(() => {
        this.log('Heartbeat (ping) sent successfully');
        
        // Set timeout timer for pong response
        this.setHeartbeatTimeout();
      })
      .catch(error => {
        this.log('Error sending heartbeat:', error);
        
        // Schedule next heartbeat on failure after a shorter interval
        this.scheduleNextHeartbeat(5000); // Retry sooner on failure
      });
  }
  
  /**
   * Reset heartbeat timeout
   * @private
   */
  resetHeartbeatTimeout() {
    this.log('Resetting heartbeat timeout timer');
    
    // Clear any existing timer
    if (this.state.heartbeatTimeoutTimer) {
      clearTimeout(this.state.heartbeatTimeoutTimer);
    }
    
    // Set timer
    this.state.heartbeatTimeoutTimer = setTimeout(() => {
      this.log('Heartbeat timeout');
      
      // If still connected, force close and reconnect
      if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
        this.log('Forcing close due to heartbeat timeout');
        
        // Don't set force close flag, so it will reconnect
        this.state.ws.close(1000, 'Heartbeat timeout');
        this.state.ws = null;
        
        // Update state
        this.state.status = 'disconnected';
        
        // Schedule reconnect
        this.scheduleReconnect();
      }
    }, this.options.heartbeatTimeout);
  }
  
  /**
   * Clear all timers
   * @private
   */
  clearTimers() {
    // Clear reconnect timer
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
      this.state.reconnectTimer = null;
    }
    
    // Clear heartbeat timer
    if (this.state.heartbeatTimer) {
      clearTimeout(this.state.heartbeatTimer);
      this.state.heartbeatTimer = null;
    }
    
    // Clear heartbeat timeout timer
    if (this.state.heartbeatTimeoutTimer) {
      clearTimeout(this.state.heartbeatTimeoutTimer);
      this.state.heartbeatTimeoutTimer = null;
    }
  }
  
  /**
   * Build connection URL with parameters
   * @param {Object} [params={}] - Additional URL parameters
   * @returns {string} - Connection URL
   * @private
   */
  buildConnectionUrl(params = {}) {
    // Start with base URL
    const url = new URL(this.options.baseUrl);
    
    // Add screen ID only if needed (not for WhatsApp status clients or daily appointments clients)
    // Only add screen ID for appointments page
    if (params.clientType === 'appointments') {
      // Load screen ID on demand
      if (!this.state.screenId) {
        this.state.screenId = storage.screenId() || 'unknown';
      }
      url.searchParams.append('screenID', this.state.screenId);
    }
    
    // Add date parameter - use provided PDate if available, otherwise default to today
    // This fixes date mismatch after midnight when viewing appointments for a different date
    let dateParam;
    if (params.PDate) {
      // Use provided date (important for reconnections and viewing past/future dates)
      dateParam = params.PDate;
    } else {
      // Default to today's date if not provided
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      dateParam = `${year}-${month}-${day}`;
    }
    url.searchParams.append('PDate', dateParam);

    // Add additional parameters (skip PDate since we already added it)
    for (const [key, value] of Object.entries(params)) {
      if (key !== 'PDate' && value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    }
    
    return url.toString();
  }
  
  /**
   * Log message if debug enabled
   * @param {string} message - Message to log
   * @param {*} [data] - Additional data to log
   * @private
   */
  log(message, data) {
    if (!this.options.debug) return;

    if (data !== undefined) {
      console.log(`[WebSocketService] ${message}`, data);
    } else {
      console.log(`[WebSocketService] ${message}`);
    }
  }

  /**
   * Get sync status for a specific date
   * PHASE 1 ENHANCEMENT
   * @param {string} date - Date to check sync status for
   * @returns {Object} - Sync status information
   */
  getSyncStatus(date = null) {
    if (date) {
      return {
        date,
        lastSequenceNum: this.state.sequenceNumbers.get(date) || 0,
        isSyncing: this.state.missedEventRequests.has(date),
        syncStatus: this.state.syncStatus
      };
    }

    // Return overall sync status
    return {
      syncStatus: this.state.syncStatus,
      pendingEventCount: this.state.pendingEventCount,
      trackedDates: Array.from(this.state.sequenceNumbers.keys()),
      sequenceNumbers: Object.fromEntries(this.state.sequenceNumbers)
    };
  }

  /**
   * Get last sequence number for a date
   * PHASE 1 ENHANCEMENT
   * @param {string} date - Date to get sequence number for
   * @returns {number} - Last sequence number
   */
  getLastSequenceNumber(date) {
    return this.state.sequenceNumbers.get(date) || 0;
  }

  /**
   * Reset sequence tracking for a date (useful for date changes)
   * PHASE 1 ENHANCEMENT
   * @param {string} date - Date to reset
   */
  resetSequenceTracking(date) {
    this.state.sequenceNumbers.delete(date);
    this.state.missedEventRequests.delete(date);
    this.log(`[PHASE 1] Reset sequence tracking for ${date}`);
  }
}

/**
 * Factory function to create a new WebSocket connection
 * Industry-standard pattern for dependency injection and testing
 * @param {Object} options - WebSocket configuration options
 * @returns {WebSocketService} - New WebSocket service instance
 */
export function createWebSocketConnection(options = {}) {
  return new WebSocketService({
    debug: true,
    autoConnect: false,
    ...options
  });
}

/**
 * Export the WebSocketService class for advanced usage and testing
 */
export { WebSocketService };

/**
 * Default export: Singleton instance for simple usage
 * Recommended for most use cases where a single shared connection is needed
 */
export default new WebSocketService({
  debug: true,
  autoConnect: false
});