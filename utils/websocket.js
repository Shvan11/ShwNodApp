// utils/websocket.js
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import * as database from '../services/database/index.js';
import { getPresentAps } from '../services/database/queries/appointment-queries.js';
import messageState from '../services/state/messageState.js';
import { getTimePointImgs } from '../services/database/queries/timepoint-queries.js';
import { getLatestVisitsSum } from '../services/database/queries/visit-queries.js';
import { createWebSocketMessage, validateWebSocketMessage, MessageSchemas } from '../services/messaging/schemas.js';
import { WebSocketEvents, createStandardMessage } from '../services/messaging/websocket-events.js';
import { logger } from '../services/core/Logger.js';
import qrcode from 'qrcode';
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

    // Set to store daily appointment connections
    this.dailyAppointmentsConnections = new Set();

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
      logger.websocket.debug('Registered screen connection', { screenId: metadata.screenId });
    } else if (type === 'waStatus') {
      this.waStatusConnections.add(ws);
      logger.websocket.debug('Registered WhatsApp status connection');
    } else if (type === 'auth') {
      // Auth connections also need QR events, so add them to waStatusConnections
      this.waStatusConnections.add(ws);
      logger.websocket.debug('Registered auth connection (QR enabled)');
    } else if (type === 'daily-appointments') {
      this.dailyAppointmentsConnections.add(ws);
      logger.websocket.debug('Registered daily appointments connection');
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
      logger.websocket.debug('Unregistered screen connection', { screenId: capabilities.metadata.screenId });
    } else if (capabilities.type === 'waStatus') {
      this.waStatusConnections.delete(ws);
      logger.websocket.debug('Unregistered WhatsApp status connection');
    } else if (capabilities.type === 'auth') {
      this.waStatusConnections.delete(ws);
      logger.websocket.debug('Unregistered auth connection');
    } else if (capabilities.type === 'daily-appointments') {
      this.dailyAppointmentsConnections.delete(ws);
      logger.websocket.debug('Unregistered daily appointments connection');
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
      logger.websocket.error('Error sending to screen', error, { screenId });
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
        logger.websocket.error('Error sending to WhatsApp status client', error);
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
        logger.websocket.error('Error sending to screen', error, { screenId });
      }
    }

    return sentCount;
  }

  /**
   * Broadcast message to all daily appointment connections
   * @param {Object|string} message - Message to send
   * @param {Function} [filter] - Filter function to determine which clients to send to
   * @returns {number} - Number of clients message was sent to
   */
  broadcastToDailyAppointments(message, filter = null) {
    let sentCount = 0;

    for (const ws of this.dailyAppointmentsConnections) {
      if (ws.readyState !== ws.OPEN) continue;

      // Apply filter if provided
      const capabilities = this.clientCapabilities.get(ws);
      if (filter && !filter(ws, capabilities)) continue;

      try {
        this.sendToClient(ws, message);
        sentCount++;
      } catch (error) {
        logger.websocket.error('Error sending to daily appointments client', error);
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
        logger.websocket.error('Error broadcasting to client', error);
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
        logger.websocket.error('Error closing inactive connection', error);
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
      waStatus: this.waStatusConnections.size,
      dailyAppointments: this.dailyAppointmentsConnections.size
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
    logger.websocket.debug('Client connected');
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
      logger.websocket.debug('New connection', { screenID, date, clientType });
  
      // Register connection based on type
      if (clientType === 'waStatus') {
        logger.websocket.debug('WhatsApp status client connected');
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
        logger.websocket.debug('QR viewer registered', { viewerId });
        } else {
          logger.websocket.debug('Connected for status only', { needsQR });
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
  
        logger.websocket.debug('Screen connected', { screenID });
  
        // Send initial data immediately
        sendInitialData(ws, date, connectionManager);
      } else if (clientType === 'auth') {
        // Authentication client - register for QR events if needed
        logger.websocket.debug('Authentication client connected');
        connectionManager.registerConnection(ws, 'auth', {
          ipAddress: req.socket.remoteAddress,
          viewerId: viewerId
        });
        
        // Register as QR viewer if explicitly requested
        const needsQR = url.searchParams.get('needsQR') === 'true';
        if (needsQR && messageState && typeof messageState.registerQRViewer === 'function') {
          const registered = messageState.registerQRViewer(viewerId);
          ws.qrViewerRegistered = true; // Mark as registered
          logger.websocket.debug('QR viewer registered for auth client', { viewerId });
        } else {
          logger.websocket.debug('Auth client connected without QR', { needsQR });
        }
      } else if (clientType === 'daily-appointments') {
        // Daily appointments view - register as daily appointments type
        logger.websocket.debug('Daily appointments client connected');
        connectionManager.registerConnection(ws, 'daily-appointments', {
          date: date,
          ipAddress: req.socket.remoteAddress
        });
        
        // Send initial data immediately
        sendInitialData(ws, date, connectionManager);
      } else {
        // Generic connection
        connectionManager.registerConnection(ws, 'generic', {
          ipAddress: req.socket.remoteAddress
        });
  
        logger.websocket.debug('Generic client connected');
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
  
          logger.websocket.debug('Received message', { 
            messageType: typeof parsedMessage,
            preview: typeof parsedMessage === 'string' ? parsedMessage : JSON.stringify(parsedMessage).substring(0, 100)
          });
  
          // Handle message based on type - only support universal typed messages
          if (typeof parsedMessage === 'object' && parsedMessage.type) {
            handleTypedMessage(ws, parsedMessage, date, connectionManager);
          } else {
            // Unrecognized message format
            logger.websocket.debug('Unrecognized message format, ignoring');
          }
        } catch (msgError) {
          logger.websocket.error('Error processing message', msgError);
        }
      });
  
      // Handle errors
      ws.on('error', (error) => {
        logger.websocket.error('WebSocket error', error);
        
        // If this was a QR viewer client (waStatus or auth), unregister it
        const capabilities = connectionManager.clientCapabilities.get(ws);
        if (capabilities && (capabilities.type === 'waStatus' || capabilities.type === 'auth') && ws.qrViewerRegistered) {
          if (messageState && typeof messageState.unregisterQRViewer === 'function') {
            messageState.unregisterQRViewer(ws.viewerId);
          }
        }
        
        connectionManager.unregisterConnection(ws);
      });
  
   // Handle close event
   ws.on('close', (code, reason) => {
    // If this was a QR viewer client (waStatus or auth), unregister it
    const capabilities = connectionManager.clientCapabilities.get(ws);
    if (capabilities && (capabilities.type === 'waStatus' || capabilities.type === 'auth') && ws.qrViewerRegistered) {
      if (messageState && typeof messageState.unregisterQRViewer === 'function') {
        messageState.unregisterQRViewer(ws.viewerId);
        logger.websocket.debug('Unregistered QR viewer on connection close', { viewerId: ws.viewerId });
      }
    }
    
    // Then unregister the connection
    connectionManager.unregisterConnection(ws);
    logger.websocket.debug('Client disconnected', { code, reason: reason || 'unknown' });
  });
  
  
    } catch (error) {
      logger.websocket.error('Error setting up WebSocket connection', error);
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
    logger.websocket.warn('Invalid message format: missing type');
    const errorMessage = createWebSocketMessage(
      MessageSchemas.WebSocketMessage.ERROR,
      { error: 'Invalid message format: missing type' }
    );
    connectionManager.sendToClient(ws, errorMessage);
    return;
  }

  // Handle different message types using universal event constants
  switch (message.type) {
    case WebSocketEvents.HEARTBEAT_PING:
      const pongMessage = {
        type: WebSocketEvents.HEARTBEAT_PONG,
        timestamp: Date.now(),
        originalId: message.id
      };
      connectionManager.sendToClient(ws, pongMessage);
      break;

    case WebSocketEvents.HEARTBEAT_PONG:
      connectionManager.updateClientCapabilities(ws, {
        supportsPing: true,
        lastPong: Date.now()
      });
      break;

    case WebSocketEvents.REQUEST_APPOINTMENTS:
      const requestDate = message.data?.date || date;
      if (requestDate) {
        await sendAppointmentsData(ws, requestDate, connectionManager);
      }
      break;

    case WebSocketEvents.REQUEST_PATIENT:
      if (message.data?.patientId) {
        await sendPatientData(ws, message.data.patientId, connectionManager);
      }
      break;

    case WebSocketEvents.CLIENT_CAPABILITIES:
      connectionManager.updateClientCapabilities(ws, message.data?.capabilities || {});
      break;

    case WebSocketEvents.REQUEST_WHATSAPP_INITIAL_STATE:
      logger.websocket.debug('Received request for initial state via WebSocket');
      await sendInitialStateForWaClient(ws, message.data, connectionManager);
      break;

    default:
      logger.websocket.warn('Unknown message type', { messageType: message.type });
  }
}

  /**
   * Send initial data to a client
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} date - Date parameter
   */
  async function sendInitialData(ws, date, connectionManager) {
    if (!date || ws.readyState !== ws.OPEN) return;

    logger.websocket.debug('Sending initial data', { date });

    try {
      await sendAppointmentsData(ws, date, connectionManager);
    } catch (error) {
      logger.websocket.error('Error sending initial data', error);
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

    logger.websocket.debug('Sending initial state for WhatsApp client via WebSocket');

    try {
      // Get state from messageState and whatsapp service
      const stateDump = messageState.dump();
      
      // Try to get whatsapp status - handle case where service might not be ready
      let clientStatus;
      let whatsappService;
      try {
        whatsappService = (await import('../services/messaging/whatsapp.js')).default;
        clientStatus = whatsappService.getStatus();
        
        // If client is disconnected and has no instance, but has active QR viewers, initialize
        if (clientStatus.state === 'DISCONNECTED' && 
            !clientStatus.hasClient && 
            messageState.activeQRViewers > 0) {
          logger.websocket.info('No client instance with active QR viewers - triggering initialization');
          // Trigger initialization asynchronously without waiting
          whatsappService.initialize().catch(error => {
            logger.websocket.error('Failed to initialize WhatsApp client', error);
          });
        }
      } catch (error) {
        logger.websocket.warn('Could not get WhatsApp status', error);
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

      // Convert QR code to data URL if present
      let qrDataUrl = null;
      if (!isClientReady && messageState.qr) {
        try {
          qrDataUrl = await qrcode.toDataURL(messageState.qr, {
            margin: 4,
            scale: 6,
            errorCorrectionLevel: 'M'
          });
        } catch (error) {
          logger.websocket.error('Failed to convert QR code to data URL:', error);
          qrDataUrl = messageState.qr; // Fallback to raw string
        }
      }

      // Create response similar to /api/update endpoint
      const responseData = {
        success: true,
        htmltext: html,
        finished,
        clientReady: isClientReady,
        initializing: clientStatus.initializing || false,
        clientStatus: clientStatus,
        persons: messageState.persons || [],
        qr: qrDataUrl,
        stats: stateDump,
        sentMessages: stateDump.sentMessages || 0,
        failedMessages: stateDump.failedMessages || 0,
        timestamp: Date.now()
      };

      const message = createStandardMessage(
        WebSocketEvents.WHATSAPP_INITIAL_STATE_RESPONSE,
        responseData
      );

      connectionManager.sendToClient(ws, message);
      logger.websocket.debug('Sent initial state response via WebSocket');
      
    } catch (error) {
      logger.websocket.error('Error sending initial state for WhatsApp client', error);
      
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
  
    logger.websocket.debug('Fetching appointments data', { date });
  
    try {
      const result = await getPresentAps(date);
      logger.websocket.debug('Got appointments data', { 
        date, 
        appointmentCount: result.appointments ? result.appointments.length : 0 
      });
  
      const message = createStandardMessage(
        WebSocketEvents.APPOINTMENTS_DATA,
        { tableData: result, date }
      );
  
      connectionManager.sendToClient(ws, message);
      logger.websocket.debug('Sent appointments data to client', { date });
    } catch (error) {
      logger.websocket.error('Error fetching appointment data', error, { date });
      
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
  
    logger.websocket.debug('Fetching patient data', { patientId });
  
    try {
      const images = await getPatientImages(patientId);
      const latestVisit = await getLatestVisitsSum(patientId);
  
      const message = createStandardMessage(
        WebSocketEvents.PATIENT_DATA,
        {
          pid: patientId,
          images,
          latestVisit
        }
      );
  
      connectionManager.sendToClient(ws, message);
      logger.websocket.debug('Sent patient data', { patientId });
    } catch (error) {
      logger.websocket.error('Error sending patient data', error, { patientId });
      
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
        logger.websocket.error('Error getting patient images', error);
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
      logger.websocket.error('Error getting patient images', error);
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
  const handleAppointmentUpdate = async (dateParam) => {
    logger.websocket.info('Received appointment update event', { date: dateParam });

    try {
      const appointmentData = await getPresentAps(dateParam);
      logger.websocket.debug('Fetched appointment data', { 
        date: dateParam, 
        appointmentCount: appointmentData.appointments ? appointmentData.appointments.length : 0 
      });

      const message = createStandardMessage(
        WebSocketEvents.APPOINTMENTS_UPDATED,
        { tableData: appointmentData, date: dateParam }
      );

      // Broadcast to screens and daily appointments clients specifically
      const screenUpdates = connectionManager.broadcastToScreens(message);
      const dailyAppointmentsUpdates = connectionManager.broadcastToDailyAppointments(message);
      logger.websocket.info('Broadcast appointment updates', { 
        screenUpdates, 
        dailyAppointmentsUpdates 
      });
    } catch (error) {
      logger.websocket.error('Error fetching appointment data', error, { date: dateParam });
    }
  };

  // Listen to universal event names only
  emitter.on(WebSocketEvents.DATA_UPDATED, handleAppointmentUpdate);

  // Handle patient loaded event
  const handlePatientLoaded = async (pid, targetScreenID) => {
    logger.websocket.info('Received patient loaded event', { patientId: pid, screenId: targetScreenID });
    
    // Check if target screen is connected and ready
    const screenConnection = connectionManager.screenConnections.get(targetScreenID);
    if (!screenConnection || screenConnection.readyState !== screenConnection.OPEN) {
      logger.websocket.debug('Screen not connected - skipping patient data send', { screenId: targetScreenID });
      return;
    }

    // Verify this is actually an appointments screen (not another type of connection)
    const capabilities = connectionManager.clientCapabilities.get(screenConnection);
    if (!capabilities || capabilities.type !== 'screen') {
      logger.websocket.debug('Screen is not an appointments screen - skipping patient data send', { screenId: targetScreenID });
      return;
    }
    
    try {
      const allImages = await getPatientImages(pid);
      logger.websocket.debug('All images for patient', { patientId: pid, imageCount: allImages.length });
      
      const filteredImages = allImages.filter(img =>
        ['.i20', '.i22', '.i21'].some(ext => img.name.toLowerCase().endsWith(ext))
      );

      const sortOrder = ['.i20', '.i22', '.i21'];
      filteredImages.sort((a, b) => {
        const aExt = sortOrder.find(ext => a.name.toLowerCase().endsWith(ext)) || '';
        const bExt = sortOrder.find(ext => b.name.toLowerCase().endsWith(ext)) || '';
        return sortOrder.indexOf(aExt) - sortOrder.indexOf(bExt);
      });

      logger.websocket.debug('Filtered images for patient', { patientId: pid, filteredCount: filteredImages.length });
      
      const latestVisit = await getLatestVisitsSum(pid);
      
      const message = createStandardMessage(
        WebSocketEvents.PATIENT_LOADED,
        {
          pid,
          images: filteredImages,
          latestVisit
        }
      );

      const success = connectionManager.sendToScreen(targetScreenID, message);

      if (success) {
        logger.websocket.debug('Sent patient data to screen', { patientId: pid, screenId: targetScreenID });
      } else {
        logger.websocket.warn('Failed to send patient data - screen not found or not ready', { screenId: targetScreenID });
      }
    } catch (error) {
      logger.websocket.error('Error processing patient loaded event', error);
    }
  };

  // Listen to universal event names only
  emitter.on(WebSocketEvents.PATIENT_LOADED, handlePatientLoaded);

  // Handle patient unloaded event
  const handlePatientUnloaded = (targetScreenID) => {
    logger.websocket.info('Received patient unloaded event', { screenId: targetScreenID });

    // Check if target screen is connected and ready
    const screenConnection = connectionManager.screenConnections.get(targetScreenID);
    if (!screenConnection || screenConnection.readyState !== screenConnection.OPEN) {
      logger.websocket.debug('Screen not connected - skipping patient unload send', { screenId: targetScreenID });
      return;
    }

    // Verify this is actually an appointments screen (not another type of connection)
    const capabilities = connectionManager.clientCapabilities.get(screenConnection);
    if (!capabilities || capabilities.type !== 'screen') {
      logger.websocket.debug('Screen is not an appointments screen - skipping patient unload send', { screenId: targetScreenID });
      return;
    }

    const message = createStandardMessage(
      WebSocketEvents.PATIENT_UNLOADED,
      {}
    );

    const success = connectionManager.sendToScreen(targetScreenID, message);

    if (success) {
      logger.websocket.debug('Sent patient unloaded to screen', { screenId: targetScreenID });
    } else {
      logger.websocket.warn('Failed to send patient unloaded - screen not found or not ready', { screenId: targetScreenID });
    }
  };

  // Listen to universal event names only
  emitter.on(WebSocketEvents.PATIENT_UNLOADED, handlePatientUnloaded);

  // Handle WhatsApp message updates with batching
  const statusUpdateBuffer = new Map();
  const BATCH_DELAY = 1000; // 1 second
  
  emitter.on('wa_message_update', (messageId, status, date) => {
    logger.websocket.debug('Received WhatsApp message update event', { messageId, status, date });

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
        logger.websocket.info('Broadcast batched WhatsApp message updates', { updateCount });
        
        // Clear the buffer
        statusUpdateBuffer.delete(date);
      }
    }, BATCH_DELAY);
  });

  // Handle broadcast messages from WhatsApp service
  emitter.on('broadcast_message', (message) => {
    const validation = validateWebSocketMessage(message);
    if (!validation.valid) {
      logger.websocket.warn('Invalid message format', { error: validation.error });
      return;
    }

    // Broadcast to appropriate clients based on message type
    switch (message.type) {
      case MessageSchemas.WebSocketMessage.QR_UPDATE:
        connectionManager.broadcastToWaStatus(message);
        break;
      case MessageSchemas.WebSocketMessage.CLIENT_READY:
        connectionManager.broadcastToAll(message);
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
      logger.websocket.error('Error getting patient images', error);
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
      logger.websocket.info('Closed inactive connections', { count: closed });
    }

    // Log active connection counts
    const counts = connectionManager.getConnectionCounts();
    logger.websocket.debug('Active connections status', counts);
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
      logger.websocket.debug('WebSocket health check', { 
        waStatusConnections: counts.waStatus, 
        qrViewersRegistered: activeViewerIds.length 
      });
    }
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
    logger.websocket.debug('Triggering periodic update', { date: today });
    emitter.emit('updated', today);
  }, updateInterval);

  logger.websocket.info('Set up periodic updates', { intervalSeconds: updateInterval / 1000 });
}

export { setupWebSocketServer };