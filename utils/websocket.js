// utils/websocket.js
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import * as database from '../services/database/queries/index.js';
import { getPresentAps } from '../services/database/queries/appointment-queries.js';
import messageState from '../services/state/messageState.js';
import { getTimePointImgs } from '../services/database/queries/timepoint-queries.js';
import { getLatestVisitsSum } from '../services/database/queries/visit-queries.js';
import { createWebSocketMessage, validateWebSocketMessage, MessageSchemas } from '../services/messaging/schemas.js';
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
   // Add this at the beginning
   ws.qrViewerRegistered = false;
    try {
      // Parse query parameters
      const url = new URL(req.url, 'http://localhost');
      const screenID = url.searchParams.get('screenID');
      const date = url.searchParams.get('PDate');
      const clientType = url.searchParams.get('clientType');
      // Create a unique ID for this connection
      const clientIP = req.socket.remoteAddress;
      const viewerId = `${clientIP}-${clientType}-${date || 'unknown'}-${Date.now()}`;
      
      // Store viewer ID on the connection object
      ws.viewerId = viewerId;
      ws.qrViewerRegistered = false;
      console.log(`New connection: screenID=${screenID}, date=${date}, clientType=${clientType}`);
  
      // Register connection based on type
      if (clientType === 'waStatus') {
        console.log('WhatsApp status client connected');
        // WhatsApp status client
        connectionManager.registerConnection(ws, 'waStatus', {
          date: date,
          ipAddress: req.socket.remoteAddress,
          viewerId: viewerId
        });
        
       // Register as QR viewer ONLY if explicitly requested via 'needsQR' parameter
       const needsQR = url.searchParams.get('needsQR') === 'true';
       if (needsQR && messageState && typeof messageState.registerQRViewer === 'function') {
        const registered = messageState.registerQRViewer(viewerId);
        ws.qrViewerRegistered = true; // Mark as registered
        console.log(`QR viewer registered for ${viewerId} (needsQR=true)`);
        } else {
          console.log(`WebSocket connected for status only (needsQR=${needsQR})`);
        }
        
        // Store date for filtering updates
        ws.waDate = date;
        ws.isWaClient = true;
      } else if (screenID) {
        // Regular appointment screen
        connectionManager.registerConnection(ws, 'screen', {
          screenId: screenID,
          date: date,
          ipAddress: req.socket.remoteAddress
        });
  
        console.log(`Screen ${screenID} connected`);
  
        // Send initial data immediately
        sendInitialData(ws, date, connectionManager);
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
  
      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        
        // If this was a WhatsApp status client AND was registered as QR viewer, unregister it
        const capabilities = connectionManager.clientCapabilities.get(ws);
        if (capabilities && capabilities.type === 'waStatus' && ws.qrViewerRegistered) {
          if (messageState && typeof messageState.unregisterQRViewer === 'function') {
            messageState.unregisterQRViewer(ws.viewerId);
          }
        }
        
        connectionManager.unregisterConnection(ws);
      });
  
   // Handle close event
   ws.on('close', (code, reason) => {
    // If this was a WhatsApp status client AND was registered as QR viewer, unregister it
    const capabilities = connectionManager.clientCapabilities.get(ws);
    if (capabilities && capabilities.type === 'waStatus' && ws.qrViewerRegistered) {
      if (messageState && typeof messageState.unregisterQRViewer === 'function') {
        messageState.unregisterQRViewer(ws.viewerId);
        console.log(`Unregistered QR viewer ${ws.viewerId} on connection close`);
      }
    }
    
    // Then unregister the connection
    connectionManager.unregisterConnection(ws);
    console.log(`Client disconnected. Code: ${code}, Reason: ${reason || 'unknown'}`);
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
  // ===== FIXED: More flexible validation for ping/pong messages =====
  // Simple validation that allows ping/pong without data field
  if (!message || typeof message !== 'object' || !message.type) {
    console.error('Invalid message format: missing type');
    const errorMessage = createWebSocketMessage(
      MessageSchemas.WebSocketMessage.ERROR,
      { error: 'Invalid message format: missing type' }
    );
    connectionManager.sendToClient(ws, errorMessage);
    return;
  }

  // Handle different message types
  switch (message.type) {
    case 'ping':
      // ===== FIXED: Simple pong response =====
      const pongMessage = {
        type: 'pong',
        timestamp: Date.now(),
        originalId: message.id
      };
      connectionManager.sendToClient(ws, pongMessage);
      break;

    case 'pong':
      connectionManager.updateClientCapabilities(ws, {
        supportsPing: true,
        lastPong: Date.now()
      });
      break;


    case 'getAppointments':
      const requestDate = message.data?.date || date;
      if (requestDate) {
        await sendAppointmentsData(ws, requestDate, connectionManager);
      }
      break;

    case 'getPatient':
      if (message.data?.patientId) {
        await sendPatientData(ws, message.data.patientId, connectionManager);
      }
      break;

    case 'capabilities':
      connectionManager.updateClientCapabilities(ws, message.data?.capabilities || {});
      break;

    case 'request_initial_state':
      console.log('Received request for initial state via WebSocket');
      await sendInitialStateForWaClient(ws, message.data, connectionManager);
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
  async function sendInitialData(ws, date, connectionManager) {
    if (!date || ws.readyState !== ws.OPEN) return;

    console.log(`Sending initial data for date: ${date}`);

    try {
      await sendAppointmentsData(ws, date, connectionManager);
    } catch (error) {
      console.error('Error sending initial data:', error);
    }
  }

  /**
   * Send initial state for WhatsApp status clients
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} requestData - Request data from client
   * @param {ConnectionManager} connectionManager - Connection manager
   */
  async function sendInitialStateForWaClient(ws, requestData, connectionManager) {
    if (ws.readyState !== ws.OPEN) return;

    console.log('Sending initial state for WhatsApp client via WebSocket');

    try {
      // Get state from messageState and whatsapp service
      const stateDump = messageState.dump();
      
      // Try to get whatsapp status - handle case where service might not be ready
      let clientStatus;
      try {
        const whatsappService = await import('../services/messaging/whatsapp.js');
        clientStatus = whatsappService.default.getStatus();
      } catch (error) {
        console.warn('Could not get WhatsApp status:', error.message);
        clientStatus = { active: false };
      }
      
      let html = '';
      const isClientReady = stateDump.clientReady || clientStatus.active;
      const finished = stateDump.finishedSending;
      
      if (isClientReady) {
        if (finished) {
          html = `<p>${stateDump.sentMessages} Messages Sent!</p><p>${stateDump.failedMessages} Messages Failed!</p><p>Finished</p>`;
        } else {
          html = `<p>${stateDump.sentMessages} Messages Sent!</p><p>${stateDump.failedMessages} Messages Failed!</p><p>Sending...</p>`;
        }
      } else if (messageState.qr && messageState.activeQRViewers > 0) {
        html = '<p>QR code ready - Please scan with WhatsApp</p>';
      } else {
        html = '<p>Initializing the client...</p>';
      }
      
      // Create response similar to /api/update endpoint
      const responseData = {
        success: true,
        htmltext: html,
        finished,
        clientReady: isClientReady,
        clientStatus: clientStatus,
        persons: messageState.persons || [],
        qr: isClientReady ? null : messageState.qr,
        stats: stateDump,
        sentMessages: stateDump.sentMessages || 0,
        failedMessages: stateDump.failedMessages || 0,
        timestamp: Date.now()
      };

      const message = createWebSocketMessage(
        'initial_state_response',
        responseData
      );

      connectionManager.sendToClient(ws, message);
      console.log('Sent initial state response via WebSocket');
      
    } catch (error) {
      console.error('Error sending initial state for WhatsApp client:', error);
      
      const errorMessage = createWebSocketMessage(
        MessageSchemas.WebSocketMessage.ERROR,
        { error: 'Failed to fetch initial state' }
      );
      connectionManager.sendToClient(ws, errorMessage);
    }
  }

  /**
   * Send appointments data to a WebSocket
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} date - Date to get appointments for
   */
  async function sendAppointmentsData(ws, date, connectionManager) {
    if (!date || ws.readyState !== ws.OPEN) return;
  
    console.log(`Fetching appointments data for date: ${date}`);
  
    try {
      const result = await getPresentAps(date);
      console.log(`Got appointments data for date ${date}: ${result.appointments ? result.appointments.length : 0} appointments`);
  
      const message = createWebSocketMessage(
        'appointment_data',
        { tableData: result },
        { date }
      );
  
      connectionManager.sendToClient(ws, message);
      console.log(`Sent appointments data to client for date: ${date}`);
    } catch (error) {
      console.error(`Error fetching appointment data for date ${date}:`, error);
      
      const errorMessage = createWebSocketMessage(
        MessageSchemas.WebSocketMessage.ERROR,
        { error: `Failed to fetch appointments for ${date}` }
      );
      connectionManager.sendToClient(ws, errorMessage);
    }
  }

  /**
   * Send patient data to a WebSocket
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} patientId - Patient ID
   */
  async function sendPatientData(ws, patientId, connectionManager) {
    if (!patientId || ws.readyState !== ws.OPEN) return;
  
    console.log(`Fetching patient data for patient ID: ${patientId}`);
  
    try {
      const images = await getPatientImages(patientId);
      const latestVisit = await getLatestVisitsSum(patientId);
  
      const message = createWebSocketMessage(
        'patient_data',
        {
          pid: patientId,
          images,
          latestVisit
        }
      );
  
      connectionManager.sendToClient(ws, message);
      console.log(`Sent patient data for ${patientId}`);
    } catch (error) {
      console.error(`Error sending patient data for ${patientId}:`, error);
      
      const errorMessage = createWebSocketMessage(
        MessageSchemas.WebSocketMessage.ERROR,
        { error: `Failed to fetch patient data for ${patientId}` }
      );
      connectionManager.sendToClient(ws, errorMessage);
    }
  
    // Helper function for patient images
    async function getPatientImages(pid) {
      try {
        const tp = "0";
        const images = await getTimePointImgs(pid, tp);
  
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
   * Get patient images
   * @param {string} pid - Patient ID
   * @returns {Promise<Array>} - Patient images
   */
  async function getPatientImages(pid) {
    try {
      const tp = "0"; // Default timepoint
      const images = await getTimePointImgs(pid, tp);

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

    try {
      const appointmentData = await getPresentAps(dateParam);
      console.log(`Fetched appointment data for date ${dateParam}: ${appointmentData.appointments ? appointmentData.appointments.length : 0} appointments`);

      const message = createWebSocketMessage(
        'appointment_update',
        { tableData: appointmentData },
        { date: dateParam }
      );

      const updateCount = connectionManager.broadcastToScreens(message);
      console.log(`Broadcast appointment updates to ${updateCount} screens`);
    } catch (error) {
      console.error(`Error fetching appointment data for date ${dateParam}:`, error);
    }
  });

  // Handle patient loaded event
  emitter.on('patientLoaded', async (pid, targetScreenID) => {
    console.log(`Received 'patientLoaded' event for patient ${pid}, screen ${targetScreenID}`);
    
    // Check if target screen is connected and ready
    const screenConnection = connectionManager.screenConnections.get(targetScreenID);
    if (!screenConnection || screenConnection.readyState !== screenConnection.OPEN) {
      console.log(`Screen ${targetScreenID} not connected - skipping patient data send`);
      return;
    }

    // Verify this is actually an appointments screen (not another type of connection)
    const capabilities = connectionManager.clientCapabilities.get(screenConnection);
    if (!capabilities || capabilities.type !== 'screen') {
      console.log(`Screen ${targetScreenID} is not an appointments screen - skipping patient data send`);
      return;
    }
    
    try {
      const allImages = await getPatientImages(pid);
      console.log("All images for patient " + pid + ":", allImages);
      
      const filteredImages = allImages.filter(img =>
        ['.i20', '.i22', '.i21'].some(ext => img.name.toLowerCase().endsWith(ext))
      );

      const sortOrder = ['.i20', '.i22', '.i21'];
      filteredImages.sort((a, b) => {
        const aExt = sortOrder.find(ext => a.name.toLowerCase().endsWith(ext)) || '';
        const bExt = sortOrder.find(ext => b.name.toLowerCase().endsWith(ext)) || '';
        return sortOrder.indexOf(aExt) - sortOrder.indexOf(bExt);
      });

      console.log("Filtered images for patient " + pid + ":", filteredImages);
      
      const latestVisit = await getLatestVisitsSum(pid);
      
      const message = createWebSocketMessage(
        'patient_loaded',
        {
          pid,
          images: filteredImages,
          latestVisit
        }
      );

      const success = connectionManager.sendToScreen(targetScreenID, message);

      if (success) {
        console.log(`Sent patient data for ${pid} to screen ${targetScreenID}`);
      } else {
        console.log(`Failed to send patient data - screen ${targetScreenID} not found or not ready`);
      }
    } catch (error) {
      console.error(`Error processing patient loaded event:`, error);
    }
  });

  // Handle patient unloaded event
  emitter.on('patientUnLoaded', (targetScreenID) => {
    console.log(`Received 'patientUnLoaded' event for screen ${targetScreenID}`);

    // Check if target screen is connected and ready
    const screenConnection = connectionManager.screenConnections.get(targetScreenID);
    if (!screenConnection || screenConnection.readyState !== screenConnection.OPEN) {
      console.log(`Screen ${targetScreenID} not connected - skipping patient unload send`);
      return;
    }

    // Verify this is actually an appointments screen (not another type of connection)
    const capabilities = connectionManager.clientCapabilities.get(screenConnection);
    if (!capabilities || capabilities.type !== 'screen') {
      console.log(`Screen ${targetScreenID} is not an appointments screen - skipping patient unload send`);
      return;
    }

    const message = createWebSocketMessage(
      'patient_unloaded',
      {}
    );

    const success = connectionManager.sendToScreen(targetScreenID, message);

    if (success) {
      console.log(`Sent patientunLoaded to screen ${targetScreenID}`);
    } else {
      console.log(`Failed to send patientunLoaded - screen ${targetScreenID} not found or not ready`);
    }
  });

  // Handle WhatsApp message updates with batching
  const statusUpdateBuffer = new Map();
  const BATCH_DELAY = 1000; // 1 second
  
  emitter.on('wa_message_update', (messageId, status, date) => {
    console.log(`Received 'wa_message_update' event: messageId=${messageId}, status=${status}, date=${date}`);

    // Add to buffer
    if (!statusUpdateBuffer.has(date)) {
      statusUpdateBuffer.set(date, []);
    }
    
    statusUpdateBuffer.get(date).push({ messageId, status });

    // Debounce the batch send
    setTimeout(() => {
      const updates = statusUpdateBuffer.get(date);
      if (updates && updates.length > 0) {
        const message = createWebSocketMessage(
          MessageSchemas.WebSocketMessage.BATCH_STATUS,
          {
            statusUpdates: updates,
            date
          }
        );

        const dateFilter = (ws, capabilities) => {
          if (!date) return true;
          return capabilities && 
                 capabilities.metadata && 
                 capabilities.metadata.date === date;
        };

        const updateCount = connectionManager.broadcastToWaStatus(message, dateFilter);
        console.log(`Broadcast batched WhatsApp message updates to ${updateCount} clients`);
        
        // Clear the buffer
        statusUpdateBuffer.delete(date);
      }
    }, BATCH_DELAY);
  });

  // Handle broadcast messages from WhatsApp service
  emitter.on('broadcast_message', (message) => {
    const validation = validateWebSocketMessage(message);
    if (!validation.valid) {
      console.error('Invalid message format:', validation.error);
      return;
    }

    // Broadcast to appropriate clients based on message type
    switch (message.type) {
      case MessageSchemas.WebSocketMessage.QR_UPDATE:
        connectionManager.broadcastToWaStatus(message);
        break;
      case MessageSchemas.WebSocketMessage.CLIENT_READY:
        connectionManager.broadcastToWaStatus(message);
        break;
      case MessageSchemas.WebSocketMessage.MESSAGE_STATUS:
        connectionManager.broadcastToWaStatus(message);
        break;
      default:
        connectionManager.broadcastToAll(message);
    }
  });

  /**
   * Get patient images helper function
   */
  async function getPatientImages(pid) {
    try {
      const tp = "0";
      const images = await getTimePointImgs(pid, tp);

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

  
  setInterval(() => {
    // Get all active WhatsApp status connections with their viewer IDs
    const activeViewerIds = [];
    connectionManager.waStatusConnections.forEach(ws => {
      if (ws.qrViewerRegistered && ws.viewerId) {
        activeViewerIds.push(ws.viewerId);
      }
    });
    
    // Verify QR viewer count matches actual connections
    if (messageState && typeof messageState.verifyQRViewerCount === 'function') {
      messageState.verifyQRViewerCount(activeViewerIds);
    }
    
    // Log connection health
    const counts = connectionManager.getConnectionCounts();
    if (counts.waStatus > 0) {
      console.log(`WebSocket health check: ${counts.waStatus} WhatsApp status connections, ${activeViewerIds.length} QR viewers registered`);
    }
  }, 60000); // Every minute

  setInterval(() => {
    // Get all active WhatsApp status connections with their viewer IDs
    const activeViewerIds = [];
    connectionManager.waStatusConnections.forEach(ws => {
      if (ws.qrViewerRegistered && ws.viewerId) {
        activeViewerIds.push(ws.viewerId);
      }
    });
    
    // Verify QR viewer count matches actual connections
    if (messageState && typeof messageState.verifyQRViewerCount === 'function') {
      messageState.verifyQRViewerCount(activeViewerIds);
    }
    
    // Rest of your cleanup code...
  }, 60000); // Every minute

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