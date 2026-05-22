// utils/websocket.ts
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import type { Server as HTTPServer } from 'http';
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

// Drop stale replay entries on read instead of running a sweep timer.
// 12 h covers a workday + buffer; staff arriving the next morning will not
// see yesterday's patient.
const CHAIR_PATIENT_REPLAY_TTL_MS = 12 * 60 * 60 * 1000;

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
}

/**
 * Extended WebSocket with custom properties
 */
interface ExtendedWebSocket extends WebSocket {
  qrViewerRegistered: boolean;
  viewerId: string;
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
    // Every new socket enters as 'generic' and joins allConnections only.
    // Type-specific Set/Map membership is established later via the
    // REGISTER_CLIENT_TYPE message — this collapses the dual registration
    // paths (URL params + REGISTER) into one and removes the silent broadcast
    // loss after auto-reconnect (where URL params were dropped).
    this.allConnections.add(ws);
    this.clientCapabilities.set(ws, {
      type,
      metadata,
      supportsJson: true,
      supportsPing: true,
      lastActivity: Date.now()
    });
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

    // Callback form so async write errors (ECONNRESET, EPIPE, clean proxy
    // RSTs from Cloudflare Tunnel idle drops) clean up the dead socket within
    // one heartbeat cycle instead of waiting up to 60s for the TCP ping sweep.
    // Doesn't help with silent mobile NAT drops — those still need the TCP
    // ping (no error packet ever arrives to trigger the callback).
    ws.send(formattedMessage, (err) => {
      if (err) this.handleSendError(ws, err);
    });

