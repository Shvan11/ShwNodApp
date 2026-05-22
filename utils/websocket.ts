// utils/websocket.ts
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import type { Server as HTTPServer } from 'http';
import messageState from '../services/state/messageState.js';
import { createWebSocketMessage, validateWebSocketMessage, MessageSchemas } from '../services/messaging/schemas.js';
import { WebSocketEvents, InternalEmitterEvents, createStandardMessage } from '../services/messaging/websocket-events.js';
import { logger } from '../services/core/Logger.js';
import stateEvents from '../services/state/stateEvents.js';
import qrcode from 'qrcode';

// ===========================================
// TYPES
// ===========================================

/**
 * Connection type identifiers. `daily-appointments` and `chair-display`
 * channels moved to SSE (see services/messaging/sse-broadcaster.ts).
 */
type ConnectionType = 'waStatus' | 'auth' | 'generic';

/**
 * Per-socket bookkeeping kept on the connection manager.
 * `type` is informational (used by the inactivity sweep to skip chair-displays);
 * `lastActivity` drives the same sweep.
 */
interface ClientCapabilities {
  type: ConnectionType;
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
  waStatus: number;
}

/**
 * Typed WebSocket message structure
 */
interface TypedMessage {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
}

// ===========================================
// CONNECTION MANAGER
// ===========================================

/**
 * WebSocket Connection Manager
 */
class ConnectionManager {
  /**
   * Holds both 'waStatus' and 'auth' sockets — auth clients also need the
   * QR_UPDATE / CLIENT_READY / message-status broadcasts that go through
   * this Set. The name reflects the broadcast channel, not the client type.
   */
  waStatusConnections: Set<ExtendedWebSocket>;
  allConnections: Set<ExtendedWebSocket>;
  clientCapabilities: WeakMap<ExtendedWebSocket, ClientCapabilities>;

  constructor() {
    this.waStatusConnections = new Set();
    this.allConnections = new Set();
    this.clientCapabilities = new WeakMap();
  }

  registerConnection(ws: ExtendedWebSocket, type: ConnectionType): void {
    // Every new socket enters as 'generic' and joins allConnections only.
    // Type-specific Set membership is established later via REGISTER_CLIENT_TYPE.
    this.allConnections.add(ws);
    this.clientCapabilities.set(ws, { type, lastActivity: Date.now() });
  }

  unregisterConnection(ws: ExtendedWebSocket): void {
    this.allConnections.delete(ws);
    this.waStatusConnections.delete(ws);
    this.clientCapabilities.delete(ws);
  }

  broadcastToWaStatus(message: unknown): number {
    let sentCount = 0;
    for (const ws of this.waStatusConnections) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        this.sendToClient(ws, message);
        sentCount++;
      } catch (error) {
        logger.websocket.error('Error sending to WhatsApp status client', error as Error);
      }
    }
    return sentCount;
  }

  broadcastToAll(message: unknown): number {
    let sentCount = 0;
    for (const ws of this.allConnections) {
      if (ws.readyState !== WebSocket.OPEN) continue;
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
    const formattedMessage = typeof message === 'string' ? message : JSON.stringify(message);

    // Callback form so async write errors (ECONNRESET, EPIPE, clean proxy
    // RSTs from Cloudflare Tunnel idle drops) clean up the dead socket
    // within one heartbeat cycle instead of waiting for the TCP ping sweep.
    // Doesn't help with silent mobile NAT drops — those still need the TCP
    // ping (no error packet ever arrives to trigger the callback).
    ws.send(formattedMessage, (err) => {
      if (err) this.handleSendError(ws, err);
    });

    const capabilities = this.clientCapabilities.get(ws);
    if (capabilities) {
      capabilities.lastActivity = Date.now();
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
      waStatus: this.waStatusConnections.size
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

    connectionManager.registerConnection(extWs, 'generic');

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
      case WebSocketEvents.REQUEST_WHATSAPP_INITIAL_STATE:
        logger.websocket.debug('Received request for initial state via WebSocket');
        await sendInitialStateForWaClient(ws, message.data, connectionManager);
        break;

      case WebSocketEvents.REGISTER_CLIENT_TYPE: {
        const data = (message.data || {}) as { clientType?: string };
        switch (data.clientType) {
          case 'waStatus': {
            connectionManager.waStatusConnections.add(ws);
            connectionManager.updateClientCapabilities(ws, { type: 'waStatus' });
            logger.websocket.debug('Registered waStatus');
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

          case 'auth':
            connectionManager.waStatusConnections.delete(ws);
            if (ws.qrViewerRegistered && messageState && typeof messageState.unregisterQRViewer === 'function') {
              messageState.unregisterQRViewer(ws.viewerId);
              ws.qrViewerRegistered = false;
            }
            logger.websocket.debug('Unregistered auth');
            break;

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
  // Appointments + chair-display events now flow through the SSE broadcaster
  // (services/messaging/sse-broadcaster.ts) which subscribes to the same
  // wsEmitter — emit sites in appointment.routes.ts and chair-display.routes.ts
  // are unchanged.

  // Route pre-formed broadcast messages emitted by routes/services to the
  // appropriate connection-set fan-out based on the message's `type`.
  emitter.on(InternalEmitterEvents.BROADCAST_MESSAGE, (message: { type: string }) => {
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
