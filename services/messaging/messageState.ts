// services/messaging/messageState.ts
import stateEvents from './stateEvents.js';
import StateManager from './StateManager.js';
import { MessageStatus } from './message-status.js';
import { log } from '../../utils/logger.js';

/**
 * State key constants
 */
const STATE_KEYS = {
  CLIENT_STATUS: 'client_status',
  MESSAGE_STATS: 'message_stats',
  PERSONS: 'persons',
  MESSAGE_STATUSES: 'message_statuses',
  QR_STATUS: 'qr_status',
} as const;

/**
 * Client status interface
 */
interface ClientStatus {
  ready: boolean;
  initializing: boolean;
  lastActivity: number;
  manualDisconnect: boolean;
}

/**
 * The progress of the CURRENT (or last) reminder batch — and only that batch.
 *
 * These counters used to grow on every `MessageSent`/`MessageFailed`, which the
 * service also emits for one-off sends (payment receipts, booking confirmations,
 * re-sends, task notices), and `finished` was only ever set true. So the /send
 * page's bar counted every message since the last restart (prod: 25 and 33
 * one-off sends before two 22-message batches → "26/22", pinned at 100 %), and a
 * second batch in the same process was "finished" after its first message
 * (audit FE-F16-1). Now `startBatch()` zeroes them, only the batch loop counts
 * (`recordBatchResult`), and the frames + `/api/wa/initial-state` report this.
 */
export interface BatchProgress {
  started: boolean;
  finished: boolean;
  total: number;
  sent: number;
  failed: number;
  /** The appointment date the batch is for (YYYY-MM-DD), null before the first batch. */
  date: string | null;
  /** Why the batch stopped early (never started, connection lost), null on a normal finish. */
  error: string | null;
}

interface MessageStats extends BatchProgress {
  finishReport: boolean;
}

const IDLE_STATS: MessageStats = {
  started: false,
  finished: false,
  total: 0,
  sent: 0,
  failed: 0,
  date: null,
  error: null,
  finishReport: false,
};

/**
 * Person interface
 */
export interface Person {
  messageId: string;
  status?: number;
  success?: string;
  addedAt?: number;
  lastUpdated?: number;
  phone?: string;
  name?: string;
  number?: string;
  patientId?: number;
  appointmentId?: number;
  errorMessage?: string;
  error?: string;
}

/**
 * QR status interface
 */
interface QRStatus {
  qr: string | null;
  activeViewers: number;
  generationActive: boolean;
  lastRequested: number | null;
}

/**
 * State dump interface
 */
export interface StateDump {
  clientReady: boolean;
  sentMessages: number;
  failedMessages: number;
  finishedSending: boolean;
  personsCount: number;
  statusUpdatesCount: number;
  activeQRViewers: number;
  lastActivity: number;
  persons?: Person[];
  messageStatuses?: Array<[string, number]>;
  qrStatus?: QRStatus;
}

class MessageStateManager {
  private stateKeys = STATE_KEYS;
  private initialized = false;

