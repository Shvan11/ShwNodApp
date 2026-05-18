// utils/websocket.ts
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import type { Server as HTTPServer } from 'http';
import { getPresentAps } from '../services/database/queries/appointment-queries.js';
import messageState from '../services/state/messageState.js';
import { getTimePointImgs } from '../services/database/queries/timepoint-queries.js';
import { getLatestVisitsSum } from '../services/database/queries/visit-queries.js';
import { getActiveWork } from '../services/database/queries/work-queries.js';
import { getPatientById } from '../services/database/queries/patient-queries.js';
import { createWebSocketMessage, validateWebSocketMessage, MessageSchemas } from '../services/messaging/schemas.js';
import { WebSocketEvents, createStandardMessage } from '../services/messaging/websocket-events.js';
import { logger } from '../services/core/Logger.js';
import stateEvents from '../services/state/stateEvents.js';
import qrcode from 'qrcode';

// Mirror of public/js/config/workTypeConfig.ts ORTHO_WORK_TYPES — visit notes only show
// for active orthodontic work on the chair-side display.
const ORTHO_WORK_TYPE_IDS: ReadonlySet<number> = new Set([1, 2, 11, 19, 20]);
const CHAIR_DISPLAY_INTRAORAL_EXTS = ['.i20', '.i22', '.i21'] as const;

// Process-local map of which patient is currently loaded on each chair. Used
// to replay the patient-loaded event when a kiosk reconnects after a network
// blip. Lost on server restart by design — staff one-click restores via the
// next patient-loaded POST.
const chairCurrentPatient = new Map<string, { personId: number; loadedAt: number }>();

// ===========================================
// TYPES
// ===========================================

/**
 * Connection type identifiers
 */
type ConnectionType = 'chair-display' | 'waStatus' | 'auth' | 'daily-appointments' | 'generic';

/**
 * Connection metadata for different client types
 */
interface ConnectionMetadata {
  chairId?: string;
  date?: string | null;
  ipAddress?: string;
  viewerId?: string;
}

/**
 * Client capabilities stored for each connection
 */
interface ClientCapabilities {
  type: ConnectionType;
  metadata: ConnectionMetadata;
  supportsJson: boolean;
  supportsPing: boolean;
  lastActivity: number;
  lastPong?: number;
}

/**
 * Extended WebSocket with custom properties
 */
interface ExtendedWebSocket extends WebSocket {
  qrViewerRegistered: boolean;
  viewerId: string;
  waDate?: string | null;
  isWaClient?: boolean;
  isAlive?: boolean;
}

/**
 * Connection counts summary
 */
interface ConnectionCounts {
  total: number;
  chairDisplays: number;
  waStatus: number;
  dailyAppointments: number;
}

/**
 * Typed WebSocket message structure
 */
interface TypedMessage {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
}

/**
 * Patient image entry
 */
interface PatientImage {
  name: string;
}

/**
 * Filter function for broadcast operations
 */
type BroadcastFilter = (ws: ExtendedWebSocket, capabilities: ClientCapabilities | undefined) => boolean;

// ===========================================
// CONNECTION MANAGER
// ===========================================

/**
 * WebSocket Connection Manager
 */
class ConnectionManager {
  chairDisplayConnections: Map<string, ExtendedWebSocket>;
  waStatusConnections: Set<ExtendedWebSocket>;
  dailyAppointmentsConnections: Set<ExtendedWebSocket>;
  allConnections: Set<ExtendedWebSocket>;
  clientCapabilities: WeakMap<ExtendedWebSocket, ClientCapabilities>;

  constructor() {
    this.chairDisplayConnections = new Map();
    this.waStatusConnections = new Set();
    this.dailyAppointmentsConnections = new Set();
    this.allConnections = new Set();
    this.clientCapabilities = new WeakMap();
  }

