/**
 * `ClientStateManager` — the WhatsApp client's state machine and the mutex that
 * serializes every lifecycle transition (init / restart / destroy).
 *
 * Split out of whatsapp.ts (S2/C6): it was already a self-contained class there,
 * moved verbatim. It owns the live `client`/`browser` handles, so it is the ONE
 * place that decides whether a transition is allowed.
 */
import stateEvents from './stateEvents.js';
import { log } from '../../utils/logger.js';
import type {
  ClientState,
  ClientStatus,
  LockWaiter,
  PuppeteerBrowser,
  WhatsAppClient,
} from './whatsapp-types.js';

export class ClientStateManager {
  public state: ClientState = 'DISCONNECTED';
  public client: WhatsAppClient | null = null;
  public browser: PuppeteerBrowser | null = null;
  public initializationPromise: Promise<boolean> | null = null;
  /**
   * Set for the WHOLE of a restart() — the teardown as well as the init that
   * follows — so callers join the restart instead of racing its teardown.
   * Deliberately NOT cleared by cleanup(): restart() calls cleanup() partway
   * through itself and its single-flight guard has to survive that. Owned by
   * restart(), which clears it by identity.
   */
  public restartPromise: Promise<boolean> | null = null;
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
  /**
   * Identifies the CURRENT lock holder. A holder releases by presenting its token,
   * so an ABANDONED attempt — one whose lock was force-released by cleanup() while
   * it was still running — presents a stale token and its release becomes a no-op.
   * Without this its late release would free the lock out from under whatever
   * attempt replaced it, letting the next caller launch a second Chrome against the
   * same LocalAuth profile.
   */
  private lockToken = 0;

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

  /**
   * Take the initialization lock. Resolves with the caller's OWNER TOKEN, which
   * must be handed back to releaseInitializationLock().
   */
  async acquireInitializationLock(timeoutMs: number = this.MAX_LOCK_WAIT_TIME): Promise<number> {
    if (!this.initializationLock) {
      this.initializationLock = Date.now();
      return ++this.lockToken;
    }

    // A lock older than the timeout is only ORPHANED if no attempt is actually
    // running behind it — age alone is not evidence. An attempt is NOT bounded by
    // INITIALIZATION_TIMEOUT: the `qr` handler in createAndInitializeClient cancels
    // the outer wait and opens a fresh FRESH_AUTH_TIMEOUT scan window, so a
    // legitimate session→QR fallback runs SESSION_RESTORATION_TIMEOUT +
    // FRESH_AUTH_TIMEOUT before its cleanup even starts. Stealing on age would
    // therefore take the lock from a healthy slow attempt and start a second Chrome
    // on the same LocalAuth profile — which authenticates but never reaches `ready`,
    // so the watchdog mis-parks a good session as "needs re-link". The in-flight
    // promise is the liveness signal: present means a real attempt owns this lock
    // (wait for it), absent means the holder is gone and the lock is free to take.
    const lockAge = Date.now() - this.initializationLock;
    const attemptInFlight = this.initializationPromise ?? this.restartPromise;
    if (lockAge > this.INITIALIZATION_TIMEOUT && !attemptInFlight) {
      log.warn(`Force releasing orphaned lock (no attempt in flight)`, { lockAge });
      this.forceReleaseLock();
      this.initializationLock = Date.now();
      return ++this.lockToken;
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
          resolve(++this.lockToken);
        },
        reject: () => {
          clearTimeout(timeout);
          reject(new Error('Lock acquisition cancelled'));
        },
      };

      this.lockWaiters.push(waitEntry);
    });
  }

  releaseInitializationLock(token: number): void {
    // Only the CURRENT holder may release. An attempt that was abandoned mid-flight
    // (cleanup() force-released its lock, a replacement then took it) carries a
    // stale token — its release has to be a no-op, or it frees the replacement's
    // lock and a third caller starts a second browser alongside a live attempt.
    if (!this.initializationLock || token !== this.lockToken) {
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
    // Invalidate the outgoing holder's token. Its attempt may still be running, and
    // its eventual release must not free a lock a newer attempt has since taken.
    this.lockToken++;

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
      hasActivePromise: !!(this.initializationPromise ?? this.restartPromise),
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

    // Explicitly ABANDON any in-flight attempt's registration: cleanup() runs when
    // the caller (restart/unlink) is about to replace that attempt, so joiners must
    // not be handed the dying one. Safe because an owner now clears by identity —
    // the abandoned attempt can no longer null its replacement's registration on the
    // way out. restartPromise is deliberately NOT cleared: restart() calls cleanup()
    // partway through itself and its single-flight guard has to survive it.
    this.initializationPromise = null;

    this.forceReleaseLock();

    this.state = 'DISCONNECTED';
    this.reconnectAttempts = 0;
    this.lastError = null;
    this.destroyInProgress = false;

    log.debug('ClientStateManager cleanup completed');
  }
}
