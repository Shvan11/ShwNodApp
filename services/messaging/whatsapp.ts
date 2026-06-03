// services/messaging/whatsapp.ts - WhatsApp Service with MessageSession Architecture
import EventEmitter from 'events';
import messageState, { type Person as StatePersonType } from '../state/messageState.js';
import stateEvents from '../state/stateEvents.js';
import { getWhatsAppMessages, markWhatsAppBatchSent } from '../database/queries/messaging-queries.js';
import * as messagingQueries from '../database/queries/messaging-queries.js';
import { InternalEmitterEvents } from './websocket-events.js';
import { messageSessionManager, type MessageLookupResult } from './MessageSessionManager.js';
import { type MessageSession } from './MessageSession.js';
import { log } from '../../utils/logger.js';
import { PhoneFormatter } from '../../utils/phoneFormatter.js';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;

// ===========================================
// TYPES AND INTERFACES
// ===========================================

/**
 * Client state lifecycle
 */
export type ClientState = 'DISCONNECTED' | 'INITIALIZING' | 'CONNECTED' | 'ERROR' | 'DESTROYED';

/**
 * Circuit breaker state
 */
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Lock waiter entry
 */
interface LockWaiter {
  resolve: () => void;
  reject: () => void;
  timeout: NodeJS.Timeout;
  timestamp: number;
}

/**
 * Client status information
 */
interface ClientStatus {
  state: ClientState;
  connected: boolean;
  initializing: boolean;
  reconnectAttempts: number;
  lastError: string | undefined;
  hasActivePromise: boolean;
}

/**
 * Circuit breaker status
 */
interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number | null;
  isOpen: boolean;
  timeInCurrentState: number;
  halfOpenCalls: number;
}

/**
 * WebSocket emitter interface
 */
interface WebSocketEmitter {
  emit(event: string, data: unknown): boolean;
}

/**
 * Puppeteer browser interface (partial)
 */
interface PuppeteerBrowser {
  pages(): Promise<PuppeteerPage[]>;
  close(): Promise<void>;
  process(): { kill(signal: string): void } | null;
}

/**
 * Puppeteer page interface (partial)
 */
interface PuppeteerPage {
  close(): Promise<void>;
}

/**
 * WhatsApp client interface (partial)
 */
export interface WhatsAppClient {
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  logout(): Promise<void>;
  getState(): Promise<string>;
  getNumberId(number: string): Promise<{ _serialized: string } | null>;
  sendMessage(chatId: string, content: string | unknown): Promise<{ id: { id: string } }>;
  getChatById(chatId: string): Promise<{ fetchMessages(options: { limit: number }): Promise<WhatsAppMessage[]> }>;
  pupBrowser?: PuppeteerBrowser;
  pupPage?: PuppeteerPage;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * WhatsApp message interface
 */
interface WhatsAppMessage {
  id: { id: string };
  ack?: number;
}

/**
 * Person data for message events
 */
interface Person {
  messageId?: string;
  appointmentId?: number;
  name: string;
  number: string;
  success: string;
  error?: string;
}

/**
 * Send result
 */
interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Session quality result
 */
type SessionQuality = 'valid' | 'empty' | 'corrupted' | 'none';

/**
 * Cleanup result
 */
interface CleanupResult {
  success: boolean;
  reason: string;
  attempt?: number;
  error?: string;
}

/**
 * Reject if `promise` doesn't settle within `ms`. Bounds a single hung
 * WhatsApp/Puppeteer round-trip so it can't stall a whole batch (the destroy
 * paths already use this inline `Promise.race` shape; this is the reusable form).
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ===========================================
// CLIENT STATE MANAGER
// ===========================================

class ClientStateManager {
  public state: ClientState = 'DISCONNECTED';
  public client: WhatsAppClient | null = null;
  public browser: PuppeteerBrowser | null = null;
  public page: PuppeteerPage | null = null;
  public initializationPromise: Promise<boolean> | null = null;
  public initializationAbortController: AbortController | null = null;
  public reconnectTimer: NodeJS.Timeout | null = null;
  public reconnectAttempts = 0;
  public lastError: Error | null = null;
  public destroyInProgress = false;
  public initializationTimeout: NodeJS.Timeout | null = null;
  public sessionStabilized = false;
  public authStabilizationStarted = false;

  private initializationLock: number | false = false;
  private lockWaiters: LockWaiter[] = [];

  // Constants
  public readonly MAX_RECONNECT_ATTEMPTS = 10;
  public readonly RECONNECT_BASE_DELAY = 5000;
  // After the attempt ceiling is hit, wait this long, then reset and retry — so an
  // unattended server self-heals from a transient outage instead of staying dead.
  public readonly RECONNECT_COOLDOWN_MS = 300000;
  public readonly SESSION_RESTORATION_TIMEOUT = 120000;
  public readonly FRESH_AUTH_TIMEOUT = 90000;
  public readonly INITIALIZATION_TIMEOUT = 60000;
  public readonly MAX_LOCK_WAIT_TIME = 30000;

  async acquireInitializationLock(timeoutMs: number = this.MAX_LOCK_WAIT_TIME): Promise<boolean> {
    if (!this.initializationLock) {
      this.initializationLock = Date.now();
      return true;
    }

    const lockAge = Date.now() - this.initializationLock;
    if (lockAge > this.INITIALIZATION_TIMEOUT) {
      log.warn(`Force releasing stale lock`, { lockAge });
      this.forceReleaseLock();
      this.initializationLock = Date.now();
      return true;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const waiterIndex = this.lockWaiters.findIndex((w) => w.resolve === waitEntry.resolve);
        if (waiterIndex > -1) {
          this.lockWaiters.splice(waiterIndex, 1);
        }
        reject(new Error(`Initialization lock timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const waitEntry: LockWaiter = {
        resolve: () => {
          clearTimeout(timeout);
          this.initializationLock = Date.now();
          resolve(true);
        },
        reject: () => {
          clearTimeout(timeout);
          reject(new Error('Lock acquisition cancelled'));
        },
        timeout,
        timestamp: Date.now(),
      };

      this.lockWaiters.push(waitEntry);
    });
  }

  releaseInitializationLock(): void {
    if (!this.initializationLock) {
      return;
    }

    this.initializationLock = false;

    if (this.lockWaiters.length > 0) {
      const nextWaiter = this.lockWaiters.shift();
      try {
        process.nextTick(() => {
          if (nextWaiter && typeof nextWaiter.resolve === 'function') {
            nextWaiter.resolve();
          }
        });
      } catch (error) {
        log.error('Error notifying next lock waiter', error);
      }
    }
  }

  forceReleaseLock(): void {
    this.initializationLock = false;

    while (this.lockWaiters.length > 0) {
      const waiter = this.lockWaiters.shift();
      try {
        if (waiter && typeof waiter.reject === 'function') {
          waiter.reject();
        }
      } catch (error) {
        log.error('Error rejecting lock waiter', error);
      }
    }
  }

  setState(newState: ClientState, error: Error | null = null): void {
    const oldState = this.state;

    if (oldState === newState && !error) {
      return;
    }

    this.state = newState;
    this.lastError = error;

    if (oldState !== newState) {
      log.info(
        `State: ${oldState} → ${newState}`,
        error ? { error: error.message } : undefined
      );
    }

    stateEvents.emit('whatsapp_state_changed', {
      from: oldState,
      to: newState,
      error,
    });
  }

  isState(state: ClientState): boolean {
    return this.state === state;
  }

  getStatus(): ClientStatus {
    return {
      state: this.state,
      connected: this.isState('CONNECTED'),
      initializing: this.isState('INITIALIZING'),
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError?.message,
      hasActivePromise: !!this.initializationPromise,
    };
  }

  clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  clearInitializationTimeout(): void {
    if (this.initializationTimeout) {
      clearTimeout(this.initializationTimeout);
      this.initializationTimeout = null;
    }
  }

  cleanup(): void {
    log.debug('Cleaning up ClientStateManager');

    this.clearReconnectTimer();
    this.clearInitializationTimeout();

    if (this.initializationAbortController) {
      try {
        this.initializationAbortController.abort();
      } catch (error) {
        log.error('Error aborting initialization', error);
      }
      this.initializationAbortController = null;
    }

    if (this.initializationPromise) {
      this.initializationPromise = null;
    }

    this.forceReleaseLock();

    this.state = 'DISCONNECTED';
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.destroyInProgress = false;

    log.debug('ClientStateManager cleanup completed');
  }
}

// ===========================================
// ENHANCED CIRCUIT BREAKER
// ===========================================

class EnhancedCircuitBreaker {
  private failureThreshold: number;
  private timeout: number;
  private halfOpenMaxCalls: number;
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private state: CircuitBreakerState = 'CLOSED';
  private halfOpenCalls = 0;
  private lastStateChange: number = Date.now();

  constructor(threshold = 5, timeout = 60000, halfOpenMaxCalls = 3) {
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.halfOpenMaxCalls = halfOpenMaxCalls;
  }

  async execute<T>(operation: () => Promise<T>, operationName = 'operation'): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.lastFailureTime && Date.now() - this.lastFailureTime > this.timeout) {
        this.transitionToHalfOpen();
      } else {
        const timeUntilRetry = this.timeout - (Date.now() - (this.lastFailureTime || 0));
        throw new Error(
          `Circuit breaker is OPEN. Retry in ${Math.ceil(timeUntilRetry / 1000)} seconds`
        );
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new Error('Circuit breaker is HALF_OPEN with max calls reached');
    }

    try {
      if (this.state === 'HALF_OPEN') {
        this.halfOpenCalls++;
      }

      const result = await operation();
      this.onSuccess(operationName);
      return result;
    } catch (error) {
      this.onFailure(operationName, error as Error);
      throw error;
    }
  }

  private onSuccess(operationName: string): void {
    if (this.state === 'HALF_OPEN') {
      log.debug(`Circuit breaker healing: ${operationName}`);
      this.transitionToClosed();
    } else if (this.state === 'CLOSED') {
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  private onFailure(operationName: string, error: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    log.warn(
      `Circuit breaker failure ${this.failureCount}/${this.failureThreshold} for ${operationName}`,
      { error: error.message }
    );

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.transitionToOpen();
    }
  }

  private transitionToClosed(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    log.info('Circuit breaker → CLOSED');
  }

  private transitionToOpen(): void {
    this.state = 'OPEN';
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    log.warn(`Circuit breaker → OPEN`, { failures: this.failureCount });
  }

  private transitionToHalfOpen(): void {
    this.state = 'HALF_OPEN';
    this.halfOpenCalls = 0;
    this.lastStateChange = Date.now();
    log.info('Circuit breaker → HALF_OPEN');
  }

  reset(): void {
    this.transitionToClosed();
    log.info('Circuit breaker manually reset');
  }

  /**
   * Record a failure that happened outside execute() — e.g. the reconnect loop
   * exhausting its attempts. Public so callers don't reach into private onFailure.
   */
  recordExternalFailure(operationName: string, error: Error): void {
    this.onFailure(operationName, error);
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      isOpen: this.state === 'OPEN',
      timeInCurrentState: Date.now() - this.lastStateChange,
      halfOpenCalls: this.halfOpenCalls,
    };
  }
}