  registerConnection(ws: ExtendedWebSocket, type: ConnectionType, metadata: ConnectionMetadata = {}): void {
    this.allConnections.add(ws);
    this.clientCapabilities.set(ws, {
      type,
      metadata,
      supportsJson: true,
      supportsPing: true,
      lastActivity: Date.now()
    });

    if (type === 'chair-display' && metadata.chairId) {
      // If a prior WS is registered for the same chairId (e.g. the kiosk
      // reconnected before the previous socket's close event fired), close
      // it explicitly so its eventual close handler doesn't unregister the
      // new entry. See unregisterConnection below for the identity guard.
      const prev = this.chairDisplayConnections.get(metadata.chairId);
      if (prev && prev !== ws) {
        try { prev.close(1000, 'Replaced by new chair-display connection'); } catch { /* ignore */ }
      }
      this.chairDisplayConnections.set(metadata.chairId, ws);
      logger.websocket.debug('Registered chair-display connection', { chairId: metadata.chairId });
    } else if (type === 'waStatus') {
      this.waStatusConnections.add(ws);
      logger.websocket.debug('Registered WhatsApp status connection');
    } else if (type === 'auth') {
      this.waStatusConnections.add(ws);
      logger.websocket.debug('Registered auth connection (QR enabled)');
    } else if (type === 'daily-appointments') {
      this.dailyAppointmentsConnections.add(ws);
      logger.websocket.debug('Registered daily appointments connection');
    }
  }

  unregisterConnection(ws: ExtendedWebSocket): void {
    this.allConnections.delete(ws);
    this.waStatusConnections.delete(ws);
    this.dailyAppointmentsConnections.delete(ws);

    // Chair-display Map: locate the entry by value so a stale OLD_WS close
    // event never unmaps a NEW_WS that already took the same chairId.
    for (const [chairId, mapped] of this.chairDisplayConnections) {
      if (mapped === ws) {
        this.chairDisplayConnections.delete(chairId);
        break;
      }
    }

    this.clientCapabilities.delete(ws);
  }

  sendToChairDisplay(chairId: string, message: unknown): boolean {
    const ws = this.chairDisplayConnections.get(chairId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;

    try {
      this.sendToClient(ws, message);
      return true;
    } catch (error) {
      logger.websocket.error('Error sending to chair-display', { error: (error as Error).message, chairId });
      return false;
    }
  }

  broadcastToWaStatus(message: unknown, filter: BroadcastFilter | null = null): number {
    let sentCount = 0;
    for (const ws of this.waStatusConnections) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (filter && !filter(ws, this.clientCapabilities.get(ws))) continue;

      try {
        this.sendToClient(ws, message);
        sentCount++;
      } catch (error) {
        logger.websocket.error('Error sending to WhatsApp status client', error as Error);
      }
    }
    return sentCount;
  }

