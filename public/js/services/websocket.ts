/**
 * WebSocket Service
 * A robust WebSocket client with automatic reconnection, heartbeat, and message queuing
 */
import EventEmitter from '../core/events';
import storage from '../core/storage';
import { WebSocketEvents } from '../constants/websocket-events';

// Type definitions
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type MessagePriority = 'high' | 'normal' | 'low';
export type SyncStatus = 'synced' | 'syncing' | 'out_of_sync';

export interface WebSocketOptions {
  baseUrl?: string;
  reconnectInterval?: number;
  reconnectDecay?: number;
  maxReconnectInterval?: number;
  maxReconnectAttempts?: number | null;
  initialConnectionTimeout?: number;
  reconnectionTimeout?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  maxQueueSize?: number;
  autoReconnect?: boolean;
  autoConnect?: boolean;
  debug?: boolean;
}

export interface SendOptions {
  timeout?: number;
  expectResponse?: boolean;
  responseId?: string | null;
  retries?: number;
  queueIfDisconnected?: boolean;
  priority?: MessagePriority;
}

export interface ConnectionParams {
  clientType?: string;
  PDate?: string;
  timestamp?: number;
  [key: string]: string | number | boolean | undefined;
}

interface PendingMessage {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  expectResponse?: boolean;
  responseId?: string | null;
  retries?: number;
}

interface QueuedMessage {
  id: number;
  data: string;
  options: SendOptions;
  timestamp: number;
  priority?: MessagePriority;
}

interface WebSocketState {
  status: ConnectionStatus;
  ws: WebSocket | null;
  reconnectAttempts: number;
  lastMessageId: number;
  lastActivity: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null;
  messageQueue: QueuedMessage[];
  pendingMessages: Map<number, PendingMessage>;
  forceClose: boolean;
  screenId: string | null;
  hasConnectedBefore: boolean;
  sequenceNumbers: Map<string, number>;
  missedEventRequests: Set<string>;
  syncStatus: SyncStatus;
  pendingEventCount: number;
}

interface SyncStatusInfo {
  date?: string;
  lastSequenceNum?: number;
  isSyncing?: boolean;
  syncStatus: SyncStatus;
  pendingEventCount?: number;
  trackedDates?: string[];
  sequenceNumbers?: Record<string, number>;
}

export class WebSocketService extends EventEmitter {
  private options: Required<WebSocketOptions>;
  private state: WebSocketState;

