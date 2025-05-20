// utils/websocket.js
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import * as database from '../services/database/queries/index.js';

/**
 * WebSocket Connection Manager
 * Manages different types of WebSocket connections
 */
class ConnectionManager {
  constructor() {
    // Map to store screen ID to WebSocket connections
    this.screenConnections = new Map();
    
    // Set to store WhatsApp status connections
    this.waStatusConnections = new Set();
    
    // Set to store all active connections
    this.allConnections = new Set();
    
    // Keep track of client capabilities
    this.clientCapabilities = new WeakMap();
  }
  
  /**
   * Register a new connection
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} type - Connection type ('screen', 'waStatus', etc.)
   * @param {Object} metadata - Connection metadata
   */
  registerConnection(ws, type, metadata = {}) {
    // Add to all connections
    this.allConnections.add(ws);
    
    // Store client capabilities
    this.clientCapabilities.set(ws, {
      type,
      metadata,
      supportsJson: true,     // Assume JSON support by default
      supportsPing: true,     // Assume ping support by default
      lastActivity: Date.now()
    });
    
    // Add to specific collection based on type
    if (type === 'screen' && metadata.screenId) {
      this.screenConnections.set(metadata.screenId, ws);
      console.log(`Registered screen connection: ${metadata.screenId}`);
    } else if (type === 'waStatus') {
      this.waStatusConnections.add(ws);
      console.log('Registered WhatsApp status connection');
    }
  }
  
  /**
   * Unregister a connection
   * @param {WebSocket} ws - WebSocket connection
   */
  unregisterConnection(ws) {
    // Remove from all connections
    this.allConnections.delete(ws);
    
    // Get client capabilities
    const capabilities = this.clientCapabilities.get(ws);
    if (!capabilities) return;
    
    // Remove from specific collection based on type
    if (capabilities.type === 'screen' && capabilities.metadata.screenId) {
      this.screenConnections.delete(capabilities.metadata.screenId);
      console.log(`Unregistered screen connection: ${capabilities.metadata.screenId}`);
    } else if (capabilities.type === 'waStatus') {
      this.waStatusConnections.delete(ws);
      console.log('Unregistered WhatsApp status connection');
    }
    
    // Remove capabilities
    this.clientCapabilities.delete(ws);
  }
  
  /**
   * Send message to a specific screen
   * @param {string} screenId - Screen ID
   * @param {Object|string} message - Message to send
   * @returns {boolean} - Whether message was sent
   */
  sendToScreen(screenId, message) {
    const ws = this.screenConnections.get(screenId);
    if (!ws || ws.readyState !== ws.OPEN) return false;
    
    try {
      this.sendToClient(ws, message);
      return true;
    } catch (error) {
      console.error(`Error sending to screen ${screenId}:`, error);
      return false;
    }
  }
  
  /**
   * Broadcast message to all WhatsApp status connections
   * @param {Object|string} message - Message to send
   * @param {Function} [filter] - Filter function to determine which clients to send to
   * @returns {number} - Number of clients message was sent to
   */
  broadcastToWaStatus(message, filter = null) {
    let sentCount = 0;
    
    for (const ws of this.waStatusConnections) {
      if (ws.readyState !== ws.OPEN) continue;
      
      // Apply filter if provided
      if (filter && !filter(ws, this.clientCapabilities.get(ws))) continue;
      
      try {
        this.sendToClient(ws, message);
        sentCount++;
      } catch (error) {
        console.error('Error sending to WhatsApp status client:', error);
      }
    }
    
    return sentCount;
  }
  
  /**
   * Broadcast message to all screen connections
   * @param {Object|string} message - Message to send
   * @param {Function} [filter] - Filter function to determine which clients to send to
   * @returns {number} - Number of clients message was sent to
   */
  broadcastToScreens(message, filter = null) {
    let sentCount = 0;
    
    for (const [screenId, ws] of this.screenConnections.entries()) {
      if (ws.readyState !== ws.OPEN) continue;
      
      // Apply filter if provided
      const capabilities = this.clientCapabilities.get(ws);
      if (filter && !filter(ws, capabilities)) continue;
      
      try {
        this.sendToClient(ws, message);
        sentCount++;
      } catch (error) {
        console.error(`Error sending to screen ${screenId}:`, error);
      }
    }
    
    return sentCount;
  }
  