    const fullCapabilities = this.clientCapabilities.get(ws);
    if (fullCapabilities) {
      fullCapabilities.lastActivity = Date.now();
    }
  }

  handleSendError(ws: ExtendedWebSocket, err: Error): void {
    const capabilities = this.clientCapabilities.get(ws);
    logger.websocket.warn('Send failed; dropping dead socket', {
      error: err.message,
      type: capabilities?.type,
    });
    this.unregisterConnection(ws);
    try { ws.terminate(); } catch { /* already dead */ }
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

  // Handle new connections. The upgrade URL carries no parameters — every
  // connection enters as 'generic' and is promoted to its specific
  // type(s) only after the client sends REGISTER_CLIENT_TYPE messages.
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const extWs = ws as ExtendedWebSocket;
    extWs.qrViewerRegistered = false;
    extWs.isAlive = true;
    const clientIP = req.socket.remoteAddress || 'unknown';
    extWs.viewerId = `${clientIP}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    extWs.on('pong', () => { extWs.isAlive = true; });

    logger.websocket.debug('Client connected', { viewerId: extWs.viewerId });

    connectionManager.registerConnection(extWs, 'generic', { ipAddress: clientIP });

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

        if (typeof parsedMessage === 'object' && parsedMessage.type) {
          handleTypedMessage(extWs, parsedMessage, connectionManager);
        }
      } catch (msgError) {
        logger.websocket.error('Error processing message', msgError as Error);
      }
    });

    const handleSocketGone = (code: number | null, reason: Buffer | null) => {
      // QR viewer cleanup is gated purely on the qrViewerRegistered flag —
      // no need to consult capabilities.type, which is just informational now.
      if (extWs.qrViewerRegistered && messageState && typeof messageState.unregisterQRViewer === 'function') {
        messageState.unregisterQRViewer(extWs.viewerId);
        extWs.qrViewerRegistered = false;
      }
      connectionManager.unregisterConnection(extWs);
      logger.websocket.debug('Client disconnected', {
        code: code ?? 'n/a',
        reason: reason?.toString() || 'unknown',
      });
    };

    extWs.on('error', (error: Error) => {
      logger.websocket.error('WebSocket error', error);
      handleSocketGone(null, null);
    });

    extWs.on('close', (code: number, reason: Buffer) => {
      handleSocketGone(code, reason);
    });
  });


  /**
   * Handle typed messages
   */
  async function handleTypedMessage(
    ws: ExtendedWebSocket,
    message: TypedMessage,
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
        connectionManager.updateClientCapabilities(ws, { supportsPing: true });
        break;

      case WebSocketEvents.CLIENT_CAPABILITIES:
        connectionManager.updateClientCapabilities(ws, (message.data?.capabilities as Partial<ClientCapabilities>) || {});
        break;

      case WebSocketEvents.REQUEST_WHATSAPP_INITIAL_STATE:
        logger.websocket.debug('Received request for initial state via WebSocket');
        await sendInitialStateForWaClient(ws, message.data, connectionManager);
        break;

      case WebSocketEvents.REGISTER_CLIENT_TYPE: {
        const data = (message.data || {}) as {
          clientType?: string;
          date?: string;
          chairId?: string;
        };
        switch (data.clientType) {
          case 'waStatus': {
            connectionManager.waStatusConnections.add(ws);
            const existing = connectionManager.clientCapabilities.get(ws);
            connectionManager.updateClientCapabilities(ws, {
              type: 'waStatus',
              metadata: { ...(existing?.metadata ?? {}), date: data.date ?? null },
            });
            logger.websocket.debug('Registered waStatus', { date: data.date ?? null });
            break;
          }

          case 'daily-appointments': {
            connectionManager.dailyAppointmentsConnections.add(ws);
            connectionManager.updateClientCapabilities(ws, { type: 'daily-appointments' });
            logger.websocket.debug('Registered daily-appointments');
            break;
          }

          case 'auth': {
            connectionManager.waStatusConnections.add(ws);
            connectionManager.updateClientCapabilities(ws, { type: 'auth' });
            if (
              messageState &&
              typeof messageState.registerQRViewer === 'function' &&
              !ws.qrViewerRegistered
            ) {
              messageState.registerQRViewer(ws.viewerId);
              ws.qrViewerRegistered = true;
              logger.websocket.debug('Registered auth (QR enabled)', { viewerId: ws.viewerId });
            } else {
              logger.websocket.debug('Registered auth (QR already registered)');
            }
            break;
          }

          case 'chair-display': {
            if (!data.chairId || !/^([1-9]|10)$/.test(data.chairId)) {
              logger.websocket.warn('Rejecting chair-display REGISTER: invalid chairId', { chairId: data.chairId });
              try { ws.close(1008, 'Invalid chairId'); } catch { /* already gone */ }
              break;
            }

            // If a prior socket is mapped to the same chairId (kiosk reconnected
            // before the previous socket's close event fired), close it
            // explicitly so its eventual close handler doesn't unregister us.
            const prev = connectionManager.chairDisplayConnections.get(data.chairId);
            if (prev && prev !== ws) {
              try { prev.close(1000, 'Replaced by new chair-display connection'); } catch { /* ignore */ }
            }

            connectionManager.chairDisplayConnections.set(data.chairId, ws);
            connectionManager.updateClientCapabilities(ws, {
              type: 'chair-display',
              metadata: { chairId: data.chairId },
            });
            logger.websocket.debug('Registered chair-display', { chairId: data.chairId });

            // Replay current patient if recorded and not stale.
            const stored = chairCurrentPatient.get(data.chairId);
            if (stored && Date.now() - stored.loadedAt < CHAIR_PATIENT_REPLAY_TTL_MS) {
              logger.websocket.debug('Replaying patient-loaded on chair-display REGISTER', {
                chairId: data.chairId,
                personId: stored.personId,
              });
              wsEmitter.emit(
                WebSocketEvents.CHAIR_DISPLAY_PATIENT_LOADED,
                String(stored.personId),
                data.chairId,
              );
            } else if (stored) {
              chairCurrentPatient.delete(data.chairId);
            }
            break;
          }

          default:
            logger.websocket.warn('REGISTER_CLIENT_TYPE: unknown clientType', { clientType: data.clientType });
        }
        break;
      }

      case WebSocketEvents.UNREGISTER_CLIENT_TYPE: {
        const data = (message.data || {}) as { clientType?: string };
        switch (data.clientType) {
          case 'waStatus':
            connectionManager.waStatusConnections.delete(ws);
            logger.websocket.debug('Unregistered waStatus');
            break;

          case 'daily-appointments':
            connectionManager.dailyAppointmentsConnections.delete(ws);
            logger.websocket.debug('Unregistered daily-appointments');
            break;

          case 'auth':
            connectionManager.waStatusConnections.delete(ws);
            if (ws.qrViewerRegistered && messageState && typeof messageState.unregisterQRViewer === 'function') {
              messageState.unregisterQRViewer(ws.viewerId);
              ws.qrViewerRegistered = false;
            }
            logger.websocket.debug('Unregistered auth');
            break;

          case 'chair-display': {
            // Locate by value — UNREGISTER doesn't carry chairId. unregisterConnection
            // does the same scan so we delegate; but UNREGISTER intentionally doesn't
            // tear down the whole socket — just removes the chair-display Map entry.
            for (const [chairId, mapped] of connectionManager.chairDisplayConnections) {
              if (mapped === ws) {
                connectionManager.chairDisplayConnections.delete(chairId);
                break;
              }
            }
            logger.websocket.debug('Unregistered chair-display');
            break;
          }

          default:
            logger.websocket.warn('UNREGISTER_CLIENT_TYPE: unknown clientType', { clientType: data.clientType });
        }
        break;
      }

      default:
        logger.websocket.warn('Unknown message type', { messageType: message.type });
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
      // Today-only contract: all registered daily-appointments clients are
      // viewing today. Fan out to every one — they discard non-matching dates
      // client-side (defense against midnight rollover / stray broadcasts).
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

  const inactivityHandle = setInterval(() => {
    const closed = connectionManager.closeInactiveConnections(inactivityTimeout);
    if (closed > 0) {
      logger.websocket.info('Closed inactive connections', { count: closed });
    }

    const counts = connectionManager.getConnectionCounts();
    logger.websocket.debug('Active connections', counts);
  }, 10 * 60 * 1000); // Every 10 minutes
  inactivityHandle.unref();
  _periodicTimers.push(inactivityHandle);

  const qrHealthHandle = setInterval(() => {
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
  }, 60000); // Every minute
  qrHealthHandle.unref();
  _periodicTimers.push(qrHealthHandle);

  // TCP-level heartbeat: terminate sockets that miss a pong within 30s.
  // Complements the 30-min inactivity sweep (which handles app-level idleness).
  // Chair-displays are included here — the activity sweep skips them, but
  // transport-dead kiosks should still be cleaned up promptly.
  const tcpPingHandle = setInterval(() => {
    for (const ws of connectionManager.allConnections) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* socket already dead */ }
    }
  }, 30_000); // Every 30 seconds
  tcpPingHandle.unref();
  _periodicTimers.push(tcpPingHandle);

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
