// services/websocket.js
import EventEmitter from '../core/events.js';
import storage from '../core/storage.js';

export class WebSocketService extends EventEmitter {
  /**
   * Create a new WebSocket service
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    super();
    
    // Default options
    this.options = Object.assign({
      reconnectInterval: 50000,
      pingInterval: 30000,
      timeout: 1200000, // 20 minutes
      debug: false
    }, options);
    
    // Initialize properties
    this.ws = null;
    this.reconnecting = false;
    this.lastMessageTime = Date.now();
    this.screenId = storage.screenId(); // Use the storage utility
    this.currentDate = this.formatDate(new Date());
    this.pingIntervalId = null;
    this.timeoutCheckId = null;
    
    // Set up timeout checker
    this.setupTimeoutChecker();
  }
  
  /**
   * Get screen ID using the storage utility
   * @returns {string} - Screen ID
   * @private
   */
  getScreenId() {
    return storage.screenId();
  }
  
  /**
   * Format date to YYYY-MM-DD
   * @param {Date} date - Date to format
   * @returns {string} - Formatted date
   * @private
   */
  formatDate(date) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }
  
  /**
   * Set up timeout checker to detect day change or inactivity
   * @private
   */
  setupTimeoutChecker() {
    this.timeoutCheckId = setInterval(() => {
      const currentDate = new Date();
      const formattedDate = this.formatDate(currentDate);
      
      // Check if day has changed
      if (formattedDate !== this.currentDate) {
        this.log('Day changed, updating connection');
        this.currentDate = formattedDate;
        this.connect();
        return;
      }
      
      // Check for timeout (no messages received for longer than timeout)
      if (Date.now() > (this.lastMessageTime + this.options.timeout + 2000)) {
        this.log(`Connection timed out (${Date.now() - this.lastMessageTime}ms)`);
        this.connect();
      }
    }, this.options.timeout);
  }
  
  /**
   * Connect to WebSocket server
   * @returns {Promise<WebSocketService>} - This service instance for chaining
   */
  async connect() {
    this.log('Connecting to WebSocket server');
    
    // Close existing connection if any
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.log('Closing existing connection');
      this.ws.close();
    }
    
    try {
      this.ws = await this.createWebSocket();
      
      // Set up event listeners
      this.setupWebSocketListeners();
      
      // Send initial update message
      this.sendMessage('updateMessage');
      
      this.emit('connected');
      this.log('WebSocket connected and update message sent');
    } catch (error) {
      this.log('Failed to connect to WebSocket', error);
      this.emit('error', error);
    }
    
    return this;
  }
  
  /**
   * Create WebSocket connection
   * @returns {Promise<WebSocket>} - WebSocket instance
   * @private
   */
  createWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}?screenID=${this.screenId}&PDate=${this.currentDate}`;
    
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const connectTimeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 10000);
      
      const timer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          clearTimeout(connectTimeout);
          clearInterval(timer);
          resolve(ws);
        } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          clearTimeout(connectTimeout);
          clearInterval(timer);
          reject(new Error('WebSocket connection failed'));
        }
      }, 10);
    });
  }
  
  /**
   * Set up WebSocket event listeners
   * @private
   */
  setupWebSocketListeners() {
    if (!this.ws) return;
    
    // Handle incoming messages
    this.ws.addEventListener('message', (event) => {
      this.lastMessageTime = Date.now();
      
      try {
        const data = JSON.parse(event.data);
        this.log('WebSocket message received', data.messageType);
        
        // Emit specific event based on message type
        if (data.messageType) {
          this.emit(data.messageType, data);
        }
        
        // Also emit generic 'message' event
        this.emit('message', data);
      } catch (error) {
        this.log('Error parsing WebSocket message', error);
      }
    });
    
    // Handle connection close
    this.ws.addEventListener('close', () => {
      this.log('WebSocket connection closed, reconnecting...');
      this.emit('disconnected');
      
      // Set up reconnection timer
      this.scheduleReconnect();
    });
    
    // Handle connection errors
    this.ws.addEventListener('error', (error) => {
      this.log('WebSocket error', error);
      this.emit('error', error);
    });
    
    // Set up ping interval to keep connection alive
    this.setupPingInterval();
  }
  
  /**
   * Set up ping interval to keep connection alive
   * @private
   */
  setupPingInterval() {
    // Clear existing interval if any
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
    }
    
    // Set up new interval
    this.pingIntervalId = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.log('Sending ping to keep connection alive');
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.options.pingInterval);
  }
  
  /**
   * Schedule reconnection after disconnect
   * @private
   */
  scheduleReconnect() {
    if (this.reconnecting) return;
    
    this.reconnecting = true;
    
    setTimeout(() => {
      this.log('Attempting to reconnect WebSocket');
      this.reconnecting = false;
      
      // Only reconnect if socket is closed
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connect();
      }
    }, this.options.reconnectInterval);
  }
  
  /**
   * Send a message to the WebSocket server
   * @param {string|Object} message - Message to send
   * @returns {boolean} - Success status
   */
  sendMessage(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('Cannot send message, WebSocket not open');
      return false;
    }
    
    try {
      // Convert object to string if needed
      const messageString = typeof message === 'object' 
        ? JSON.stringify(message) 
        : message;
      
      this.ws.send(messageString);
      return true;
    } catch (error) {
      this.log('Error sending WebSocket message', error);
      return false;
    }
  }
  
  /**
   * Log a message if debug is enabled
   * @param {string} message - Message to log
   * @param {*} data - Optional data to log
   * @private
   */
  log(message, data) {
    if (this.options.debug) {
      if (data) {
        console.log(`[WebSocketService] ${message}:`, data);
      } else {
        console.log(`[WebSocketService] ${message}`);
      }
    }
  }
  
  /**
   * Disconnect WebSocket and clean up
   */
  disconnect() {
    this.log('Disconnecting WebSocket');
    
    // Clear intervals
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
    
    if (this.timeoutCheckId) {
      clearInterval(this.timeoutCheckId);
      this.timeoutCheckId = null;
    }
    
    // Close connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    // Reset state
    this.reconnecting = false;
  }
}

// Export singleton instance
export default new WebSocketService();