  broadcastToDailyAppointments(message: unknown, filter: BroadcastFilter | null = null): number {
    let sentCount = 0;
    for (const ws of this.dailyAppointmentsConnections) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const capabilities = this.clientCapabilities.get(ws);
      if (filter && !filter(ws, capabilities)) continue;

      try {
        this.sendToClient(ws, message);
        sentCount++;
      } catch (error) {
        logger.websocket.error('Error sending to daily appointments client', error as Error);
      }
    }
    return sentCount;
  }

  broadcastToAll(message: unknown, filter: BroadcastFilter | null = null): number {
    let sentCount = 0;
    for (const ws of this.allConnections) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const capabilities = this.clientCapabilities.get(ws);
      if (filter && !filter(ws, capabilities)) continue;

      try {
        this.sendToClient(ws, message);
        sentCount++;
      } catch (error) {
        logger.websocket.error('Error broadcasting to client', error as Error);
      }
    }
    return sentCount;
  }

  sendToClient(ws: ExtendedWebSocket, message: unknown): void {
    const capabilities = this.clientCapabilities.get(ws) || { supportsJson: true };
    let formattedMessage: string;

    if (typeof message === 'string') {
      formattedMessage = message;
    } else if (capabilities.supportsJson) {
      formattedMessage = JSON.stringify(message);
    } else {
      formattedMessage = typeof (message as { toString?: () => string }).toString === 'function'
        ? (message as { toString: () => string }).toString()
        : String(message);
    }

    ws.send(formattedMessage);

    const fullCapabilities = this.clientCapabilities.get(ws);
    if (fullCapabilities) {
      fullCapabilities.lastActivity = Date.now();
    }
  }

  updateClientCapabilities(ws: ExtendedWebSocket, capabilities: Partial<ClientCapabilities>): void {
    const existing = this.clientCapabilities.get(ws) || {} as ClientCapabilities;
    this.clientCapabilities.set(ws, {
      ...existing,
      ...capabilities,
      lastActivity: Date.now()
    } as ClientCapabilities);
  }

  getInactiveConnections(timeout: number): ExtendedWebSocket[] {
    const now = Date.now();
    const inactive: ExtendedWebSocket[] = [];

    for (const ws of this.allConnections) {
      const capabilities = this.clientCapabilities.get(ws);
      if (!capabilities) continue;

      // Chair-displays are read-only kiosks: they never send inbound traffic,
      // and only get push events when staff opens/closes a patient. A quiet
      // morning would otherwise trip the inactivity sweep and force needless
      // reconnects. Skip them — they're naturally cleaned up on disconnect.
      if (capabilities.type === 'chair-display') continue;

      const inactiveTime = now - capabilities.lastActivity;
      if (inactiveTime > timeout) {
        inactive.push(ws);
      }
    }

    return inactive;
  }

  closeInactiveConnections(timeout: number): number {
    const inactive = this.getInactiveConnections(timeout);

    for (const ws of inactive) {
      try {
        ws.close(1000, 'Inactivity timeout');
        this.unregisterConnection(ws);
      } catch (error) {
        logger.websocket.error('Error closing inactive connection', error as Error);
      }
    }

    return inactive.length;
  }

  getConnectionCounts(): ConnectionCounts {
    return {
      total: this.allConnections.size,
      chairDisplays: this.chairDisplayConnections.size,
      waStatus: this.waStatusConnections.size,
      dailyAppointments: this.dailyAppointmentsConnections.size
    };
  }
}

// ===========================================
// MAIN SETUP FUNCTION
// ===========================================

/**
 * Setup WebSocket server
 */