  /**
   * Broadcast message to all connections
   * @param {Object|string} message - Message to send
   * @param {Function} [filter] - Filter function to determine which clients to send to
   * @returns {number} - Number of clients message was sent to
   */
  broadcastToAll(message, filter = null) {
    let sentCount = 0;
    
    for (const ws of this.allConnections) {
      if (ws.readyState !== ws.OPEN) continue;
      
      // Apply filter if provided
      const capabilities = this.clientCapabilities.get(ws);
      if (filter && !filter(ws, capabilities)) continue;
      
      try {
        this.sendToClient(ws, message);
        sentCount++;
      } catch (error) {
        console.error('Error broadcasting to client:', error);
      }
    }
    
    return sentCount;
  }
  
  /**
   * Send message to a specific client
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object|string} message - Message to send
   */
  sendToClient(ws, message) {
    // Get client capabilities
    const capabilities = this.clientCapabilities.get(ws) || {
      supportsJson: true
    };
    
    // Format message based on capabilities
    let formattedMessage;
    
    if (typeof message === 'string') {
      formattedMessage = message;
    } else if (capabilities.supportsJson) {
      formattedMessage = JSON.stringify(message);
    } else {
      // Convert to simple string if JSON not supported
      formattedMessage = typeof message.toString === 'function' 
        ? message.toString() 
        : String(message);
    }
    
    // Send message
    ws.send(formattedMessage);
    
    // Update last activity
    if (capabilities) {
      capabilities.lastActivity = Date.now();
    }
  }
  
  /**
   * Update client capabilities
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} capabilities - Capabilities to update
   */
  updateClientCapabilities(ws, capabilities) {
    const existing = this.clientCapabilities.get(ws) || {};
    this.clientCapabilities.set(ws, {
      ...existing,
      ...capabilities,
      lastActivity: Date.now()
    });
  }
  
  /**
   * Get all inactive connections
   * @param {number} timeout - Inactivity timeout in ms
   * @returns {Array} - Inactive connections
   */
  getInactiveConnections(timeout) {
    const now = Date.now();
    const inactive = [];
    
    for (const ws of this.allConnections) {
      const capabilities = this.clientCapabilities.get(ws);
      if (!capabilities) continue;
      
      const inactiveTime = now - capabilities.lastActivity;
      if (inactiveTime > timeout) {
        inactive.push(ws);
      }
    }
    
    return inactive;
  }
  
  /**
   * Close inactive connections
   * @param {number} timeout - Inactivity timeout in ms
   * @returns {number} - Number of connections closed
   */
  closeInactiveConnections(timeout) {
    const inactive = this.getInactiveConnections(timeout);
    
    for (const ws of inactive) {
      try {
        ws.close(1000, 'Inactivity timeout');
        this.unregisterConnection(ws);
      } catch (error) {
        console.error('Error closing inactive connection:', error);
      }
    }
    
    return inactive.length;
  }
  
  /**
   * Get counts of active connections
   * @returns {Object} - Connection counts
   */
  getConnectionCounts() {
    return {
      total: this.allConnections.size,
      screens: this.screenConnections.size,
      waStatus: this.waStatusConnections.size
    };
  }
}

/**
 * Setup WebSocket server and event handling
 * @param {Object} server - HTTP server instance
 * @returns {EventEmitter} - Event emitter for WebSocket events
 */