  constructor() {
    // Defer to next tick so the StateManager singleton is fully initialized,
    // then set up event handlers only once the initial state is in place.
    setTimeout(() => {
      this.initializeState()
        .then(() => this.setupEventHandlers())
        .catch((error) =>
          log.error('Error during MessageStateManager startup:', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
    }, 0);
  }

  private async initializeState(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize all state keys using the singleton instance
      await Promise.all([
        StateManager.atomicOperation<ClientStatus>(this.stateKeys.CLIENT_STATUS, () => ({
          ready: false,
          initializing: false,
          lastActivity: Date.now(),
          manualDisconnect: false,
        })),
        StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, () => ({ ...IDLE_STATS })),
        StateManager.atomicOperation<Map<string, Person>>(this.stateKeys.PERSONS, () => new Map()),
        StateManager.atomicOperation<Map<string, number>>(
          this.stateKeys.MESSAGE_STATUSES,
          () => new Map()
        ),
        StateManager.atomicOperation<QRStatus>(this.stateKeys.QR_STATUS, () => ({
          qr: null,
          activeViewers: 0,
          generationActive: false,
          lastRequested: null,
        })),
      ]);

      this.initialized = true;
      log.info('MessageStateManager initialized successfully');
    } catch (error) {
      log.error('Error initializing MessageStateManager:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private setupEventHandlers(): void {
    // Listen for cleanup events
    stateEvents.on('qr_cleanup_required', () => {
      this.cleanupQR();
    });

    stateEvents.on('client_disconnected', () => {
      this.handleClientDisconnect();
    });
  }

  /**
   * Get client ready status
   */
  get clientReady(): boolean {
    const status = StateManager.get<ClientStatus>(this.stateKeys.CLIENT_STATUS);
    return status?.ready || false;
  }

  /**
   * Set client ready status atomically
   */
  async setClientReady(ready: boolean): Promise<ClientStatus> {
    return StateManager.atomicOperation<ClientStatus>(this.stateKeys.CLIENT_STATUS, (current) => ({
      ...(current as ClientStatus),
      ready,
      lastActivity: Date.now(),
    }));
  }

  /**
   * Update message status atomically with rollback capability
   */
  async updateMessageStatus(
    messageId: string,
    status: number,
    dbOperation: (() => Promise<void>) | null = null
  ): Promise<boolean> {
    // Captured *inside* the locked closure below so the monotonic compare and the
    // write are one atomic critical section — two rapid acks for the same messageId
    // can no longer both read a stale value and let the lower status win.
    let applied = false;
    let oldStatus: number | null = null;

    try {
      await StateManager.atomicOperation<Map<string, number>>(
        this.stateKeys.MESSAGE_STATUSES,
        (statuses) => {
          const current = statuses || new Map<string, number>();
          oldStatus = current.get(messageId) ?? null;

          // Monotonic: only advance, never regress.
          if (oldStatus !== null && oldStatus >= status) {
            applied = false;
            return current; // unchanged
          }

          // Mutate in place under the lock (O(1), not O(n) clone) — safe because the
          // closure is a synchronous critical section and all readers snapshot via
          // Array.from(), so none can observe a half-written map.
          current.set(messageId, status);
          applied = true;
          return current;
        }
      );

      if (!applied) {
        return false;
      }

      // Execute database operation if provided
      if (dbOperation) {
        await dbOperation();
      }

      // Update persons array
      await this.updatePersonStatus(messageId, status);

      // Emit success event
      stateEvents.emit('message_status_updated', { messageId, status });

      return true;
    } catch (error) {
      // Rollback the in-memory bump on failure, restoring the exact prior state
      // (delete the key if there was no status before this call).
      if (applied) {
        await StateManager.atomicOperation<Map<string, number>>(
          this.stateKeys.MESSAGE_STATUSES,
          (statuses) => {
            const current = statuses || new Map<string, number>();
            // Only roll back if no concurrent write has since advanced the status.
            if (current.get(messageId) !== status) return current;
            if (oldStatus !== null) {
              current.set(messageId, oldStatus);
            } else {
              current.delete(messageId);
            }
            return current;
          }
        );
      }

      log.error(`Failed to update message status for ${messageId}:`, { error: error instanceof Error ? error.message : String(error) });
      stateEvents.emit('message_status_error', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update person status in persons array. Internal — the only caller is
   * updateMessageStatus(), which owns the monotonic ack ordering.
   */
  private async updatePersonStatus(messageId: string, status: number): Promise<void> {
    await StateManager.atomicOperation<Map<string, Person>>(this.stateKeys.PERSONS, (persons) => {
      const current = persons || new Map<string, Person>();
      const existing = current.get(messageId);
      if (!existing) return current; // unknown message — unchanged
      // O(1) in-place upsert under the lock (see updateMessageStatus for why this is safe).
      current.set(messageId, { ...existing, status, lastUpdated: Date.now() });
      return current;
    });
  }

  /**
   * Add person atomically with deduplication
   */
  async addPerson(person: Person): Promise<boolean> {
    // No send counters here: one-off sends (receipts, confirmations, re-sends)
    // come through addPerson too. The batch's own counts are `recordBatchResult`'s
    // (FE-F16-1).
    await StateManager.atomicOperation<Map<string, Person>>(this.stateKeys.PERSONS, (persons) => {
      const current = persons || new Map<string, Person>();
      const existing = current.get(person.messageId);

      if (existing) {
        // Update existing person instead of adding duplicate (O(1) in-place).
        current.set(person.messageId, {
          ...existing,
          ...person,
          lastUpdated: Date.now(),
        });
      } else {
        // New message — insert. Map preserves insertion order, so the array views
        // (persons getter / dump) keep the same ordering the array append produced.
        // PENDING is only the DEFAULT: a caller that already knows the outcome
        // (index.ts's MessageFailed handler) passes its own status, and clobbering
        // it here left every failed send permanently recorded as PENDING — nothing
        // downstream ever transitions a person that was born failed.
        current.set(person.messageId, {
          ...person,
          addedAt: Date.now(),
          status: person.status ?? (person.success === '&times;' ? MessageStatus.ERROR : MessageStatus.PENDING),
        });
      }
      return current;
    });

    return true;
  }

  /**
   * Handle QR viewer registration
   */
  async registerQRViewer(viewerId?: string): Promise<QRStatus> {
    const result = await StateManager.atomicOperation<QRStatus>(
      this.stateKeys.QR_STATUS,
      (qrStatus) => {
        const current = qrStatus || {
          qr: null,
          activeViewers: 0,
          generationActive: false,
          lastRequested: null,
        };
        return {
          ...current,
          activeViewers: (current.activeViewers || 0) + 1,
          generationActive: true,
          lastRequested: Date.now(),
        };
      }
    );

    // Emit the event when viewers connect
    stateEvents.emit('qr_viewer_connected');

    log.info(
      `QR viewer ${viewerId || 'unknown'} registered. Active viewers: ${result.activeViewers}`
    );
    return result;
  }

  /**
   * Handle QR viewer unregistration
   */
  async unregisterQRViewer(viewerId?: string): Promise<boolean> {
    const result = await StateManager.atomicOperation<QRStatus>(
      this.stateKeys.QR_STATUS,
      (qrStatus) => {
        const current = qrStatus || {
          qr: null,
          activeViewers: 0,
          generationActive: false,
          lastRequested: null,
        };
        const newViewers = Math.max(0, (current.activeViewers || 0) - 1);
        return {
          ...current,
          activeViewers: newViewers,
          lastRequested: Date.now(),
        };
      }
    );

    // Schedule cleanup if no viewers. unref() so this fire-and-forget timer
    // never keeps the process alive during graceful shutdown.
    if (result.activeViewers === 0 && !this.clientReady) {
      setTimeout(() => {
        const current = StateManager.get<QRStatus>(this.stateKeys.QR_STATUS);
        if (current && current.activeViewers === 0) {
          stateEvents.emit('qr_cleanup_required');
        }
      }, 60000).unref();
    }

    log.info(`QR viewer ${viewerId || 'unknown'} unregistered.`);
    return true;
  }

  /**
   * Set QR code
   */
  async setQR(qr: string | null): Promise<QRStatus> {
    return StateManager.atomicOperation<QRStatus>(this.stateKeys.QR_STATUS, (qrStatus) => ({
      ...(qrStatus || {
        qr: null,
        activeViewers: 0,
        generationActive: false,
        lastRequested: null,
      }),
      qr,
      lastRequested: Date.now(),
    }));
  }

  /**
   * Get QR code
   */
  get qr(): string | null {
    const qrStatus = StateManager.get<QRStatus>(this.stateKeys.QR_STATUS);
    return qrStatus?.qr || null;
  }

  /**
   * Get active QR viewers count
   */
  get activeQRViewers(): number {
    const qrStatus = StateManager.get<QRStatus>(this.stateKeys.QR_STATUS);
    return qrStatus?.activeViewers || 0;
  }

  /**
   * Set finish report status
   */
  async setFinishReport(finished: boolean): Promise<MessageStats> {
    return StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, (stats) => ({
      ...(stats || IDLE_STATS),
      finishReport: finished,
    }));
  }

  /** A reminder batch begins: its counters start from zero (FE-F16-1). */
  async startBatch(date: string, total: number): Promise<BatchProgress> {
    const next = await StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, (stats) => ({
      ...(stats || IDLE_STATS),
      started: true,
      finished: false,
      total,
      sent: 0,
      failed: 0,
      date,
      error: null,
    }));
    return toBatchProgress(next);
  }

  /** One recipient of the running batch was attempted. */
  async recordBatchResult(ok: boolean): Promise<BatchProgress> {
    const next = await StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, (stats) => {
      const current = stats || IDLE_STATS;
      return ok ? { ...current, sent: current.sent + 1 } : { ...current, failed: current.failed + 1 };
    });
    return toBatchProgress(next);
  }

  /**
   * The running batch ended. `error` says why it stopped early; a batch that
   * failed before it began (circuit breaker open, the eligibility read threw) is
   * recorded as started-and-finished with that error, so the page can say so.
   */
  async finishBatch(error: string | null = null): Promise<BatchProgress> {
    const next = await StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, (stats) => ({
      ...(stats || IDLE_STATS),
      started: true,
      finished: true,
      error,
    }));
    return toBatchProgress(next);
  }

  /** The current (or last) batch's progress. */
  get batchProgress(): BatchProgress {
    return toBatchProgress(StateManager.get<MessageStats>(this.stateKeys.MESSAGE_STATS) || IDLE_STATS);
  }

  /**
   * Get manual disconnect status
   */
  get manualDisconnect(): boolean {
    const status = StateManager.get<ClientStatus>(this.stateKeys.CLIENT_STATUS);
    return status?.manualDisconnect || false;
  }

  /**
   * Set manual disconnect status
   */
  set manualDisconnect(value: boolean) {
    StateManager.atomicOperation<ClientStatus>(this.stateKeys.CLIENT_STATUS, (current) => ({
      ...(current as ClientStatus),
      manualDisconnect: value,
    })).catch((error) =>
      log.error('Failed to set manualDisconnect:', { error: error instanceof Error ? error.message : String(error) })
    );
  }

  /**
   * Reset the message-send session: send stats, per-message persons, and ack
   * statuses. Used between send batches (restart() and the manual clear()).
   *
   * Deliberately does NOT touch CLIENT_STATUS or QR_STATUS. Client readiness is
   * lifecycle state owned by the ready/disconnected handlers, and activeViewers
   * is the live SSE QR-viewer count owned by register/unregisterQRViewer —
   * neither is part of a send session. Clearing them here used to backfire:
   * restart() calls reset() *after* the client has already reconnected and
   * fired `ready`, so resetting CLIENT_STATUS flipped clientReady back to false
   * (server reporting not-ready while actually connected) and zeroed the viewer
   * count out from under still-open streams. restart() already clears
   * clientReady/qr explicitly before re-init, so reset() owes them nothing.
   */
  async reset(): Promise<void> {
    log.info('Resetting message-send session state');

    await Promise.all([
      StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, () => ({ ...IDLE_STATS })),

      StateManager.atomicOperation<Map<string, Person>>(this.stateKeys.PERSONS, () => new Map()),
      StateManager.atomicOperation<Map<string, number>>(
        this.stateKeys.MESSAGE_STATUSES,
        () => new Map()
      ),
    ]);

    stateEvents.emit('state_reset');
  }