function setupWebSocketServer(server: HTTPServer): EventEmitter {
  const wsEmitter = new EventEmitter();
  const connectionManager = new ConnectionManager();
  const wss = new WebSocketServer({ server });

  // Set up global event handlers
  setupGlobalEventHandlers(wsEmitter, connectionManager);

  // Set up cleanup interval
  setupPeriodicCleanup(connectionManager);

  // Handle new connections
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const extWs = ws as ExtendedWebSocket;
    logger.websocket.debug('Client connected');
    extWs.qrViewerRegistered = false;
    extWs.isAlive = true;
    extWs.on('pong', () => { extWs.isAlive = true; });

    try {
      const url = new URL(req.url || '', 'http://localhost');
      const date = url.searchParams.get('PDate');
      const clientTypeParam = url.searchParams.get('clientType');
      const clientTypes = clientTypeParam ? clientTypeParam.split(',').map(t => t.trim()) : [];
      const clientIP = req.socket.remoteAddress || 'unknown';
      const viewerId = `${clientIP}-${clientTypes.join('-')}-${date || 'unknown'}-${Date.now()}`;

      extWs.viewerId = viewerId;
      extWs.qrViewerRegistered = false;
      logger.websocket.debug('New connection', { date, clientTypes });

      const needsQR = url.searchParams.get('needsQR') === 'true';

      // Register for each client type
      for (const clientType of clientTypes) {
        if (clientType === 'waStatus') {
          logger.websocket.debug('Registering WhatsApp status client');
          connectionManager.registerConnection(extWs, 'waStatus', {
            date: date,
            ipAddress: req.socket.remoteAddress,
            viewerId: viewerId
          });

          if (needsQR && messageState && typeof messageState.registerQRViewer === 'function' && !extWs.qrViewerRegistered) {
            messageState.registerQRViewer(viewerId);
            extWs.qrViewerRegistered = true;
            logger.websocket.debug('QR viewer registered', { viewerId });
          }

          extWs.waDate = date;
          extWs.isWaClient = true;

        } else if (clientType === 'auth') {
          logger.websocket.debug('Registering authentication client');
          connectionManager.registerConnection(extWs, 'auth', {
            ipAddress: req.socket.remoteAddress,
            viewerId: viewerId
          });

          if (needsQR && messageState && typeof messageState.registerQRViewer === 'function' && !extWs.qrViewerRegistered) {
            messageState.registerQRViewer(viewerId);
            extWs.qrViewerRegistered = true;
            logger.websocket.debug('QR viewer registered for auth client', { viewerId });
          }

        } else if (clientType === 'daily-appointments') {
          logger.websocket.debug('Registering daily appointments client');
          connectionManager.registerConnection(extWs, 'daily-appointments', {
            date: date,
            ipAddress: req.socket.remoteAddress
          });

        } else if (clientType === 'chair-display') {
          const chairIdParam = url.searchParams.get('chairId');
          if (!chairIdParam || !/^([1-9]|10)$/.test(chairIdParam)) {
            logger.websocket.warn('Rejecting chair-display connection: invalid chairId', { chairIdParam });
            extWs.close(1008, 'Invalid chairId');
            return;
          }
          logger.websocket.debug('Registering chair-display client', { chairId: chairIdParam });
          connectionManager.registerConnection(extWs, 'chair-display', {
            chairId: chairIdParam,
            ipAddress: req.socket.remoteAddress
          });

          // Replay current patient (if any) so a kiosk reconnect restores
          // without manual reload. Reuses the existing patient-loaded handler
          // for all payload assembly (images, latest visit, patient name).
          const stored = chairCurrentPatient.get(chairIdParam);
          if (stored) {
            logger.websocket.debug('Replaying patient-loaded on chair-display reconnect', {
              chairId: chairIdParam,
              personId: stored.personId,
            });
            wsEmitter.emit(
              WebSocketEvents.CHAIR_DISPLAY_PATIENT_LOADED,
              String(stored.personId),
              chairIdParam
            );
          }
        }
      }

      if (clientTypes.length === 0) {
        logger.websocket.debug('Generic client connected');
        connectionManager.registerConnection(extWs, 'generic', {
          ipAddress: req.socket.remoteAddress
        });
      }

      if (clientTypes.includes('daily-appointments')) {
        sendInitialData(extWs, date, connectionManager);
      }

      // Handle messages
      extWs.on('message', async (message: RawData) => {
        try {
          const capabilities = connectionManager.clientCapabilities.get(extWs);
          if (capabilities) {
            capabilities.lastActivity = Date.now();
          }

          let parsedMessage: TypedMessage | string;
          const messageStr = message.toString();

          try {
            parsedMessage = JSON.parse(messageStr) as TypedMessage;
          } catch {
            parsedMessage = messageStr;
          }

          logger.websocket.debug('Received message', {
            messageType: typeof parsedMessage
          });

          if (typeof parsedMessage === 'object' && parsedMessage.type) {
            handleTypedMessage(extWs, parsedMessage, date, connectionManager);
          }
        } catch (msgError) {
          logger.websocket.error('Error processing message', msgError as Error);
        }
      });

      // Handle errors
      extWs.on('error', (error: Error) => {
        logger.websocket.error('WebSocket error', error);

        const capabilities = connectionManager.clientCapabilities.get(extWs);
        if (capabilities && (capabilities.type === 'waStatus' || capabilities.type === 'auth') && extWs.qrViewerRegistered) {
          if (messageState && typeof messageState.unregisterQRViewer === 'function') {
            messageState.unregisterQRViewer(extWs.viewerId);
          }
        }

        connectionManager.unregisterConnection(extWs);
      });

      extWs.on('close', (code: number, reason: Buffer) => {
        const capabilities = connectionManager.clientCapabilities.get(extWs);
        if (capabilities && (capabilities.type === 'waStatus' || capabilities.type === 'auth') && extWs.qrViewerRegistered) {
          if (messageState && typeof messageState.unregisterQRViewer === 'function') {
            messageState.unregisterQRViewer(extWs.viewerId);
            logger.websocket.debug('Unregistered QR viewer on connection close', { viewerId: extWs.viewerId });
          }
        }

        connectionManager.unregisterConnection(extWs);
        logger.websocket.debug('Client disconnected', { code, reason: reason.toString() || 'unknown' });
      });

    } catch (error) {
      logger.websocket.error('Error setting up WebSocket connection', error as Error);
    }
  });


  /**
   * Handle typed messages
   */
  async function handleTypedMessage(
    ws: ExtendedWebSocket,
    message: TypedMessage,
    date: string | null,
    connectionManager: ConnectionManager
  ): Promise<void> {
    if (!message || typeof message !== 'object' || !message.type) {
      logger.websocket.warn('Invalid message format: missing type');
      const errorMessage = createWebSocketMessage(
        MessageSchemas.WebSocketMessage.ERROR,
        { error: 'Invalid message format: missing type' }
      );
      connectionManager.sendToClient(ws, errorMessage);
      return;
    }

    // Handle different message types
    switch (message.type) {
      case WebSocketEvents.HEARTBEAT_PING: {
        const pongMessage = {
          type: WebSocketEvents.HEARTBEAT_PONG,
          timestamp: Date.now(),
          originalId: message.id
        };
        connectionManager.sendToClient(ws, pongMessage);
        break;
      }

      case WebSocketEvents.HEARTBEAT_PONG:
        connectionManager.updateClientCapabilities(ws, {
          supportsPing: true,
          lastPong: Date.now()
        });
        break;

      case WebSocketEvents.REQUEST_APPOINTMENTS: {
        const requestDate = (message.data?.date as string) || date;
        if (requestDate) {
          await sendAppointmentsData(ws, requestDate, connectionManager);
        }
        break;
      }

      case WebSocketEvents.CLIENT_CAPABILITIES:
        connectionManager.updateClientCapabilities(ws, (message.data?.capabilities as Partial<ClientCapabilities>) || {});
        break;

      case WebSocketEvents.REQUEST_WHATSAPP_INITIAL_STATE:
        logger.websocket.debug('Received request for initial state via WebSocket');
        await sendInitialStateForWaClient(ws, message.data, connectionManager);
        break;

      default:
        logger.websocket.warn('Unknown message type', { messageType: message.type });
    }
  }

  async function sendInitialData(
    ws: ExtendedWebSocket,
    date: string | null,
    connectionManager: ConnectionManager
  ): Promise<void> {
    if (!date || ws.readyState !== WebSocket.OPEN) return;
    logger.websocket.debug('Sending initial data', { date });

    try {
      await sendAppointmentsData(ws, date, connectionManager);
    } catch (error) {
      logger.websocket.error('Error sending initial data', error as Error);
    }
  }

  async function sendInitialStateForWaClient(
    ws: ExtendedWebSocket,
    _requestData: Record<string, unknown> | undefined,
    connectionManager: ConnectionManager
  ): Promise<void> {
    if (ws.readyState !== WebSocket.OPEN) return;
    logger.websocket.debug('Sending initial state for WhatsApp client');

    try {
      const stateDump = messageState.dump();

      let clientStatus: { state?: string; active?: boolean; initializing?: boolean; hasClient?: boolean };
      try {
        const whatsappService = (await import('../services/messaging/whatsapp.js')).default;
        clientStatus = whatsappService.getStatus();
      } catch (error) {
        logger.websocket.warn('Could not get WhatsApp status', error as Error);
        clientStatus = { active: false };
      }

      // Delegate init to the WhatsApp service via the existing event bus.
      // initializeOnDemand() in whatsapp.ts performs the DISCONNECTED /
      // activeQRViewers / circuit-breaker checks itself.
      if (messageState.activeQRViewers > 0) {
        stateEvents.emit('whatsapp_initialization_requested');
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

      let qrDataUrl: string | null = null;
      if (!isClientReady && messageState.qr) {
        try {
          qrDataUrl = await qrcode.toDataURL(messageState.qr, {
            margin: 4,
            scale: 6,
            errorCorrectionLevel: 'M'
          });
        } catch (error) {
          logger.websocket.error('Failed to convert QR code to data URL:', error as Error);
          qrDataUrl = messageState.qr;
        }
      }

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
      logger.websocket.debug('Sent initial state response');

    } catch (error) {
      logger.websocket.error('Error sending initial state', error as Error);

      const errorMessage = createWebSocketMessage(
        MessageSchemas.WebSocketMessage.ERROR,
        { error: 'Failed to fetch initial state' }
      );
      connectionManager.sendToClient(ws, errorMessage);
    }
  }

  async function sendAppointmentsData(
    ws: ExtendedWebSocket,
    date: string,
    connectionManager: ConnectionManager
  ): Promise<void> {
    if (!date || ws.readyState !== WebSocket.OPEN) return;
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
      logger.websocket.debug('Sent appointments data', { date });
    } catch (error) {
      logger.websocket.error('Error fetching appointment data', { error: (error as Error).message, date });

      const errorMessage = createWebSocketMessage(
        MessageSchemas.WebSocketMessage.ERROR,
        { error: `Failed to fetch appointments for ${date}` }
      );
      connectionManager.sendToClient(ws, errorMessage);
    }
  }

  return wsEmitter;
}