function setupWebSocketServer(server) {
  // Create event emitter for communication
  const wsEmitter = new EventEmitter();
  
  // Create connection manager
  const connectionManager = new ConnectionManager();
  
  // Create WebSocket server
  const wss = new WebSocketServer({ server });
  
  // Set up global event handlers
  setupGlobalEventHandlers(wsEmitter, connectionManager);
  
  // Set up cleanup interval
  setupPeriodicCleanup(connectionManager);
  
  // Handle new connections
  wss.on('connection', (ws, req) => {
    console.log('Client connected to WebSocket');
    
    try {
      // Parse query parameters
      const url = new URL(req.url, 'http://localhost');
      const screenID = url.searchParams.get('screenID');
      const date = url.searchParams.get('PDate');
      const clientType = url.searchParams.get('clientType');
      
      console.log(`New connection: screenID=${screenID}, date=${date}, clientType=${clientType}`);
      
      // Register connection based on type
      if (clientType === 'waStatus') {
        // WhatsApp status client
        connectionManager.registerConnection(ws, 'waStatus', {
          date: date,
          ipAddress: req.socket.remoteAddress
        });
        
        // Store date for filtering updates
        ws.waDate = date;
        ws.isWaClient = true;
        
        console.log('WhatsApp status client connected');
      } else if (screenID) {
        // Regular appointment screen
        connectionManager.registerConnection(ws, 'screen', {
          screenId: screenID,
          date: date,
          ipAddress: req.socket.remoteAddress
        });
        
        console.log(`Screen ${screenID} connected`);
        
        // Send initial data immediately
        sendInitialData(ws, date);
      } else {
        // Generic connection
        connectionManager.registerConnection(ws, 'generic', {
          ipAddress: req.socket.remoteAddress
        });
        
        console.log('Generic client connected');
      }
      
      // Handle messages from clients
      ws.on('message', async (message) => {
        try {
          // Update last activity
          const capabilities = connectionManager.clientCapabilities.get(ws);
          if (capabilities) {
            capabilities.lastActivity = Date.now();
          }
          
          // Parse message
          let parsedMessage;
          const messageStr = message.toString();
          
          try {
            parsedMessage = JSON.parse(messageStr);
          } catch (e) {
            // Not JSON, use raw message
            parsedMessage = messageStr;
          }
          
          console.log(`Received message: ${typeof parsedMessage === 'string' ? parsedMessage : JSON.stringify(parsedMessage).substring(0, 100)}`);
          
          // Handle message based on type
          if (typeof parsedMessage === 'object' && parsedMessage.type) {
            handleTypedMessage(ws, parsedMessage, date, connectionManager);
          } else if (messageStr === 'updateMessage' && date) {
            // Legacy support for 'updateMessage' string command
            console.log(`Processing updateMessage request for date: ${date}`);
            await sendAppointmentsData(ws, date);
          } else if (messageStr === 'ping') {
            // Legacy support for 'ping' string command
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'pong' }));
            }
          } else {
            // Unrecognized message
            console.log('Unrecognized message format, ignoring');
          }
        } catch (msgError) {
          console.error('Error processing message:', msgError);
        }
      });
      
      // Handle close
      ws.on('close', (code, reason) => {
        connectionManager.unregisterConnection(ws);
        console.log(`Client disconnected. Code: ${code}, Reason: ${reason || 'unknown'}`);
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        connectionManager.unregisterConnection(ws);
      });
    } catch (error) {
      console.error('Error setting up WebSocket connection:', error);
    }
  });
  
  /**
   * Handle typed messages (with a 'type' property)
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Parsed message
   * @param {string} date - Date parameter
   * @param {ConnectionManager} connectionManager - Connection manager
   */
  async function handleTypedMessage(ws, message, date, connectionManager) {
    switch (message.type) {
      case 'ping':
        // Respond to ping with pong
        connectionManager.sendToClient(ws, { type: 'pong' });
        break;
        
      case 'pong':
        // Update client capabilities with ping support
        connectionManager.updateClientCapabilities(ws, {
          supportsPing: true
        });
        break;
        
      case 'getAppointments':
        // Get appointments data for a specific date
        const requestDate = message.date || date;
        if (requestDate) {
          await sendAppointmentsData(ws, requestDate);
        }
        break;
        
      case 'getPatient':
        // Get patient data
        if (message.patientId) {
          await sendPatientData(ws, message.patientId);
        }
        break;
        
      case 'capabilities':
        // Update client capabilities
        connectionManager.updateClientCapabilities(ws, message.capabilities || {});
        break;
        
      default:
        console.log(`Unknown message type: ${message.type}`);
    }
  }
  
  /**
   * Send initial data to a client
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} date - Date parameter
   */
  async function sendInitialData(ws, date) {
    if (!date || ws.readyState !== ws.OPEN) return;
    
    console.log(`Sending initial data for date: ${date}`);
    
    try {
      await sendAppointmentsData(ws, date);
    } catch (error) {
      console.error('Error sending initial data:', error);
    }
  }
  
  /**
   * Send appointments data to a WebSocket
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} date - Date to get appointments for
   */
  async function sendAppointmentsData(ws, date) {
    if (!date || ws.readyState !== ws.OPEN) return;
    
    console.log(`Fetching appointments data for date: ${date}`);
    
    try {
      const result = await database.getPresentAps(date);
      console.log(`Got appointments data for date ${date}: ${result.appointments ? result.appointments.length : 0} appointments`);
      
      connectionManager.sendToClient(ws, {
        messageType: 'updated',
        tableData: result
      });
      
      console.log(`Sent appointments data to client for date: ${date}`);
    } catch (error) {
      console.error(`Error fetching appointment data for date ${date}:`, error);
    }
  }
  
  /**
   * Send patient data to a WebSocket
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} patientId - Patient ID
   */
  async function sendPatientData(ws, patientId) {
    if (!patientId || ws.readyState !== ws.OPEN) return;
    
    console.log(`Fetching patient data for patient ID: ${patientId}`);
    
    try {
      // Get patient images
      const images = await getPatientImages(patientId);
      
      // Get latest visit
      const latestVisit = await database.getLatestVisitsSum(patientId);
      
      // Send response
      connectionManager.sendToClient(ws, {
        messageType: 'patientLoaded',
        pid: patientId,
        images,
        latestVisit
      });
      
      console.log(`Sent patient data for ${patientId}`);
    } catch (error) {
      console.error(`Error sending patient data for ${patientId}:`, error);
    }
  }
  
  /**
   * Get patient images
   * @param {string} pid - Patient ID
   * @returns {Promise<Array>} - Patient images
   */
  async function getPatientImages(pid) {
    try {
      const tp = "0"; // Default timepoint
      const images = await database.getTimePointImgs(pid, tp);
      
      // Transform image names to proper format
      return images.map(code => {
        const name = `${pid}0${tp}.i${code}`;
        return { name };
      });
    } catch (error) {
      console.error('Error getting patient images:', error);
      return [];
    }
  }
  
  // Return the WebSocket emitter
  return wsEmitter;
}