  /**
   * Get current state dump
   */
  dump(detailed = false): StateDump {
    const clientStatus = StateManager.get<ClientStatus>(this.stateKeys.CLIENT_STATUS) || {
      ready: false,
      initializing: false,
      lastActivity: Date.now(),
      manualDisconnect: false,
    };
    const messageStats = StateManager.get<MessageStats>(this.stateKeys.MESSAGE_STATS) || IDLE_STATS;
    const personsMap =
      StateManager.get<Map<string, Person>>(this.stateKeys.PERSONS) || new Map<string, Person>();
    const persons = Array.from(personsMap.values());
    const messageStatuses =
      StateManager.get<Map<string, number>>(this.stateKeys.MESSAGE_STATUSES) || new Map();
    const qrStatus = StateManager.get<QRStatus>(this.stateKeys.QR_STATUS) || {
      qr: null,
      activeViewers: 0,
      generationActive: false,
      lastRequested: null,
    };

    const dump: StateDump = {
      clientReady: clientStatus.ready || false,
      sentMessages: messageStats.sent || 0,
      failedMessages: messageStats.failed || 0,
      finishedSending: messageStats.finished || false,
      personsCount: persons.length || 0,
      statusUpdatesCount: messageStatuses.size || 0,
      activeQRViewers: qrStatus.activeViewers || 0,
      lastActivity: clientStatus.lastActivity || Date.now(),
    };

    if (detailed) {
      dump.persons = persons;
      dump.messageStatuses = Array.from(messageStatuses.entries());
      dump.qrStatus = qrStatus;
    }

    return dump;
  }