// ===========================================
// WHATSAPP SERVICE
// ===========================================

class WhatsAppService extends EventEmitter {
  private clientState: ClientStateManager;
  private circuitBreaker: EnhancedCircuitBreaker;
  private wsEmitter: WebSocketEmitter | null = null;
  private messageState: typeof messageState;

  private eventHandlers: {
    onQR: (qr: string) => Promise<void>;
    onReady: () => Promise<void>;
    onAuthenticated: () => Promise<void>;
    onMessageAck: (msg: WhatsAppMessage, ack: number) => Promise<void>;
    onDisconnected: (reason: string) => Promise<void>;
    onAuthFailure: (error: Error) => Promise<void>;
    onLoadingScreen: (percent: number, message: string) => void;
  };

  constructor() {
    super();
    this.clientState = new ClientStateManager();
    this.circuitBreaker = new EnhancedCircuitBreaker();
    this.messageState = messageState;

    this.eventHandlers = {
      onQR: this.handleQR.bind(this),
      onReady: this.handleReady.bind(this),
      onAuthenticated: this.handleAuthenticated.bind(this),
      onMessageAck: this.handleMessageAck.bind(this),
      onDisconnected: this.handleDisconnected.bind(this),
      onAuthFailure: this.handleAuthFailure.bind(this),
      onLoadingScreen: this.handleLoadingScreen.bind(this),
    };

    this.setupCleanupHandlers();
    this.setupEventListeners();
  }

  private setupCleanupHandlers(): void {
    // Signal handling is owned by index.ts:gracefulShutdown, which calls
    // whatsappService.gracefulShutdown() at the right point in the chain.
    // No process.on('SIGINT'/'SIGTERM') here.

    stateEvents.on('qr_cleanup_required', () => {
      this.scheduleClientCleanup();
    });

    stateEvents.on('qr_viewer_connected', () => {
      this.handleViewerConnected();
    });
  }