/**
 * Set up global event handlers
 * @param {EventEmitter} emitter - WebSocket event emitter
 * @param {ConnectionManager} connectionManager - Connection manager
 */
function setupGlobalEventHandlers(emitter, connectionManager) {
  // Handle appointment updates
  emitter.on('updated', async (dateParam) => {
    console.log(`Received 'updated' event for date: ${dateParam}`);
    
    // Get appointment data once to reuse for all connections
    let appointmentData;
    try {
      appointmentData = await database.getPresentAps(dateParam);
      console.log(`Fetched appointment data for date ${dateParam}: ${appointmentData.appointments ? appointmentData.appointments.length : 0} appointments`);
    } catch (error) {
      console.error(`Error fetching appointment data for date ${dateParam}:`, error);
      return; // Exit if we can't get data
    }
    
    // Prepare message
    const message = {
      messageType: 'updated',
      tableData: appointmentData
    };
    
    // Broadcast to all screen connections
    const updateCount = connectionManager.broadcastToScreens(message);
    console.log(`Broadcast appointment updates to ${updateCount} screens`);
  });
  
  // Handle patient loaded event
  emitter.on('patientLoaded', async (pid, targetScreenID) => {
    console.log(`Received 'patientLoaded' event for patient ${pid}, screen ${targetScreenID}`);
    
    // Send to specific screen
    const success = connectionManager.sendToScreen(targetScreenID, {
      messageType: 'patientLoaded',
      pid,
      images: await getPatientImages(pid),
      latestVisit: await database.getLatestVisitsSum(pid)
    });
    
    if (success) {
      console.log(`Sent patient data for ${pid} to screen ${targetScreenID}`);
    } else {
      console.log(`Failed to send patient data - screen ${targetScreenID} not found or not ready`);
    }
  });
  
  // Handle patient unloaded event
  emitter.on('patientUnLoaded', (targetScreenID) => {
    console.log(`Received 'patientUnLoaded' event for screen ${targetScreenID}`);
    
    // Send to specific screen
    const success = connectionManager.sendToScreen(targetScreenID, {
      messageType: 'patientunLoaded'
    });
    
    if (success) {
      console.log(`Sent patientunLoaded to screen ${targetScreenID}`);
    } else {
      console.log(`Failed to send patientunLoaded - screen ${targetScreenID} not found or not ready`);
    }
  });
  
  // Handle WhatsApp message updates
  emitter.on('wa_message_update', (messageId, status, date) => {
    console.log(`Received 'wa_message_update' event: messageId=${messageId}, status=${status}, date=${date}`);
    
    // Prepare message
    const updateData = {
      messageType: 'messageAckUpdated',
      messageId,
      status,
      date
    };
    
    // Create filter function for date matching
    const dateFilter = (ws, capabilities) => {
      // If no date specified, send to all
      if (!date) return true;
      
      // Check if client has a matching date
      return capabilities && 
             capabilities.metadata && 
             capabilities.metadata.date === date;
    };
    
    // Broadcast to WhatsApp status clients
    const updateCount = connectionManager.broadcastToWaStatus(updateData, dateFilter);
    console.log(`Broadcast WhatsApp message update to ${updateCount} clients`);
  });
  
  /**
   * Get patient images helper function
   * @param {string} pid - Patient ID
   * @returns {Promise<Array>} - Patient images
   */
  async function getPatientImages(pid) {
    try {
      const tp = "0"; // Default timepoint
      const images = await database.getTimePointImgs(pid, tp);
      
      // Transform image names to proper format
      return images.map(code => {
        const name = `${pid}0${tp}.i${code}`;
        return { name };
      });
    } catch (error) {
      console.error('Error getting patient images:', error);
      return [];
    }
  }
}