  /**
   * Get persons array
   */
  get persons(): Person[] {
    const map = StateManager.get<Map<string, Person>>(this.stateKeys.PERSONS);
    return map ? Array.from(map.values()) : [];
  }

  // Cleanup methods
  cleanupQR(): void {
    log.info('Cleaning up QR code');
    StateManager.atomicOperation<QRStatus>(this.stateKeys.QR_STATUS, (qrStatus) => ({
      ...(qrStatus || {
        qr: null,
        activeViewers: 0,
        generationActive: false,
        lastRequested: null,
      }),
      qr: null,
      generationActive: false,
    })).catch((error) =>
      log.error('Failed to clean up QR code:', { error: error instanceof Error ? error.message : String(error) })
    );
  }

  handleClientDisconnect(): void {
    StateManager.atomicOperation<ClientStatus>(this.stateKeys.CLIENT_STATUS, (status) => ({
      ...(status || { ready: false, initializing: false, lastActivity: Date.now(), manualDisconnect: false }),
      ready: false,
      lastActivity: Date.now(),
    })).catch((error) =>
      log.error('Failed to handle client disconnect:', { error: error instanceof Error ? error.message : String(error) })
    );
  }

  /**
   * Clean up all resources
   */
  cleanup(): void {
    StateManager.cleanup();
    stateEvents.removeAllListeners();
  }
}

function toBatchProgress(stats: MessageStats): BatchProgress {
  const { started, finished, total, sent, failed, date, error } = stats;
  return { started, finished, total, sent, failed, date, error };
}

// Create singleton instance
const messageStateManagerInstance = new MessageStateManager();

// Export singleton
export default messageStateManagerInstance;