// ===========================================
// GLOBAL EVENT HANDLERS
// ===========================================

/**
 * Global event handlers
 */
function setupGlobalEventHandlers(emitter: EventEmitter, connectionManager: ConnectionManager): void {
  const handleAppointmentUpdate = async (dateParam: string): Promise<void> => {
    logger.websocket.info('Appointment update event', { date: dateParam });

    try {
      const message = createStandardMessage(
        WebSocketEvents.APPOINTMENTS_UPDATED,
        { date: dateParam }
      );

      const sentCount = connectionManager.broadcastToDailyAppointments(message);

      logger.websocket.info('Broadcast appointment updates', {
        dailyAppointments: sentCount
      });
    } catch (error) {
      logger.websocket.error('Error broadcasting appointment update', { error: (error as Error).message, date: dateParam });
    }
  };

  emitter.on(WebSocketEvents.DATA_UPDATED, handleAppointmentUpdate);

  // Chair-display: patient loaded
  const handleChairDisplayPatientLoaded = async (pid: string, targetChairId: string): Promise<void> => {
    logger.websocket.info('Chair-display patient loaded', { patientId: pid, chairId: targetChairId });

    const parsedId = parseInt(pid, 10);
    if (Number.isFinite(parsedId) && parsedId > 0) {
      // Record state even if the kiosk isn't currently connected — a later
      // reconnect will trigger replay using this entry.
      chairCurrentPatient.set(targetChairId, { personId: parsedId, loadedAt: Date.now() });
    }

    const chairConnection = connectionManager.chairDisplayConnections.get(targetChairId);
    if (!chairConnection || chairConnection.readyState !== WebSocket.OPEN) {
      logger.websocket.debug('Chair display not connected', { chairId: targetChairId });
      return;
    }

    try {
      const personId = parseInt(pid, 10);

      const allImages = await getPatientImagesLocal(pid);
      const filteredImages = allImages.filter(img =>
        CHAIR_DISPLAY_INTRAORAL_EXTS.some(ext => img.name.toLowerCase().endsWith(ext))
      );
      filteredImages.sort((a, b) => {
        const aExt = CHAIR_DISPLAY_INTRAORAL_EXTS.find(ext => a.name.toLowerCase().endsWith(ext)) || '';
        const bExt = CHAIR_DISPLAY_INTRAORAL_EXTS.find(ext => b.name.toLowerCase().endsWith(ext)) || '';
        return CHAIR_DISPLAY_INTRAORAL_EXTS.indexOf(aExt as typeof CHAIR_DISPLAY_INTRAORAL_EXTS[number])
          - CHAIR_DISPLAY_INTRAORAL_EXTS.indexOf(bExt as typeof CHAIR_DISPLAY_INTRAORAL_EXTS[number]);
      });

      const activeWork = await getActiveWork(personId);
      const isOrtho = !!(activeWork && ORTHO_WORK_TYPE_IDS.has(activeWork.Typeofwork as number));
      const [latestVisit, patientRecord] = await Promise.all([
        isOrtho ? getLatestVisitsSum(personId) : Promise.resolve(null),
        getPatientById(personId),
      ]);

      const name = patientRecord?.PatientName?.trim() ||
        [patientRecord?.FirstName, patientRecord?.LastName].filter(Boolean).join(' ').trim() ||
        null;

      const message = createStandardMessage(
        WebSocketEvents.CHAIR_DISPLAY_PATIENT_LOADED,
        {
          pid,
          name,
          images: filteredImages,
          latestVisit
        }
      );

      const success = connectionManager.sendToChairDisplay(targetChairId, message);

      if (success) {
        logger.websocket.debug('Sent patient data to chair display', { patientId: pid, chairId: targetChairId, isOrtho });
      } else {
        logger.websocket.warn('Failed to send patient data', { chairId: targetChairId });
      }
    } catch (error) {
      logger.websocket.error('Error processing chair-display patient loaded', error as Error);
    }

    async function getPatientImagesLocal(pid: string): Promise<PatientImage[]> {
      try {
        const tp = "0";
        const images = await getTimePointImgs(pid, tp);

        return images.map((code: string | number) => {
          const name = `${pid}0${tp}.i${code}`;
          return { name };
        });
      } catch (error) {
        logger.websocket.error('Error getting patient images', error as Error);
        return [];
      }
    }
  };

  emitter.on(WebSocketEvents.CHAIR_DISPLAY_PATIENT_LOADED, handleChairDisplayPatientLoaded);

  // Chair-display: patient cleared
  const handleChairDisplayPatientCleared = (targetChairId: string): void => {
    logger.websocket.info('Chair-display patient cleared', { chairId: targetChairId });

    chairCurrentPatient.delete(targetChairId);

    const chairConnection = connectionManager.chairDisplayConnections.get(targetChairId);
    if (!chairConnection || chairConnection.readyState !== WebSocket.OPEN) {
      logger.websocket.debug('Chair display not connected', { chairId: targetChairId });
      return;
    }

    const message = createStandardMessage(
      WebSocketEvents.CHAIR_DISPLAY_PATIENT_CLEARED,
      {}
    );

    const success = connectionManager.sendToChairDisplay(targetChairId, message);

    if (success) {
      logger.websocket.debug('Sent patient cleared', { chairId: targetChairId });
    } else {
      logger.websocket.warn('Failed to send patient cleared', { chairId: targetChairId });
    }
  };

  emitter.on(WebSocketEvents.CHAIR_DISPLAY_PATIENT_CLEARED, handleChairDisplayPatientCleared);

  // WhatsApp message updates with batching
  const statusUpdateBuffer = new Map<string, Array<{ messageId: string; status: string }>>();
  const BATCH_DELAY = 1000;

  emitter.on('wa_message_update', (messageId: string, status: string, date: string) => {
    logger.websocket.debug('WhatsApp message update', { messageId, status, date });

    if (!statusUpdateBuffer.has(date)) {
      statusUpdateBuffer.set(date, []);
    }

    statusUpdateBuffer.get(date)!.push({ messageId, status });

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

        const dateFilter: BroadcastFilter = (_ws, capabilities) => {
          if (!date) return true;
          return capabilities !== undefined &&
                 capabilities.metadata !== undefined &&
                 capabilities.metadata.date === date;
        };

        const updateCount = connectionManager.broadcastToWaStatus(message, dateFilter);
        logger.websocket.info('Broadcast batched WhatsApp updates', { updateCount });

        statusUpdateBuffer.delete(date);
      }
    }, BATCH_DELAY);
  });

  // Broadcast messages
  emitter.on('broadcast_message', (message: { type: string }) => {
    const validation = validateWebSocketMessage(message);
    if (!validation.valid) {
      logger.websocket.warn('Invalid message format', { error: validation.error });
      return;
    }

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
}

// ===========================================
// PERIODIC CLEANUP
// ===========================================

const _periodicTimers: ReturnType<typeof setInterval>[] = [];

function teardownPeriodicCleanup(): void {
  for (const handle of _periodicTimers) {
    clearInterval(handle);
  }
  _periodicTimers.length = 0;
}

/**
 * Periodic cleanup
 */
function setupPeriodicCleanup(connectionManager: ConnectionManager): void {
  const inactivityTimeout = 30 * 60 * 1000; // 30 minutes

  _periodicTimers.push(setInterval(() => {
    const closed = connectionManager.closeInactiveConnections(inactivityTimeout);
    if (closed > 0) {
      logger.websocket.info('Closed inactive connections', { count: closed });
    }

    const counts = connectionManager.getConnectionCounts();
    logger.websocket.debug('Active connections', counts);
  }, 10 * 60 * 1000)); // Every 10 minutes

  _periodicTimers.push(setInterval(() => {
    const activeViewerIds: string[] = [];
    connectionManager.waStatusConnections.forEach(ws => {
      if (ws.qrViewerRegistered && ws.viewerId) {
        activeViewerIds.push(ws.viewerId);
      }
    });

    if (messageState && typeof messageState.verifyQRViewerCount === 'function') {
      messageState.verifyQRViewerCount(activeViewerIds);
    }

    const counts = connectionManager.getConnectionCounts();
    if (counts.waStatus > 0) {
      logger.websocket.debug('WebSocket health check', {
        waStatusConnections: counts.waStatus,
        qrViewersRegistered: activeViewerIds.length
      });
    }
  }, 60000)); // Every minute

  // TCP-level heartbeat: terminate sockets that miss a pong within 30s.
  // Complements the 30-min inactivity sweep (which handles app-level idleness).
  // Chair-displays are included here — the activity sweep skips them, but
  // transport-dead kiosks should still be cleaned up promptly.
  _periodicTimers.push(setInterval(() => {
    for (const ws of connectionManager.allConnections) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* socket already dead */ }
    }
  }, 30_000)); // Every 30 seconds

  // Application-level heartbeat: push a JSON SERVER_HEARTBEAT to every open
  // connection every 15s. Clients use receipt to compute data freshness — the
  // socket being OPEN is not sufficient evidence that messages still flow.
  const heartbeatHandle = setInterval(() => {
    const heartbeat = createStandardMessage(
      WebSocketEvents.SERVER_HEARTBEAT,
      { id: `hb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now() }
    );
    connectionManager.broadcastToAll(heartbeat);
  }, 15_000);
  heartbeatHandle.unref(); // Don't block process exit if graceful shutdown is bypassed.
  _periodicTimers.push(heartbeatHandle);
}

export { setupWebSocketServer, teardownPeriodicCleanup };