/**
 * Set up periodic cleanup
 * @param {ConnectionManager} connectionManager - Connection manager
 */
function setupPeriodicCleanup(connectionManager) {
  // Close inactive connections every 10 minutes
  const inactivityTimeout = 30 * 60 * 1000; // 30 minutes
  
  setInterval(() => {
    const closed = connectionManager.closeInactiveConnections(inactivityTimeout);
    if (closed > 0) {
      console.log(`Closed ${closed} inactive connections`);
    }
    
    // Log active connection counts
    const counts = connectionManager.getConnectionCounts();
    console.log(`Active connections: ${counts.total} total, ${counts.screens} screens, ${counts.waStatus} WhatsApp status`);
  }, 10 * 60 * 1000); // Every 10 minutes
}

/**
 * Set up periodic updates to all clients
 * @param {EventEmitter} emitter - WebSocket event emitter
 */
function setupPeriodicUpdate(emitter) {
  // Check for updates every minute
  const updateInterval = 60000; // 1 minute
  
  setInterval(() => {
    // Get current date in YYYY-MM-DD format
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    
    // Emit update event for today's date
    console.log(`Triggering periodic update for date: ${today}`);
    emitter.emit('updated', today);
  }, updateInterval);
  
  console.log(`Set up periodic updates every ${updateInterval / 1000} seconds`);
}

export { setupWebSocketServer };