  private setupEventListeners(): void {
    stateEvents.on('whatsapp_initialization_requested', () => {
      // Fire-and-forget: when an init is already in flight, initializeOnDemand()
      // returns the *shared* initializationPromise, which can reject (e.g. init
      // timeout). Without this .catch() that rejection escapes as an unhandled
      // rejection. The primary awaiter in initialize() already handles recovery
      // (reconnect/circuit breaker), so here we only need to swallow it.
      this.initializeOnDemand().catch((error: unknown) => {
        log.debug('On-demand WhatsApp initialization rejected (handled by init/reconnect logic)', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  setEmitter(emitter: WebSocketEmitter): void {
    this.wsEmitter = emitter;
    log.debug('WebSocket emitter set');
  }

  isReady(): boolean {
    return this.clientState.isState('CONNECTED') && this.messageState.clientReady;
  }

  getStatus(): Record<string, unknown> {
    const clientStatus = this.clientState.getStatus();
    const circuitStatus = this.circuitBreaker.getStatus();

    return {
      active: this.isReady(),
      initializing: clientStatus.initializing,
      state: clientStatus.state,
      reconnectAttempts: clientStatus.reconnectAttempts,
      circuitBreakerOpen: circuitStatus.isOpen,
      circuitBreakerState: circuitStatus.state,
      qrCode: this.messageState.qr,
      lastError: clientStatus.lastError,
      hasClient: !!this.clientState.client,
    };
  }

  private async handleViewerConnected(): Promise<void> {
    log.debug('QR viewer connected - checking session state');

    if (this.clientState.isState('DISCONNECTED') && !this.clientState.client) {
      log.debug(
        'Client disconnected with no instance - will wait for explicit initialization request'
      );
    } else {
      log.debug('Skipping auto-initialization', {
        state: this.clientState.state,
        hasClient: !!this.clientState.client,
        qrViewers: this.messageState.activeQRViewers,
      });
    }
  }

  async initialize(forceRestart = false): Promise<boolean> {
    if (!forceRestart && this.clientState.isState('CONNECTED')) {
      log.info('WhatsApp client already connected');
      return true;
    }

    if (!forceRestart && this.clientState.isState('INITIALIZING')) {
      log.info('WhatsApp client already initializing, waiting for completion');
      return this.clientState.initializationPromise as Promise<boolean>;
    }

    if (this.circuitBreaker.getStatus().isOpen && !forceRestart) {
      throw new Error('Circuit breaker is open, cannot initialize WhatsApp client');
    }

    try {
      log.debug('Acquiring initialization lock');
      await this.clientState.acquireInitializationLock();

      if (
        !forceRestart &&
        (this.clientState.isState('CONNECTED') || this.clientState.isState('INITIALIZING'))
      ) {
        this.clientState.releaseInitializationLock();
        return this.clientState.initializationPromise || true;
      }

      this.clientState.initializationPromise = this.performInitialization(forceRestart);

      const result = await this.clientState.initializationPromise;
      return result;
    } catch (error) {
      log.error('Initialization failed', error);
      throw error;
    } finally {
      this.clientState.initializationPromise = null;
      this.clientState.releaseInitializationLock();
    }
  }

  private async performInitialization(forceRestart = false): Promise<boolean> {
    log.info('Starting initialization', { forceRestart });

    try {
      if (forceRestart && this.clientState.client) {
        await this.destroyClient('restart');
      }

      if (!forceRestart && !this.clientState.client) {
        const sessionQuality = await this.validateSessionQuality();

        if (sessionQuality === 'valid') {
          log.info('Found existing session - proceeding with client creation');
        } else if (sessionQuality === 'corrupted') {
          log.warn(
            `Session quality: ${sessionQuality} - cleaning up corrupted session`
          );
          await this.cleanupInvalidSession();
          log.info(
            'Corrupted session cleaned up - will create fresh client and show QR'
          );
        } else if (sessionQuality === 'empty') {
          log.info(
            'Session is empty - will create client and let Puppeteer initialize storage'
          );
        } else {
          log.info('No existing session found - will create new client');
        }
      }

      this.clientState.setState('INITIALIZING');

      this.clientState.initializationAbortController = new AbortController();

      this.clientState.initializationTimeout = setTimeout(() => {
        if (this.clientState.initializationAbortController) {
          this.clientState.initializationAbortController.abort();
        }
      }, this.clientState.INITIALIZATION_TIMEOUT);

      const success = await this.circuitBreaker.execute(async () => {
        return this.createAndInitializeClient();
      }, 'whatsapp-initialization');

      if (success === true) {
        if (!this.clientState.isState('CONNECTED')) {
          this.clientState.setState('CONNECTED');
        }
        this.clientState.reconnectAttempts = 0;
        log.info('Client initialized successfully');
        return true;
      } else if (success === false) {
        log.info('Client in QR mode - waiting for scan');
        this.clientState.setState('INITIALIZING');
        return false;
      } else {
        throw new Error('Client initialization returned unexpected value');
      }
    } catch (error) {
      // A failed initialize() leaves the Puppeteer Chrome alive and holding
      // the userDataDir SingletonLock, so every subsequent retry fails with
      // "browser is already running for ...session-client". Tear it down now.
      await this.cleanupFailedClient();

      this.clientState.setState('ERROR', error as Error);
      await this.messageState.setClientReady(false);

      if (!this.messageState.manualDisconnect && !this.clientState.destroyInProgress) {
        this.scheduleReconnect(error as Error);
      }

      throw error;
    } finally {
      this.clientState.clearInitializationTimeout();
      if (this.clientState.initializationAbortController) {
        this.clientState.initializationAbortController = null;
      }
    }
  }

  private async cleanupFailedClient(): Promise<void> {
    if (!this.clientState.client) {
      return;
    }

    const failedClient = this.clientState.client;
    this.clientState.client = null;

    try {
      this.removeClientEventHandlers(failedClient);
    } catch (error) {
      log.debug('Error removing handlers from failed client', error);
    }

    try {
      await Promise.race([
        failedClient.destroy(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Destroy timeout after init failure')), 10000)
        ),
      ]);
      log.debug('Failed client destroyed gracefully');
      return;
    } catch (destroyError) {
      log.warn('Graceful destroy of failed client failed - force closing browser', {
        error: (destroyError as Error).message,
      });
    }

    const browser = failedClient.pupBrowser;
    if (!browser) {
      log.debug('No pupBrowser on failed client - browser may not have launched');
      return;
    }

    try {
      await Promise.race([
        browser.close(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Browser close timeout')), 5000)
        ),
      ]);
      log.info('Browser force-closed after init failure');
      return;
    } catch (closeError) {
      log.error('Browser close failed - killing process', closeError);
    }

    try {
      const proc = browser.process();
      if (proc) {
        proc.kill('SIGKILL');
        log.warn('Browser process killed via SIGKILL after init failure');
      }
    } catch (killError) {
      log.error('Failed to kill browser process after init failure', killError);
    }
  }

  private async createAndInitializeClient(): Promise<boolean> {
    log.info('Creating WhatsApp client');

    if (this.clientState.initializationAbortController?.signal.aborted) {
      throw new Error('Initialization aborted due to timeout');
    }

    // Let Puppeteer keep its DEFAULT signal handlers (handleSIGINT/SIGTERM/
    // SIGHUP all true) so it tears Chrome down when the process is signalled.
    // This was previously disabled in dev to dodge a tsx-watch + concurrently
    // signal race that corrupted the WA Web IndexedDB MANIFEST — but that race
    // was specific to the OLD WSL/Linux dev box. Dev and prod now BOTH run on
    // Windows, where SIGINT (Ctrl+C) is delivered to the process and the
    // uncatchable kills (node --watch restarts, hard service stops) wouldn't run
    // our handlers regardless. So restoring Puppeteer's defaults can only help
    // close Chrome and matches the production (Windows service) shutdown path.
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: 'client' }),
      puppeteer: {
        headless: true,
        timeout: 30000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          // Conservative footprint trims — strip Chrome subsystems WA Web never
          // uses. Safe (no behavior change); deliberately NOT --single-process
          // (breaks whatsapp-web.js) and NOT a renderer heap cap (WA Web's DOM
          // is heavy; an undersized --max-old-space-size crashes the page).
          '--disable-extensions',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--mute-audio',
          '--disable-background-networking',
          '--disable-component-extensions-with-background-pages',
        ],
      },
    }) as unknown as WhatsAppClient;

    this.clientState.client = client;
    this.clientState.sessionStabilized = false;
    this.clientState.authStabilizationStarted = false;

    await this.setupClientEventHandlers(client);

    const hasSession = await this.checkExistingSession();

    const timeoutDuration = hasSession
      ? this.clientState.SESSION_RESTORATION_TIMEOUT
      : this.clientState.FRESH_AUTH_TIMEOUT;

    const startTime = Date.now();
    let resolved = false;

    const progressInterval = setInterval(() => {
      if (!resolved) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        log.debug(`Waiting for authentication... ${elapsed}s elapsed`);
      }
    }, 5000);

    const initPromise = new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(async () => {
        if (!resolved) {
          resolved = true;
          clearInterval(progressInterval);
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          log.error('❌ Initialization timeout - no events fired', {
            elapsed: elapsed + 's',
            timeout: Math.floor(timeoutDuration / 1000) + 's',
            hasSession,
            clientState: this.clientState.state,
          });

          // An init timeout is NOT proof of corruption — WhatsApp is often just
          // slow to verify a perfectly good session (repeated QR "verifying
          // session validity"). Don't move a healthy session aside on a mere
          // timeout; re-validate first and only clean if the files are
          // genuinely corrupted. The next attempt restores the slow session.
          if (hasSession) {
            const recheck = await this.validateSessionQuality();
            if (recheck === 'corrupted') {
              log.info('Init timed out and session is corrupted - cleaning up');
              try {
                await this.cleanupInvalidSession();
                log.info('Session cleanup complete - will retry on next attempt');
              } catch (cleanupError) {
                log.error('Failed to cleanup session', {
                  error: (cleanupError as Error).message,
                });
              }
            } else {
              log.info(
                `Init timed out but session quality is '${recheck}' - preserving it, will retry`
              );
            }
          }

          reject(new Error('Client initialization timeout - no events'));
        }
      }, timeoutDuration);

      const onReady = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          clearInterval(progressInterval);
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          log.info(`Client authenticated (${elapsed}s)`);
          client.removeListener('qr', onQR);
          client.removeListener('auth_failure', onAuthFailure);
          client.removeListener('disconnected', onDisconnected);
          this.clientState.setState('CONNECTED');
          resolve(true);
        }
      };

      const onQR = () => {
        log.info('QR code generated - waiting for scan');
        clearTimeout(timeout);
        clearInterval(progressInterval);
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            log.info('QR scan timeout - client waiting for future scan');
            client.removeListener('qr', onQR);
            client.removeListener('auth_failure', onAuthFailure);
            client.removeListener('disconnected', onDisconnected);
            resolve(false);
          }
        }, this.clientState.FRESH_AUTH_TIMEOUT);
      };

      const onAuthFailure = (error: unknown) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          clearInterval(progressInterval);
          log.error('Authentication failed', { error: String(error) });
          client.removeListener('ready', onReady);
          client.removeListener('qr', onQR);
          client.removeListener('disconnected', onDisconnected);
          reject(new Error(`Authentication failed: ${error}`));
        }
      };

      const onDisconnected = (reason: unknown) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          clearInterval(progressInterval);
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          log.warn(`❌ onDisconnected event fired (${elapsed}s)`, {
            reason: String(reason),
          });
          client.removeListener('ready', onReady);
          client.removeListener('qr', onQR);
          client.removeListener('auth_failure', onAuthFailure);
          reject(new Error(`Client disconnected during init: ${reason}`));
        }
      };

      client.once('ready', onReady);
      client.on('qr', onQR);
      client.once('auth_failure', onAuthFailure);
      client.once('disconnected', onDisconnected);

      if (this.clientState.initializationAbortController?.signal.aborted) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(progressInterval);
        reject(new Error('Initialization aborted'));
        return;
      }

      const initializeCall = client.initialize();

      initializeCall
        .then(() => {
          log.debug('client.initialize() promise resolved');
        })
        .catch((error: Error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            clearInterval(progressInterval);

            // Capture page state at moment of rejection - cheap to read, very
            // useful when diagnosing inject failures (e.g. confirming WA Web
            // navigated to ?post_logout=1 due to corrupted IndexedDB).
            const pageState: Record<string, unknown> = {};
            try {
              const pupPage = (client as unknown as { pupPage?: unknown }).pupPage as
                | { url?: () => string; mainFrame?: () => { url: () => string }; isClosed?: () => boolean }
                | undefined;
              if (pupPage) {
                pageState.url = pupPage.url?.();
                pageState.mainFrameUrl = pupPage.mainFrame?.().url();
                pageState.closed = pupPage.isClosed?.();
              }
            } catch {
              // best-effort
            }

            log.error('❌ client.initialize() promise rejected', {
              error: error.message,
              stack: error.stack,
              pageState,
            });
            reject(error);
          }
        });
    });

    return initPromise;
  }

  private async setupClientEventHandlers(client: WhatsAppClient): Promise<void> {
    log.debug('Setting up event handlers');

    client.on('qr', this.eventHandlers.onQR as (...args: unknown[]) => void);
    client.on('ready', this.eventHandlers.onReady as (...args: unknown[]) => void);
    client.on('authenticated', this.eventHandlers.onAuthenticated as (...args: unknown[]) => void);
    client.on('message_ack', this.eventHandlers.onMessageAck as (...args: unknown[]) => void);
    client.on('disconnected', this.eventHandlers.onDisconnected as (...args: unknown[]) => void);
    client.on('auth_failure', this.eventHandlers.onAuthFailure as (...args: unknown[]) => void);
    client.on('loading_screen', this.eventHandlers.onLoadingScreen as (...args: unknown[]) => void);

    log.debug('Event handlers registered successfully');
  }

  private removeClientEventHandlers(client: WhatsAppClient): void {
    if (!client || !this.eventHandlers) {
      log.debug('No client or handlers to remove');
      return;
    }

    try {
      client.removeListener('qr', this.eventHandlers.onQR as (...args: unknown[]) => void);
      client.removeListener('ready', this.eventHandlers.onReady as (...args: unknown[]) => void);
      client.removeListener(
        'authenticated',
        this.eventHandlers.onAuthenticated as (...args: unknown[]) => void
      );
      client.removeListener(
        'message_ack',
        this.eventHandlers.onMessageAck as (...args: unknown[]) => void
      );
      client.removeListener(
        'disconnected',
        this.eventHandlers.onDisconnected as (...args: unknown[]) => void
      );
      client.removeListener(
        'auth_failure',
        this.eventHandlers.onAuthFailure as (...args: unknown[]) => void
      );
      client.removeListener(
        'loading_screen',
        this.eventHandlers.onLoadingScreen as (...args: unknown[]) => void
      );

      log.debug('Event handlers removed successfully');
    } catch (error) {
      log.error('Error removing event handlers', error);
    }
  }

  private async handleQR(qr: string): Promise<void> {
    const sessionQuality = await this.validateSessionQuality();

    if (sessionQuality === 'valid') {
      log.info(
        'QR received for existing session - WhatsApp may be verifying session validity'
      );
    } else if (sessionQuality === 'none') {
      log.info('QR received for fresh authentication - no existing session');
    } else {
      log.debug(`QR received - session quality: ${sessionQuality}`);
    }

    if (this.messageState.clientReady) {
      await this.messageState.setClientReady(false);
    }

    await this.messageState.setQR(qr);
    this.emit('qr', qr);

    if (this.wsEmitter) {
      try {
        const qrImageUrl = await qrcode.toDataURL(qr, {
          margin: 4,
          scale: 6,
          errorCorrectionLevel: 'M',
        });
        this.wsEmitter.emit(InternalEmitterEvents.WHATSAPP_QR_UPDATED, {
          qr: qrImageUrl,
          clientReady: false,
        });
      } catch (error) {
        log.error('Failed to convert QR code to data URL:', error);
        this.wsEmitter.emit(InternalEmitterEvents.WHATSAPP_QR_UPDATED, {
          qr,
          clientReady: false,
        });
      }
    }
  }

  private async handleAuthenticated(): Promise<void> {
    // whatsapp-web.js fires this event each time WA Web's app state syncs,
    // which during initial multi-device sync happens several times. Guard so
    // the side-effects (clear QR, schedule 60s stabilization) run once.
    if (this.clientState.sessionStabilized || this.clientState.authStabilizationStarted) {
      return;
    }
    this.clientState.authStabilizationStarted = true;

    log.info('Client authenticated successfully');

    await this.messageState.setQR(null);

    log.info('Waiting 60s for session to stabilize...');

    const SESSION_STABILIZATION_DELAY = 60000;

    await new Promise((resolve) => setTimeout(resolve, SESSION_STABILIZATION_DELAY));

    this.clientState.sessionStabilized = true;
    log.info('Session stabilized - safe to restart');
  }

  private async handleReady(): Promise<void> {
    log.info('Client ready');

    if (this.clientState.client) {
      try {
        this.clientState.browser = this.clientState.client.pupBrowser || null;
        this.clientState.page = this.clientState.client.pupPage || null;
      } catch (error) {
        log.warn('Could not store browser references', error);
      }
    }

    if (!this.clientState.sessionStabilized) {
      log.info('Session restored from existing files');
      this.clientState.sessionStabilized = true;
    }

    this.clientState.setState('CONNECTED');
    await this.messageState.setClientReady(true);
    await this.messageState.setQR(null);

    this.emit('ClientIsReady');
    if (this.wsEmitter) {
      this.wsEmitter.emit(InternalEmitterEvents.WHATSAPP_CLIENT_READY, {
        clientReady: true,
        state: 'ready',
        message: 'WhatsApp client is ready!',
      });
    }
  }

  private async handleMessageAck(msg: WhatsAppMessage, ack: number): Promise<void> {
    const messageId = msg.id.id;

    const messageInfo: MessageLookupResult | null =
      messageSessionManager.getAppointmentIdForMessage(messageId);

    log.debug(`Message status updated`, {
      messageId,
      ack,
      messageInfo,
    });

    if (!messageInfo) {
      log.debug(
        'Message not found in any active session - may be from previous session or external message',
        {
          messageId,
          ackStatus: ack,
        }
      );
      return;
    }

    const { appointmentId, sessionDate, sessionId } = messageInfo;

    try {
      messageSessionManager.recordDeliveryStatusUpdate(messageId, String(ack));

      await this.messageState.updateMessageStatus(messageId, ack, async () => {
        log.debug('Updating database status', {
          messageId,
          appointmentId,
          sessionDate,
          sessionId,
          ackStatus: ack,
        });

        await messagingQueries.updateSingleMessageStatus(messageId, ack);
      });

      if (this.wsEmitter) {
        this.wsEmitter.emit(InternalEmitterEvents.WHATSAPP_MESSAGE_STATUS, {
          messageId,
          appointmentId,
          sessionDate,
          status: ack,
        });
      }
    } catch (error) {
      log.error('Error updating message status', {
        messageId,
        appointmentId,
        sessionDate,
        sessionId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Broadcast a client-ready state change to SSE subscribers. Mirrors the
   * frames restart() already emits, so the browser's `whatsappClientReady`
   * flag stays in sync with the server — otherwise the Send button stays
   * enabled after an organic disconnect and fires a request the server
   * rejects with 503.
   */
  private broadcastReadyState(clientReady: boolean, state: string, message: string): void {
    if (!this.wsEmitter) return;
    try {
      this.wsEmitter.emit(InternalEmitterEvents.WHATSAPP_CLIENT_READY, {
        clientReady,
        state,
        message,
      });
    } catch (error) {
      log.error('Error broadcasting client-ready state', error);
    }
  }

  private async handleDisconnected(reason: string): Promise<void> {
    log.warn(`Client disconnected`, { reason });
    this.clientState.setState('DISCONNECTED');
    await this.messageState.setClientReady(false);
    this.broadcastReadyState(false, 'disconnected', `WhatsApp disconnected: ${reason}`);

    stateEvents.emit('client_disconnected', reason);

    if (!this.messageState.manualDisconnect && !this.clientState.destroyInProgress) {
      this.scheduleReconnect(new Error(`Disconnected: ${reason}`));
    }
  }

  private async handleAuthFailure(error: Error): Promise<void> {
    log.error('WhatsApp authentication failed', error);
    this.clientState.setState('ERROR', error);
    await this.messageState.setClientReady(false);
    this.broadcastReadyState(false, 'auth_failure', 'WhatsApp authentication failed');

    if (!this.messageState.manualDisconnect && !this.clientState.destroyInProgress) {
      this.scheduleReconnect(error);
    }
  }

  private handleLoadingScreen(percent: number, message: string): void {
    log.debug(`WhatsApp loading: ${percent}% - ${message}`);
  }

  private scheduleReconnect(error: Error): void {
    this.clientState.reconnectAttempts++;

    if (this.clientState.reconnectAttempts > this.clientState.MAX_RECONNECT_ATTEMPTS) {
      log.warn(
        `Exceeded maximum reconnection attempts (${this.clientState.MAX_RECONNECT_ATTEMPTS}); entering slow-retry cooldown`
      );
      this.circuitBreaker.recordExternalFailure('max-reconnect-attempts', error);

      // Don't give up permanently on an unattended server. After a long cooldown,
      // reset the attempt counter and try again — indefinite slow retries beat a
      // dead client that only a manual restart() can revive.
      this.clientState.clearReconnectTimer();
      this.clientState.reconnectTimer = setTimeout(() => {
        log.info('Reconnect cooldown elapsed — resetting attempts and retrying');
        this.clientState.reconnectAttempts = 0;
        this.initialize().catch((err) => {
          log.error('Error during cooldown reconnection attempt', err);
        });
      }, this.clientState.RECONNECT_COOLDOWN_MS);
      return;
    }

    const delay =
      Math.min(
        this.clientState.RECONNECT_BASE_DELAY *
          Math.pow(1.5, this.clientState.reconnectAttempts - 1),
        60000
      ) *
      (0.75 + Math.random() * 0.5);

    log.info(
      `Scheduling reconnection attempt ${this.clientState.reconnectAttempts} in ${Math.round(delay)}ms`
    );

    this.clientState.clearReconnectTimer();
    this.clientState.reconnectTimer = setTimeout(async () => {
      log.info(
        `Attempting to reconnect (attempt ${this.clientState.reconnectAttempts})`
      );
      try {
        await this.initialize();
      } catch (err) {
        log.error('Error during reconnection attempt', err);
      }
    }, delay);
  }

  async restart(): Promise<boolean> {
    log.info('Restarting WhatsApp client - preserving authentication');

    this.messageState.manualDisconnect = true;

    try {
      if (this.wsEmitter) {
        try {
          this.wsEmitter.emit(InternalEmitterEvents.WHATSAPP_CLIENT_READY, {
            clientReady: false,
            state: 'restarting',
            message: 'Restarting WhatsApp client...',
          });
          log.debug('Broadcasted restarting state to clients');
        } catch (error) {
          log.error('Error broadcasting restarting state', error);
        }
      }

      if (this.clientState.client) {
        try {
          await this.clientState.client.destroy();
          log.info('Client destroyed for restart - authentication preserved');
        } catch (error) {
          log.error('Error destroying client during restart', error);
        }
        this.clientState.client = null;
      }

      this.clientState.cleanup();
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      await this.messageState.setQR(null);

      this.circuitBreaker.reset();

      if (this.wsEmitter) {
        try {
          this.wsEmitter.emit(InternalEmitterEvents.WHATSAPP_CLIENT_READY, {
            clientReady: false,
            state: 'initializing',
            message: 'Initializing WhatsApp client...',
          });
          log.debug('Broadcasted initializing state to clients');
        } catch (error) {
          log.error('Error broadcasting initializing state', error);
        }
      }

      const result = await this.initialize();

      this.messageState.manualDisconnect = false;
      await this.messageState.reset();
      this.clientState.reconnectAttempts = 0;

      return result;
    } catch (error) {
      this.messageState.manualDisconnect = false;
      throw error;
    }
  }

  private async forceCloseBrowser(): Promise<void> {
    if (!this.clientState.browser) {
      log.debug('No browser reference to close');
      return;
    }

    try {
      log.warn('Force closing Puppeteer browser');

      const pages = await this.clientState.browser.pages();
      await Promise.all(
        pages.map((page) =>
          page.close().catch((err) => log.error('Error closing page', err))
        )
      );

      await Promise.race([
        this.clientState.browser.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Browser close timeout')), 10000)
        ),
      ]);

      log.info('Browser force closed successfully');
    } catch (error) {
      log.error('Error force closing browser', error);

      try {
        const browserProcess = this.clientState.browser?.process();
        if (browserProcess) {
          browserProcess.kill('SIGKILL');
          log.warn('Browser process killed with SIGKILL');
        }
      } catch (killError) {
        log.error('Could not kill browser process', killError);
      }
    } finally {
      this.clientState.browser = null;
      this.clientState.page = null;
    }
  }

  async destroyClient(reason = 'manual'): Promise<void> {
    log.info(`Destroying WhatsApp client (reason: ${reason})`);

    if (
      this.clientState.client &&
      !this.clientState.sessionStabilized &&
      reason === 'restart'
    ) {
      log.warn(
        '⚠️  WARNING: Session has NOT stabilized yet - session data may be incomplete!'
      );
      log.warn(
        '⚠️  Restarting before 60-second stabilization delay completes may result in session loss'
      );
      log.warn(
        '⚠️  QR code will be required on next startup if session data is incomplete'
      );
    }

    this.clientState.destroyInProgress = true;

    try {
      if (this.clientState.client) {
        this.removeClientEventHandlers(this.clientState.client);
      }

      if (this.clientState.client) {
        try {
          await Promise.race([
            (async () => {
              await this.clientState.client!.destroy();
              log.info(
                `WhatsApp client destroyed for ${reason} (session preserved)`
              );
            })(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Client destroy timeout')), 30000)
            ),
          ]);
        } catch (destroyError) {
          log.error('Graceful destroy failed, attempting force close', destroyError);
          await this.forceCloseBrowser();
        }

        this.clientState.client = null;
      }

      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
    } catch (error) {
      log.error('Error destroying client', error);
      await this.forceCloseBrowser();
    } finally {
      this.clientState.browser = null;
      this.clientState.page = null;
      this.clientState.destroyInProgress = false;
    }
  }

  private scheduleClientCleanup(): void {
    log.debug(
      'Automatic cleanup disabled - client will persist until manually destroyed'
    );
  }

  async send(date: string): Promise<SendResult[] | void> {
    if (!this.isReady()) {
      throw new Error('WhatsApp client not ready to send messages');
    }

    return this.circuitBreaker.execute(async () => {
      log.info(`Starting message sending session for date: ${date}`);

      const session = messageSessionManager.startSession(date, this);

      try {
        const [numbers, messages, ids, names] = await getWhatsAppMessages(date);

        if (!numbers || numbers.length === 0) {
          log.info(`No messages to send for date ${date}`);
          await this.messageState.setFinishedSending(true);
          this.emit('finishedSending');

          messageSessionManager.completeSession(date);
          return;
        }

        log.info(
          `Sending ${numbers.length} messages with session ${session.sessionId}`
        );

        if (this.wsEmitter) {
          this.wsEmitter.emit(InternalEmitterEvents.WHATSAPP_SENDING_STARTED, {
            total: numbers.length,
            sent: 0,
            failed: 0,
            started: true,
            finished: false,
            sessionId: session.sessionId,
            date: date,
          });
        }

        const results: SendResult[] = [];
        for (let i = 0; i < numbers.length; i++) {
          if (!this.isReady()) {
            throw new Error('Client disconnected during sending');
          }

          try {
            const result = await this.sendSingleMessage(
              numbers[i],
              messages[i],
              names[i],
              ids[i],
              date,
              session
            );
            results.push(result);

            if (i < numbers.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          } catch (error) {
            log.error(`Error sending message to ${numbers[i]}`, error);
            results.push({ success: false, error: (error as Error).message });
          }
        }

        // Mark the date's per-day row as processed now that the batch has been
        // dispatched (moved here from the read path so previewing never writes).
        try {
          await markWhatsAppBatchSent(date);
        } catch (err) {
          log.warn('Failed to mark WhatsApp batch as sent', { date, error: (err as Error).message });
        }

        await this.messageState.setFinishedSending(true);
        this.emit('finishedSending');

        log.info(`Message sending finished - session remains active for status updates`, {
          sessionId: session.sessionId,
          date: date,
          totalResults: results.length,
          sessionStats: session.getStats(),
        });

        return results;
      } catch (error) {
        messageSessionManager.completeSession(date);
        throw error;
      }
    }, 'send-messages');
  }

  private async sendSingleMessage(
    number: string,
    message: string,
    name: string,
    appointmentId: number,
    appointmentDate: string,
    session: MessageSession
  ): Promise<SendResult> {
    // Normalize phone number - removes spaces, handles country code formats
    const cleanNumber = PhoneFormatter.normalize(number, '964');
    const chatId = `${cleanNumber}@c.us`;

    try {
      const sentMessage = await this.clientState.client!.sendMessage(chatId, message);

      log.debug(`Message sent to ${number} (normalized: ${cleanNumber})`);

      if (session) {
        const registered = session.registerMessage(
          sentMessage.id.id,
          appointmentId,
          appointmentDate
        );

        if (!registered) {
          log.warn('Failed to register message in session', {
            messageId: sentMessage.id.id,
            appointmentId,
            appointmentDate,
            sessionId: session.sessionId,
          });
        }

        session.recordMessageSent(sentMessage.id.id);
      }

      const person: Person = {
        messageId: sentMessage.id.id,
        appointmentId: appointmentId,
        name,
        number,
        success: '&#10004;',
      };

      if (appointmentId) {
        try {
          await messagingQueries.updateWhatsAppStatus([appointmentId], [sentMessage.id.id]);
          log.debug(`Marked appointment ${appointmentId} as sent in database`);
        } catch (dbError) {
          log.error(
            `Failed to mark appointment ${appointmentId} as sent`,
            dbError
          );
        }
      }

      this.emit('MessageSent', person);

      return { success: true, messageId: sentMessage.id.id };
    } catch (error) {
      if (session) {
        session.recordMessageFailed('', (error as Error).message);
      }

      const person: StatePersonType = {
        messageId: `error_${Date.now()}_${number}`,
        name,
        number,
        success: '&times;',
        error: (error as Error).message,
      };

      await this.messageState.addPerson(person);
      this.emit('MessageFailed', person);

      throw error;
    }
  }

  /**
   * Public method for sending a single WhatsApp message
   * Used by routes for ad-hoc message sending (receipts, patient messages)
   */
  async sendMessage(
    number: string,
    message: string,
    name: string,
    appointmentId?: number | null
  ): Promise<SendResult> {
    if (!this.isReady()) {
      return { success: false, error: 'WhatsApp client not ready' };
    }

    // Normalize phone number - removes spaces, handles country code formats
    const cleanNumber = PhoneFormatter.normalize(number, '964');
    const chatId = `${cleanNumber}@c.us`;

    try {
      const sentMessage = await this.clientState.client!.sendMessage(chatId, message);

      log.debug(`Message sent to ${number} (normalized: ${cleanNumber})`);

      // Update database if appointmentId provided
      if (appointmentId) {
        try {
          await messagingQueries.updateWhatsAppStatus([appointmentId], [sentMessage.id.id]);
          log.debug(`Marked appointment ${appointmentId} as sent in database`);
        } catch (dbError) {
          log.error(
            `Failed to mark appointment ${appointmentId} as sent`,
            dbError
          );
        }
      }

      const person: Person = {
        messageId: sentMessage.id.id,
        appointmentId: appointmentId ?? undefined,
        name,
        number,
        success: '&#10004;',
      };

      this.emit('MessageSent', person);

      return { success: true, messageId: sentMessage.id.id };
    } catch (error) {
      const person: StatePersonType = {
        messageId: `error_${Date.now()}_${number}`,
        name,
        number,
        success: '&times;',
        error: (error as Error).message,
      };

      await this.messageState.addPerson(person);
      this.emit('MessageFailed', person);

      return { success: false, error: (error as Error).message };
    }
  }

  async report(date: string): Promise<{ success: boolean; messagesChecked: number }> {
    if (!this.isReady()) {
      throw new Error('WhatsApp client not ready for report generation');
    }

    return this.circuitBreaker.execute(async () => {
      try {
        log.info(`Generating WhatsApp report for date: ${date}`);

        const messages = await messagingQueries.getWhatsAppDeliveryStatus(date);

        if (messages.length > 0) {
          // Check delivery acks with bounded concurrency and a per-message timeout.
          // Previously this was a sequential loop with no timeout, so one hung
          // getChatById/fetchMessages could serialize-block the whole WhatsApp
          // command path for minutes (send/report/queueOperation share one breaker).
          const CONCURRENCY = 5;
          const PER_MESSAGE_TIMEOUT_MS = 15000;
          const statusUpdates: Array<{ id: number; ack: number }> = [];

          const checkOne = async (msg: (typeof messages)[number]): Promise<void> => {
            try {
              const update = await withTimeout(
                (async () => {
                  const chat = await this.clientState.client!.getChatById(msg.number);
                  const fetchedMessages = await chat.fetchMessages({ limit: 50 });
                  const ourMessage = fetchedMessages.find((m) => m.id.id === msg.wamid);
                  return ourMessage ? { id: msg.id, ack: ourMessage.ack || 1 } : null;
                })(),
                PER_MESSAGE_TIMEOUT_MS,
                `report check ${msg.wamid}`
              );
              if (update) statusUpdates.push(update);
            } catch (error) {
              log.error(`Error checking message ${msg.wamid}`, error);
            }
          };

          // Simple worker pool: CONCURRENCY workers pull from a shared cursor.
          let cursor = 0;
          const worker = async (): Promise<void> => {
            while (cursor < messages.length) {
              const idx = cursor++;
              await checkOne(messages[idx]);
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, messages.length) }, () => worker())
          );

          if (statusUpdates.length > 0) {
            await messagingQueries.updateWhatsAppDeliveryStatus(statusUpdates);
          }
        }

        await this.messageState.setFinishReport(true);
        this.emit('finishedSending');

        log.info(`Report generated for ${messages.length} messages`);
        return { success: true, messagesChecked: messages.length };
      } catch (error) {
        log.error('Error generating report', error);
        throw error;
      }
    }, 'generate-report');
  }

  async clear(): Promise<{ success: boolean }> {
    log.info('Clearing message state');
    await this.messageState.reset();
    return { success: true };
  }

  async initializeOnDemand(): Promise<boolean> {
    log.debug('initializeOnDemand called - checking conditions');

    if (
      this.clientState.isState('CONNECTED') ||
      this.clientState.isState('INITIALIZING')
    ) {
      log.debug('Client already connected or initializing');
      return this.clientState.initializationPromise || true;
    }

    if (this.messageState.activeQRViewers === 0) {
      log.debug('No QR viewers, skipping initialization');
      return false;
    }

    if (this.circuitBreaker.getStatus().isOpen) {
      log.warn('Circuit breaker is open, cannot auto-initialize');
      return false;
    }

    log.info('Auto-initializing WhatsApp client');
    try {
      return await this.initialize();
    } catch (error) {
      log.error('Failed to auto-initialize', error);
      return false;
    }
  }

  async queueOperation<T>(
    operation: (client: WhatsAppClient) => Promise<T>,
    operationName = 'operation'
  ): Promise<T> {
    if (!this.isReady()) {
      throw new Error('WhatsApp client is not ready for operations');
    }

    if (this.circuitBreaker.getStatus().isOpen) {
      throw new Error('Circuit breaker is open, operation cannot be executed');
    }

    return this.circuitBreaker.execute(async () => {
      try {
        log.debug(`Executing queued operation: ${operationName}`);
        const result = await operation(this.clientState.client!);
        log.debug(`Queued operation completed successfully: ${operationName}`);
        return result;
      } catch (error) {
        log.error(`Queued operation failed: ${operationName}`, error);
        throw error;
      }
    }, operationName);
  }

  async gracefulShutdown(signal = 'manual'): Promise<void> {
    log.info(`Graceful shutdown initiated (${signal})`);

    try {
      this.messageState.manualDisconnect = true;

      this.clientState.cleanup();

      await this.destroyClient('shutdown');

      await this.messageState.cleanup();

      log.info('Graceful shutdown completed');
    } catch (error) {
      log.error('Error during graceful shutdown', error);
    }
  }

  getDetailedStatus(): Record<string, unknown> {
    const clientStatus = this.clientState.getStatus();
    const circuitStatus = this.circuitBreaker.getStatus();
    const messageStats = this.messageState.dump();

    return {
      service: {
        ready: this.isReady(),
        state: clientStatus.state,
        hasClient: !!this.clientState.client,
        activeViewers: this.messageState.activeQRViewers,
      },
      client: clientStatus,
      circuitBreaker: circuitStatus,
      messageState: messageStats,
      timestamp: Date.now(),
    };
  }

  async forceDestroy(): Promise<void> {
    log.warn('Force destroying WhatsApp client');

    this.clientState.destroyInProgress = true;

    try {
      if (this.clientState.client) {
        this.removeClientEventHandlers(this.clientState.client);
      }

      this.clientState.cleanup();

      if (this.clientState.client) {
        try {
          await this.clientState.client.destroy();
        } catch (error) {
          log.error('Error during force destroy', error);
        }
        this.clientState.client = null;
      }

      await this.forceCloseBrowser();

      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      this.circuitBreaker.reset();
    } finally {
      this.clientState.browser = null;
      this.clientState.page = null;
      this.clientState.destroyInProgress = false;
    }
  }

  async simpleDestroy(): Promise<{ success: boolean; message?: string; error?: string }> {
    log.info(
      'Destroying WhatsApp client - closing browser but preserving authentication'
    );

    this.clientState.destroyInProgress = true;
    this.messageState.manualDisconnect = true;

    try {
      if (this.clientState.client) {
        this.removeClientEventHandlers(this.clientState.client);

        try {
          await this.clientState.client.destroy();
          log.info(
            'WhatsApp client destroyed successfully - authentication preserved'
          );
        } catch (error) {
          log.error('Error during destroy', error);
          await this.forceCloseBrowser();
        }
        this.clientState.client = null;
      }

      this.clientState.cleanup();
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      await this.messageState.setQR(null);

      messageSessionManager.completeAllSessions();
      this.circuitBreaker.reset();

      return {
        success: true,
        message: 'Client destroyed - browser closed, authentication preserved',
      };
    } catch (error) {
      log.error('Error during simple destruction', error);
      await this.forceCloseBrowser();
      return { success: false, error: 'Destroy failed: ' + (error as Error).message };
    } finally {
      this.clientState.browser = null;
      this.clientState.page = null;
      this.clientState.destroyInProgress = false;
      this.messageState.manualDisconnect = false;
    }
  }

  async completeLogout(): Promise<{ success: boolean; message?: string; error?: string }> {
    log.info(
      'Starting complete WhatsApp client logout with authentication cleanup'
    );

    this.clientState.destroyInProgress = true;
    this.messageState.manualDisconnect = true;

    try {
      if (this.clientState.client) {
        this.removeClientEventHandlers(this.clientState.client);

        try {
          await this.clientState.client.logout();
          log.info(
            'WhatsApp client logged out successfully - authentication cleared by logout()'
          );
        } catch (error) {
          log.error('Error during logout', error);
          try {
            await this.clientState.client.destroy();
          } catch (destroyError) {
            log.error('Error during destroy', destroyError);
            await this.forceCloseBrowser();
          }
        }
        this.clientState.client = null;
      }

      this.clientState.cleanup();
      this.clientState.setState('DISCONNECTED');
      await this.messageState.setClientReady(false);
      await this.messageState.setQR(null);

      messageSessionManager.completeAllSessions();
      this.circuitBreaker.reset();

      return {
        success: true,
        message: 'Client logged out - authentication completely cleared',
      };
    } catch (error) {
      log.error('Error during complete logout', error);
      await this.forceCloseBrowser();
      return { success: false, error: 'Logout failed: ' + (error as Error).message };
    } finally {
      this.clientState.browser = null;
      this.clientState.page = null;
      this.clientState.destroyInProgress = false;
      this.messageState.manualDisconnect = false;
    }
  }

  async healthCheck(): Promise<Record<string, unknown>> {
    const status = this.getDetailedStatus();

    if (this.clientState.client && this.clientState.isState('CONNECTED')) {
      try {
        const state = await this.clientState.client.getState();
        (status as Record<string, unknown>).healthCheck = {
          clientResponsive: true,
          clientState: state,
          timestamp: Date.now(),
        };
      } catch (error) {
        (status as Record<string, unknown>).healthCheck = {
          clientResponsive: false,
          error: (error as Error).message,
          timestamp: Date.now(),
        };
      }
    }

    return status;
  }

  async validateSessionQuality(): Promise<SessionQuality> {
    try {
      // Async fs so a large/bloated Chrome profile dir doesn't block the event
      // loop — this runs on init AND on every QR event (handleQR).
      const fsp = (await import('fs/promises')).default;
      const path = await import('path');

      const exists = async (p: string): Promise<boolean> => {
        try {
          await fsp.access(p);
          return true;
        } catch {
          return false;
        }
      };

      const sessionPath = '.wwebjs_auth/session-client/Default';

      if (!(await exists(sessionPath))) {
        log.debug('Session quality: none (path does not exist)');
        return 'none';
      }

      try {
        const sessionStats = await fsp.stat(sessionPath);
        const sessionAgeMs = Date.now() - sessionStats.birthtimeMs;

        if (sessionAgeMs < 10000) {
          log.debug(
            `Session quality: new (session created ${Math.floor(sessionAgeMs / 1000)}s ago, assuming valid)`
          );
          return 'valid';
        }
      } catch {
        log.debug('Could not determine session age, continuing validation');
      }

      const indexedDBPath = path.default.join(sessionPath, 'IndexedDB');
      const indexedDBWhatsAppPath = path.default.join(
        indexedDBPath,
        'https_web.whatsapp.com_0.indexeddb.leveldb'
      );

      if (!(await exists(indexedDBPath))) {
        try {
          const parentStats = await fsp.stat(sessionPath);
          const parentAgeMs = Date.now() - parentStats.mtimeMs;

          if (parentAgeMs < 30000) {
            log.debug(
              `Session quality: initializing (modified ${Math.floor(parentAgeMs / 1000)}s ago, waiting for IndexedDB)`
            );
            return 'valid';
          }
        } catch {
          // Can't determine age, continue
        }

        log.debug('Session quality: empty (IndexedDB directory missing after 30s)');
        return 'empty';
      }

      let indexedDBDataFileCount = 0;
      if (await exists(indexedDBWhatsAppPath)) {
        try {
          const indexedDBFiles = await fsp.readdir(indexedDBWhatsAppPath);
          indexedDBDataFileCount = indexedDBFiles.filter((f) => f.endsWith('.ldb')).length;

          log.debug(
            `IndexedDB contains ${indexedDBDataFileCount} WhatsApp data files`
          );

          // LevelDB needs a MANIFEST file pointed to by CURRENT. If Chromium
          // was killed mid-MANIFEST-rewrite, CURRENT can reference a file that
          // never finished being written. Chromium will then fail to open the
          // database with "Internal error opening backing store", WA Web will
          // log out, and every restore retry hits the same wall.
          const currentPath = path.default.join(indexedDBWhatsAppPath, 'CURRENT');
          if (await exists(currentPath)) {
            const manifestName = (await fsp.readFile(currentPath, 'utf8')).trim();
            if (manifestName) {
              const manifestPath = path.default.join(indexedDBWhatsAppPath, manifestName);
              if (!(await exists(manifestPath))) {
                log.warn(
                  `Session quality: corrupted (CURRENT references missing ${manifestName})`
                );
                return 'corrupted';
              }
            }
          }
        } catch (error) {
          log.warn('Session quality: corrupted (IndexedDB read error)', {
            error: (error as Error).message,
          });
          return 'corrupted';
        }
      }

      const leveldbPath = path.default.join(sessionPath, 'Local Storage/leveldb');

      if (await exists(leveldbPath)) {
        try {
          const leveldbFiles = await fsp.readdir(leveldbPath);
          log.debug(`Local Storage contains ${leveldbFiles.length} files`);
        } catch (error) {
          log.warn('Session quality: corrupted (leveldb read error)', {
            error: (error as Error).message,
          });
          return 'corrupted';
        }
      }

      let totalSize = 0;
      const calculateDirSize = async (dirPath: string): Promise<void> => {
        try {
          const files = await fsp.readdir(dirPath, { withFileTypes: true });
          for (const file of files) {
            const filePath = path.default.join(dirPath, file.name);
            try {
              if (file.isDirectory()) {
                await calculateDirSize(filePath);
              } else {
                const stats = await fsp.stat(filePath);
                totalSize += stats.size;
              }
            } catch {
              log.debug(`Skipping file in size calculation: ${filePath}`);
            }
          }
        } catch {
          log.debug(`Skipping directory in size calculation: ${dirPath}`);
        }
      };

      await calculateDirSize(sessionPath);

      if (totalSize > 1024 * 1024) {
        // Mature session by total size, but the WA Web auth keys live
        // exclusively in IndexedDB. If Chrome was killed mid-write and
        // wiped the .ldb files, the session is unrecoverable even though
        // Local Storage / cookies remain.
        if (indexedDBDataFileCount === 0) {
          log.warn(
            `Session quality: corrupted (size ${Math.floor(totalSize / 1024)}KB but 0 IndexedDB data files - auth keys gone)`
          );
          return 'corrupted';
        }
        log.info(
          `Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, mature session)`
        );
        return 'valid';
      }

      if (totalSize > 100 * 1024 && indexedDBDataFileCount >= 5) {
        log.info(
          `Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, ${indexedDBDataFileCount} IndexedDB files)`
        );
        return 'valid';
      }

      if (totalSize > 10 * 1024 && indexedDBDataFileCount > 0) {
        log.info(
          `Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, ${indexedDBDataFileCount} IndexedDB files, fresh session)`
        );
        return 'valid';
      }

      if (totalSize < 10 * 1024) {
        log.debug(`Session quality: empty (size ${totalSize} bytes < 10KB after 10s)`);
        return 'empty';
      }

      if (indexedDBDataFileCount === 0) {
        log.debug(`Session quality: empty (no IndexedDB data files after 10s)`);
        return 'empty';
      }

      log.info(
        `Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, assuming valid by default)`
      );
      return 'valid';
    } catch (error) {
      log.error('Error validating session quality', {
        error: (error as Error).message,
      });
      return 'corrupted';
    }
  }

  async checkExistingSession(): Promise<boolean> {
    const quality = await this.validateSessionQuality();
    return quality === 'valid';
  }

  async cleanupInvalidSession(maxRetries = 3): Promise<CleanupResult> {
    const fs = await import('fs');
    const sessionPath = '.wwebjs_auth/session-client';

    if (!fs.default.existsSync(sessionPath)) {
      log.debug('No session directory to clean up');
      return { success: true, reason: 'no_session' };
    }

    // A live/hung Chromium child still holds an OS handle on the session's
    // SQLite files (e.g. "Account Web Data"), so on Windows rmSync fails with
    // EBUSY no matter how many times we retry. Tear the client+browser down
    // first to release the handle. No-op when no in-process client exists
    // (e.g. the startup corrupted-session path).
    if (this.clientState.client) {
      log.info('Tearing down live client before session deletion to release file locks');
      await this.cleanupFailedClient();
    }

    // Hard delete — no recoverable copy. We only reach here on a genuine
    // 'corrupted' verdict (validateSessionQuality in performInitialization, and
    // the init-timeout re-validation), so there is no good session worth
    // keeping. The accuracy of that verdict is the only safety net: if it
    // misfires the cost is a re-scan, which is exactly the forcing function to
    // keep the detection correct instead of papering over it with backups.
    log.info('Deleting corrupted session directory');

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log.info(`Attempting session cleanup (attempt ${attempt}/${maxRetries})`);

        fs.default.rmSync(sessionPath, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 1000,
        });

        log.info('Session cleaned up successfully', { attempt });
        return { success: true, reason: 'deleted', attempt };
      } catch (error) {
        log.error(`Session cleanup attempt ${attempt} failed`, {
          error: (error as Error).message,
          code: (error as NodeJS.ErrnoException).code,
        });

        if (attempt < maxRetries) {
          const delay = 1000 * Math.pow(2, attempt - 1);
          log.info(`Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          log.error('Session cleanup failed after all retries', {
            maxRetries,
            error: (error as Error).message,
          });
          return {
            success: false,
            reason: 'cleanup_failed',
            error: (error as Error).message,
          };
        }
      }
    }

    return { success: false, reason: 'max_retries_exceeded' };
  }
}

// Export singleton instance
export default new WhatsAppService();