  /**
   * Create a new WebSocket service
   * @param options - Configuration options
   */
  constructor(options: WebSocketOptions = {}) {
    super();

    // Default options
    this.options = {
      // Base URL for WebSocket connection
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
      reconnectInterval: 2000,
      reconnectDecay: 1.5,
      maxReconnectInterval: 30000,
      maxReconnectAttempts: 20,

      // Connection timeout (progressive)
      initialConnectionTimeout: 45000,
      reconnectionTimeout: 15000,

      // Heartbeat configuration
      heartbeatInterval: 60000,
      heartbeatTimeout: 30000,

      // Message handling
      maxQueueSize: 100,
      autoReconnect: true,
      autoConnect: false,
      debug: false,

      // Override with provided options
      ...options,
    };

    // Connection state
    this.state = {
      status: 'disconnected',
      ws: null,
      reconnectAttempts: 0,
      lastMessageId: 0,
      lastActivity: Date.now(),
      reconnectTimer: null,
      heartbeatTimer: null,
      heartbeatTimeoutTimer: null,
      messageQueue: [],
      pendingMessages: new Map(),
      forceClose: false,
      screenId: null,
      hasConnectedBefore: false,
      sequenceNumbers: new Map(),
      missedEventRequests: new Set(),
      syncStatus: 'synced',
      pendingEventCount: 0,
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
   */
  get status(): ConnectionStatus {
    return this.state.status;
  }

  /**
   * Check if connection is active
   */
  get isConnected(): boolean {
    return (
      this.state.status === 'connected' &&
      this.state.ws !== null &&
      this.state.ws.readyState === WebSocket.OPEN
    );
  }

  /**
   * Connect to WebSocket server
   * @param params - Connection parameters
   * @returns This service instance
   */
  connect(params: ConnectionParams = {}): Promise<WebSocketService> {
    this.log('Connecting to WebSocket server...');

    // If already connected or connecting, return
    if (this.state.status === 'connected' || this.state.status === 'connecting') {
      this.log('Already connected or connecting');
      return Promise.resolve(this);
    }

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
        if (
          this.state.ws.readyState === WebSocket.OPEN ||
          this.state.ws.readyState === WebSocket.CONNECTING
        ) {
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
        const onConnect = (): void => {
          this.off('connected', onConnect);
          this.off('error', onError);
          resolve(this);
        };

        const onError = (error: unknown): void => {
          this.off('connected', onConnect);
          this.off('error', onError);
          reject(error);
        };

        this.once('connected', onConnect);
        this.once('error', onError);

        // Progressive timeout
        const isFirstConnection = !this.state.hasConnectedBefore;
        const timeoutDuration = isFirstConnection
          ? this.options.initialConnectionTimeout
          : this.options.reconnectionTimeout;

        this.log(
          `Setting connection timeout: ${timeoutDuration}ms (${isFirstConnection ? 'initial' : 'reconnection'})`
        );

        // For initial connection, show helpful message halfway through
        if (isFirstConnection) {
          setTimeout(() => {
            if (this.state.status === 'connecting') {
              console.log('[WebSocket] Still connecting... Server may be starting up. Please wait.');
              this.emit('connecting_slow', {
                message: 'Server may be starting up',
                elapsed: timeoutDuration / 2,
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

            // Close the underlying WebSocket
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
   * @param code - Close code
   * @param reason - Close reason
   */
  disconnect(code = 1000, reason = ''): void {
    this.log(`Disconnecting WebSocket (${code}: ${reason})`);

    // Set force close flag to prevent auto-reconnect
    this.state.forceClose = true;

    // Clear timers
    this.clearTimers();

    // Clear message queue
    this.state.messageQueue = [];

    // Reject all pending messages
    for (const [, { reject }] of this.state.pendingMessages) {
      reject(new Error('WebSocket disconnected'));
    }
    this.state.pendingMessages.clear();

    // Close WebSocket if it exists
    if (this.state.ws) {
      try {
        // Remove event listeners
        this.state.ws.onopen = null;
        this.state.ws.onmessage = null;
        this.state.ws.onclose = null;
        this.state.ws.onerror = null;

        // Close the connection if still open
        if (
          this.state.ws.readyState === WebSocket.OPEN ||
          this.state.ws.readyState === WebSocket.CONNECTING
        ) {
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
   * @param message - Message to send
   * @param options - Send options
   * @returns Promise that resolves with the response
   */
  send(message: string | Record<string, unknown>, options: SendOptions = {}): Promise<unknown> {
    const defaultOptions: Required<SendOptions> = {
      timeout: 30000,
      expectResponse: false,
      responseId: null,
      retries: 3,
      queueIfDisconnected: true,
      priority: 'normal',
    };

    const sendOptions = { ...defaultOptions, ...options };

    // Create a new message ID
    const messageId = ++this.state.lastMessageId;

    // Prepare message data
    let messageData: string;
    if (typeof message === 'string') {
      messageData = message;
    } else {
      messageData = JSON.stringify({
        id: messageId,
        ...message,
      });
    }

    // If not connected, queue message or reject
    if (!this.isConnected) {
      if (sendOptions.queueIfDisconnected) {
        this.log(
          `Queueing message (${messageId}): ${messageData.substring(0, 100)}${messageData.length > 100 ? '...' : ''}`
        );

        // If queue is full, remove oldest messages
        if (this.state.messageQueue.length >= this.options.maxQueueSize) {
          const removeIndex = this.state.messageQueue.findIndex((item) => item.priority === 'low');
          if (removeIndex >= 0) {
            this.state.messageQueue.splice(removeIndex, 1);
          } else {
            this.state.messageQueue.shift();
          }
        }

        // Add to queue
        this.state.messageQueue.push({
          id: messageId,
          data: messageData,
          options: sendOptions,
          timestamp: Date.now(),
        });

        // Try to connect if not already
        if (this.state.status === 'disconnected' && this.options.autoReconnect) {
          this.connect();
        }

        // Return a promise that resolves when the message is actually sent
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            const queueIndex = this.state.messageQueue.findIndex((m) => m.id === messageId);
            if (queueIndex >= 0) {
              this.state.messageQueue.splice(queueIndex, 1);
              reject(new Error(`Message ${messageId} timed out in queue`));
            }
          }, sendOptions.timeout);

          this.state.pendingMessages.set(messageId, {
            resolve,
            reject,
            timeout: timeoutId,
            expectResponse: sendOptions.expectResponse,
            responseId: sendOptions.responseId,
            retries: sendOptions.retries,
          });
        });
      } else {
        return Promise.reject(new Error('WebSocket not connected'));
      }
    }

    // Send message directly
    try {
      this.log(
        `Sending message (${messageId}): ${messageData.substring(0, 100)}${messageData.length > 100 ? '...' : ''}`
      );
      this.state.ws!.send(messageData);

      // Update last activity
      this.state.lastActivity = Date.now();

      // If expecting response, return promise
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
            responseId: sendOptions.responseId,
          });
        });
      } else {
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
   */
  private onOpen(_event: Event): void {
    this.log('WebSocket connected');

    // Update state
    this.state.status = 'connected';
    this.state.reconnectAttempts = 0;
    this.state.lastActivity = Date.now();
    const wasReconnect = this.state.hasConnectedBefore;
    this.state.hasConnectedBefore = true;

    // Start heartbeat
    this.startHeartbeat();

    // Process queued messages
    this.processQueue();

    // Request state verification on reconnect
    if (wasReconnect) {
      this.log('[PHASE 1] Reconnected - requesting state verification');
      this.state.syncStatus = 'syncing';

      this.emit('reconnected', {
        sequenceNumbers: Object.fromEntries(this.state.sequenceNumbers),
      });

      setTimeout(() => {
        if (this.state.syncStatus === 'syncing') {
          this.state.syncStatus = 'synced';
        }
      }, 5000);
    }

    this.emit('connected', _event);
  }

  /**
   * Handle WebSocket close event
   */
  private onClose(event: CloseEvent): void {
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
      wasClean: event.wasClean,
    });

    // Reconnect if not force closed
    if (!this.state.forceClose && this.options.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket error event
   */
  private onError(event: Event): void {
    this.log('WebSocket error:', event);
    console.error('[WebSocket] Error occurred:', {
      type: event.type,
      target: event.target,
      readyState: this.state.ws?.readyState,
      url: this.state.ws?.url,
    });

    this.emit('error', event);
    this.state.status = 'error';
  }

  /**
   * Handle WebSocket message event
   */
  private onMessage(event: MessageEvent): void {
    // Update last activity
    this.state.lastActivity = Date.now();

    try {
      let message: unknown;

      // Try to parse as JSON
      try {
        message = JSON.parse(event.data);
      } catch {
        message = event.data;
      }

      this.log(
        `Received message: ${typeof message === 'string' ? message : JSON.stringify(message).substring(0, 100)}`
      );

      const msgObj = message as Record<string, unknown>;

      // Send ACK for messages that require it
      if (typeof message === 'object' && msgObj.requiresAck && msgObj.id) {
        this.log(`[PHASE 1] Sending ACK for message ${msgObj.id}`);
        this.send(
          { type: 'ack', messageId: msgObj.id },
          { queueIfDisconnected: false }
        );
      }

      // Handle sequence numbers for appointment events
      if (typeof message === 'object' && msgObj.sequenceNum !== undefined && msgObj.date) {
        const lastSeq = this.state.sequenceNumbers.get(msgObj.date as string) || 0;
        const receivedSeq = msgObj.sequenceNum as number;

        this.log(
          `[PHASE 1] Sequence check - Date: ${msgObj.date}, Last: ${lastSeq}, Received: ${receivedSeq}`
        );

        if (receivedSeq > lastSeq + 1) {
          console.warn(
            `[PHASE 1] Sequence gap detected! Expected ${lastSeq + 1}, got ${receivedSeq}`
          );
          this.handleSequenceGap(msgObj.date as string, lastSeq, receivedSeq);
        }

        this.state.sequenceNumbers.set(msgObj.date as string, receivedSeq);
      }

      // Handle full refresh request from server
      if (typeof message === 'object' && msgObj.fullRefreshRequired) {
        console.warn(`[PHASE 1] Server requesting full refresh: ${msgObj.reason || 'unknown'}`);
        this.emit('fullRefreshRequired', { date: msgObj.date, reason: msgObj.reason });
        return;
      }

      // Check if it's a heartbeat/ping response
      if (
        typeof message === 'object' &&
        (msgObj.type === WebSocketEvents.HEARTBEAT_PING ||
          msgObj.type === WebSocketEvents.HEARTBEAT_PONG)
      ) {
        if (msgObj.type === WebSocketEvents.HEARTBEAT_PING) {
          this.send({ type: WebSocketEvents.HEARTBEAT_PONG }, { queueIfDisconnected: false });
        } else if (msgObj.type === WebSocketEvents.HEARTBEAT_PONG) {
          this.log('Received heartbeat pong response');

          if (this.state.heartbeatTimeoutTimer) {
            clearTimeout(this.state.heartbeatTimeoutTimer);
            this.state.heartbeatTimeoutTimer = null;
          }

          this.scheduleNextHeartbeat();
        }
        return;
      }

      // Check if it's a response to a pending message
      if (typeof message === 'object' && msgObj.id) {
        const pendingMessage = this.state.pendingMessages.get(msgObj.id as number);

        if (pendingMessage) {
          clearTimeout(pendingMessage.timeout);
          pendingMessage.resolve(message);
          this.state.pendingMessages.delete(msgObj.id as number);
          this.emit('message', message);
          return;
        }
      }

      // Emit based on message type
      if (typeof message === 'object' && msgObj.messageType) {
        this.emit(msgObj.messageType as string, message);
      }

      if (typeof message === 'object' && msgObj.type) {
        this.log(`Emitting event for message type '${msgObj.type}'`);

        if (this.options.debug) {
          console.log(`📡 [WebSocket Service] Message received - Type: ${msgObj.type}`);
          console.log(`📡 [WebSocket Service] Full message:`, JSON.stringify(message, null, 2));
          console.log(
            `📡 [WebSocket Service] Data payload:`,
            JSON.stringify(msgObj.data || message, null, 2)
          );
        }

        this.emit(msgObj.type as string, msgObj.data || message);

        if (this.options.debug) {
          console.log(`📡 [WebSocket Service] Event '${msgObj.type}' emitted successfully`);
        }
      }

      this.emit('message', message);
    } catch (error) {
      this.log('Error processing message:', error);
      this.emit('error', error);
    }
  }

  /**
   * Handle sequence gap - request missed events
   */
  private handleSequenceGap(date: string, lastSeq: number, receivedSeq: number): void {
    if (this.state.missedEventRequests.has(date)) {
      this.log(`[PHASE 1] Already requested missed events for ${date}, skipping`);
      return;
    }

    this.log(`[PHASE 1] Requesting missed events for ${date} (seq ${lastSeq + 1} to ${receivedSeq - 1})`);
    this.state.syncStatus = 'syncing';
    this.state.missedEventRequests.add(date);

    this.send(
      {
        type: 'request_missed_events',
        date: date,
        lastSequenceNum: lastSeq,
      },
      { queueIfDisconnected: false }
    );

    setTimeout(() => {
      this.state.missedEventRequests.delete(date);
      this.state.syncStatus = 'synced';
    }, 10000);
  }

  /**
   * Set heartbeat timeout
   */
  private setHeartbeatTimeout(): void {
    if (this.state.heartbeatTimeoutTimer) {
      clearTimeout(this.state.heartbeatTimeoutTimer);
    }

    this.log('Setting heartbeat timeout timer');

    this.state.heartbeatTimeoutTimer = setTimeout(() => {
      this.log('Heartbeat timeout - no pong received');

      if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
        this.log('Forcing close due to heartbeat timeout');
        this.state.ws.close(1000, 'Heartbeat timeout');
        this.state.ws = null;
        this.state.status = 'disconnected';
        this.scheduleReconnect();
      }
    }, this.options.heartbeatTimeout);
  }

  /**
   * Schedule next heartbeat
   */
  private scheduleNextHeartbeat(delay: number | null = null): void {
    if (this.state.heartbeatTimer) {
      clearTimeout(this.state.heartbeatTimer);
    }

    const interval = delay || this.options.heartbeatInterval;
    this.log(`Scheduling next heartbeat in ${interval}ms`);

    this.state.heartbeatTimer = setTimeout(() => {
      this.sendHeartbeat();
    }, interval);
  }

  /**
   * Process queued messages
   */
  private processQueue(): void {
    if (this.state.messageQueue.length === 0) return;

    this.log(`Processing message queue (${this.state.messageQueue.length} messages)`);

    // Sort queue by priority and timestamp
    this.state.messageQueue.sort((a, b) => {
      const priorityOrder: Record<MessagePriority, number> = { high: 0, normal: 1, low: 2 };
      const aPriority = priorityOrder[a.options.priority || 'normal'];
      const bPriority = priorityOrder[b.options.priority || 'normal'];

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      } else {
        return a.timestamp - b.timestamp;
      }
    });

    const queue = [...this.state.messageQueue];
    this.state.messageQueue = [];

    for (const message of queue) {
      try {
        this.state.ws!.send(message.data);

        const pendingMessage = this.state.pendingMessages.get(message.id);
        if (pendingMessage) {
          if (pendingMessage.expectResponse) {
            clearTimeout(pendingMessage.timeout);
            pendingMessage.timeout = setTimeout(() => {
              this.state.pendingMessages.delete(message.id);
              pendingMessage.reject(
                new Error(`Message ${message.id} timed out waiting for response`)
              );
            }, message.options.timeout || 30000);
          } else {
            clearTimeout(pendingMessage.timeout);
            pendingMessage.resolve(undefined);
            this.state.pendingMessages.delete(message.id);
          }
        }
      } catch (error) {
        this.log(`Error sending queued message ${message.id}:`, error);

        if ((message.options.retries || 0) > 0) {
          message.options.retries!--;
          this.state.messageQueue.push(message);
        } else {
          const pendingMessage = this.state.pendingMessages.get(message.id);
          if (pendingMessage) {
            clearTimeout(pendingMessage.timeout);
            pendingMessage.reject(error as Error);
            this.state.pendingMessages.delete(message.id);
          }
        }
      }
    }
  }

  /**
   * Schedule reconnect attempt
   */
  private scheduleReconnect(): void {
    if (this.state.forceClose) return;

    if (
      this.options.maxReconnectAttempts !== null &&
      this.state.reconnectAttempts >= this.options.maxReconnectAttempts
    ) {
      this.log('Maximum reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      this.options.reconnectInterval *
        Math.pow(this.options.reconnectDecay, this.state.reconnectAttempts),
      this.options.maxReconnectInterval
    );

    this.log(`Scheduling reconnect attempt ${this.state.reconnectAttempts + 1} in ${delay}ms`);

    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
    }

    this.state.reconnectTimer = setTimeout(() => {
      this.state.reconnectAttempts++;
      this.connect().catch(() => {});
    }, delay);
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    this.log('Starting heartbeat');
    this.clearHeartbeatTimers();
    this.sendHeartbeat();
  }

  /**
   * Clear heartbeat timers
   */
  private clearHeartbeatTimers(): void {
    if (this.state.heartbeatTimer) {
      this.log('Clearing existing heartbeat timer');
      clearTimeout(this.state.heartbeatTimer);
      this.state.heartbeatTimer = null;
    }

    if (this.state.heartbeatTimeoutTimer) {
      this.log('Clearing existing heartbeat timeout timer');
      clearTimeout(this.state.heartbeatTimeoutTimer);
      this.state.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * Send heartbeat
   */
  private sendHeartbeat(): void {
    this.log('Sending heartbeat (ping)');

    this.send({ type: WebSocketEvents.HEARTBEAT_PING }, { queueIfDisconnected: false })
      .then(() => {
        this.log('Heartbeat (ping) sent successfully');
        this.setHeartbeatTimeout();
      })
      .catch((error) => {
        this.log('Error sending heartbeat:', error);
        this.scheduleNextHeartbeat(5000);
      });
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
      this.state.reconnectTimer = null;
    }

    if (this.state.heartbeatTimer) {
      clearTimeout(this.state.heartbeatTimer);
      this.state.heartbeatTimer = null;
    }

    if (this.state.heartbeatTimeoutTimer) {
      clearTimeout(this.state.heartbeatTimeoutTimer);
      this.state.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * Build connection URL with parameters
   */
  private buildConnectionUrl(params: ConnectionParams = {}): string {
    const url = new URL(this.options.baseUrl);

    if (params.clientType === 'appointments') {
      if (!this.state.screenId) {
        this.state.screenId = storage.screenId() || 'unknown';
      }
      url.searchParams.append('screenID', this.state.screenId);
    }

    let dateParam: string;
    if (params.PDate) {
      dateParam = params.PDate;
    } else {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      dateParam = `${year}-${month}-${day}`;
    }
    url.searchParams.append('PDate', dateParam);

    for (const [key, value] of Object.entries(params)) {
      if (key !== 'PDate' && value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    }

    return url.toString();
  }

  /**
   * Log message if debug enabled
   */
  private log(message: string, data?: unknown): void {
    if (!this.options.debug) return;

    if (data !== undefined) {
      console.log(`[WebSocketService] ${message}`, data);
    } else {
      console.log(`[WebSocketService] ${message}`);
    }
  }

  /**
   * Get sync status for a specific date
   */
  getSyncStatus(date: string | null = null): SyncStatusInfo {
    if (date) {
      return {
        date,
        lastSequenceNum: this.state.sequenceNumbers.get(date) || 0,
        isSyncing: this.state.missedEventRequests.has(date),
        syncStatus: this.state.syncStatus,
      };
    }

    return {
      syncStatus: this.state.syncStatus,
      pendingEventCount: this.state.pendingEventCount,
      trackedDates: Array.from(this.state.sequenceNumbers.keys()),
      sequenceNumbers: Object.fromEntries(this.state.sequenceNumbers),
    };
  }

  /**
   * Get last sequence number for a date
   */
  getLastSequenceNumber(date: string): number {
    return this.state.sequenceNumbers.get(date) || 0;
  }

  /**
   * Reset sequence tracking for a date
   */
  resetSequenceTracking(date: string): void {
    this.state.sequenceNumbers.delete(date);
    this.state.missedEventRequests.delete(date);
    this.log(`[PHASE 1] Reset sequence tracking for ${date}`);
  }
}

/**
 * Factory function to create a new WebSocket connection
 */
export function createWebSocketConnection(options: WebSocketOptions = {}): WebSocketService {
  return new WebSocketService({
    debug: true,
    autoConnect: false,
    ...options,
  });
}

/**
 * Default export: Singleton instance for simple usage
 */
export default new WebSocketService({
  debug: true,
  autoConnect: false,
});
