/**
 * WebSocket Service
 *
 * A robust WebSocket client with automatic reconnection, message queuing,
 * and freshness tracking. Liveness is enforced by:
 *   1. The server's TCP-level ws.ping() (30 s).
 *   2. A SERVER_HEARTBEAT message every 15 s — receipt drives the freshness signal.
 *   3. A 5 s freshness-poll zombie killer that force-reconnects if no message
 *      (including SERVER_HEARTBEAT) has arrived in 35 s.
 *
 * There is no client→server heartbeat ping; the freshness-poll catches everything
 * a client-side ping could detect, faster.
 */
import EventEmitter from '../core/events';
import { WebSocketEvents } from '../constants/websocket-events';
import {
  LIVENESS_STALE_THRESHOLD_MS,
  VISIBILITY_RESUME_THRESHOLD_MS,
} from '../constants/websocket-liveness';

// Type definitions
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type MessagePriority = 'high' | 'normal' | 'low';
export type Freshness = 'fresh' | 'stale';

// 2x the server heartbeat interval (15s) — one missed heartbeat tolerated.
const FRESHNESS_STALE_THRESHOLD_MS = 30_000;
// Internal poll cadence for freshness transitions; throttled by browser when tab is hidden.
const FRESHNESS_POLL_INTERVAL_MS = 5_000;

