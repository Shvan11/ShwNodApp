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
import pdfGenerator from '../pdf/appointment-pdf-generator.js';
import { getGroupSettings } from './group-settings.js';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth, MessageMedia } = pkg;

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
  sendMessage(chatId: string, content: string | unknown, options?: unknown): Promise<{ id: { id: string } }>;
  getChats(): Promise<WhatsAppChat[]>;
  getChatById(chatId: string): Promise<{ fetchMessages(options: { limit: number }): Promise<WhatsAppMessage[]> }>;
  pupBrowser?: PuppeteerBrowser;
  pupPage?: PuppeteerPage;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * LocalAuth strategy (partial) — the bits unlink() needs. `logout()` is the
 * library's own session-clear (`fs.rm(userDataDir, …)`); `userDataDir` is only
 * populated after the client has initialized, so the retained instance must be
 * the one that was actually used.
 */
interface LocalAuthStrategy {
  logout(): Promise<void>;
  userDataDir?: string;
}

/**
 * WhatsApp message interface
 */
interface WhatsAppMessage {
  id: { id: string };
  ack?: number;
}

/**
 * WhatsApp chat interface (partial — only the fields group lookup reads)
 */
interface WhatsAppChat {
  id: { _serialized: string };
  name: string;
  isGroup: boolean;
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

  // Ready watchdog: recovers the "authenticated but `ready` never fires" stall by
  // auto-restarting; if that's exhausted, parks for a manual re-link (see
  // armReadyWatchdog / parkForRelink).
  private readyWatchdog: ReturnType<typeof setTimeout> | null = null;
  private readyWatchdogRestarts = 0;

  // Monotonic id for each initialization attempt. Overlapping triggers — the ready
  // watchdog, scheduleReconnect, and EVERY open auth page's on-demand init — can
  // start a fresh attempt while an older one is still pending. The older attempt's
  // late completion (most damagingly its init TIMEOUT firing ~120s after it was
  // abandoned) must NOT run cleanupFailedClient()/setState('ERROR') against the
  // newer attempt's healthy, already-CONNECTED client — that was the observed
  // CONNECTED→ERROR flap. performInitialization bumps this on entry; only the
  // current epoch may mutate shared client state on failure.
  private initEpoch = 0;

  // The boot-time orphan-Chrome sweep runs only on the FIRST init since process
  // start: a prior process generation (e.g. a service restart whose detached Chrome
  // outlived the old node) can leave a chrome.exe bound to our profile. After boot,
  // restart() does a TARGETED ensureProfileUnlocked(priorProc); an untargeted
  // profile-wide kill on every restart would risk killing a concurrent attempt's
  // live browser during an overlap.
  private hasSweptOrphansAtBoot = false;

  // Set when a session has authenticated but never reached `ready` across the
  // watchdog's whole restart budget — i.e. the persisted session is poisoned
  // (loads enough to authenticate, can't finish syncing; validateSessionQuality
  // still rates it 'valid' so nothing else catches it). MANUAL-ONLY recovery: we
  // stop all auto-reconnect/auto-init so we don't thrash reloading the dead
  // session, and wait for an explicit Re-link (unlink()). It NEVER triggers an
  // automatic session clear. Cleared by unlink()/restart()/a real `ready`.
  private needsRelink = false;

  // The LocalAuth instance backing the live client, retained so unlink() can call
  // ITS OWN logout() (the library's session-clear) instead of our reaching into
  // .wwebjs_auth with fs. userDataDir is only set after the client inits, so we
  // must reuse this exact instance, never a fresh one.
  private authStrategy: LocalAuthStrategy | null = null;

  // Liveness heartbeat: a plain network drop can kill the socket WITHOUT firing
  // `disconnected`/`change_state`, so we poll getState() to catch silent death
  // (see startHeartbeat).
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatMisses = 0;

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
      needsRelink: this.needsRelink,
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