export interface WebSocketOptions {
  baseUrl?: string;
  reconnectInterval?: number;
  reconnectDecay?: number;
  maxReconnectInterval?: number;
  maxReconnectAttempts?: number | null;
  initialConnectionTimeout?: number;
  reconnectionTimeout?: number;
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
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  messageQueue: QueuedMessage[];
  pendingMessages: Map<number, PendingMessage>;
  forceClose: boolean;
  hasConnectedBefore: boolean;
  // performance.now() at last received message — monotonic; immune to wall-clock jumps.
  // 0 means stale (either never received or forcibly cleared on close/error).
  lastMessageReceivedAtMonotonic: number;
  // Last emitted freshness value, so we only emit freshness_changed on transitions.
  lastEmittedFreshness: Freshness;
  freshnessPollTimer: ReturnType<typeof setInterval> | null;
  // performance.now() at the moment the tab became hidden, or null if visible.
  // Drives the visibility-resume zombie check.
  hiddenSinceMonotonic: number | null;
  // Server-stamped connection identity from the last heartbeat. Reset on close
  // / forceReconnect so a stale id from a torn-down socket can't suppress the
  // first heartbeat's diff on the replacement socket.
  serverConnectionId: string | null;
  // Authoritative broadcast-Set membership reported by the most recent
  // heartbeat. The connection manager diffs this against its tracked
  // clientTypes to detect (and re-register) subscriptions the server forgot.
  serverSubscriptions: ReadonlySet<string>;
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
      reconnectTimer: null,
      messageQueue: [],
      pendingMessages: new Map(),
      forceClose: false,
      hasConnectedBefore: false,
      lastMessageReceivedAtMonotonic: 0,
      lastEmittedFreshness: 'stale',
      freshnessPollTimer: null,
      hiddenSinceMonotonic: null,
      serverConnectionId: null,
      serverSubscriptions: new Set(),
    };

    // Bind methods to ensure correct 'this' context
    this.connect = this.connect.bind(this);
    this.disconnect = this.disconnect.bind(this);
    this.send = this.send.bind(this);
    this.onMessage = this.onMessage.bind(this);
    this.onOpen = this.onOpen.bind(this);
    this.onClose = this.onClose.bind(this);
    this.onError = this.onError.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handlePageShow = this.handlePageShow.bind(this);
    this.handleOffline = this.handleOffline.bind(this);

    this.startFreshnessPoll();

    // Browser lifecycle hooks: detect long-hidden returns, bfcache restores,
    // and network drops so a zombie socket gets force-reconnected immediately
    // instead of waiting for the next freshness-poll tick (which is throttled
    // when the tab is hidden anyway).
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pageshow', this.handlePageShow);
    window.addEventListener('offline', this.handleOffline);

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
   * Connect to WebSocket server. Connection state (client-type subscriptions)
   * is managed via REGISTER_CLIENT_TYPE messages by ConnectionManager; the
   * upgrade URL itself carries no parameters.
   */
  connect(): Promise<WebSocketService> {
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

    const url = this.options.baseUrl;
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
    this.stopFreshnessPoll();

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
    console.info('[WebSocket] connected');

    // Update state
    this.state.status = 'connected';
    this.state.reconnectAttempts = 0;
    const wasReconnect = this.state.hasConnectedBefore;
    this.state.hasConnectedBefore = true;

    // Process queued messages
    this.processQueue();

    // Emit reconnected so subscribers can run idempotent recovery (e.g. REST refetch).
    if (wasReconnect) {
      this.emit('reconnected', { timestamp: Date.now() });
    }

    this.emit('connected', _event);
  }

  /**
   * Handle WebSocket close event
   */
  private onClose(event: CloseEvent): void {
    this.log(`WebSocket closed: ${event.code} - ${event.reason}`);
    console.info('[WebSocket] disconnected', { code: event.code, reason: event.reason });

    // Clear timers
    this.clearTimers();

    // Update state
    this.state.status = 'disconnected';
    this.state.ws = null;
    // Clear server-stamped identity so the next socket's first heartbeat is
    // treated as a fresh registration, not as a `connectionIdChanged` event.
    this.state.serverConnectionId = null;
    this.state.serverSubscriptions = new Set();
    this.markStale();

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
    this.markStale();
  }

  /**
   * Handle WebSocket message event
   */
  private onMessage(event: MessageEvent): void {
    // Update freshness on every message receipt. Using performance.now() so
    // a wall-clock jump (NTP sync, suspend/resume) can't mask staleness.
    this.state.lastMessageReceivedAtMonotonic = performance.now();
    if (this.state.lastEmittedFreshness !== 'fresh') {
      this.state.lastEmittedFreshness = 'fresh';
      this.emit('freshness_changed', { freshness: 'fresh' });
    }

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

      // SERVER_HEARTBEAT carries the server's authoritative view of this
      // socket's identity and broadcast-Set membership. Freshness is already
      // updated above; here we diff and emit `subscriptions_changed` on real
      // changes so the connection manager can re-register anything missing.
      if (typeof message === 'object' && msgObj.type === WebSocketEvents.SERVER_HEARTBEAT) {
        const hbData = (msgObj.data ?? {}) as { connectionId?: string; subscriptions?: string[] };
        if (hbData.connectionId) {
          const nextConnId = hbData.connectionId;
          const nextSubs = new Set(hbData.subscriptions ?? []);
          const prevConnId = this.state.serverConnectionId;
          const prevSubs = this.state.serverSubscriptions;
          const subsChanged =
            nextSubs.size !== prevSubs.size ||
            [...nextSubs].some((s) => !prevSubs.has(s));
          const connIdChanged = prevConnId !== null && prevConnId !== nextConnId;
          if (connIdChanged || subsChanged || prevConnId === null) {
            this.state.serverConnectionId = nextConnId;
            this.state.serverSubscriptions = nextSubs;
            this.emit('subscriptions_changed', {
              connectionId: nextConnId,
              subscriptions: Array.from(nextSubs),
              connectionIdChanged: connIdChanged,
            });
          }
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
   * Compute current data freshness. Stale if socket isn't OPEN, or no message
   * (including SERVER_HEARTBEAT) has arrived within FRESHNESS_STALE_THRESHOLD_MS.
   */
  getFreshness(): Freshness {
    if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) {
      return 'stale';
    }
    if (this.state.lastMessageReceivedAtMonotonic === 0) {
      return 'stale';
    }
    const elapsed = performance.now() - this.state.lastMessageReceivedAtMonotonic;
    return elapsed > FRESHNESS_STALE_THRESHOLD_MS ? 'stale' : 'fresh';
  }

  /**
   * Force the freshness signal to 'stale' immediately. Used by recovery-fetch
   * failure handlers so the indicator reflects the data gap without waiting
   * for the next heartbeat miss.
   */
  markStale(): void {
    this.state.lastMessageReceivedAtMonotonic = 0;
    if (this.state.lastEmittedFreshness !== 'stale') {
      this.state.lastEmittedFreshness = 'stale';
      this.emit('freshness_changed', { freshness: 'stale' });
    }
  }

  /**
   * Internal 5s poll. Two jobs in one tick (no overlapping intervals, no drift):
   *
   * 1. Emit `freshness_changed` on transitions so the indicator updates.
   * 2. **Zombie-socket killer**: if the WS reports OPEN but no message
   *    (including the 15s server heartbeat) has arrived in LIVENESS_STALE_THRESHOLD_MS,
   *    force-close so the reconnect path runs. This is what catches silent
   *    mobile NAT drops and Cloudflare Tunnel idle drops — the OS never gets
   *    a FIN/RST, so `readyState` lies until we actively probe.
   *
   * Browsers throttle setInterval in hidden tabs, so this won't fire reliably
   * while backgrounded — the `visibilitychange` / `pageshow` handlers are the
   * safety net for the long-hidden case.
   */
  private startFreshnessPoll(): void {
    if (this.state.freshnessPollTimer) return;
    this.state.freshnessPollTimer = setInterval(() => {
      const current = this.getFreshness();
      if (current !== this.state.lastEmittedFreshness) {
        this.state.lastEmittedFreshness = current;
        this.emit('freshness_changed', { freshness: current });
      }

      const last = this.state.lastMessageReceivedAtMonotonic;
      if (
        last > 0 &&
        performance.now() - last > LIVENESS_STALE_THRESHOLD_MS &&
        this.state.ws?.readyState === WebSocket.OPEN
      ) {
        this.forceReconnect('liveness timeout');
      }
    }, FRESHNESS_POLL_INTERVAL_MS);
  }

  private stopFreshnessPoll(): void {
    if (this.state.freshnessPollTimer) {
      clearInterval(this.state.freshnessPollTimer);
      this.state.freshnessPollTimer = null;
    }
  }

  /**
   * Defensively close the current socket and schedule a reconnect. Drives the
   * reconnect itself rather than depending on `onClose` firing — bfcache
   * restores leave the underlying descriptor dead, and `close()` on a torn-down
   * socket can throw or silently no-op without ever delivering the close event.
   */
  private forceReconnect(reason: string): void {
    this.log(`Force reconnect: ${reason}`);
    console.warn('[WebSocket] force reconnect', { reason });
    const dead = this.state.ws;
    this.state.ws = null;
    if (dead) {
      // Null listeners first so any delayed open/message/close/error events
      // from the torn-down socket can't bleed into our state machine.
      dead.onopen = null;
      dead.onmessage = null;
      dead.onclose = null;
      dead.onerror = null;
      try {
        dead.close(1000, reason);
      } catch {
        /* descriptor may already be gone (bfcache) */
      }
    }
    this.clearTimers();
    this.state.status = 'disconnected';
    // Clear server-stamped identity — see onClose for rationale.
    this.state.serverConnectionId = null;
    this.state.serverSubscriptions = new Set();
    this.markStale();
    this.emit('disconnected', { code: 1000, reason, wasClean: true });
    if (!this.state.forceClose && this.options.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.state.hiddenSinceMonotonic = performance.now();
      return;
    }
    // Don't materialize a connection on visibility-resume if the app never
    // opened one. hasConnectedBefore gates this on "we previously had a
    // working connection that needs restoring".
    if (!this.state.hasConnectedBefore) {
      this.state.hiddenSinceMonotonic = null;
      return;
    }
    const since = this.state.hiddenSinceMonotonic;
    this.state.hiddenSinceMonotonic = null;
    if (since !== null && performance.now() - since > VISIBILITY_RESUME_THRESHOLD_MS) {
      this.forceReconnect('visibility resume');
      return;
    }
    if (this.getFreshness() === 'stale') {
      this.forceReconnect('visible while stale');
    }
  }

  private handlePageShow(event: PageTransitionEvent): void {
    if (event.persisted && this.state.hasConnectedBefore) {
      // iOS Safari bfcache restore: the socket descriptor is torn down even
      // though the JS WebSocket object still reports readyState === OPEN.
      this.forceReconnect('pageshow bfcache');
    }
  }

  private handleOffline(): void {
    // Surface the gap immediately instead of waiting for the next 5s poll tick.
    this.markStale();
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
      if (!this.state.ws || this.state.ws.readyState !== WebSocket.OPEN) {
        // Socket died mid-drain — requeue what's left and bail; the next
        // 'connected' event will retry.
        this.state.messageQueue.push(message);
        continue;
      }
      try {
        this.state.ws.send(message.data);

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
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.state.reconnectTimer) {
      clearTimeout(this.state.reconnectTimer);
      this.state.reconnectTimer = null;
    }
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