    // Do NOT short-circuit here when the breaker is OPEN. The OPEN→HALF_OPEN
    // transition (and the actual re-probe) happens only inside
    // circuitBreaker.execute() in performInitialization(). Gating the breaker here
    // would mean execute() never runs again once it opens, so the breaker could
    // never self-heal AND the scheduleReconnect() loop would dead-lock after the
    // failure threshold (performInitialization()'s catch is the only thing that
    // reschedules — it never runs if we throw first), leaving the client dead until
    // a manual restart(). Let the call fall through: execute() fast-throws while
    // genuinely OPEN (its catch reschedules) and half-opens once the cooldown
    // elapses, so an unattended server recovers from a transient outage on its own.

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
    // Tag this attempt. Overlapping triggers can abandon it mid-flight; its late
    // failure must then become a no-op instead of tearing down whatever client a
    // newer attempt has since made live (see the superseded-attempt guard below).
    const myEpoch = ++this.initEpoch;
    log.info('Starting initialization', { forceRestart, attempt: myEpoch });

    try {
      // BOOT-ONLY orphan sweep: a prior PROCESS generation (e.g. a service restart
      // whose detached Chrome grandchildren outlived the old node — node-windows
      // doesn't reap the whole tree, and a hard/looping shutdown can skip WhatsApp's
      // graceful destroy) can leave an orphaned chrome.exe bound to THIS LocalAuth
      // profile. Puppeteer may launch ALONGSIDE it WITHOUT throwing "browser is
      // already running", but the new page then authenticates yet never reaches
      // `ready` (its in-page WA store can't open the contended profile) — and the
      // watchdog mis-parks a healthy session. A stale `lockfile` check missed this: a
      // LIVE orphan holds SingletonLock/Cookie/Socket + the ProcessSingleton mutex,
      // not `lockfile`. Sweep on the FIRST init since process start ONLY — after boot,
      // restart() does a TARGETED ensureProfileUnlocked(priorProc); an untargeted
      // profile-wide kill on every restart would risk killing a concurrent attempt's
      // healthy browser during an overlap.
      if (!this.clientState.client && !this.hasSweptOrphansAtBoot) {
        this.hasSweptOrphansAtBoot = true;
        await this.ensureProfileUnlocked();
      }

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
      // SUPERSEDED-ATTEMPT GUARD. If a newer init attempt started since ours began
      // (the ready watchdog, scheduleReconnect, or an open auth page's on-demand init
      // all fire independently), that newer attempt now owns this.clientState.client —
      // possibly a healthy, already-CONNECTED one. Our late failure here is most often
      // this attempt's init TIMEOUT firing ~120s after it was abandoned; running
      // cleanupFailedClient()/setState('ERROR') would destroy the LIVE client and flap
      // CONNECTED→ERROR. Bail without side effects — the attempt that superseded us
      // owns the client and its own recovery.
      if (this.initEpoch !== myEpoch) {
        log.warn(
          'Superseded WhatsApp init attempt failed — ignoring (leaving the live client intact)',
          { attempt: myEpoch, current: this.initEpoch, error: (error as Error)?.message }
        );
        throw error;
      }

      // A failed initialize() leaves the Puppeteer Chrome alive and holding
      // the userDataDir lock, so every subsequent retry fails with
      // "browser is already running for ...session-client". Tear it down now.
      await this.cleanupFailedClient();

      // If the launch collided with a browser that already owns the profile,
      // clear the lock + any orphan chrome.exe so the scheduled reconnect can
      // actually succeed instead of hitting the same collision forever.
      const initErrMsg = (error as Error)?.message || '';
      if (/already running|ProcessSingleton/i.test(initErrMsg)) {
        await this.ensureProfileUnlocked();
      }

      this.clientState.setState('ERROR', error as Error);
      await this.messageState.setClientReady(false);

      if (!this.messageState.manualDisconnect && !this.clientState.destroyInProgress) {
        this.scheduleReconnect(error as Error);
      }

      throw error;
    } finally {
      // Only the current attempt may clear the SHARED init timer/abort controller —
      // a superseded attempt's finally would otherwise cancel the live attempt's
      // timeout/abort mid-flight.
      if (this.initEpoch === myEpoch) {
        this.clientState.clearInitializationTimeout();
        if (this.clientState.initializationAbortController) {
          this.clientState.initializationAbortController = null;
        }
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
    // Retain the auth strategy: unlink() calls its own logout() to clear the
    // session via the library, and its userDataDir is only populated once this
    // client initializes — so we must hold THIS instance, not construct a new one.
    const authStrategy = new LocalAuth({ clientId: 'client' });
    this.authStrategy = authStrategy as unknown as LocalAuthStrategy;

    const client = new Client({
      authStrategy,
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

    // Tell the UI the scan worked so it stops presenting the QR as if it failed,
    // even though `ready` (which marks the client usable) may still be seconds
    // away — or may never arrive (handled by the watchdog below).
    this.broadcastReadyState(false, 'authenticated', 'Authenticated — finishing connection…');

    // Always arm the ready watchdog. whatsapp-web.js frequently fires
    // `authenticated` but never `ready` on both fresh QR links (post-auth
    // navigation destroys Puppeteer's injected context) AND session restores after
    // an unclean shutdown (Ctrl+C / service kill) — same symptom, same fix: a
    // restart reloads the persisted session cleanly and `ready` fires in ~1s.
    // A legitimate slow restore reaches ready well within the 75s window; if it
    // hasn't arrived by then the client is stuck, not just slow.
    this.armReadyWatchdog();

    log.info('Waiting 60s for session to stabilize...');

    const SESSION_STABILIZATION_DELAY = 60000;

    await new Promise((resolve) => setTimeout(resolve, SESSION_STABILIZATION_DELAY));

    this.clientState.sessionStabilized = true;
    log.info('Session stabilized - safe to restart');
  }

  private async handleReady(): Promise<void> {
    log.info('Client ready');

    // `ready` arrived — cancel the watchdog, reset its restart budget, and clear
    // any "needs re-link" park (the session is demonstrably healthy now).
    this.clearReadyWatchdog();
    this.readyWatchdogRestarts = 0;
    this.needsRelink = false;

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

    // Connected — start the liveness heartbeat so a silently-dropped socket gets
    // detected and recovered instead of sitting dead until the next send fails.
    this.startHeartbeat();
  }

  /** Cancel a pending ready-watchdog (ready arrived, or we're tearing down). */
  private clearReadyWatchdog(): void {
    if (this.readyWatchdog) {
      clearTimeout(this.readyWatchdog);
      this.readyWatchdog = null;
    }
  }

  /**
   * After `authenticated`, give `ready` a bounded window to arrive; if it
   * doesn't, restart once to reload the freshly-persisted session — the proven
   * recovery for whatsapp-web.js's "authenticated but never ready" fresh-link
   * stall (post-auth navigation kills the injected context, so `ready` never
   * fires, yet a restart that reloads the saved session reaches ready in ~1s).
   *
   * Fires AFTER the 60s stabilization window so the restart never races session
   * persistence, and is capped by MAX_RESTARTS so a genuinely broken session
   * can't loop forever. The CONNECTED guard makes it a no-op if ready did fire.
   */
  private armReadyWatchdog(): void {
    this.clearReadyWatchdog();
    const READY_WATCHDOG_DELAY_MS = 75000;
    const READY_WATCHDOG_MAX_RESTARTS = 2;

    this.readyWatchdog = setTimeout(() => {
      this.readyWatchdog = null;

      // Ready arrived (or we've otherwise left the auth flow) — nothing to do.
      if (this.clientState.isState('CONNECTED') || this.messageState.clientReady) {
        return;
      }

      if (this.readyWatchdogRestarts >= READY_WATCHDOG_MAX_RESTARTS) {
        // Restarts reload the SAME persisted session, which keeps authenticating
        // but never reaching ready — the session is poisoned. We do NOT auto-clear
        // it (manual-only by design): park, stop thrashing, and surface a
        // "needs re-link" state so a human can re-scan via unlink().
        log.error(
          'WhatsApp authenticated but never became ready after auto-restarts — parking for manual re-link',
          { restarts: this.readyWatchdogRestarts }
        );
        void this.parkForRelink('authenticated but never ready').catch((err) =>
          log.error('parkForRelink failed', { error: (err as Error).message })
        );
        return;
      }

      this.readyWatchdogRestarts += 1;
      log.warn(
        'Authenticated but no `ready` event — auto-restarting to reload the persisted session',
        { attempt: this.readyWatchdogRestarts, maxAttempts: READY_WATCHDOG_MAX_RESTARTS }
      );
      void this.restart().catch((err) => {
        log.error('Ready-watchdog restart failed', { error: (err as Error).message });
      });
    }, READY_WATCHDOG_DELAY_MS);

    // Never let this timer hold the process open during shutdown.
    if (typeof this.readyWatchdog.unref === 'function') {
      this.readyWatchdog.unref();
    }
  }

  /**
   * Park the client for a MANUAL re-link. Called when a session authenticated but
   * never reached `ready` across the watchdog's full restart budget — the session
   * is poisoned and reloading it again only thrashes. We tear the dead browser
   * down (freeing resources) but DELIBERATELY keep the session on disk — clearing
   * it is a human decision (the Re-link button → unlink()). `needsRelink` then
   * gates off auto-reconnect and on-demand init so nothing silently reloads the
   * dead session; the UI shows a "session expired — re-link" state via the SSE
   * frame below.
   */
  private async parkForRelink(reason: string): Promise<void> {
    this.needsRelink = true;
    this.clearReadyWatchdog();
    this.stopHeartbeat();
    this.clientState.clearReconnectTimer();
    // Suppress the reconnect paths during teardown; `needsRelink` is the durable
    // guard afterwards (manualDisconnect's setter is async, so it only covers the
    // window before the flag propagates).
    this.messageState.manualDisconnect = true;

    try {
      await this.destroyClient('relink-park');
    } catch (error) {
      log.error('parkForRelink: client teardown failed', { error: (error as Error).message });
    } finally {
      // From here on `needsRelink` blocks auto-reconnect/auto-init; release the
      // transient manualDisconnect so unlink()/restart() can manage it normally.
      this.messageState.manualDisconnect = false;
    }

    this.clientState.setState('ERROR', new Error(`Needs re-link: ${reason}`));
    await this.messageState.setClientReady(false);
    await this.messageState.setQR(null);
    this.broadcastReadyState(
      false,
      'needs_relink',
      'WhatsApp session expired — please re-link the device (scan a new QR).'
    );
    log.warn('WhatsApp parked for manual re-link', { reason });
  }

  /**
   * Manual re-link: clear the stored WhatsApp session through the LIBRARY's own
   * API (never our own fs surgery on .wwebjs_auth) and start fresh so a new QR
   * appears. The ONLY recovery for a poisoned "authenticated but never ready"
   * session — every other path reloads or preserves it. Triggered exclusively by
   * an explicit user action (the Re-link / Logout button) — manual-only by design.
   *
   * Reliable-clear sequence:
   *   1. If the page is healthy, client.logout() does a clean WhatsApp-side device
   *      unlink AND clears the folder itself (Client.logout() ends in
   *      authStrategy.logout()); on a stuck page it throws → fall through.
   *   2. Close the browser and release the profile lock (ensureProfileUnlocked
   *      kills any orphan Chrome bound to THIS profile) so the delete can't hit
   *      Windows EBUSY.
   *   3. authStrategy.logout() — the retained, initialized LocalAuth's own
   *      fs.rm(userDataDir, {recursive, force, maxRetries}) — clears
   *      .wwebjs_auth/session-client correctly.
   *   4. Re-initialize → a fresh QR arrives over SSE.
   */
  async unlink(): Promise<{ success: boolean; error?: string }> {
    log.warn('Manual WhatsApp re-link requested — clearing session for a fresh QR');
    this.clearReadyWatchdog();
    this.stopHeartbeat();
    this.clientState.clearReconnectTimer();
    this.clientState.destroyInProgress = true;
    this.messageState.manualDisconnect = true;
    this.broadcastReadyState(false, 'relinking', 'Re-linking WhatsApp — a new QR is on the way…');

    // Capture the live browser PID before destroy: in QR/stuck mode
    // clientState.browser is null, so the client's pupBrowser is the only handle
    // ensureProfileUnlocked can use.
    const priorProc = this.clientState.client?.pupBrowser?.process?.() ?? null;
    let cleared = false;

    try {
      if (this.clientState.client) {
        this.removeClientEventHandlers(this.clientState.client);
        try {
          // Clean path: unlinks the device on WhatsApp AND clears the folder.
          await withTimeout(this.clientState.client.logout(), 15000, 'client.logout');
          cleared = true;
          log.info('Clean WhatsApp logout succeeded — device unlinked and session cleared');
        } catch (logoutErr) {
          log.warn('Clean logout unavailable (stuck page) — destroying + clearing via LocalAuth', {
            error: (logoutErr as Error).message,
          });
          try {
            await withTimeout(this.clientState.client.destroy(), 15000, 'client.destroy');
          } catch (destroyErr) {
            log.error('unlink: destroy failed — force-closing browser', {
              error: (destroyErr as Error).message,
            });
            await this.forceCloseBrowser();
          }
        }
        this.clientState.client = null;
      }

      // Fallback clear: release locks (kill orphan Chrome on this profile) then use
      // the library's own session-clear. Skipped if client.logout() already did it.
      if (!cleared) {
        await this.ensureProfileUnlocked(priorProc);
        if (this.authStrategy) {
          try {
            await this.authStrategy.logout();
            log.info('Session cleared via LocalAuth.logout()');
            cleared = true;
          } catch (err) {
            log.error('LocalAuth.logout() could not clear the session folder', {
              error: (err as Error).message,
            });
          }
        } else {
          log.warn('unlink: no retained LocalAuth instance — nothing on disk to clear');
          cleared = true; // nothing to clear counts as cleared
        }
      }

      // Reset park + lifecycle guards so the fresh init below runs cleanly.
      this.clientState.cleanup();
      this.clientState.setState('DISCONNECTED');
      this.needsRelink = false;
      this.readyWatchdogRestarts = 0;
      this.circuitBreaker.reset();
      messageSessionManager.completeAllSessions();
      await this.messageState.setClientReady(false);
      await this.messageState.setQR(null);
      await this.messageState.reset();
    } catch (error) {
      log.error('unlink failed', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    } finally {
      this.clientState.destroyInProgress = false;
      this.messageState.manualDisconnect = false;
    }

    if (!cleared) {
      // The clear genuinely failed (e.g. files still locked). Do NOT init into the
      // same poison — stay parked so the user can retry / escalate.
      this.needsRelink = true;
      this.broadcastReadyState(
        false,
        'needs_relink',
        'Could not clear the WhatsApp session — please retry re-linking.'
      );
      return {
        success: false,
        error: 'Could not clear the session folder (it may be locked); please retry.',
      };
    }

    // Fire-and-forget fresh init: no session on disk → straight to QR mode.
    // Awaiting would block past the HTTP timeout (FRESH_AUTH_TIMEOUT 90s); the QR
    // arrives over SSE.
    this.initialize().catch((err) => {
      log.error('unlink: fresh init failed', { error: (err as Error).message });
    });

    return { success: true };
  }

  /** Stop the liveness heartbeat and reset its miss counter. */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatMisses = 0;
  }

  /**
   * Start the liveness heartbeat. whatsapp-web.js does NOT fire `disconnected` on
   * a plain network drop, so a connection can die silently and we'd only discover
   * it when the next send fails. Every 60s we ask the page for `client.getState()`;
   * two consecutive non-`CONNECTED`/error probes mean the socket is dead → restart
   * (which reloads the saved session, no QR needed). Debounced by two misses to
   * ride out getState()'s known transient flakiness. Started on `ready`, stopped
   * on every teardown; idempotent (safe to call on repeated `ready` events).
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    const HEARTBEAT_INTERVAL_MS = 60000;
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeatTick();
    }, HEARTBEAT_INTERVAL_MS);
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  private async heartbeatTick(): Promise<void> {
    // Only probe when we BELIEVE we're up; the init/reconnect paths own every
    // other state, and a user-initiated teardown must not be fought.
    if (
      !this.clientState.isState('CONNECTED') ||
      !this.messageState.clientReady ||
      this.clientState.destroyInProgress ||
      this.messageState.manualDisconnect
    ) {
      return;
    }

    const client = this.clientState.client;
    if (!client) return;

    const HEARTBEAT_MAX_MISSES = 2;
    let state: string | null = null;
    let probeFailed = false;
    try {
      state = await Promise.race([
        client.getState(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('getState timeout')), 10000)
        ),
      ]);
    } catch (err) {
      probeFailed = true;
      log.debug('WhatsApp heartbeat probe threw', { error: (err as Error).message });
    }

    // 'CONNECTED' is the only healthy value; anything else (or a throw) is a miss.
    if (!probeFailed && state === 'CONNECTED') {
      this.heartbeatMisses = 0;
      return;
    }

    this.heartbeatMisses += 1;
    log.warn('WhatsApp heartbeat miss — connection may be dead', {
      state: state ?? 'error',
      miss: this.heartbeatMisses,
      maxMisses: HEARTBEAT_MAX_MISSES,
    });

    if (this.heartbeatMisses < HEARTBEAT_MAX_MISSES) return;

    log.error('WhatsApp connection is silently dead — restarting to recover', {
      lastState: state ?? 'error',
    });
    this.stopHeartbeat(); // restart() starts a fresh one on the next `ready`
    void this.restart().catch((err) => {
      log.error('Heartbeat-triggered restart failed', { error: (err as Error).message });
    });
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
    this.clearReadyWatchdog();
    this.stopHeartbeat();
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
    // Parked for manual re-link: the session is poisoned, so reconnecting would
    // only reload it and stall again. Wait for the user (unlink()).
    if (this.needsRelink) {
      log.debug('Reconnect skipped — session parked for manual re-link');
      return;
    }
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

    this.clearReadyWatchdog();
    this.stopHeartbeat();
    // Explicit user retry — lift any re-link park so this attempt runs. (If the
    // session is still poisoned it will re-stall and the watchdog re-parks; the
    // session-clearing fix is unlink(), not restart, which preserves auth.)
    this.needsRelink = false;
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

      // Capture the live Chrome's PID BEFORE destroying the client. In QR mode
      // `ready` never fired, so clientState.browser is null — the only handle to
      // the running browser is the client's pupBrowser. We need the PID to be
      // sure the process is gone before relaunching: a still-dying or orphaned
      // Chrome keeps owning the LocalAuth profile and makes initialize() throw
      // "The browser is already running for …session-client".
      const priorProc = this.clientState.client?.pupBrowser?.process?.() ?? null;

      if (this.clientState.client) {
        try {
          await Promise.race([
            this.clientState.client.destroy(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Client destroy timeout')), 15000)
            ),
          ]);
          log.info('Client destroyed for restart - authentication preserved');
        } catch (error) {
          log.error(
            'Error destroying client during restart - will force-unlock the profile',
            error
          );
        }
        this.clientState.client = null;
      }

      // Make absolutely sure no Chrome still owns the profile, else the
      // initialize() below fails with "browser is already running".
      await this.ensureProfileUnlocked(priorProc);

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
    this.clearReadyWatchdog();
    this.stopHeartbeat();

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

  /**
   * Guarantee the LocalAuth Chrome profile is free before (re)launching.
   *
   * Puppeteer refuses to launch on a profile another Chrome still owns and throws
   * "The browser is already running for <userDataDir>" — on Windows it detects a
   * leftover `<dir>\lockfile` plus Chrome's ProcessSingleton mutex held by a live
   * chrome.exe (BrowserLauncher.js). A bare destroy() can leave the old chrome.exe
   * still dying, and an unclean prior shutdown (e.g. the SIGHUP console-disconnect
   * path) can orphan one entirely. So we: (1) hard-kill the browser we had a handle
   * to and wait for it to actually exit, (2) on Windows kill any orphan chrome.exe
   * still bound to THIS profile (matched by command line, so the user's own Chrome
   * is never touched), then (3) delete the stale lock files.
   */
  private async ensureProfileUnlocked(
    trackedProc: { kill?: (signal: string) => void; pid?: number } | null = null
  ): Promise<void> {
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const sessionDir = pathMod.default.resolve('.wwebjs_auth', 'session-client');

    if (trackedProc?.pid) {
      await this.killPidAndWait(trackedProc.pid);
    }

    if (process.platform === 'win32') {
      await this.killWindowsChromeForProfile(sessionDir);
    }

    for (const name of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try {
        fsMod.default.rmSync(pathMod.default.join(sessionDir, name), {
          force: true,
          maxRetries: 3,
          retryDelay: 200,
        });
      } catch (err) {
        log.debug(`Profile unlock: could not remove ${name}`, {
          error: (err as Error).message,
        });
      }
    }
  }

  /** SIGKILL a PID, then poll (signal 0) until it's actually gone or we time out. */
  private async killPidAndWait(pid: number, timeoutMs = 8000): Promise<void> {
    try {
      process.kill(pid, 'SIGKILL');
      log.info('Killed leftover WhatsApp Chrome process', { pid });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return; // already gone
      log.debug('killPidAndWait: initial kill failed', {
        pid,
        error: (err as Error).message,
      });
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        process.kill(pid, 0); // probe: throws ESRCH once the process is gone
      } catch {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    log.warn('Leftover Chrome process still alive after kill timeout', { pid });
  }

  /**
   * Kill any chrome.exe whose command line references THIS LocalAuth profile dir.
   * Targeted on purpose — it must never close the staff member's personal Chrome,
   * only the orphaned WhatsApp-Web browser bound to our --user-data-dir.
   */
  private async killWindowsChromeForProfile(sessionDir: string): Promise<void> {
    if (process.platform !== 'win32') return;
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const run = promisify(execFile);

      const needle = sessionDir.replace(/'/g, "''"); // escape single quotes for PS
      const script =
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
        `Where-Object { $_.CommandLine -and $_.CommandLine -like '*${needle}*' } | ` +
        `ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $_.ProcessId } catch {} }`;

      const { stdout } = await run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: 10000, windowsHide: true, encoding: 'utf8' }
      );
      const pids = String(stdout).trim();
      if (pids) {
        log.warn('Killed orphan Chrome bound to the WhatsApp profile', {
          pids: pids.split(/\s+/),
        });
      }
    } catch (err) {
      log.debug('Orphan-Chrome scan failed (non-fatal)', {
        error: (err as Error).message,
      });
    }
  }

  private scheduleClientCleanup(): void {
    log.debug(
      'Automatic cleanup disabled - client will persist until manually destroyed'
    );
  }

  /**
   * Generate the daily appointments PDF (the same report the email path builds)
   * and post it to the staff WhatsApp group named {@link APPOINTMENTS_GROUP_NAME}.
   *
   * Best-effort: any failure (PDF gen, group not found, send error) is logged and
   * swallowed so it can never interrupt the per-patient notification batch.
   */
  private async sendAppointmentsPdfToGroup(date: string): Promise<void> {
    try {
      // Runtime-configurable from the /send page (persisted in the options table).
      const { enabled, groupName } = await getGroupSettings();
      if (!enabled) {
        log.info('Appointments group PDF disabled in settings — skipping', { date });
        return;
      }

      const client = this.clientState.client;
      if (!client) {
        log.warn('Skipping appointments group PDF — WhatsApp client unavailable', { date });
        return;
      }

      // Reuse the exact PDF report the email notification attaches.
      const pdfResult = await pdfGenerator.generateAppointmentPDF(date);

      // Locate the target group by exact chat name (no direct name→id lookup in
      // whatsapp-web.js, so scan the chat list).
      const chats = await client.getChats();
      const group = chats.find((chat) => chat.isGroup && chat.name?.trim() === groupName);
      if (!group) {
        log.warn('Appointments WhatsApp group not found — skipping group PDF', {
          date,
          groupName,
        });
        return;
      }

      const media = new MessageMedia(
        'application/pdf',
        pdfResult.buffer.toString('base64'),
        `appointments-${date}.pdf`
      );

      const formattedDate = new Date(date).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
      const caption = `Daily Appointments — ${formattedDate}\nTotal: ${pdfResult.appointmentCount}`;

      await client.sendMessage(group.id._serialized, media, { caption });

      log.info('Posted appointments PDF to WhatsApp group', {
        date,
        groupName,
        chatId: group.id._serialized,
        appointmentCount: pdfResult.appointmentCount,
      });
    } catch (error) {
      log.error('Failed to post appointments PDF to WhatsApp group', {
        date,
        error: (error as Error).message,
      });
    }
  }

  async send(date: string): Promise<SendResult[] | void> {
    if (!this.isReady()) {
      throw new Error('WhatsApp client not ready to send messages');
    }

    return this.circuitBreaker.execute(async () => {
      log.info(`Starting message sending session for date: ${date}`);

      // Post the full appointment list (as PDF) to the staff group. Done once per
      // batch, before the per-patient loop, so it fires even when no patient
      // reminders are pending. Best-effort: never let a group failure abort sends.
      await this.sendAppointmentsPdfToGroup(date);

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

    // Honor WHATSAPP_AUTO_INIT=false as a TRUE kill-switch: block every
    // automatic init path, not just the boot one (index.ts gates boot the same
    // way). The global SSE subscription registers a QR viewer for every logged-in
    // user, so without this gate the on-demand path would auto-start WhatsApp
    // regardless of the flag. Manual start (whatsapp.initialize() via
    // POST /api/wa/initialize) bypasses this and still works.
    if (process.env.WHATSAPP_AUTO_INIT === 'false') {
      log.debug('On-demand init skipped — WHATSAPP_AUTO_INIT=false (manual start only)');
      return false;
    }

    // Parked for manual re-link: don't auto-init into the poisoned session when a
    // QR viewer connects. The user must explicitly Re-link (unlink()).
    if (this.needsRelink) {
      log.debug('On-demand init skipped — session parked for manual re-link');
      return false;
    }

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
